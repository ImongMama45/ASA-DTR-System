from django.db import models
from django.contrib.auth.models import User
from django.core.validators import MinValueValidator
from decimal import Decimal
import json


class Employee(models.Model):
    DUTY_CHOICES = [('AM', 'AM Duty'), ('PM', 'PM Duty')]
    OFFICE_CHOICES = [
        ('Finance', 'Finance'),
        ('Registrar', 'Registrar'),
        ('Property', 'Property'),
        ('Clinic', 'Clinic'),
        ('Admission & Guidance', 'Admission & Guidance'),
        ('HR', 'HR'),
        ('BSSW Department', 'BSSW Department'),
        ('ICES', 'ICES'),
        ('BSE Department', 'BSE Department'),
        ('BSPA Department', 'BSPA Department'),
        ('BTVTED & ABELS Department', 'BTVTED & ABELS Department'),
        ('BSA & BSAIS Department', 'BSA & BSAIS Department'),
        ('GAD', 'GAD'),
        ('Supplies', 'Supplies'),
        ('LMSTC & DHRS', 'LMSTC & DHRS'),
        ('Library', 'Library'),
        ('OSAS', 'OSAS'),
        ('Admin', 'Admin'),
        ('PE Department', 'PE Department'),
        ('BSIT Department', 'BSIT Department'),
        ('Alumni', 'Alumni'),
    ]
    name = models.CharField(max_length=200)
    duty = models.CharField(max_length=2, choices=DUTY_CHOICES, default='AM')
    office = models.CharField(max_length=100, choices=OFFICE_CHOICES, blank=True, null=True)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    local_id = models.CharField(max_length=100, blank=True, null=True, db_index=True)
    has_qr_code = models.BooleanField(default=False)
    card_version = models.IntegerField(default=1)  # Incremented on QR card reissue; stale versions are rejected at scan time
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
        ('Auditor', 'Auditor'),
        ('PIO', 'PIO'),
        ('Member', 'Member'),
    ]
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    employee = models.OneToOneField(Employee, on_delete=models.SET_NULL, null=True, blank=True, related_name='user_profile')
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default='Member')
    profile_pic = models.URLField(max_length=500, blank=True, null=True)  # Cloudinary URL
    last_seen = models.DateTimeField(null=True, blank=True)  # Updated on every authenticated request

    def __str__(self):
        return f"{self.user.username} - {self.role}"


