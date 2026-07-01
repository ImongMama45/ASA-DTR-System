from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register(r'employees', views.EmployeeViewSet, basename='employee')
router.register(r'batches', views.DTRBatchViewSet)
router.register(r'fund-payments', views.FundPaymentViewSet, basename='fund-payment')

urlpatterns = [
    path('', include(router.urls)),
    path('sync/', views.sync_view, name='sync'),
    path('dashboard/', views.dashboard_view, name='dashboard'),
    path('fund-payments/upsert/', views.fund_payment_upsert, name='fund-payment-upsert'),
]
