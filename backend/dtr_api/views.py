from rest_framework import viewsets, status
from rest_framework.decorators import api_view
from rest_framework.response import Response
from django.utils import timezone
import json

from .models import Employee, DTRBatch, SyncLog, FundPayment
from .serializers import EmployeeSerializer, DTRBatchSerializer, FundPaymentSerializer


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


class FundPaymentViewSet(viewsets.ViewSet):
    """
    GET  /api/fund-payments/?year=2026           -> all payments for a year
    POST /api/fund-payments/upsert/              -> create or update a single record
    POST /api/fund-payments/bulk/                -> bulk upsert all payments for a year
    """

    def list(self, request):
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
