import logging

from rest_framework import viewsets, status
from rest_framework.decorators import api_view, permission_classes, action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from django.utils import timezone
import json

logger = logging.getLogger(__name__)

from django.shortcuts import get_object_or_404
from django.http import HttpResponse
from googleapiclient.errors import HttpError
from . import drive_client
from . import supabase_client
from django.http import HttpResponseRedirect
from .models import Employee, DTRBatch, SyncLog, FundPayment, SheetsSyncState, Attachment, TreasuryTransaction
from .serializers import EmployeeSerializer, DTRBatchSerializer, FundPaymentSerializer, AttachmentSerializer, TreasuryTransactionSerializer
from . import sheets_sync
from .permissions import IsSuperAdmin, CanManageEmployees, CanManageDTR, CanManageFunds, CanAccessAttachment
from rest_framework.exceptions import NotFound, ValidationError
from django.db import transaction
from .models import ActivityLog

def perform_employee_swap(request_data, replaced_id, replaced_local_id, user):
    with transaction.atomic():
        old_employee = None
        if replaced_id:
            old_employee = Employee.objects.select_for_update().filter(id=replaced_id).first()
        if not old_employee and replaced_local_id:
            old_employee = Employee.objects.select_for_update().filter(local_id=replaced_local_id).first()

        if old_employee is None:
            raise NotFound("Employee to be replaced was not found.")
        if not old_employee.is_active:
            raise ValidationError({"replaced_employee_id": "Employee is already archived or replaced."})

        old_employee.is_active = False
        old_employee.end_date = timezone.now().date()
        
        if hasattr(old_employee, 'user_profile') and old_employee.user_profile.user:
            old_employee.user_profile.user.is_active = False
            old_employee.user_profile.user.save()
        old_employee.save()

        data = {
            **request_data,
            'duty': old_employee.duty,
            'office': old_employee.office,
            'start_date': timezone.now().date()
        }
        serializer = EmployeeSerializer(data=data)
        serializer.is_valid(raise_exception=True)
        new_employee = serializer.save()

        if hasattr(old_employee, 'user_profile') and old_employee.user_profile.user:
            ActivityLog.objects.create(
                user=old_employee.user_profile.user,
                action="Employee Replaced",
                description=f"Account archived and replaced by {new_employee.name}."
            )

    from .models import SheetsSyncState
    from . import sheets_sync
    SheetsSyncState.mark_dirty()
    try:
        sheets_sync.run_sync_if_needed()
    except Exception as exc:
        logger.warning("Inline sheet sync failed (non-fatal): %s", exc)

    return Response({
        "new_employee": EmployeeSerializer(new_employee).data,
        "replaced_employee": EmployeeSerializer(old_employee).data
    }, status=status.HTTP_201_CREATED)

