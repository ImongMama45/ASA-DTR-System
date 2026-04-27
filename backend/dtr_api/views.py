from rest_framework import viewsets, status
from rest_framework.decorators import api_view
from rest_framework.response import Response
from django.utils import timezone
import json

from .models import Employee, DTRBatch, SyncLog
from .serializers import EmployeeSerializer, DTRBatchSerializer


class EmployeeViewSet(viewsets.ModelViewSet):
    queryset = Employee.objects.all()
    serializer_class = EmployeeSerializer


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
                start_date=payload.get('start') or None,
                local_id=str(payload.get('localId', '')),
            )
        elif action == 'UPDATE_EMPLOYEE':
            Employee.objects.filter(local_id=str(payload.get('id', ''))).update(
                name=payload.get('name', ''),
                duty=payload.get('duty', 'AM'),
                start_date=payload.get('start') or None,
            )
        elif action == 'DELETE_EMPLOYEE':
            Employee.objects.filter(local_id=str(payload.get('id', ''))).delete()
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
        'total_employees': Employee.objects.count(),
        'total_batches': DTRBatch.objects.count(),
        'last_sync': last_sync.processed_at.strftime('%Y-%m-%d %H:%M') if last_sync else None,
    })
