from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.models import User
from .models import Employee, DTRBatch, SyncLog, FundPayment, UserProfile


class FundPaymentInline(admin.TabularInline):
    """Show FundPayment records directly inside the Employee admin form."""
    model = FundPayment
    extra = 0
    readonly_fields = ('year', 'month', 'cutoff', 'amount', 'modified_at')
    fk_name = 'employee'
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(FundPayment)
class FundPaymentAdmin(admin.ModelAdmin):
    list_display = ['employee_name', 'year', 'month', 'cutoff', 'amount', 'modified_at']
    list_filter = ['year', 'month', 'cutoff']
    search_fields = ['employee__name']
    readonly_fields = ('modified_at',)

    def employee_name(self, obj):
        if not obj.employee:
            return "[Deleted Employee]"
        return obj.employee.name
    employee_name.short_description = 'Employee'


# Unregister the default User admin, then re-register with our customisation
admin.site.unregister(User)

@admin.register(User)
class UserAdmin(BaseUserAdmin):
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
