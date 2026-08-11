from rest_framework import serializers

from .models import Employee, DTRBatch, FundPayment, Attachment, TreasuryTransaction, AttendanceRecord, AttendanceAnomaly


class EmployeeSerializer(serializers.ModelSerializer):
    role = serializers.CharField(source='user_profile.role', read_only=True, default=None)
    username = serializers.CharField(source='user_profile.user.username', read_only=True, default=None)
    profile_pic = serializers.URLField(source='user_profile.profile_pic', read_only=True, default=None)

    class Meta:
        model = Employee
        fields = ['id', 'name', 'duty', 'office', 'start_date', 'end_date', 'is_active', 'local_id', 'has_qr_code', 'created_at', 'updated_at', 'role', 'username', 'profile_pic']


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


from .supabase_client import get_public_url

class AttendanceRecordSerializer(serializers.ModelSerializer):
    employee_name = serializers.SerializerMethodField()
    scanned_by_display = serializers.SerializerMethodField()

    class Meta:
        model = AttendanceRecord
        fields = [
            'id', 'employee', 'employee_name', 'scan_type', 'timestamp',
            'scanned_by', 'scanned_by_name', 'scanned_by_role', 'scanned_by_display',
            'source', 'location', 'proof_image', 'admin_notes', 'linked_anomaly',
        ]
        read_only_fields = [
            'id', 'timestamp', 'scanned_by', 'scanned_by_name',
            'scanned_by_role', 'source', 'linked_anomaly',
        ]

    def get_employee_name(self, obj):
        return obj.employee.name if obj.employee else '[Deleted Employee]'

    def get_scanned_by_display(self, obj):
        """Human-readable name of the officer who scanned."""
        if obj.scanned_by_name:
            return obj.scanned_by_name
        if obj.scanned_by:
            emp = getattr(getattr(obj.scanned_by, 'profile', None), 'employee', None)
            return emp.name if emp else obj.scanned_by.username
        return None


class AttendanceAnomalySerializer(serializers.ModelSerializer):
    employee_name = serializers.SerializerMethodField()

    class Meta:
        model = AttendanceAnomaly
        fields = [
            'id', 'employee', 'employee_name', 'attempted_by', 'attempted_by_name',
            'reason', 'timestamp', 'reviewed', 'resolved_by_record',
        ]
        read_only_fields = ['id', 'timestamp', 'attempted_by', 'attempted_by_name', 'resolved_by_record']

    def get_employee_name(self, obj):
        return obj.employee.name if obj.employee else '[Unknown]'