class EmployeeViewSet(viewsets.ModelViewSet):
    serializer_class = EmployeeSerializer

    def get_permissions(self):
        """
        Permission tiers:
        - list / retrieve        → IsAuthenticated (all roles can read)
        - create / update        → CanManageEmployees (SuperAdmin, President, VP)
        - destroy (archive/soft) → CanManageEmployees (President/VP can archive departing members)
        - hard_delete (custom)   → IsSuperAdmin only (irreversible, permanent)
        """
        if self.action == 'hard_delete':
            return [IsSuperAdmin()]
        if self.action in ('create', 'update', 'partial_update', 'destroy'):
            return [CanManageEmployees()]
        return [IsAuthenticated()]

    def create(self, request, *args, **kwargs):
        replaced_id = request.data.pop('replaced_employee_id', None)
        replaced_local_id = request.data.pop('replaced_local_id', None)
        if replaced_id or replaced_local_id:
            return perform_employee_swap(request.data, replaced_id, replaced_local_id, request.user)
        return super().create(request, *args, **kwargs)

    def get_queryset(self):
        qs = Employee.objects.all()
        active_param = self.request.query_params.get('active', None)
        if active_param == 'true':
            qs = qs.filter(is_active=True)
        elif active_param == 'false':
            qs = qs.filter(is_active=False)
        return qs

    def destroy(self, request, *args, **kwargs):
        """Soft-delete (archive): sets is_active=False and disables the linked User account.
        President and VP can perform this for routine member departures.
        Use hard_delete (SuperAdmin only) for permanent removal."""
        employee = self.get_object()
        end_date = request.data.get('end_date', None)
        employee.is_active = False
        if end_date:
            employee.end_date = end_date
        employee.save()
        if hasattr(employee, 'user_profile') and employee.user_profile.user:
            employee.user_profile.user.is_active = False
            employee.user_profile.user.save()
        return Response({'status': 'archived'}, status=status.HTTP_200_OK)

    @action(detail=True, methods=['delete'], url_path='hard-delete')
    def hard_delete(self, request, pk=None):
        """Permanent removal of the Employee record (SuperAdmin only).
        The linked User account is completely deleted as requested.
        Fund payments become orphaned rows with employee=NULL, still visible in the Fund Tracker.
        """
        employee = self.get_object()
        # Delete the linked User account completely
        if hasattr(employee, 'user_profile') and employee.user_profile.user:
            user = employee.user_profile.user
            user.delete()
        # Deleting the Employee now leaves FundPayment.employee = NULL (SET_NULL)
        # preserving all historical payment records.
        employee.delete()
        return Response({'status': 'Funds cleared successfully.'}, status=status.HTTP_200_OK)


