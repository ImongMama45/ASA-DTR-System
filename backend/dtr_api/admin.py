from django.contrib import admin
from .models import Employee, DTRBatch, SyncLog, FundPayment, User

class FundPaymentInline(admin.StackedInline):
    """Show FundPayment records directly inside the Employee admin form."""
    model = FundPayment
    extra = 0  # Don't show extra empty rows by default
    readonly_fields = ('amount', 'date_formatted')
    fk_name = 'employee'

    def date_formatted(self, obj):
        """A helper to show the date in a nicer format inside the admin."""
        if not obj.date_created:
            return "Never"
        return obj.date_created.strftime('%Y-%m-%d %H:%M')
    date_formatted.short_description = 'Date Paid'

@admin.register(FundPayment)
class FundPaymentAdmin(admin.ModelAdmin):
    list_display = ['employee_name', 'year', 'month', 'cutoff', 'amount', 'date_created']
    list_filter = ['year', 'month', 'cutoff']
    search_fields = ['employee__name']
    readonly_fields = ('date_created',)

    def employee_name(self, obj):
        if not obj.employee:
            return "[Deleted Employee]"
        return obj.employee.name
    employee_name.short_description = 'Employee'

@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    list_display = ['username', 'first_name', 'last_name', 'is_staff', 'is_active', 'is_superuser']
    list_filter = ['is_staff', 'is_active', 'is_superuser']
    search_fields = ['username', 'first_name', 'last_name', 'email']
    ordering = ['username']

@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ['user', 'employee', 'role']
    list_filter = ['role']
    search_fields = ['user__username', 'user__first_name', 'user__last_name', 'employee__name']
    ordering = ['user__username']


@admin.register(Employee)
class EmployeeAdmin(admin.ModelAdmin):
    list_display = ['name', 'duty', 'start_date', 'created_at']
    search_fields = ['name']
    list_filter = ['duty']
    inlines = [FundPaymentInline]

@admin.register(DTRBatch)
class DTRBatchAdmin(admin.ModelAdmin):
    list_display = ['label', 'month', 'year', 'cutoff', 'created_at']
    list_filter = ['year', 'cutoff']

@admin.register(SyncLog)
class SyncLogAdmin(admin.ModelAdmin):
    list_display = ['action', 'success', 'processed_at']
    list_filter = ['success', 'action']
