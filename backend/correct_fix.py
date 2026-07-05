import os
import django
import datetime

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'dtr_project.settings')
django.setup()

from dtr_api.models import Employee, FundPayment

def reset_and_add_payments(last_name, start_date_str, payments):
    emp = Employee.objects.filter(name__icontains=last_name).first()
    if not emp: return
    emp.start_date = datetime.datetime.strptime(start_date_str, '%Y-%m-%d').date()
    emp.save()
    FundPayment.objects.filter(employee=emp).delete()
    for y, m, c, amt in payments:
        FundPayment.objects.update_or_create(
            employee=emp, year=y, month=m, cutoff=c,
            defaults={'amount': amt}
        )

reset_and_add_payments("MENEMEDEZ", "2026-01-16", [])
reset_and_add_payments("REDOTA", "2026-01-16", [(2026, 1, 16, 20), (2026, 2, 1, 20), (2026, 2, 16, 20), (2026, 3, 1, 20), (2026, 3, 16, 20), (2026, 4, 1, 20), (2026, 4, 16, 20), (2026, 5, 1, 20)])
reset_and_add_payments("LLEGO", "2026-02-16", [(2026, 2, 16, 20), (2026, 3, 1, 20), (2026, 3, 16, 20), (2026, 4, 1, 20), (2026, 4, 16, 20)])
reset_and_add_payments("SILANG", "2026-02-16", [(2026, 2, 16, 20), (2026, 3, 1, 20), (2026, 3, 16, 20), (2026, 4, 1, 20), (2026, 4, 16, 20), (2026, 5, 1, 20)])
# Theo Degras - strictly 1 payment!
reset_and_add_payments("DEGRAS", "2026-02-16", [(2026, 2, 16, 20)])
reset_and_add_payments("LIPAOPAO", "2026-02-01", [(2026, 2, 1, 20), (2026, 2, 16, 20), (2026, 3, 1, 20), (2026, 3, 16, 20), (2026, 4, 1, 20), (2026, 4, 16, 20)])
reset_and_add_payments("PANESA", "2026-04-01", [(2026, 4, 1, 20), (2026, 4, 16, 20), (2026, 5, 1, 20)])
reset_and_add_payments("MANALO", "2026-02-16", [(2026, 2, 16, 20), (2026, 3, 1, 20), (2026, 3, 16, 20), (2026, 4, 1, 20), (2026, 4, 16, 20), (2026, 5, 1, 20), (2026, 5, 16, 20), (2026, 6, 1, 20)])
