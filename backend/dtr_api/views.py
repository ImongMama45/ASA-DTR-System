import logging

from rest_framework import viewsets, status
from rest_framework.decorators import api_view, permission_classes, action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from django.utils import timezone
from datetime import timedelta
from django.db import transaction
from django.core.cache import cache
import json

logger = logging.getLogger(__name__)

from django.shortcuts import get_object_or_404
from django.http import HttpResponse
from googleapiclient.errors import HttpError
from . import drive_client
from . import supabase_client
from django.http import HttpResponseRedirect
from .models import Employee, DTRBatch, SyncLog, FundPayment, SheetsSyncState, Attachment, TreasuryTransaction
from .models import AttendanceRecord, AttendanceAnomaly, EmployeeTardinessRecord, DTREndpoint
from django.db.models import F
from .serializers import EmployeeSerializer, DTRBatchSerializer, FundPaymentSerializer, AttachmentSerializer, TreasuryTransactionSerializer
from .serializers import AttendanceRecordSerializer, AttendanceAnomalySerializer, DTREndpointSerializer
from . import sheets_sync
from .permissions import IsSuperAdmin, CanManageEmployees, CanManageDTR, CanManageFunds, CanAccessAttachment, CanScanAttendance, IsAuthenticatedAndActive, IsOfficer
from rest_framework.exceptions import NotFound, ValidationError
from django.db import transaction
from .models import ActivityLog
from rest_framework.decorators import throttle_classes
from rest_framework.throttling import ScopedRateThrottle

# ─── Throttle Classes ──────────────────────────────────────────────────────────
class AttendanceLiveThrottle(ScopedRateThrottle):
    scope = 'attendance_live'

class AttendanceAnomaliesThrottle(ScopedRateThrottle):
    scope = 'attendance_anomalies'

class AttendanceStatsThrottle(ScopedRateThrottle):
    scope = 'attendance_stats'

class AttendanceHistoryThrottle(ScopedRateThrottle):
    scope = 'attendance_history'

class DashboardThrottle(ScopedRateThrottle):
    scope = 'dashboard_view'

