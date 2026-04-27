from rest_framework import serializers

from .models import Employee, DTRBatch


class EmployeeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Employee
        fields = ['id', 'name', 'duty', 'start_date', 'local_id', 'created_at', 'updated_at']


class DTRBatchRowSerializer(serializers.Serializer):
    day = serializers.IntegerField()
    arrival = serializers.CharField(allow_blank=True, default='')
    departure = serializers.CharField(allow_blank=True, default='')
    pmArrival = serializers.CharField(allow_blank=True, default='')
    pmDeparture = serializers.CharField(allow_blank=True, default='')


class DTRBatchEmployeeRefSerializer(serializers.Serializer):
    name = serializers.CharField()
    duty = serializers.CharField(default='AM')


class DTRBatchEmployeeSerializer(serializers.Serializer):
    emp = DTRBatchEmployeeRefSerializer()
    rows = DTRBatchRowSerializer(many=True)


class DTRBatchSerializer(serializers.ModelSerializer):
    employees = serializers.SerializerMethodField()

    class Meta:
        model = DTRBatch
        fields = ['id', 'label', 'month', 'year', 'cutoff', 'employees', 'local_id', 'created_at']

    def get_employees(self, obj):
        employees = obj.get_employees() or []

        for employee in employees:
            emp = employee.get('emp') or {}
            if 'duty' not in emp or not emp.get('duty'):
                emp['duty'] = 'AM'
            employee['emp'] = emp
            employee.setdefault('rows', [])

        serializer = DTRBatchEmployeeSerializer(employees, many=True)
        return serializer.data
