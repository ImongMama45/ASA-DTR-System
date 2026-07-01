from django.db import models
import json


class Employee(models.Model):
    DUTY_CHOICES = [('AM', 'AM Duty'), ('PM', 'PM Duty')]
    OFFICE_CHOICES = [
        ('Finance Office', 'Finance Office'),
        ('Registrar Office', 'Registrar Office'),
        ('Maintenance Office', 'Maintenance Office'),
        ('Clinic', 'Clinic'),
        ('Admission/Guidance Office', 'Admission/Guidance Office'),
        ('HR Office', 'HR Office'),
        ('BSSW Program Head Office', 'BSSW Program Head Office'),
        ('ICES Office', 'ICES Office'),
        ('BSE Program Head Office', 'BSE Program Head Office'),
        ('BSPA Program Head Office', 'BSPA Program Head Office'),
        ('BTVTED/ABELS Program Head Office', 'BTVTED/ABELS Program Head Office'),
        ('BSA/BSAIS Program Head Office', 'BSA/BSAIS Program Head Office'),
        ('GAD Office', 'GAD Office'),
        ('Library', 'Library'),
        ('Admin Office', 'Admin Office'),
        ('PE Department Office', 'PE Department Office'),
        ('BSIT Program Head Office', 'BSIT Program Head Office'),
        ('Alumni Office', 'Alumni Office'),
    ]
    name = models.CharField(max_length=200)
    duty = models.CharField(max_length=2, choices=DUTY_CHOICES, default='AM')
    office = models.CharField(max_length=100, choices=OFFICE_CHOICES, blank=True, null=True)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    local_id = models.CharField(max_length=100, blank=True, null=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class DTRBatch(models.Model):
    label = models.CharField(max_length=100)
    month = models.IntegerField()
    year = models.IntegerField()
    cutoff = models.IntegerField()
    employees_data = models.TextField(default='[]')
    local_id = models.CharField(max_length=100, blank=True, null=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def get_employees(self):
        return json.loads(self.employees_data)

    def set_employees(self, data):
        self.employees_data = json.dumps(data)

    def __str__(self):
        return self.label


class FundPayment(models.Model):
    """Tracks the bi-monthly fund payments (₱20 per cutoff) for each employee."""
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='fund_payments')
    year = models.IntegerField()
    month = models.IntegerField()  # 0-indexed (Jan=0)
    cutoff = models.IntegerField()  # 1 or 16
    amount = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    modified_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('employee', 'year', 'month', 'cutoff')
        ordering = ['year', 'month', 'cutoff']

    def __str__(self):
        return f"{self.employee.name} - {self.year}/{self.month+1} cutoff {self.cutoff}: ₱{self.amount}"


class SyncLog(models.Model):
    action = models.CharField(max_length=100)
    payload = models.TextField()
    processed_at = models.DateTimeField(auto_now_add=True)
    success = models.BooleanField(default=True)

    class Meta:
        ordering = ['-processed_at']
