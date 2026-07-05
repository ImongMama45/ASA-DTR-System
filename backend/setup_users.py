import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'dtr_project.settings')
django.setup()

from django.contrib.auth.models import User
from dtr_api.models import Employee, UserProfile

def run():
    print("Setting up SuperAdmin and migrating existing Employees to Users...")

    # 1. Setup SuperAdmin
    superadmin_username = 'admin'
    
    user, created = User.objects.get_or_create(username=superadmin_username)
    if created:
        user.set_password('Admin2026!')
        user.is_superuser = True
        user.is_staff = True
        user.save()
        print(f"Created SuperAdmin user '{superadmin_username}' with default password 'Admin2026!'")
    else:
        print(f"SuperAdmin user '{superadmin_username}' already exists.")

    profile, created = UserProfile.objects.get_or_create(user=user)
    if profile.role != 'SuperAdmin':
        profile.role = 'SuperAdmin'
        profile.save()

    # 2. Setup existing Employees
    employees = Employee.objects.all()
    count = 0
    for emp in employees:
        # We need a unique username. Let's use local_id if available, otherwise fallback.
        # But wait! User specifically said:
        # "Safer: a dedicated username field, either an institutional email if your school issues one, or something SuperAdmin explicitly assigns per person during account creation - decoupled from local_id"
        # We can create a default username like SA_{emp.id} and they can change it later.
        username = f"sa_{emp.id}"
        
        # Check if user already exists
        emp_user, created = User.objects.get_or_create(username=username)
        if created:
            # Set unusable password. SuperAdmin must set password in User Management.
            emp_user.set_unusable_password()
            # Follow is_active state
            emp_user.is_active = emp.is_active
            emp_user.save()
            count += 1
            
            # Create UserProfile
            UserProfile.objects.get_or_create(
                user=emp_user,
                employee=emp,
                defaults={'role': 'Member'}
            )
        else:
            # Sync is_active just in case
            if emp_user.is_active != emp.is_active:
                emp_user.is_active = emp.is_active
                emp_user.save()
            
            # Ensure profile exists
            UserProfile.objects.get_or_create(
                user=emp_user,
                employee=emp,
                defaults={'role': 'Member'}
            )

    print(f"Successfully migrated {count} new Employees to User accounts.")

if __name__ == '__main__':
    run()