class TreasurySummaryThrottle(ScopedRateThrottle):
    scope = 'treasury_summary'


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
        if self.action in ('create', 'update', 'partial_update', 'destroy', 'restore'):
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

    @action(detail=True, methods=['patch'], url_path='restore')
    def restore(self, request, pk=None):
        """Re-activate an archived employee and their linked user account (SuperAdmin / CanManageEmployees)."""
        employee = self.get_object()
        employee.is_active = True
        employee.end_date = None
        employee.save()
        if hasattr(employee, 'user_profile') and employee.user_profile.user:
            employee.user_profile.user.is_active = True
            employee.user_profile.user.save()
        return Response({'status': 'restored'}, status=status.HTTP_200_OK)

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
        """Only DTR managers can read or write DTR batches."""
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
    if action in FUND_ACTIONS and role not in {'SuperAdmin', 'President', 'Vice President', 'Treasurer', 'Auditor'}:
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
@permission_classes([IsOfficer])
@throttle_classes([DashboardThrottle])
def dashboard_view(request):
    from django.db.models import Count
    last_sync = SyncLog.objects.filter(success=True).order_by('-processed_at').first()
    active = Employee.objects.filter(is_active=True).count()
    archived = Employee.objects.filter(is_active=False).count()
    return Response({
        'total_employees': active + archived,
        'active_employees': active,
        'archived_employees': archived,
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

def _current_total_budget_breakdown():
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
    
    total = contributions + deposits - withdrawals + fund_edit_adds - fund_edit_subs
    return {
        'total_budget': str(total),
        'sa_contributions': str(contributions),
        'deposits': str(deposits),
        'withdrawals': str(withdrawals),
        'adjustments_add': str(fund_edit_adds),
        'adjustments_sub': str(fund_edit_subs)
    }

def _current_total_budget():
    return Decimal(_current_total_budget_breakdown()['total_budget'])


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@throttle_classes([TreasurySummaryThrottle])
def treasury_summary(request):
    """GET /api/treasury/summary/ — readable by all authenticated users."""
    return Response(_current_total_budget_breakdown())


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
    throttle_scope = 'treasury_transaction'

    def get_throttles(self):
        # Only apply the scoped throttle on write actions; reads are unthrottled.
        if self.action in ['create', 'destroy']:
            from rest_framework.throttling import ScopedRateThrottle
            return [ScopedRateThrottle()]
        return []

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

@api_view(['POST'])
@permission_classes([IsSuperAdmin])
def admin_clean_treasury(request):
    """
    Emergency cleanup endpoint to remove phantom FUND_EDIT transactions and 
    recalculate running balances. Only callable by SuperAdmin.
    """
    try:
        from django.db import transaction
        from django.db.models import Sum
        from decimal import Decimal
        with transaction.atomic():
            wipe_all = request.data.get('wipe_all', False)
            
            if wipe_all:
                fe_qs = TreasuryTransaction.objects.all()
            else:
                # 1. Delete all FUND_EDIT transactions
                fe_qs = TreasuryTransaction.objects.filter(
                    transaction_type__in=[
                        TreasuryTransaction.TransactionType.FUND_EDIT_ADD, 
                        TreasuryTransaction.TransactionType.FUND_EDIT_SUB
                    ]
                )
            deleted_count, _ = fe_qs.delete()

            # 2. Recalculate remaining running balances chronologically
            txs = list(TreasuryTransaction.objects.order_by("created_at", "pk"))
            fp_total = FundPayment.objects.aggregate(total=Sum("amount"))["total"] or Decimal("0")
            
            # The baseline is just the SA contributions (fp_total).
            running = fp_total
            
            # Update forwards
            updated = 0
            for tx in txs:
                if tx.transaction_type == TreasuryTransaction.TransactionType.DEPOSIT:
                    running += tx.amount
                elif tx.transaction_type == TreasuryTransaction.TransactionType.WITHDRAWAL:
                    running -= tx.amount
                    
                if tx.running_balance != running:
                    tx.running_balance = running
                    tx.save(update_fields=["running_balance"])
                    updated += 1

            return Response({
                'message': 'Treasury cleaned successfully.',
                'deleted_fund_edits': deleted_count,
                'recalculated_balances': updated,
                'final_balance': str(running)
            })
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ══════════════════════════════════════════════════════════════════════════════
# ── ATTENDANCE SYSTEM ────────────────────────────────────────────────────────
# ══════════════════════════════════════════════════════════════════════════════

def _officer_snapshot(user):
    """Capture the officer's name and role at the time of the action.
    Same snapshot-at-creation pattern as TreasuryTransaction.recorded_by_name/role.
    """
    profile = getattr(user, 'profile', None)
    emp = getattr(profile, 'employee', None) if profile else None
    name = (emp.name if emp else None) or user.username
    role = getattr(profile, 'role', 'Unknown') if profile else 'Unknown'
    return name, role


def _log_anomaly(employee, user, reason):
    """Create an AttendanceAnomaly record."""
    name, _ = _officer_snapshot(user)
    return AttendanceAnomaly.objects.create(
        employee=employee,
        attempted_by=user,
        attempted_by_name=name,
        reason=reason,
        timestamp=timezone.now(),
    )


# ── Tardiness detection helpers ───────────────────────────────────────────────

LATE_THRESHOLDS = {
    'AM_ARRIVAL': (8, 0),    # 08:00 PHT
    'PM_ARRIVAL': (13, 0),   # 13:00 PHT
}


def _cutoff_for_date(d):
    """Returns (year, month, cutoff) — cutoff 1 = days 1-15, cutoff 2 = 16-end."""
    return d.year, d.month, (1 if d.day <= 15 else 2)


def _check_arrival_anomalies(employee, scan_type, record_timestamp, user):
    """
    Shared helper called by both attendance_scan and attendance_manual.
    Runs on any *_ARRIVAL record; creates AttendanceAnomaly rows and
    increments EmployeeTardinessRecord when the employee is late.

    Wrong-shift and lateness are independent:
      - WRONG_SHIFT is informational only and never touches late_count.
      - Only correctly-shifted but late arrivals increment the counter.
    """
    if scan_type not in ('AM_ARRIVAL', 'PM_ARRIVAL'):
        return

    local_ts = timezone.localtime(record_timestamp)
    is_am_scan = (scan_type == 'AM_ARRIVAL')
    duty_mismatch = (
        (employee.duty == 'AM' and not is_am_scan) or
        (employee.duty == 'PM' and is_am_scan)
    )

    if duty_mismatch:
        _log_anomaly(
            employee, user,
            f"WRONG_SHIFT: {employee.duty} duty employee scanned {scan_type}"
        )
        return  # wrong-shift never counts toward tardiness

    threshold_h, threshold_m = LATE_THRESHOLDS[scan_type]
    threshold_dt = local_ts.replace(
        hour=threshold_h, minute=threshold_m, second=0, microsecond=0
    )

    if local_ts > threshold_dt:
        minutes_late = int((local_ts - threshold_dt).total_seconds() // 60)
        _log_anomaly(employee, user, f"LATE_ARRIVAL: {minutes_late} min late")

        year, month, cutoff = _cutoff_for_date(local_ts.date())
        # Guarantee the row exists, then atomically increment (avoids read-then-write race)
        EmployeeTardinessRecord.objects.get_or_create(
            employee=employee, year=year, month=month, cutoff=cutoff,
            defaults={'late_count': 0, 'minutes_late_total': 0},
        )
        EmployeeTardinessRecord.objects.filter(
            employee=employee, year=year, month=month, cutoff=cutoff,
        ).update(
            late_count=F('late_count') + 1,
            minutes_late_total=F('minutes_late_total') + minutes_late,
        )


@api_view(['POST'])
@permission_classes([CanScanAttendance])
def attendance_scan(request):
    """
    POST /api/attendance/scan/
    Body: { qr_payload: "...", intent: "IN" | "OUT", location: "..." (optional) }

    State machine:
    - Verifies HMAC signature and card_version
    - Self-scan prevention
    - Finds the last unmatched arrival (if any) rather than assuming today_records[0]
      is the only arrival — supports AM + PM pairs (up to 4 records/day)
    - IN is blocked if there's already an open (unmatched) arrival, or 4 records exist
    - OUT is blocked if there's no open arrival, or the 4-hour minimum since that
      arrival hasn't elapsed yet
    """
    from .qr_utils import verify_qr_payload
    import json as _json

    qr_payload = request.data.get('qr_payload', '')
    intent = request.data.get('intent', '').upper()
    location = request.data.get('location', '')

    if intent not in ('IN', 'OUT'):
        return Response({'error': 'Intent must be "IN" or "OUT".'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        raw = _json.loads(qr_payload)
        raw_eid = raw.get('eid')
    except (ValueError, TypeError, AttributeError):
        _log_anomaly(None, request.user, "QR decode failed — invalid JSON")
        return Response({'error': 'Invalid QR code format.', 'anomaly': True}, status=status.HTTP_400_BAD_REQUEST)

    employee = Employee.objects.filter(id=raw_eid).first()
    if not employee:
        _log_anomaly(None, request.user, f"QR references non-existent employee ID {raw_eid}")
        return Response({'error': 'Employee not found.', 'anomaly': True}, status=status.HTTP_404_NOT_FOUND)

    eid, error = verify_qr_payload(qr_payload, employee.card_version)
    if error:
        reason_map = {
            'QR signature invalid': 'Signature invalid',
            'revoked': 'Card revoked',
            'expired': 'QR expired',
        }
        short_reason = next((v for k, v in reason_map.items() if k.lower() in error.lower()), error)
        _log_anomaly(employee, request.user, short_reason)
        return Response({'error': error, 'anomaly': True}, status=status.HTTP_400_BAD_REQUEST)

    officer_emp_id = getattr(getattr(request.user, 'profile', None), 'employee_id', None)
    if officer_emp_id is not None and officer_emp_id == employee.id:
        _log_anomaly(employee, request.user, "Self-scan blocked")
        return Response(
            {'error': 'You cannot scan your own ID.', 'anomaly': True},
            status=status.HTTP_403_FORBIDDEN
        )

    # ── State machine ──────────────────────────────────────────────────────
    now_utc = timezone.now()
    now_local = timezone.localtime(now_utc)
    today_start = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timezone.timedelta(days=1)
    today_records = list(
        AttendanceRecord.objects.filter(
            employee=employee,
            timestamp__gte=today_start,
            timestamp__lt=today_end,
        ).order_by('timestamp')
    )
    record_count = len(today_records)

    last = today_records[-1] if today_records else None
    open_arrival = last if last and last.scan_type in ('AM_ARRIVAL', 'PM_ARRIVAL') else None

    MIN_DURATION = timedelta(hours=4)

    scan_type = None
    anomaly_reason = None
    is_blocked = False

    if intent == 'IN':
        if record_count >= 4:
            anomaly_reason = "Fifth+ scan attempt today"
            is_blocked = True
        elif open_arrival:
            anomaly_reason = "Logged IN again without logging OUT"
            is_blocked = True
        else:
            has_am = any(r.scan_type == 'AM_ARRIVAL' for r in today_records)
            has_pm = any(r.scan_type == 'PM_ARRIVAL' for r in today_records)
            hour = now_local.hour
            
            if not has_am and not has_pm:
                if hour >= 12:
                    scan_type = 'PM_ARRIVAL'
                    if hour >= 20:
                        anomaly_reason = f"Outside standard hours for PM — {now_local.strftime('%H:%M')}"
                else:
                    scan_type = 'AM_ARRIVAL'
                    if hour < 7:
                        anomaly_reason = f"Outside standard hours — {now_local.strftime('%H:%M')}"
            elif has_am and not has_pm:
                scan_type = 'PM_ARRIVAL'
                if hour < 12 or hour > 19:
                    anomaly_reason = f"Outside standard hours for PM — {now_local.strftime('%H:%M')}"
            else:
                anomaly_reason = "Already logged PM shift"
                is_blocked = True

    elif intent == 'OUT':
        if not open_arrival:
            anomaly_reason = "Logged OUT without logging IN"
            is_blocked = True
        else:
            elapsed = now_utc - open_arrival.timestamp
            if elapsed < MIN_DURATION:
                remaining = MIN_DURATION - elapsed
                mins = int(remaining.total_seconds() // 60)
                anomaly_reason = f"4-hour minimum not met — {mins // 60}h {mins % 60}m remaining"
                is_blocked = True
            else:
                scan_type = 'AM_DEPARTURE' if open_arrival.scan_type == 'AM_ARRIVAL' else 'PM_DEPARTURE'

    if is_blocked:
        _log_anomaly(employee, request.user, anomaly_reason)
        return Response(
            {'error': anomaly_reason, 'anomaly': True, 'blocked': True},
            status=status.HTTP_409_CONFLICT
        )

    officer_name, officer_role = _officer_snapshot(request.user)
    record = AttendanceRecord.objects.create(
        employee=employee,
        scan_type=scan_type,
        timestamp=now_utc,
        scanned_by=request.user,
        scanned_by_name=officer_name,
        scanned_by_role=officer_role,
        source='SCAN',
        location=location,
    )

    # Late / wrong-shift detection (arrival scans only)
    if scan_type in ('AM_ARRIVAL', 'PM_ARRIVAL'):
        _check_arrival_anomalies(employee, scan_type, now_utc, request.user)

    # If out-of-hours, also flag an anomaly (but the record was created)
    anomaly_obj = None
    if anomaly_reason:
        anomaly_obj = _log_anomaly(employee, request.user, anomaly_reason)

    return Response({
        'record': AttendanceRecordSerializer(record).data,
        'anomaly': AttendanceAnomalySerializer(anomaly_obj).data if anomaly_obj else None,
        'blocked': False,
    }, status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([CanScanAttendance])
def attendance_scan_status(request):
    """
    POST /api/attendance/scan-status/
    Body: { qr_payload: "..." }

    Read-only preview used by the scanner UI. Verifies the QR the same way
    attendance_scan does, but writes nothing — just reports whether IN/OUT
    is currently allowed and how much of the 4-hour window remains.
    """
    from .qr_utils import verify_qr_payload
    import json as _json

    qr_payload = request.data.get('qr_payload', '')

    try:
        raw = _json.loads(qr_payload)
        raw_eid = raw.get('eid')
    except (ValueError, TypeError, AttributeError):
        return Response({'error': 'Invalid QR code format.'}, status=status.HTTP_400_BAD_REQUEST)

    employee = Employee.objects.filter(id=raw_eid).first()
    if not employee:
        return Response({'error': 'Employee not found.'}, status=status.HTTP_404_NOT_FOUND)

    eid, error = verify_qr_payload(qr_payload, employee.card_version)
    if error:
        return Response({'error': error}, status=status.HTTP_400_BAD_REQUEST)

    officer_emp_id = getattr(getattr(request.user, 'profile', None), 'employee_id', None)
    if officer_emp_id is not None and officer_emp_id == employee.id:
        return Response({'error': 'You cannot scan your own ID.'}, status=status.HTTP_403_FORBIDDEN)

    now_utc = timezone.now()
    now_local = timezone.localtime(now_utc)
    today_start = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timezone.timedelta(days=1)
    today_records = list(
        AttendanceRecord.objects.filter(
            employee=employee,
            timestamp__gte=today_start,
            timestamp__lt=today_end,
        ).order_by('timestamp')
    )

    last = today_records[-1] if today_records else None
    open_arrival = last if last and last.scan_type in ('AM_ARRIVAL', 'PM_ARRIVAL') else None

    can_login = open_arrival is None and len(today_records) < 4
    can_logout = False
    seconds_remaining = 0

    if open_arrival:
        elapsed = now_utc - open_arrival.timestamp
        min_duration = timedelta(hours=4)
        if elapsed >= min_duration:
            can_logout = True
        else:
            seconds_remaining = int((min_duration - elapsed).total_seconds())

    return Response({
        'employee_id': employee.id,
        'employee_name': employee.name,
        'scans_today': len(today_records),
        'last_scan_type': last.scan_type if last else None,
        'last_scan_time': last.timestamp.isoformat() if last else None,
        'can_login': can_login,
        'can_logout': can_logout,
        'seconds_remaining': seconds_remaining,
        'completed': len(today_records) >= 4,
    })





@api_view(['GET'])
@permission_classes([IsAuthenticatedAndActive])
@throttle_classes([AttendanceLiveThrottle])
def attendance_live(request):
    """
    GET /api/attendance/live/
    Returns today's attendance records + unreviewed anomaly count.
    Polled every 5 seconds by the Admin LiveAttendance panel.
    Has its own throttle scope to avoid exhausting the default user rate.
    """
    now = timezone.localtime(timezone.now())   # PHT-aware
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timezone.timedelta(days=1)

    records = AttendanceRecord.objects.filter(
        timestamp__gte=today_start,
        timestamp__lt=today_end,
    ).select_related('employee')

    unreviewed_count = AttendanceAnomaly.objects.filter(
        timestamp__gte=today_start,
        timestamp__lt=today_end,
        reviewed=False,
    ).count()

    return Response({
        'records': AttendanceRecordSerializer(records, many=True).data,
        'unreviewed_anomalies': unreviewed_count,
        'server_time': now.isoformat(),
    })


@api_view(['GET'])
@permission_classes([IsAuthenticatedAndActive])
@throttle_classes([AttendanceAnomaliesThrottle])
def attendance_anomalies(request):
    """
    GET /api/attendance/anomalies/?reviewed=false
    Returns anomalies for the admin review panel.
    Supports filtering by reviewed status.
    """
    qs = AttendanceAnomaly.objects.select_related('employee', 'resolved_by_record')
    reviewed_param = request.query_params.get('reviewed')
    if reviewed_param == 'false':
        qs = qs.filter(reviewed=False)
    elif reviewed_param == 'true':
        qs = qs.filter(reviewed=True)
    # Optional filter by anomaly type prefix (e.g. ?type=LATE_ARRIVAL or ?type=WRONG_SHIFT)
    type_param = request.query_params.get('type')
    if type_param:
        qs = qs.filter(reason__startswith=type_param)
    return Response(AttendanceAnomalySerializer(qs[:100], many=True).data)


@api_view(['POST'])
@permission_classes([IsSuperAdmin])
def attendance_anomaly_review(request, anomaly_id):
    """
    POST /api/attendance/anomalies/<id>/review/
    Body: { action: "dismiss" }
    Marks an anomaly as reviewed without creating a corrective record.
    (The "Create Manual Entry" path goes through attendance_manual with an anomaly_id instead.)
    """
    anomaly = get_object_or_404(AttendanceAnomaly, id=anomaly_id)
    action_type = request.data.get('action', '').lower()

    if action_type != 'dismiss':
        return Response({'error': 'Action must be "dismiss".'}, status=status.HTTP_400_BAD_REQUEST)

    anomaly.reviewed = True
    anomaly.save(update_fields=['reviewed'])
    return Response({'message': 'Anomaly dismissed.', 'id': anomaly.id})


@api_view(['POST'])
@permission_classes([IsSuperAdmin])
def attendance_manual(request):
    """
    POST /api/attendance/manual/
    Body (multipart or JSON): {
        employee_id, scan_type, location (opt), admin_notes (opt),
        anomaly_id (opt — links to the originating anomaly),
        proof_image (file, opt)
    }
    Creates an AttendanceRecord with source=MANUAL.
    If anomaly_id is provided, auto-sets reviewed=True and resolved_by_record.
    """
    employee_id = request.data.get('employee_id')
    scan_type = request.data.get('scan_type')
    location = request.data.get('location', '')
    admin_notes = request.data.get('admin_notes', '').strip()
    anomaly_id = request.data.get('anomaly_id')
    date_str = request.data.get('date') # Expected format "YYYY-MM-DD"
    time_str = request.data.get('time') # Expected format "HH:MM"

    if not admin_notes:
        return Response({'error': 'Admin notes are required for manual entry.'}, status=status.HTTP_400_BAD_REQUEST)

    valid_types = [c[0] for c in AttendanceRecord.SCAN_TYPE_CHOICES]
    if scan_type not in valid_types:
        return Response({'error': f'scan_type must be one of: {valid_types}'}, status=status.HTTP_400_BAD_REQUEST)

    employee = Employee.objects.filter(id=employee_id).first()
    if not employee:
        return Response({'error': 'Employee not found.'}, status=status.HTTP_404_NOT_FOUND)

    # Handle proof image upload to Cloudinary
    proof_file = request.FILES.get('proof_image')
    if not proof_file:
        return Response({'error': 'Photo proof is required for manual entry.'}, status=status.HTTP_400_BAD_REQUEST)

    proof_path = ''
    try:
        import cloudinary.uploader
        upload_result = cloudinary.uploader.upload(proof_file, folder="attendance_proofs")
        proof_path = upload_result.get('secure_url')
    except Exception as e:
        logger.error("Cloudinary upload failed for attendance proof: %s", e)
        return Response({'error': 'Failed to upload proof image.'}, status=status.HTTP_502_BAD_GATEWAY)

    officer_name, officer_role = _officer_snapshot(request.user)

    # Resolve linked anomaly
    linked_anomaly = None
    if anomaly_id:
        linked_anomaly = AttendanceAnomaly.objects.filter(id=anomaly_id).first()

    # Determine timestamp
    record_timestamp = timezone.now()
    base_local = timezone.localtime(timezone.now())
    
    if date_str and not linked_anomaly:
        try:
            d_parts = date_str.split('-')
            year, month, day = int(d_parts[0]), int(d_parts[1]), int(d_parts[2])
            base_local = base_local.replace(year=year, month=month, day=day)
        except (ValueError, TypeError, IndexError):
            pass

    if time_str:
        try:
            parts = time_str.split(':')
            hour, minute = int(parts[0]), int(parts[1])
            if linked_anomaly:
                base_local = timezone.localtime(linked_anomaly.timestamp)
            record_timestamp = base_local.replace(hour=hour, minute=minute, second=0, microsecond=0)
        except (ValueError, TypeError, IndexError):
            pass

    # Remove any existing record for this employee, for this EXACT scan_type, on this specific day.
    # This ensures a Manual Entry overrides the existing entry instead of duplicating it or deleting unrelated scans.
    day_start = base_local.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timezone.timedelta(days=1)
    
    with transaction.atomic():
        AttendanceRecord.objects.filter(
            employee=employee,
            scan_type=scan_type,
            timestamp__gte=day_start,
            timestamp__lt=day_end
        ).delete()

        record = AttendanceRecord.objects.create(
            employee=employee,
            scan_type=scan_type,
            timestamp=record_timestamp,
            scanned_by=request.user,
            scanned_by_name=officer_name,
            scanned_by_role=officer_role,
            source='MANUAL',
            location=location,
            proof_image=proof_path,
            admin_notes=admin_notes,
            linked_anomaly=linked_anomaly,
        )

        # Late / wrong-shift detection runs against the corrected parsed timestamp.
        # Manual Entry is not exempt: backdating to exact threshold to avoid a flag
        # is a data-integrity hole. The check is honest about whatever time gets stored.
        if scan_type in ('AM_ARRIVAL', 'PM_ARRIVAL'):
            _check_arrival_anomalies(employee, scan_type, record_timestamp, request.user)

    # If linked to an anomaly, mark it resolved
    if linked_anomaly:
        linked_anomaly.reviewed = True
        linked_anomaly.resolved_by_record = record
        linked_anomaly.save(update_fields=['reviewed', 'resolved_by_record'])

    return Response(AttendanceRecordSerializer(record).data, status=status.HTTP_201_CREATED)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def attendance_tardiness(request):
    """
    GET /api/attendance/tardiness/
    Returns tardiness and absence data for all active employees in the given cutoff.
    Includes:
      - late_count, minutes_late_total, late_details (timestamps of late arrivals)
      - absent_count, absent_details (list of missed Mon-Fri working day strings)
    """
    import calendar
    from datetime import datetime, date as date_cls

    now = timezone.localtime(timezone.now())
    try:
        year = int(request.query_params.get('year', now.year))
        month = int(request.query_params.get('month', now.month))
        cutoff = int(request.query_params.get('cutoff', 1 if now.day <= 15 else 2))
    except (ValueError, TypeError):
        year, month = now.year, now.month
        cutoff = 1 if now.day <= 15 else 2

    qs = EmployeeTardinessRecord.objects.filter(
        year=year, month=month, cutoff=cutoff
    ).select_related('employee')

    if cutoff == 1:
        start_dt = timezone.make_aware(datetime(year, month, 1, 0, 0, 0))
        end_dt = timezone.make_aware(datetime(year, month, 15, 23, 59, 59))
    else:
        last_day = calendar.monthrange(year, month)[1]
        start_dt = timezone.make_aware(datetime(year, month, 16, 0, 0, 0))
        end_dt = timezone.make_aware(datetime(year, month, last_day, 23, 59, 59))

    anomalies_qs = AttendanceAnomaly.objects.filter(
        timestamp__gte=start_dt,
        timestamp__lte=end_dt,
        reason__startswith='LATE_ARRIVAL'
    ).order_by('-timestamp')

    lates_by_emp = {}
    for a in anomalies_qs:
        if a.employee_id:
            if a.employee_id not in lates_by_emp:
                lates_by_emp[a.employee_id] = []
            local_ts = timezone.localtime(a.timestamp)
            lates_by_emp[a.employee_id].append({
                'id': a.id,
                'date': local_ts.strftime('%b %d, %Y'),
                'time': local_ts.strftime('%I:%M %p'),
                'reason': a.reason,
            })

    def _status(count):
        if count == 0:
            return 'green'
        elif count <= 2:
            return 'orange'
        return 'red'

    today = timezone.localtime(timezone.now()).date()
    today_start = timezone.make_aware(datetime.combine(today, datetime.min.time()))
    today_end = timezone.make_aware(datetime.combine(today, datetime.max.time()))

    today_logged_in = set(AttendanceRecord.objects.filter(
        timestamp__gte=today_start, timestamp__lte=today_end, scan_type__contains='ARRIVAL'
    ).values_list('employee_id', flat=True))

    today_late_emps = set(AttendanceAnomaly.objects.filter(
        timestamp__gte=today_start, timestamp__lte=today_end, reason__startswith='LATE_ARRIVAL'
    ).values_list('employee_id', flat=True))

    now_time = timezone.localtime(timezone.now()).time()

    def _daily_status(emp_id, duty):
        if emp_id in today_logged_in:
            return 'late' if emp_id in today_late_emps else 'ontime'
        if duty == 'AM' and now_time.hour >= 13:
            return 'absent'
        if duty == 'PM' and now_time.hour >= 18:
            return 'absent'
        if duty not in ['AM', 'PM'] and now_time.hour >= 18:
            return 'absent'
        return 'blank'

    # -- Absence Calculation --------------------------------------------------

    # Fetch DTREndpoint safely -- no 500 if no endpoint has been set yet
    try:
        ep = DTREndpoint.objects.get(month=month, year=year, cutoff=cutoff)
        endpoint_date_cap = ep.endpoint_date
        holiday_day_nums = set(ep.get_holidays())  # list[int] of day-of-month numbers
    except DTREndpoint.DoesNotExist:
        endpoint_date_cap = None
        holiday_day_nums = set()

    # Upper bound = min(natural cutoff end, endpoint_date if set, today)
    upper_bound = end_dt.date()
    if endpoint_date_cap:
        upper_bound = min(upper_bound, endpoint_date_cap)
    upper_bound = min(upper_bound, today)

    # Reconstruct holiday full dates from integer day-of-month numbers scoped to (year, month)
    holiday_dates = set()
    for day_num in holiday_day_nums:
        try:
            holiday_dates.add(date_cls(year, month, day_num))
        except ValueError:
            pass  # invalid day for this month -- skip silently

    # Bulk-fetch arrivals as (emp_id, date) set -- single query, O(1) per-employee lookup
    arrived_set = set(
        AttendanceRecord.objects.filter(
            timestamp__gte=start_dt,
            timestamp__date__lte=upper_bound,
            scan_type__contains='ARRIVAL',
        ).values_list('employee_id', 'timestamp__date')
    )

    cutoff_start_date = start_dt.date()

    def _compute_absences(emp):
        # Lower bound: use start_date if set; else fall back to created_at via localtime().
        # created_at is stored in UTC -- timezone.localtime() prevents off-by-one-day bug
        # for employees created after 16:00 UTC (midnight PHT).
        if emp.start_date:
            lower = max(cutoff_start_date, emp.start_date)
        else:
            lower = max(cutoff_start_date, timezone.localtime(emp.created_at).date())

        # Upper bound: clamp by end_date if set.
        # Note: currently defensive/dead code -- archiving also sets is_active=False,
        # excluding the employee from the queryset entirely. Kept future-safe.
        upper = upper_bound
        if emp.end_date:
            upper = min(upper, emp.end_date)

        absent_dates = []
        cursor = lower
        while cursor <= upper:
            # Only count Mon-Fri working days that are not holidays
            if cursor.weekday() < 5 and cursor not in holiday_dates:
                # Today partial-day exemption: do not flag absent until shift window closes
                if cursor == today:
                    skip = False
                    if emp.duty == 'AM' and now_time.hour < 13:
                        skip = True
                    elif emp.duty != 'AM' and now_time.hour < 18:
                        skip = True
                    if skip:
                        if cursor.day < calendar.monthrange(cursor.year, cursor.month)[1]:
                            cursor = cursor.replace(day=cursor.day + 1)
                        elif cursor.month == 12:
                            cursor = date_cls(cursor.year + 1, 1, 1)
                        else:
                            cursor = date_cls(cursor.year, cursor.month + 1, 1)
                        continue

                if (emp.id, cursor) not in arrived_set:
                    absent_dates.append(cursor)

            # Advance cursor by one day
            if cursor.day < calendar.monthrange(cursor.year, cursor.month)[1]:
                cursor = cursor.replace(day=cursor.day + 1)
            elif cursor.month == 12:
                cursor = date_cls(cursor.year + 1, 1, 1)
            else:
                cursor = date_cls(cursor.year, cursor.month + 1, 1)

        return len(absent_dates), [d.strftime('%b %d, %Y') for d in absent_dates]

    # -- Build response -------------------------------------------------------

    records_by_emp = {r.employee_id: r for r in qs}
    results = []
    for emp in Employee.objects.filter(is_active=True).order_by('name'):
        r = records_by_emp.get(emp.id)
        absent_count, absent_details = _compute_absences(emp)
        results.append({
            'employee_id': emp.id,
            'name': emp.name,
            'duty': emp.duty,
            'late_count': r.late_count if r else 0,
            'minutes_late_total': r.minutes_late_total if r else 0,
            'status': _status(r.late_count if r else 0),
            'daily_status': _daily_status(emp.id, emp.duty),
            'late_details': lates_by_emp.get(emp.id, []),
            'absent_count': absent_count,
            'absent_details': absent_details,
        })
    return Response(results)



@api_view(['GET'])
@permission_classes([IsAuthenticated])
def attendance_employee(request, employee_id):
    """
    GET /api/attendance/employee/<id>/?month=7&year=2026&cutoff=1
    Returns attendance records for one employee, filtered by period.
    Used by the DTR generator's "From Attendance Logs" mode.
    """
    employee = Employee.objects.filter(id=employee_id).first()
    if not employee:
        return Response({'error': 'Employee not found.'}, status=status.HTTP_404_NOT_FOUND)

    qs = AttendanceRecord.objects.filter(employee=employee).order_by('timestamp')

    # Date-range mode: ?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
    # Takes priority over year/month/cutoff mode when both date params are present.
    date_from_raw = request.query_params.get('date_from')
    date_to_raw = request.query_params.get('date_to')
    if date_from_raw and date_to_raw:
        from datetime import date as date_type
        try:
            date_from = date_type.fromisoformat(date_from_raw)
            date_to = date_type.fromisoformat(date_to_raw)
        except ValueError:
            return Response({'error': 'date_from and date_to must be YYYY-MM-DD.'}, status=status.HTTP_400_BAD_REQUEST)
        # Filter by server-local date using __date lookups
        qs = qs.filter(timestamp__date__gte=date_from, timestamp__date__lte=date_to)
        return Response(AttendanceRecordSerializer(qs, many=True).data)

    # Standard period mode: ?year=&month=&cutoff=
    year = request.query_params.get('year')
    month = request.query_params.get('month')
    if year and month:
        qs = qs.filter(timestamp__year=int(year), timestamp__month=int(month))

    cutoff = request.query_params.get('cutoff')
    if cutoff:
        if int(cutoff) == 1:
            qs = qs.filter(timestamp__day__lte=15)
        elif int(cutoff) == 16:
            qs = qs.filter(timestamp__day__gte=16)

    return Response(AttendanceRecordSerializer(qs, many=True).data)


# ── GET/POST /api/dtr/endpoint/ ───────────────────────────────────────────────
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def dtr_endpoint_view(request):
    """
    GET  /api/dtr/endpoint/?month=&year=&cutoff=
         Returns the DTREndpoint for that period, or 404 if none exists yet.

    POST /api/dtr/endpoint/  { month, year, cutoff, endpoint_date }
         Creates or updates the endpoint for that period.
         Requires CanManageDTR permission for writes.
         Writes an ActivityLog entry when an *existing* endpoint is changed.
    """
    from datetime import date as date_type
    from .permissions import CanManageDTR as CanManageDTRPerm

    if request.method == 'GET':
        month = request.query_params.get('month')
        year = request.query_params.get('year')
        cutoff = request.query_params.get('cutoff')
        if not all([month, year, cutoff]):
            return Response({'error': 'month, year, and cutoff are required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            ep = DTREndpoint.objects.get(month=int(month), year=int(year), cutoff=int(cutoff))
        except DTREndpoint.DoesNotExist:
            return Response({'error': 'No endpoint set for this period.'}, status=status.HTTP_404_NOT_FOUND)
        return Response(DTREndpointSerializer(ep).data)

    # POST — require CanManageDTR
    perm = CanManageDTRPerm()
    if not perm.has_permission(request, None):
        return Response({'error': 'Only DTR managers can set endpoints.'}, status=status.HTTP_403_FORBIDDEN)

    month = request.data.get('month')
    year = request.data.get('year')
    cutoff = request.data.get('cutoff')
    endpoint_date_raw = request.data.get('endpoint_date')
    # Optional list of integer day numbers that were holidays during this cutoff.
    # Must be stored via set_holidays() / json.dumps — never directly in update_or_create's
    # defaults dict, which would write a raw Python list into a TextField.
    holidays_raw = request.data.get('holidays', [])

    if not all([month, year, cutoff, endpoint_date_raw]):
        return Response({'error': 'month, year, cutoff, and endpoint_date are required.'}, status=status.HTTP_400_BAD_REQUEST)

    # Validate holidays is a list of ints
    try:
        holidays_list = [int(d) for d in holidays_raw] if holidays_raw else []
    except (TypeError, ValueError):
        return Response({'error': 'holidays must be a list of day numbers.'}, status=status.HTTP_400_BAD_REQUEST)

    # Look for existing record to detect if this is an update (for audit log)
    old_ep = DTREndpoint.objects.filter(month=int(month), year=int(year), cutoff=int(cutoff)).first()
    old_date = old_ep.endpoint_date if old_ep else None

    ep, created = DTREndpoint.objects.update_or_create(
        month=int(month),
        year=int(year),
        cutoff=int(cutoff),
        defaults={
            'endpoint_date': endpoint_date_raw,
            'set_by': request.user,
        }
    )

    # Persist holidays separately via the model helper — holidays_json is a TextField
    # and must be JSON-encoded, not written as a raw Python object.
    ep.set_holidays(holidays_list)
    ep.save(update_fields=['holidays_json'])

    # Write audit log only for retroactive edits (not the initial creation)
    if not created and old_date and str(old_date) != str(endpoint_date_raw):
        ActivityLog.objects.create(
            user=request.user,
            action='Changed DTR Endpoint',
            description=(
                f"Changed DTR endpoint for {month}/{year} cutoff {cutoff} "
                f"from {old_date} to {endpoint_date_raw}."
            )
        )

    return Response(DTREndpointSerializer(ep).data, status=status.HTTP_200_OK if not created else status.HTTP_201_CREATED)


@api_view(['GET', 'POST'])
@permission_classes([CanScanAttendance])
def attendance_generate_qr(request, employee_id):
    """
    GET /api/attendance/generate-qr/<employee_id>/
    Returns the signed QR payload.
    POST /api/attendance/generate-qr/<employee_id>/
    Reissues the card by incrementing card_version, invalidating all old cards.
    """
    from .qr_utils import generate_qr_payload
    from django.core.cache import cache

    employee = Employee.objects.filter(id=employee_id).first()
    if not employee:
        return Response({'error': 'Employee not found.'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'POST':
        employee.card_version += 1
        employee.has_qr_code = True
        employee.save(update_fields=['card_version', 'has_qr_code'])
    elif not employee.has_qr_code:
        employee.has_qr_code = True
        employee.save(update_fields=['has_qr_code'])

    payload = generate_qr_payload(employee.id, employee.card_version)
    return Response({
        'qr_payload': payload,
        'employee_id': employee.id,
        'employee_name': employee.name,
        'card_version': employee.card_version,
    })

@api_view(['GET'])
@permission_classes([IsAuthenticatedAndActive])
@throttle_classes([AttendanceStatsThrottle])
def attendance_stats(request):
    """
    Returns aggregated stats (total logs, anomalies, hours rendered).
    Modes:
      - Default: returns week/month/year aggregates (cached).
      - ?period=day&date=YYYY-MM-DD: returns a single-day aggregate keyed as 'day'.
    """
    period = request.query_params.get('period')
    date_str = request.query_params.get('date')

    cache_key = f"attendance_stats:{period or 'default'}:{date_str or ''}"
    cached = cache.get(cache_key)
    if cached is not None:
        return Response(cached)

    now = timezone.localtime(timezone.now())
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    def _get_stats_from_list(recs, anoms):
        logs_count = len(recs)
        anomalies_count = len(anoms)
        qr_count = sum(1 for r in recs if r['source'] == 'SCAN')
        manual_count = sum(1 for r in recs if r['source'] == 'MANUAL')

        from collections import defaultdict
        shifts = defaultdict(lambda: {'arr': None, 'dep': None})
        for r in recs:
            date_key = timezone.localtime(r['timestamp']).date()
            session = 'AM' if 'AM' in r['scan_type'] else 'PM'
            key = (r['employee_id'], date_key, session)
            if 'ARRIVAL' in r['scan_type']:
                shifts[key]['arr'] = r
            elif 'DEPARTURE' in r['scan_type']:
                shifts[key]['dep'] = r

        total_seconds = 0
        for v in shifts.values():
            if v['arr'] and v['dep'] and v['dep']['timestamp'] > v['arr']['timestamp']:
                total_seconds += (v['dep']['timestamp'] - v['arr']['timestamp']).total_seconds()

        hours_rendered = round(total_seconds / 3600, 1)
        anomaly_rate = round((anomalies_count / logs_count * 100) if logs_count else 0, 1)

        return {
            'total_logs': logs_count,
            'anomalies': anomalies_count,
            'anomaly_rate': anomaly_rate,
            'hours_rendered': hours_rendered,
            'qr_count': qr_count,
            'manual_count': manual_count,
        }

    if period == 'day' and date_str:
        try:
            target_date = timezone.datetime.strptime(date_str, '%Y-%m-%d').date()
        except ValueError:
            target_date = now.date()
        day_start = timezone.make_aware(timezone.datetime.combine(target_date, timezone.datetime.min.time()))
        day_end = day_start + timedelta(days=1)
        
        recs = list(AttendanceRecord.objects.filter(timestamp__gte=day_start, timestamp__lt=day_end).values('employee_id', 'scan_type', 'timestamp', 'source'))
        anoms = list(AttendanceAnomaly.objects.filter(timestamp__gte=day_start, timestamp__lt=day_end).values('id', 'timestamp'))
        
        response_data = {'day': _get_stats_from_list(recs, anoms)}
    else:
        # Default: week / month / year-to-date
        this_week_start = today_start - timedelta(days=now.weekday())
        this_month_start = today_start.replace(day=1)
        this_year_start = today_start.replace(month=1, day=1)
        
        # Single fetch for the year
        all_recs = list(AttendanceRecord.objects.filter(timestamp__gte=this_year_start).values('employee_id', 'scan_type', 'timestamp', 'source'))
        all_anoms = list(AttendanceAnomaly.objects.filter(timestamp__gte=this_year_start).values('id', 'timestamp'))
        
        # Slice for week and month
        week_recs = [r for r in all_recs if r['timestamp'] >= this_week_start]
        week_anoms = [a for a in all_anoms if a['timestamp'] >= this_week_start]
        
        month_recs = [r for r in all_recs if r['timestamp'] >= this_month_start]
        month_anoms = [a for a in all_anoms if a['timestamp'] >= this_month_start]
        
        response_data = {
            'week': _get_stats_from_list(week_recs, week_anoms),
                'month': _get_stats_from_list(month_recs, month_anoms),
            'year': _get_stats_from_list(all_recs, all_anoms)
        }

    cache.set(cache_key, response_data, 60)
    return Response(response_data)


@api_view(['GET'])
@permission_classes([IsAuthenticatedAndActive])
def attendance_leaderboard(request):
    from datetime import timedelta
    start_date = timezone.localtime(timezone.now()).date() - timedelta(days=30)
    start_datetime = timezone.make_aware(timezone.datetime.combine(start_date, timezone.datetime.min.time()))
    
    logs = AttendanceRecord.objects.filter(timestamp__gte=start_datetime).select_related('employee')
    
    present_counts = {}
    early_counts = {}
    
    for log in logs:
        emp_id = log.employee.id
        emp_name = log.employee.name
        if emp_id not in present_counts:
            present_counts[emp_id] = {'name': emp_name, 'count': 0}
            early_counts[emp_id] = {'name': emp_name, 'count': 0}
            
        if 'ARRIVAL' in log.scan_type:
            present_counts[emp_id]['count'] += 1
            
        local_time = timezone.localtime(log.timestamp)
        if log.scan_type == 'AM_ARRIVAL' and (local_time.hour < 8 or (local_time.hour == 8 and local_time.minute == 0)):
            early_counts[emp_id]['count'] += 1
        elif log.scan_type == 'PM_ARRIVAL' and (local_time.hour < 13 or (local_time.hour == 13 and local_time.minute == 0)):
            early_counts[emp_id]['count'] += 1

    top_present = sorted(present_counts.values(), key=lambda x: x['count'], reverse=True)[:5]
    top_early = sorted(early_counts.values(), key=lambda x: x['count'], reverse=True)[:5]
    
    return Response({
        'most_present': top_present,
        'most_early': top_early
    })


@api_view(['GET'])
@permission_classes([IsAuthenticatedAndActive])
@throttle_classes([AttendanceHistoryThrottle])
def attendance_history(request):
    """
    GET /api/attendance/history/?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD[&group_by=day|week|month|year]
    - Without group_by: returns raw records list (existing behaviour).
    - With group_by: returns bucketed counts [{label, count, date}] for chart rendering.
    """
    start_date_str = request.query_params.get('start_date')
    end_date_str = request.query_params.get('end_date')
    group_by = request.query_params.get('group_by')  # 'day' | 'week' | 'month' | 'year'

    now = timezone.localtime(timezone.now())

    if start_date_str:
        try:
            start_date = timezone.datetime.strptime(start_date_str, '%Y-%m-%d').date()
        except ValueError:
            start_date = now.date() - timedelta(days=7)
    else:
        start_date = now.date() - timedelta(days=7)

    if end_date_str:
        try:
            end_date = timezone.datetime.strptime(end_date_str, '%Y-%m-%d').date()
        except ValueError:
            end_date = now.date()
    else:
        end_date = now.date()

    start_datetime = timezone.make_aware(timezone.datetime.combine(start_date, timezone.datetime.min.time()))
    end_datetime = timezone.make_aware(timezone.datetime.combine(end_date, timezone.datetime.max.time()))

    records_qs = AttendanceRecord.objects.filter(
        timestamp__gte=start_datetime,
        timestamp__lte=end_datetime
    ).select_related('employee').order_by('timestamp')

    if group_by:
        from django.core.cache import cache
        cache_key = f"attendance_history:{start_date_str}:{end_date_str}:{group_by}"
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached)

        try:
            # Return bucketed counts for charts — aggregated from daily metrics
            from collections import defaultdict
            import datetime as dt_module
            from .models import Employee, AttendanceAnomaly
    
            total_active_employees = Employee.objects.filter(is_active=True).count()
            
            daily_stats = defaultdict(lambda: {
                'present_employees': set(),
                'late': 0,
                'wrong_shift': 0,
                'qr_count': 0,
                'manual_count': 0,
                'label': '',
            })
            
            curr_date = start_date
            while curr_date <= end_date:
                date_str = curr_date.strftime('%Y-%m-%d')
                if group_by == 'day':
                    label = date_str
                elif group_by == 'week':
                    week_start = curr_date - dt_module.timedelta(days=curr_date.weekday())
                    label = week_start.strftime('%Y-%m-%d')
                elif group_by == 'month':
                    label = curr_date.strftime('%Y-%m')
                elif group_by == 'year':
                    label = curr_date.strftime('%Y')
                else:
                    label = date_str
                    
                daily_stats[date_str]['label'] = label
                curr_date += dt_module.timedelta(days=1)
                
            for r in records_qs:
                local_ts = timezone.localtime(r.timestamp)
                date_str = local_ts.strftime('%Y-%m-%d')
                if date_str in daily_stats:
                    if r.employee_id:
                        daily_stats[date_str]['present_employees'].add(r.employee_id)
                    if r.source == 'SCAN':
                        daily_stats[date_str]['qr_count'] += 1
                    elif r.source == 'MANUAL':
                        daily_stats[date_str]['manual_count'] += 1
    
            anomalies_qs = AttendanceAnomaly.objects.filter(
                timestamp__gte=start_datetime,
                timestamp__lte=end_datetime
            )
            for a in anomalies_qs:
                local_ts = timezone.localtime(a.timestamp)
                date_str = local_ts.strftime('%Y-%m-%d')
                if date_str in daily_stats:
                    reason = (a.reason or '').upper()
                    if 'LATE' in reason:
                        daily_stats[date_str]['late'] += 1
                    if 'SHIFT' in reason:
                        daily_stats[date_str]['wrong_shift'] += 1
                        
            today_str = now.strftime('%Y-%m-%d')
            buckets = {}
            for date_str, stats in daily_stats.items():
                dt = dt_module.datetime.strptime(date_str, '%Y-%m-%d')
                is_sunday = dt.weekday() == 6
                
                label = stats['label']
                if label not in buckets:
                    buckets[label] = {
                        'label': label,
                        'present': 0,
                        'absent': 0,
                        'late': 0,
                        'wrong_shift': 0,
                        'qr_count': 0,
                        'manual_count': 0,
                    }
                    
                presents = len(stats['present_employees'])
                absents = max(0, total_active_employees - presents)
                
                # Defer counting absents for the current day until midnight
                if is_sunday or date_str == today_str:
                    absents = 0
                    
                buckets[label]['present'] += presents
                buckets[label]['absent'] += absents
                buckets[label]['late'] += stats['late']
                buckets[label]['wrong_shift'] += stats['wrong_shift']
                buckets[label]['qr_count'] += stats['qr_count']
                buckets[label]['manual_count'] += stats['manual_count']
                
            chart_data = [buckets[k] for k in sorted(buckets.keys())]
            result = {'chart_data': chart_data, 'group_by': group_by}
            cache.set(cache_key, result, 60)
            return Response(result)
        except Exception as e:
            import traceback
            return Response({'error': traceback.format_exc()}, status=500)

    # Default: raw records list
    return Response({
        'records': AttendanceRecordSerializer(records_qs.order_by('-timestamp'), many=True).data,
    })