class ActivityLog(models.Model):
    """Tracks user actions for history display in Settings."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='activity_logs')
    action = models.CharField(max_length=255)
    description = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.user.username} - {self.action} at {self.created_at}"

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


class DTREndpoint(models.Model):
    """
    Stores the exact date a DTR was generated for a given cutoff period.
    Keyed by (month, year, cutoff) — exactly one endpoint per period.
    DTRs are often generated ahead of the cutoff's actual end date (e.g.,
    generating the June 1–15 DTR on June 10). The endpoint records where
    placeholder-filled days begin. When the next DTR is generated, the system
    checks real scan data for the gap between the endpoint and the cutoff end
    to find genuine absences and carry them forward as deductions.
    """
    month = models.IntegerField()
    year = models.IntegerField()
    cutoff = models.IntegerField()   # 1 or 16, matching DTRBatch's convention
    endpoint_date = models.DateField()
    # Stores a JSON list of integer day numbers that were holidays in this period.
    # e.g. [4, 12] means day 4 and day 12 were holidays in the cutoff.
    # Stored server-side so the next generation can reliably exclude them from
    # the carryover gap check without depending on the local browser IndexedDB cache.
    holidays_json = models.TextField(default='[]', blank=True)
    set_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='dtr_endpoints')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def get_holidays(self):
        """Returns the list of holiday day numbers (integers) for this period."""
        import json
        try:
            return json.loads(self.holidays_json or '[]')
        except (ValueError, TypeError):
            return []

    def set_holidays(self, days: list):
        """Stores the list of holiday day numbers (integers) for this period."""
        import json
        self.holidays_json = json.dumps([int(d) for d in days])

    class Meta:
        unique_together = ('month', 'year', 'cutoff')
        ordering = ['-year', '-month', '-cutoff']

    def __str__(self):
        return f"DTREndpoint {self.year}/{self.month:02d} cutoff {self.cutoff} → {self.endpoint_date}"


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
    drive_file_id = models.CharField(max_length=200, unique=True, null=True, blank=True)
    supabase_file_path = models.CharField(max_length=500, null=True, blank=True)
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

class TreasuryTransaction(models.Model):
    """
    Append-only ledger for treasury deposits/withdrawals, separate from
    per-employee FundPayment contributions. Intentionally has no update
    or delete path in the API - this is a financial audit trail and
    entries must not be alterable after the fact.
    """

    class TransactionType(models.TextChoices):
        DEPOSIT = 'DEPOSIT', 'Deposit'
        WITHDRAWAL = 'WITHDRAWAL', 'Withdrawal'
        FUND_EDIT_ADD = 'FUND_EDIT_ADD', 'Fund Edit (Add)'
        FUND_EDIT_SUB = 'FUND_EDIT_SUB', 'Fund Edit (Subtract)'

    transaction_type = models.CharField(max_length=15, choices=TransactionType.choices)
    amount = models.DecimalField(
        max_digits=10, decimal_places=2,
        validators=[MinValueValidator(Decimal('0.01'))]
    )
    description = models.TextField()

    # Auto-generated: dep_20260721101530#12 / with_20260721101530#13
    transaction_id = models.CharField(max_length=50, unique=True, blank=True, editable=False)

    recorded_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='treasury_transactions')
    # Snapshots taken at creation time so the log stays historically accurate
    # even if the user's name changes or their role is later updated.
    recorded_by_name = models.CharField(max_length=200, blank=True)
    recorded_by_role = models.CharField(max_length=20, blank=True)
    running_balance = models.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal('0.00'),
        help_text="Snapshot of the total budget AFTER this transaction was applied."
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def save(self, *args, **kwargs):
        is_new = self.pk is None
        super().save(*args, **kwargs)
        if is_new and not self.transaction_id:
            if self.transaction_type == self.TransactionType.DEPOSIT:
                prefix = 'dep'
            elif self.transaction_type == self.TransactionType.WITHDRAWAL:
                prefix = 'with'
            else:
                prefix = 'fd'
            timestamp = self.created_at.strftime('%Y%m%d%H%M%S')
            self.transaction_id = f"{prefix}_{timestamp}#{self.pk}"
            super().save(update_fields=['transaction_id'])

    def __str__(self):
        return f"{self.transaction_id} - PHP {self.amount}"


class AttendanceRecord(models.Model):
    """One row per successful clock-in or clock-out event.
    scan_type encodes both AM/PM session and arrival/departure intent.
    Timestamp is always server-clock; never from the client or QR payload.
    """
    SCAN_TYPE_CHOICES = [
        ('AM_ARRIVAL', 'AM Arrival'),
        ('AM_DEPARTURE', 'AM Departure'),
        ('PM_ARRIVAL', 'PM Arrival'),
        ('PM_DEPARTURE', 'PM Departure'),
    ]
    SOURCE_CHOICES = [
        ('SCAN', 'QR Scan'),
        ('MANUAL', 'Manual Override'),
    ]

    employee = models.ForeignKey(
        Employee, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='attendance_records'
    )
    scan_type = models.CharField(max_length=14, choices=SCAN_TYPE_CHOICES)
    timestamp = models.DateTimeField()  # Server clock, set at request processing time
    scanned_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='scans_performed'
    )
    scanned_by_name = models.CharField(max_length=200, blank=True)
    scanned_by_role = models.CharField(max_length=20, blank=True)
    source = models.CharField(max_length=10, choices=SOURCE_CHOICES, default='SCAN')
    location = models.CharField(max_length=200, blank=True)
    proof_image = models.CharField(max_length=500, blank=True, null=True)  # Supabase Storage path for MANUAL overrides
    admin_notes = models.TextField(blank=True)
    linked_anomaly = models.ForeignKey(
        'AttendanceAnomaly', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='corrective_records',
        help_text='Set when this record was created as a corrective action from an anomaly'
    )

    class Meta:
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['employee', 'timestamp']),
            models.Index(fields=['timestamp']),
        ]

    def __str__(self):
        emp_name = self.employee.name if self.employee else '[Deleted Employee]'
        return f"{emp_name} - {self.scan_type} @ {self.timestamp}"


class AttendanceAnomaly(models.Model):
    """Flagged or blocked scan attempts. Kept separate from AttendanceRecord
    so the real attendance table stays 'only valid, real clock events.'
    Admin can Dismiss (acknowledge) or Create Manual Entry (corrective action).
    """
    employee = models.ForeignKey(
        Employee, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='attendance_anomalies'
    )
    attempted_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='scan_anomalies'
    )
    attempted_by_name = models.CharField(max_length=200, blank=True)
    reason = models.CharField(max_length=255)
    timestamp = models.DateTimeField()  # Server clock
    reviewed = models.BooleanField(default=False)
    resolved_by_record = models.ForeignKey(
        AttendanceRecord, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='resolving_anomalies',
        help_text='Set when admin creates a corrective AttendanceRecord from this anomaly'
    )

    class Meta:
        ordering = ['-timestamp']
        verbose_name_plural = 'Attendance anomalies'

    def __str__(self):
        emp_name = self.employee.name if self.employee else '[Unknown]'
        return f"Anomaly: {emp_name} - {self.reason} @ {self.timestamp}"


class EmployeeTardinessRecord(models.Model):
    """
    Per-employee, per-cutoff late counter.
    Cutoff 1 = days 1–15 of the month.
    Cutoff 2 = days 16–end of the month.
    Resets implicitly: a new cutoff simply has no row (or a fresh row) —
    the previous cutoff's row is never touched.
    Status (green/orange/red) is computed from late_count, never stored.
    """
    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name='tardiness_records'
    )
    year = models.IntegerField()
    month = models.IntegerField()
    cutoff = models.IntegerField()           # 1 = days 1–15 · 2 = days 16–31
    late_count = models.IntegerField(default=0)
    minutes_late_total = models.IntegerField(default=0)

    class Meta:
        unique_together = ('employee', 'year', 'month', 'cutoff')

    def __str__(self):
        return (
            f"{self.employee.name} — {self.year}/{self.month:02d} "
            f"cutoff {self.cutoff}: {self.late_count} late"
        )
