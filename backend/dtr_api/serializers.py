from rest_framework import serializers

from .models import Employee, DTRBatch, FundPayment, Attachment, TreasuryTransaction


class EmployeeSerializer(serializers.ModelSerializer):
    role = serializers.CharField(source='user_profile.role', read_only=True, default=None)
    username = serializers.CharField(source='user_profile.user.username', read_only=True, default=None)
    profile_pic = serializers.URLField(source='user_profile.profile_pic', read_only=True, default=None)

    class Meta:
        model = Employee
        fields = ['id', 'name', 'duty', 'office', 'start_date', 'end_date', 'is_active', 'local_id', 'created_at', 'updated_at', 'role', 'username', 'profile_pic']


class FundPaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = FundPayment
        fields = ['id', 'employee', 'year', 'month', 'cutoff', 'amount', 'modified_at']


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


class AttachmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Attachment
        fields = ['id', 'original_filename', 'mime_type', 'uploaded_at', 'employee', 'dtr_batch', 'fund_payment']
        read_only_fields = ['id', 'uploaded_at']


class TreasuryTransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = TreasuryTransaction
        fields = [
            'id', 'transaction_id', 'transaction_type', 'amount', 'description',
            'recorded_by_name', 'recorded_by_role', 'running_balance', 'created_at',
        ]
        read_only_fields = ['id', 'transaction_id', 'recorded_by_name', 'recorded_by_role', 'running_balance', 'created_at']
