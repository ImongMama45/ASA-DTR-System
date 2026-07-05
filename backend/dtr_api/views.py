import logging

from rest_framework import viewsets, status
from rest_framework.decorators import api_view, permission_classes, action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from django.utils import timezone
import json

logger = logging.getLogger(__name__)

from .models import Employee, DTRBatch, SyncLog, FundPayment, SheetsSyncState
from .serializers import EmployeeSerializer, DTRBatchSerializer, FundPaymentSerializer
from . import sheets_sync
from .permissions import IsSuperAdmin, CanManageEmployees, CanManageDTR, CanManageFunds


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
        The linked User account is disabled (not deleted) so the audit trail
        (fund payments, DTR history) is preserved — fund payments become orphaned
        rows with employee=NULL, still visible in the Fund Tracker as historical data.
        """
        employee = self.get_object()
        # Disable — but do NOT delete — the linked User so login is blocked
        # but fund/DTR history rows referencing this employee are kept intact.
        if hasattr(employee, 'user_profile') and employee.user_profile.user:
            user = employee.user_profile.user
            user.is_active = False
            user.save()
            # Detach the profile so the user can't be re-linked accidentally
            employee.user_profile.employee = None
            employee.user_profile.save()
        # Deleting the Employee now leaves FundPayment.employee = NULL (SET_NULL)
        # preserving all historical payment records.
        employee.delete()
        return Response({'status': 'deleted'}, status=status.HTTP_200_OK)


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
    WRITE_ACTIONS_EMPLOYEE = {'CREATE_EMPLOYEE', 'UPDATE_EMPLOYEE', 'ARCHIVE_EMPLOYEE', 'RESTORE_EMPLOYEE'}
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