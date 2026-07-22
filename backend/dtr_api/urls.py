from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views
from . import auth_views

router = DefaultRouter()
router.register(r'employees', views.EmployeeViewSet, basename='employee')
router.register(r'batches', views.DTRBatchViewSet)
router.register(r'treasury/transactions', views.TreasuryTransactionViewSet, basename='treasury-transaction')

urlpatterns = [
    path('', include(router.urls)),
    path('sync/', views.sync_view, name='sync'),
    path('dashboard/', views.dashboard_view, name='dashboard'),
    path('fund-payments/', views.fund_payments_list, name='fund-payments-list'),
    path('fund-payments/upsert/', views.fund_payment_upsert, name='fund-payment-upsert'),
    path('sheets-sync-now/', views.sheets_sync_now, name='sheets-sync-now'),
    path('sheets-sync-status/', views.sheets_sync_status, name='sheets-sync-status'),
    path('treasury/summary/', views.treasury_summary, name='treasury-summary'),
    # ── Auth endpoints ──────────────────────────────────────────────────────
    path('auth/login/', auth_views.login_view, name='auth-login'),
    path('auth/token/refresh/', auth_views.token_refresh_view, name='auth-token-refresh'),
    path('auth/me/', auth_views.me_view, name='auth-me'),
    path('auth/change-password/', auth_views.change_password_view, name='auth-change-password'),
    path('auth/set-password/<int:user_id>/', auth_views.set_password_view, name='auth-set-password'),
    path('auth/logout/', auth_views.logout_view, name='auth-logout'),
    
    # ── Settings ────────────────────────────────────────────────────────
    path('settings/profile-pic/', auth_views.update_profile_pic, name='settings-profile-pic'),
    path('settings/activity-logs/', auth_views.get_activity_logs, name='settings-activity-logs'),
    path('settings/colleagues/', auth_views.get_office_colleagues, name='settings-colleagues'),
    path('settings/update-profile-info/', auth_views.update_profile_info, name='settings-update-profile-info'),

    # ── User management (SuperAdmin only) ───────────────────────────────────
    path('auth/users/', auth_views.users_list_view, name='auth-users-list'),
    path('auth/users/create/', auth_views.create_user_view, name='auth-users-create'),
    path('auth/set-role/<int:user_id>/', auth_views.set_role_view, name='auth-set-role'),
    path('auth/toggle-active/<int:user_id>/', auth_views.toggle_active_view, name='auth-toggle-active'),
    path('auth/heartbeat/', auth_views.heartbeat_view, name='auth-heartbeat'),
    path('auth/online-users/', auth_views.online_users_view, name='auth-online-users'),
    path('attachments/upload/', views.attachment_upload, name='attachment-upload'),
    path('attachments/<int:attachment_id>/download/', views.attachment_download, name='attachment-download'),
]
