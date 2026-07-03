from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register(r'employees', views.EmployeeViewSet, basename='employee')
router.register(r'batches', views.DTRBatchViewSet)

urlpatterns = [
    path('', include(router.urls)),
    path('sync/', views.sync_view, name='sync'),
    path('dashboard/', views.dashboard_view, name='dashboard'),
    path('fund-payments/', views.fund_payments_list, name='fund-payments-list'),
    path('fund-payments/upsert/', views.fund_payment_upsert, name='fund-payment-upsert'),
    path('webhooks/sheets-sync/', views.sheets_webhook_sync, name='sheets-webhook-sync'),
    path('sheets-sync-now/', views.sheets_sync_now, name='sheets-sync-now'),
    path('sheets-sync-status/', views.sheets_sync_status, name='sheets-sync-status'),
]
