from django.db import models
from django.contrib.auth.models import User
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


class UserProfile(models.Model):
    ROLE_CHOICES = [
        ('SuperAdmin', 'SuperAdmin'),
        ('President', 'President'),
        ('Vice President', 'Vice President'),
        ('Secretary', 'Secretary'),
        ('Treasurer', 'Treasurer'),
        ('Member', 'Member'),
    ]
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    employee = models.OneToOneField(Employee, on_delete=models.SET_NULL, null=True, blank=True, related_name='user_profile')
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default='Member')

    def __str__(self):
        return f"{self.user.username} - {self.role}"


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
    employee = models.ForeignKey(
        Employee,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='fund_payments'
    )
    year = models.IntegerField()
    month = models.IntegerField()  # 0-indexed (Jan=0)
    cutoff = models.IntegerField()  # 1 or 16
    amount = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    modified_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('employee', 'year', 'month', 'cutoff')
        ordering = ['year', 'month', 'cutoff']

    def __str__(self):
        emp_name = self.employee.name if self.employee else '[Deleted Employee]'
        return f"{emp_name} - {self.year}/{self.month} cutoff {self.cutoff}: ₱{self.amount}"


class SyncLog(models.Model):
    action = models.CharField(max_length=100)
    payload = models.TextField()
    processed_at = models.DateTimeField(auto_now_add=True)
    success = models.BooleanField(default=True)

    class Meta:
        ordering = ['-processed_at']


class SheetsSyncState(models.Model):
    """
    Singleton model (always pk=1) that tracks the state of the
    System → Google Sheets mirror. Use SheetsSyncState.get() everywhere.
    """
    # The Google Sheets file ID once created; None means sheet doesn't exist yet.
    spreadsheet_id = models.CharField(max_length=200, blank=True, null=True)
    # Dirty flag: set to True whenever any FundPayment changes.
    # The sync engine clears it after a successful push.
    is_dirty = models.BooleanField(default=False)
    # Timestamp of the last *successful* sync. Used by the throttle check.
    last_synced_at = models.DateTimeField(null=True, blank=True)
    # Timestamp of when the dirty flag was most recently set.
    dirty_since = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "Sheets Sync State"

    @classmethod
    def get(cls):
        """Always returns the single shared state row, creating it if needed."""
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    @classmethod
    def mark_dirty(cls):
        """Call this whenever a FundPayment is created or updated."""
        from django.utils import timezone
        cls.objects.update_or_create(
            pk=1,
            defaults={'is_dirty': True, 'dirty_since': timezone.now()},
        )

    def __str__(self):
        return f"SheetsSyncState | dirty={self.is_dirty} | last_synced={self.last_synced_at}"


class Attachment(models.Model):
    """A file (PDF or image) stored in Google Drive, referenced by Django."""
    drive_file_id = models.CharField(max_length=200, unique=True)
    original_filename = models.CharField(max_length=255)
    mime_type = models.CharField(max_length=100)
    uploaded_at = models.DateTimeField(auto_now_add=True)
    uploaded_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True
    )

    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, null=True, blank=True,
        related_name='attachments'
    )
    dtr_batch = models.ForeignKey(
        DTRBatch, on_delete=models.CASCADE, null=True, blank=True,
        related_name='attachments'
    )
    fund_payment = models.ForeignKey(
        FundPayment, on_delete=models.CASCADE, null=True, blank=True,
        related_name='attachments'
    )

    class Meta:
        ordering = ['-uploaded_at']

    def __str__(self):
        return self.original_filename
