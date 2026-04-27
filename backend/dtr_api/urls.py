from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register(r'employees', views.EmployeeViewSet)
router.register(r'batches', views.DTRBatchViewSet)

urlpatterns = [
    path('', include(router.urls)),
    path('sync/', views.sync_view, name='sync'),
    path('dashboard/', views.dashboard_view, name='dashboard'),
]