class DTRBatchViewSet(viewsets.ModelViewSet):
    queryset = DTRBatch.objects.all()
    serializer_class = DTRBatchSerializer

    def get_permissions(self):
        """All authenticated users can read; only DTR managers can write."""
        if self.request.method in ('GET', 'HEAD', 'OPTIONS'):
            return [IsAuthenticated()]
        return [CanManageDTR()]

    def create(self, request, *args, **kwargs):
        data = request.data.copy()
        employees_data = data.pop('employees', [])
        batch = DTRBatch(
            label=data.get('label', ''),
            month=data.get('month', 1),
            year=data.get('year', 2024),
            cutoff=data.get('cutoff', 1),
            local_id=data.get('local_id', None),
        )
        batch.set_employees(employees_data)
        batch.save()
        return Response(DTRBatchSerializer(batch).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        batch = self.get_object()
        data = request.data.copy()
        employees_data = data.pop('employees', None)
        batch.label = data.get('label', batch.label)
        batch.month = data.get('month', batch.month)
        batch.year = data.get('year', batch.year)
        batch.cutoff = data.get('cutoff', batch.cutoff)
        if employees_data is not None:
            batch.set_employees(employees_data)
        batch.save()
        return Response(DTRBatchSerializer(batch).data)


# ── HIGHEST HARM: fund payment write path ─────────────────────────────────────
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def fund_payments_list(request):
    """GET /api/fund-payments/?year=2026 — returns all payments for a given year."""
    year = request.query_params.get('year')
    qs = FundPayment.objects.select_related('employee')
    if year:
        qs = qs.filter(year=int(year))
    serializer = FundPaymentSerializer(qs, many=True)
    return Response(serializer.data)

@api_view(['POST'])
@permission_classes([CanManageFunds])
def fund_payment_upsert(request):
    """Create or update a single fund payment record."""
    employee_local_id = request.data.get('employee_local_id')
    employee_id = request.data.get('employee_id')
    year = request.data.get('year')
    month = request.data.get('month')
    cutoff = request.data.get('cutoff')
    amount = request.data.get('amount', 0)

    emp = None
    if employee_id:
        emp = Employee.objects.filter(id=employee_id).first()
    if not emp and employee_local_id:
        emp = Employee.objects.filter(local_id=str(employee_local_id)).first()

    if not emp:
        return Response({'error': 'Employee not found'}, status=status.HTTP_404_NOT_FOUND)

    obj, _ = FundPayment.objects.update_or_create(
        employee=emp,
        year=int(year),
        month=int(month),
        cutoff=int(cutoff),
        defaults={'amount': amount},
    )

    # Mark sheet as dirty and run a throttled sync (at most once per 60s).
    SheetsSyncState.mark_dirty()
    try:
        sheets_sync.run_sync_if_needed()
    except Exception as exc:
        logger.warning("Inline sheet sync failed (non-fatal): %s", exc)

    # Log to ActivityLog for the affected user
    try:
        from .models import ActivityLog, UserProfile
        profile = UserProfile.objects.filter(employee=emp).select_related('user').first()
        month_names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        m_name = month_names[int(month) - 1] if 1 <= int(month) <= 12 else str(month)
        c_name = '15' if int(cutoff) == 1 else '31'
        recorded_by = request.user.username

        # Log for the employee whose funds were changed
        if profile and profile.user:
            desc = f"Payment set to PHP {float(amount):.2f} for {m_name} {c_name} (Edited by {recorded_by})"
            ActivityLog.objects.create(
                user=profile.user,
                action="Fund Payment Updated",
                description=desc
            )
        
        # Log for the admin who performed the change
        ActivityLog.objects.create(
            user=request.user,
            action="Edited Fund Payment",
            description=f"You updated a fund payment for {emp.name} ({m_name} {c_name})."
        )
    except Exception as e:
        logger.error(f"Failed to create ActivityLog in upsert: {e}")

    return Response(FundPaymentSerializer(obj).data, status=status.HTTP_200_OK)


# ── Sync queue — requires auth; action-level checks below ─────────────────────
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def sync_view(request):
    """Receives sync queue items from the frontend. Auth required."""
    action = request.data.get('action')
    payload = request.data.get('payload', {})
    role = getattr(getattr(request.user, 'profile', None), 'role', None)

    # Action-level authorization — mirrors the permission matrix
    WRITE_ACTIONS_EMPLOYEE = {'CREATE_EMPLOYEE', 'UPDATE_EMPLOYEE', 'ARCHIVE_EMPLOYEE', 'RESTORE_EMPLOYEE', 'REPLACE_EMPLOYEE'}
    DELETE_ACTIONS = {'DELETE_EMPLOYEE'}
    DTR_ACTIONS = {'CREATE_BATCH', 'UPDATE_BATCH'}
    FUND_ACTIONS = {'UPSERT_FUND_PAYMENT'}

    if action in DELETE_ACTIONS and role != 'SuperAdmin':
        return Response({'error': 'Only SuperAdmin can delete employees.'}, status=status.HTTP_403_FORBIDDEN)
    if action in WRITE_ACTIONS_EMPLOYEE and role not in {'SuperAdmin', 'President', 'Vice President'}:
        return Response({'error': 'Insufficient permissions to modify employees.'}, status=status.HTTP_403_FORBIDDEN)
    if action in DTR_ACTIONS and role not in {'SuperAdmin', 'President', 'Vice President', 'Secretary'}:
        return Response({'error': 'Insufficient permissions to manage DTR.'}, status=status.HTTP_403_FORBIDDEN)
    if action in FUND_ACTIONS and role not in {'SuperAdmin', 'President', 'Vice President', 'Treasurer'}:
        return Response({'error': 'Insufficient permissions to edit fund records.'}, status=status.HTTP_403_FORBIDDEN)

    log = SyncLog(action=action, payload=json.dumps(payload))
    try:
        if action == 'CREATE_EMPLOYEE':
            emp = Employee.objects.create(
                name=payload.get('name', ''),
                duty=payload.get('duty', 'AM'),
                office=payload.get('office') or None,
                start_date=payload.get('start') or None,
                is_active=payload.get('is_active', True),
                local_id=str(payload.get('localId', '')),
            )
        elif action == 'UPDATE_EMPLOYEE':
            update_fields = {
                'name': payload.get('name', ''),
                'duty': payload.get('duty', 'AM'),
                'start_date': payload.get('start') or None,
                'office': payload.get('office') or None,
            }
            if 'is_active' in payload:
                update_fields['is_active'] = payload['is_active']
            if 'end_date' in payload:
                update_fields['end_date'] = payload.get('end_date') or None
            Employee.objects.filter(local_id=str(payload.get('id', ''))).update(**update_fields)
        elif action == 'ARCHIVE_EMPLOYEE':
            emp = Employee.objects.filter(local_id=str(payload.get('id', ''))).first()
            if emp:
                emp.is_active = False
                emp.end_date = payload.get('end_date') or None
                emp.save()
                if hasattr(emp, 'user_profile') and emp.user_profile.user:
                    emp.user_profile.user.is_active = False
                    emp.user_profile.user.save()
        elif action == 'RESTORE_EMPLOYEE':
            emp = Employee.objects.filter(local_id=str(payload.get('id', ''))).first()
            if emp:
                emp.is_active = True
                emp.end_date = None
                emp.save()
                if hasattr(emp, 'user_profile') and emp.user_profile.user:
                    emp.user_profile.user.is_active = True
                    emp.user_profile.user.save()
        elif action == 'REPLACE_EMPLOYEE':
            replaced_id = payload.get('replaced_employee_id', None)
            replaced_local_id = payload.get('replaced_local_id', None)
            perform_employee_swap(payload, replaced_id, replaced_local_id, request.user)
        elif action == 'DELETE_EMPLOYEE':
            Employee.objects.filter(local_id=str(payload.get('id', ''))).delete()
        elif action == 'UPSERT_FUND_PAYMENT':
            emp = Employee.objects.filter(local_id=str(payload.get('employeeId', ''))).first()
            if emp:
                FundPayment.objects.update_or_create(
                    employee=emp,
                    year=payload.get('year'),
                    month=payload.get('month'),
                    cutoff=payload.get('cutoff'),
                    defaults={'amount': payload.get('amount', 0)},
                )
                SheetsSyncState.mark_dirty()
                # Mirror the direct endpoint: attempt a throttled inline sync so
                # offline-queued fund edits reach Sheets promptly, not just on
                # the next manual "Sync Now" click.
                try:
                    sheets_sync.run_sync_if_needed()
                except Exception as exc:
                    logger.warning("Inline sheet sync (sync_view) failed (non-fatal): %s", exc)
        elif action == 'CREATE_BATCH':
            batch = DTRBatch(
                label=payload.get('label', ''),
                month=payload.get('month', 1),
                year=payload.get('year', 2024),
                cutoff=payload.get('cutoff', 1),
                local_id=str(payload.get('localId', '')),
            )
            batch.set_employees(payload.get('employees', []))
            batch.save()
        elif action == 'UPDATE_BATCH':
            batch = DTRBatch.objects.filter(local_id=str(payload.get('id', ''))).first()
            if batch:
                batch.label = payload.get('label', batch.label)
                batch.set_employees(payload.get('employees', batch.get_employees()))
                batch.save()
        log.success = True
    except Exception as e:
        log.success = False
        log.payload = json.dumps({'error': str(e), 'original': payload})
    log.save()
    return Response({'status': 'ok', 'action': action})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def dashboard_view(request):
    from django.db.models import Count
    last_sync = SyncLog.objects.filter(success=True).order_by('-processed_at').first()
    return Response({
        'total_employees': Employee.objects.filter(is_active=True).count(),
        'total_batches': DTRBatch.objects.count(),
        'last_sync': last_sync.processed_at.strftime('%Y-%m-%d %H:%M') if last_sync else None,
    })



@api_view(['POST'])
@permission_classes([IsAuthenticated])
def sheets_sync_now(request):
    """
    POST /api/sheets-sync-now/
    Manually triggers a full, unconditional sync to Google Sheets.
    Called by the "Sync Now" button in the Fund Tracker UI.
    """
    result = sheets_sync.run_sync_now()
    state = SheetsSyncState.get()
    return Response({
        'synced': result.get('synced', False),
        'spreadsheet_id': result.get('spreadsheet_id'),
        'last_synced_at': state.last_synced_at.isoformat() if state.last_synced_at else None,
        'error': result.get('error'),
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def sheets_sync_status(request):
    """
    GET /api/sheets-sync-status/
    Returns current sync state for display in the Fund Tracker UI.
    """
    state = SheetsSyncState.get()
    return Response({
        'is_dirty': state.is_dirty,
        'spreadsheet_id': state.spreadsheet_id,
        'last_synced_at': state.last_synced_at.isoformat() if state.last_synced_at else None,
        'dirty_since': state.dirty_since.isoformat() if state.dirty_since else None,
    })


ALLOWED_MIME_TYPES = {
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
}
MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # 20 MB -- scanned multi-page PDFs can exceed 15 MB, modern phone photos can be several MB. Do not increase further without explicit reason due to memory pressure on free tiers.


@api_view(['POST'])
@permission_classes([CanAccessAttachment])
def attachment_upload(request):
    """
    POST /api/attachments/upload/
    multipart/form-data with fields: file, employee_id (optional), dtr_batch_id (optional), fund_payment_id (optional)
    """
    f = request.FILES.get('file')
    if not f:
        return Response({'error': 'No file provided.'}, status=status.HTTP_400_BAD_REQUEST)
    if f.content_type not in ALLOWED_MIME_TYPES:
        return Response({'error': f'Unsupported file type: {f.content_type}'}, status=status.HTTP_400_BAD_REQUEST)
    if f.size > MAX_UPLOAD_BYTES:
        return Response({'error': 'File too large.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        supabase_file_path = supabase_client.upload_file(f.read(), f.name)
    except Exception as e:
        logger.error("Supabase upload failed: %s", e)
        return Response({'error': 'Upload to storage failed. Please try again.'}, status=status.HTTP_502_BAD_GATEWAY)

    attachment = Attachment.objects.create(
        supabase_file_path=supabase_file_path,
        original_filename=f.name,
        mime_type=f.content_type,
        uploaded_by=request.user,
        employee_id=request.data.get('employee_id') or None,
        dtr_batch_id=request.data.get('dtr_batch_id') or None,
        fund_payment_id=request.data.get('fund_payment_id') or None,
    )
    return Response(AttachmentSerializer(attachment).data, status=status.HTTP_201_CREATED)


@api_view(['GET'])
@permission_classes([CanAccessAttachment])
def attachment_download(request, attachment_id):
    """
    GET /api/attachments/<id>/download/
    Proxies the file from Drive. Does NOT expose the raw Drive file/link to the client.
    """
    attachment = get_object_or_404(Attachment, id=attachment_id)
    # Perform object-level permission check for GET requests
    if not CanAccessAttachment().has_object_permission(request, attachment_download, attachment):
        return Response({'error': 'You do not have permission to view this attachment.'}, status=status.HTTP_403_FORBIDDEN)

    # Legacy Google Drive fallback
    if attachment.drive_file_id and not attachment.supabase_file_path:
        try:
            content, mime_type = drive_client.download_file(attachment.drive_file_id)
        except HttpError as e:
            logger.error("Drive download failed for attachment %s: %s", attachment_id, e)
            return Response({'error': 'File could not be retrieved.'}, status=status.HTTP_502_BAD_GATEWAY)

        response = HttpResponse(content, content_type=mime_type)
        response['Content-Disposition'] = f'inline; filename="{attachment.original_filename}"'
        return response

    # Supabase signed URL redirect
    try:
        url = supabase_client.get_signed_url(attachment.supabase_file_path, expires_in=600)
    except Exception as e:
        logger.error("Supabase download failed for attachment %s: %s", attachment_id, e)
        return Response({'error': 'File could not be retrieved.'}, status=status.HTTP_502_BAD_GATEWAY)

    return HttpResponseRedirect(url)


from decimal import Decimal
from django.db.models import Sum
from rest_framework import mixins
from rest_framework.exceptions import ValidationError

def _current_total_budget():
    contributions = FundPayment.objects.aggregate(total=Sum('amount'))['total'] or Decimal('0')
    deposits = TreasuryTransaction.objects.filter(
        transaction_type=TreasuryTransaction.TransactionType.DEPOSIT
    ).aggregate(total=Sum('amount'))['total'] or Decimal('0')
    withdrawals = TreasuryTransaction.objects.filter(
        transaction_type=TreasuryTransaction.TransactionType.WITHDRAWAL
    ).aggregate(total=Sum('amount'))['total'] or Decimal('0')
    fund_edit_adds = TreasuryTransaction.objects.filter(
        transaction_type=TreasuryTransaction.TransactionType.FUND_EDIT_ADD
    ).aggregate(total=Sum('amount'))['total'] or Decimal('0')
    fund_edit_subs = TreasuryTransaction.objects.filter(
        transaction_type=TreasuryTransaction.TransactionType.FUND_EDIT_SUB
    ).aggregate(total=Sum('amount'))['total'] or Decimal('0')
    return contributions + deposits - withdrawals + fund_edit_adds - fund_edit_subs


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def treasury_summary(request):
    """GET /api/treasury/summary/ — readable by all authenticated users."""
    return Response({'total_budget': str(_current_total_budget())})


class TreasuryTransactionViewSet(mixins.ListModelMixin,
                                  mixins.RetrieveModelMixin,
                                  mixins.CreateModelMixin,
                                  mixins.DestroyModelMixin,
                                  viewsets.GenericViewSet):
    """
    List/retrieve open to everyone authenticated (the public-to-org ledger view).
    Create/Destroy restricted to CanManageFunds.
    """
    queryset = TreasuryTransaction.objects.all()
    serializer_class = TreasuryTransactionSerializer

    def get_permissions(self):
        if self.action in ['create', 'destroy']:
            return [CanManageFunds()]
        return [IsAuthenticated()]

    def perform_create(self, serializer):
        user = self.request.user
        profile = getattr(user, 'profile', None)
        emp = getattr(profile, 'employee', None)
        recorded_by_name = (emp.name if emp else None) or user.username
        recorded_by_role = getattr(profile, 'role', 'Member')

        transaction_type = serializer.validated_data['transaction_type']
        amount = serializer.validated_data['amount']

        current_total = _current_total_budget()
        
        if transaction_type == TreasuryTransaction.TransactionType.WITHDRAWAL:
            if amount > current_total:
                raise ValidationError({'amount': f'Insufficient funds. Current budget is ₱{current_total}.'})
            new_balance = current_total - amount
        elif transaction_type == TreasuryTransaction.TransactionType.DEPOSIT:
            new_balance = current_total + amount
        elif transaction_type == TreasuryTransaction.TransactionType.FUND_EDIT_ADD:
            new_balance = current_total + amount
        elif transaction_type == TreasuryTransaction.TransactionType.FUND_EDIT_SUB:
            new_balance = current_total - amount
        else:
            new_balance = current_total

        tx = serializer.save(
            recorded_by=user,
            recorded_by_name=recorded_by_name,
            recorded_by_role=recorded_by_role,
            running_balance=new_balance,
        )

        # Log activity for affected employees if employee_changes are provided
        employee_changes = self.request.data.get('employee_changes', [])
        if employee_changes:
            from .models import ActivityLog, UserProfile
            for change in employee_changes:
                emp_id = change.get('emp_id')
                diff = change.get('diff', 0)
                month_name = change.get('month_name', '')
                cutoff = change.get('cutoff', '')
                
                if not emp_id or diff == 0:
                    continue
                    
                # Find the user associated with this employee
                profile = UserProfile.objects.filter(employee_id=emp_id).select_related('user').first()
                if profile and profile.user:
                    sign = '+' if diff > 0 else '-'
                    action = f"Fund Edit {'Addition' if diff > 0 else 'Subtraction'}"
                    desc = f"{sign}PHP {abs(diff):.2f} for {month_name} {cutoff} (Edited by {recorded_by_name})"
                    ActivityLog.objects.create(
                        user=profile.user,
                        action=action,
                        description=desc
                    )
            
            # Log for the admin performing the batch change
            ActivityLog.objects.create(
                user=user,
                action="Fund Batch Edit",
                description=f"You applied a batch fund edit affecting {len(employee_changes)} employees."
            )