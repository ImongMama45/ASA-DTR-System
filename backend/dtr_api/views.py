import logging

from rest_framework import viewsets, status
from rest_framework.decorators import api_view
from rest_framework.response import Response
from django.utils import timezone
import json

logger = logging.getLogger(__name__)

from .models import Employee, DTRBatch, SyncLog, FundPayment, SheetsSyncState
from .serializers import EmployeeSerializer, DTRBatchSerializer, FundPaymentSerializer
from . import sheets_sync


class EmployeeViewSet(viewsets.ModelViewSet):
    serializer_class = EmployeeSerializer

    def get_queryset(self):
        qs = Employee.objects.all()
        active_param = self.request.query_params.get('active', None)
        if active_param == 'true':
            qs = qs.filter(is_active=True)
        elif active_param == 'false':
            qs = qs.filter(is_active=False)
        return qs

    def destroy(self, request, *args, **kwargs):
        """Soft-delete: archive instead of actually deleting."""
        employee = self.get_object()
        end_date = request.data.get('end_date', None)
        employee.is_active = False
        if end_date:
            employee.end_date = end_date
        employee.save()
        return Response({'status': 'archived'}, status=status.HTTP_200_OK)


class DTRBatchViewSet(viewsets.ModelViewSet):
    queryset = DTRBatch.objects.all()
    serializer_class = DTRBatchSerializer

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


@api_view(['GET'])
def fund_payments_list(request):
    """GET /api/fund-payments/?year=2026 — returns all payments for a given year."""
    year = request.query_params.get('year')
    qs = FundPayment.objects.select_related('employee')
    if year:
        qs = qs.filter(year=int(year))
    serializer = FundPaymentSerializer(qs, many=True)
    return Response(serializer.data)

@api_view(['POST'])
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


@api_view(['POST'])
def sync_view(request):
    """Receives sync queue items from the frontend."""
    action = request.data.get('action')
    payload = request.data.get('payload', {})
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
            Employee.objects.filter(local_id=str(payload.get('id', ''))).update(
                is_active=False,
                end_date=payload.get('end_date') or None,
            )
        elif action == 'RESTORE_EMPLOYEE':
            Employee.objects.filter(local_id=str(payload.get('id', ''))).update(
                is_active=True,
                end_date=None,
            )
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
                SheetsSyncState.mark_dirty()  # flag for next sync cycle
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
def dashboard_view(request):
    from django.db.models import Count
    last_sync = SyncLog.objects.filter(success=True).order_by('-processed_at').first()
    return Response({
        'total_employees': Employee.objects.filter(is_active=True).count(),
        'total_batches': DTRBatch.objects.count(),
        'last_sync': last_sync.processed_at.strftime('%Y-%m-%d %H:%M') if last_sync else None,
    })


import os
import calendar
from datetime import date

@api_view(['POST'])
def sheets_webhook_sync(request):
    """
    Dedicated webhook for Google Sheets sync.
    Requires X-API-KEY header.
    Expects payload: { "updates": [ { "employee_id": 45, "year": 2025, "month": 7, "cutoff": 1, "amount": 20 } ] }
    """
    api_key = request.headers.get('X-API-KEY')
    expected_key = os.environ.get('SHEETS_API_KEY', 'asa-sheets-sync-secret-2026')
    if api_key != expected_key:
        return Response({'error': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)
        
    updates = request.data.get('updates', [])
    processed = 0
    errors = []
    
    for item in updates:
        emp_id = item.get('employee_id')
        year = int(item.get('year', 0))
        month = int(item.get('month', 0))
        cutoff = int(item.get('cutoff', 1))
        amount = item.get('amount', 0)
        
        try:
            emp = Employee.objects.get(id=emp_id)
            
            # Business Logic Parity Validation
            if cutoff == 1:
                cutoff_start = date(year, month + 1, 1)
                cutoff_end = date(year, month + 1, 15)
            else:
                cutoff_start = date(year, month + 1, 16)
                last_day = calendar.monthrange(year, month + 1)[1]
                cutoff_end = date(year, month + 1, last_day)
                
            if emp.start_date and cutoff_end < emp.start_date:
                errors.append(f"Row skipped: ID {emp_id} (Cutoff before start_date)")
                continue
                
            if emp.end_date and cutoff_start > emp.end_date:
                errors.append(f"Row skipped: ID {emp_id} (Cutoff after end_date)")
                continue
                
            FundPayment.objects.update_or_create(
                employee=emp,
                year=year,
                month=month,
                cutoff=cutoff,
                defaults={'amount': amount}
            )
            processed += 1
        except Employee.DoesNotExist:
            errors.append(f"Employee {emp_id} not found.")
        except ValueError:
             errors.append(f"Invalid date values for Employee {emp_id}.")
        except Exception as e:
            errors.append(f"Error processing {emp_id}: {str(e)}")
            
    return Response({
        'status': 'success',
        'processed': processed,
        'errors': errors
    })



@api_view(['POST'])
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