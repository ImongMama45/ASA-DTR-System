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
    
    # Delete existing payments
    FundPayment.objects.filter(employee=emp).delete()
    
    for y, m, c, amt in payments:
        FundPayment.objects.update_or_create(
            employee=emp, year=y, month=m, cutoff=c,
            defaults={'amount': amt}
        )
    print(f"Fixed {last_name}")

# Row 40: Menemedez Andrei. NEW until Jan-15. Jan-26 is NEW?
# Wait! In the image, Menemedez Andrei: NEW from Jul-31 to Jan-15. Jan-26 is blank? Feb 15 is blank?
# No, look at row 40: Menemedez Andrei. It has `NEW` in Jul-31, ... `NEW` in Dec-31. `NEW` in Jan-15.
# Then NOTHING for Jan-26, Feb-15, Feb-31...
# Wait, look closely at Row 40. Menemedez Andrei has NOTHING in Feb, Mar, Apr. He literally has NO 20s.
# So I shouldn't add any 20s for Menemedez.
reset_and_add_payments("MENEMEDEZ", "2026-01-16", [])

# Row 41: Redota sHANE. NEW until Jan-15. Jan-26 = 20. Feb 15 = 20. Feb 31 = 20. March 15 = 20. Mar 31 = 20. April 15 = 20. April 30 = 20. May 15 = 20.
reset_and_add_payments("REDOTA", "2026-01-16", [
    (2026, 1, 16, 20), (2026, 2, 1, 20), (2026, 2, 16, 20), (2026, 3, 1, 20), 
    (2026, 3, 16, 20), (2026, 4, 1, 20), (2026, 4, 16, 20), (2026, 5, 1, 20)
])

# Row 42: Llego, Jeffrey. NEW until Feb 15. Feb 31 = 20. March 15 = 20. Mar 31 = 20. April 15 = 20. April 30 = 20.
reset_and_add_payments("LLEGO", "2026-02-16", [
    (2026, 2, 16, 20), (2026, 3, 1, 20), (2026, 3, 16, 20), (2026, 4, 1, 20), (2026, 4, 16, 20)
])

# Row 43: Silang Iverson. NEW until Feb 15. Feb 31 = 20. March 15 = 20. Mar 31 = 20. April 15 = 20. April 30 = 20. May 15 = 20.
reset_and_add_payments("SILANG", "2026-02-16", [
    (2026, 2, 16, 20), (2026, 3, 1, 20), (2026, 3, 16, 20), (2026, 4, 1, 20), (2026, 4, 16, 20), (2026, 5, 1, 20)
])

# Row 44: Degras Theo. NEW until Feb 15. Feb 31 = 20. March 15 = 20. Mar 31 = 20.
reset_and_add_payments("DEGRAS", "2026-02-16", [
    (2026, 2, 16, 20), (2026, 3, 1, 20), (2026, 3, 16, 20)
])

# Row 45: Lipaopao Angela. NEW until Jan-26. Feb 15 = 20. Feb 31 = 20. March 15 = 20. Mar 31 = 20. April 15 = 20. April 30 = 20.
reset_and_add_payments("LIPAOPAO", "2026-02-01", [
    (2026, 2, 1, 20), (2026, 2, 16, 20), (2026, 3, 1, 20), (2026, 3, 16, 20), (2026, 4, 1, 20), (2026, 4, 16, 20)
])

# Row 46: Panesa Jeremy. NEW until Mar 31. April 15 = 20. April 30 = 20. May 15 = 20.
reset_and_add_payments("PANESA", "2026-04-01", [
    (2026, 4, 1, 20), (2026, 4, 16, 20), (2026, 5, 1, 20)
])

# Row 47: Manalo Helton. NEW until Feb 15. Feb 31 = 20. March 15 = 20. Mar 31 = 20. April 15 = 20. April 30 = 20. May 15 = 20. May 31 = 20. June 15 = 20.
reset_and_add_payments("MANALO", "2026-02-16", [
    (2026, 2, 16, 20), (2026, 3, 1, 20), (2026, 3, 16, 20), (2026, 4, 1, 20), 
    (2026, 4, 16, 20), (2026, 5, 1, 20), (2026, 5, 16, 20), (2026, 6, 1, 20)
])
