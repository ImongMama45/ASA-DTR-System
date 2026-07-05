import os
import django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'dtr_project.settings')
django.setup()

from dtr_api.models import Employee, FundPayment

data = [
    ("ANCAJA", [20, 20, 20, 20, 10, 20, 20, 20, 20, 20, 20, 20, None, None, None, None]),
    ("AZORES", [20, 20, 20, 20, 20, 20, 20, 20, 20, None, None, None, None, None, None, None]),
    ("BALANIAL", [20, 20, 20, 20, 20, 20, 20, 20, 20, None, None, None, None, None, None, None]),
    ("BARCO", [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, None, None, None]),
    ("BARIA", [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, None, None, None, None]),
    ("BATAD", [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, None, None, None]),
    ("BILER", [0, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, None, None, None]),
    ("CAPISTRANO", [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, None]),
    ("DE DIOS", [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, None, None, None]),
    ("DOMANALS", [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 10, None]),
    ("FRIAS", [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, None, None, None]),
    ("GADDI", [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, None, None, None]),
    ("GUZMAN", [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, None, None, None]),
    ("LALISAN", [20, 20, 20, 20, 20, 20, 20, 20, None, None, None, None, None, None, None, None]),
    ("LABITIGAN", [0, 20, 20, 20, 20, 20, 20, 20, None, None, None, None, None, None, None, None]),
    ("MALONZO", [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, None, None, None, None, None, None]),
    ("MENDOZA", [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, None, None, None, None]),
    ("RIVERA", [0, 0, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, None, None, None]),
    ("SESGUNDO", [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, None, None, None, None, None, None]),
    ("VALENCIA", [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, None, None, None, None, None, None]),
    ("DATOR", [0, 0, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, None]),
    ("GIANAN", [0, 0, 0, 0, 20, 20, 20, 20, 20, 20, 20, 20, 20, None, None, None]),
]

year = 2024 # Assumed from the images format

cutoffs = [
    (1, 1), (1, 16),
    (2, 1), (2, 16),
    (3, 1), (3, 16),
    (4, 1), (4, 16),
    (5, 1), (5, 16),
    (6, 1), (6, 16),
    (7, 1), (7, 16),
    (8, 1), (8, 16),
]

count = 0
for last_name, amounts in data:
    emp = Employee.objects.filter(name__icontains=last_name).first()
    if not emp:
        continue
    
    for i, amt in enumerate(amounts):
        if amt is None or amt == 0:
            continue
        
        month, cutoff = cutoffs[i]
        FundPayment.objects.update_or_create(
            employee=emp,
            year=year,
            month=month,
            cutoff=cutoff,
            defaults={'amount': amt}
        )
        count += 1

print(f"Done seeding {count} fund payments for 2024.")
