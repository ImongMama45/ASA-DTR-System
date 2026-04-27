from django.contrib import admin
from .models import Employee, DTRBatch, SyncLog

@admin.register(Employee)
class EmployeeAdmin(admin.ModelAdmin):
    list_display = ['name', 'duty', 'start_date', 'created_at']
    search_fields = ['name']
    list_filter = ['duty']

@admin.register(DTRBatch)
class DTRBatchAdmin(admin.ModelAdmin):
    list_display = ['label', 'month', 'year', 'cutoff', 'created_at']
    list_filter = ['year', 'cutoff']

@admin.register(SyncLog)
class SyncLogAdmin(admin.ModelAdmin):
    list_display = ['action', 'success', 'processed_at']
    list_filter = ['success', 'action']
