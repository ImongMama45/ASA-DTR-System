from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views
from . import auth_views

router = DefaultRouter()
router.register(r'employees', views.EmployeeViewSet, basename='employee')
router.register(r'batches', views.DTRBatchViewSet)

urlpatterns = [
    path('', include(router.urls)),
    path('sync/', views.sync_view, name='sync'),
    path('dashboard/', views.dashboard_view, name='dashboard'),
    path('fund-payments/', views.fund_payments_list, name='fund-payments-list'),
    path('fund-payments/upsert/', views.fund_payment_upsert, name='fund-payment-upsert'),
    path('sheets-sync-now/', views.sheets_sync_now, name='sheets-sync-now'),
    path('sheets-sync-status/', views.sheets_sync_status, name='sheets-sync-status'),
    # ── Auth endpoints ──────────────────────────────────────────────────────
    path('auth/login/', auth_views.login_view, name='auth-login'),
    path('auth/token/refresh/', auth_views.token_refresh_view, name='auth-token-refresh'),
    path('auth/me/', auth_views.me_view, name='auth-me'),
    path('auth/change-password/', auth_views.change_password_view, name='auth-change-password'),
    path('auth/set-password/<int:user_id>/', auth_views.set_password_view, name='auth-set-password'),
    path('auth/logout/', auth_views.logout_view, name='auth-logout'),
    # ── User management (SuperAdmin only) ───────────────────────────────────
    path('auth/users/', auth_views.users_list_view, name='auth-users-list'),
    path('auth/set-role/<int:user_id>/', auth_views.set_role_view, name='auth-set-role'),
    path('auth/toggle-active/<int:user_id>/', auth_views.toggle_active_view, name='auth-toggle-active'),
]
