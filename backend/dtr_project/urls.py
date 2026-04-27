from django.contrib import admin
from django.http import HttpResponse
from django.urls import path, include

def home(request):
    return HttpResponse("Backend is running!")

urlpatterns = [
    path('', home),  # 👈 ADD THIS
    path('admin/', admin.site.urls),
    path('api/', include('dtr_api.urls')),
]
