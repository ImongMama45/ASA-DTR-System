import os
import django
import pandas as pd

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'dtr_project.settings')
django.setup()

from dtr_api.models import Employee, FundPayment

xl = pd.ExcelFile("S.A FUND '25-'26.xlsx")

employees = list(Employee.objects.values('id', 'name'))

def match_employee(sheet_name):
    sheet_name = str(sheet_name).strip()
    if sheet_name == 'nan':
        return None
    if ',' in sheet_name:
        last, first = [x.strip() for x in sheet_name.split(',', 1)]
    else:
        parts = sheet_name.split(maxsplit=1)
        last = parts[0].strip()
        first = parts[1].strip() if len(parts) > 1 else ""
        
    for emp in employees:
        db_name = emp['name'].upper()
        if last.upper() in db_name:
            if first:
                first_part = first.split()[0].upper()
                if first_part in db_name:
                    return emp['id']
            else:
                return emp['id']
    return None

# Clear all payments first to prevent duplicates/conflicts from my earlier script
FundPayment.objects.all().delete()

count = 0

# Mapping for FUND 2025
df_2025 = xl.parse('FUND 2025')
cols_2025 = [
    (1, 1), (1, 16),
    (2, 1), (2, 16),
    (3, 1), (3, 16),
    (4, 1), (4, 16),
    (5, 1), (5, 16),
    (6, 1), (6, 16),
    (7, 1), (7, 16),
    (8, 1), (8, 16),
]
col_offset_2025 = 2 

for idx, row in df_2025.iterrows():
    name = row.iloc[0]
    emp_id = match_employee(name)
    if not emp_id: continue
    
    emp = Employee.objects.get(id=emp_id)
    
    for i, (month, cutoff) in enumerate(cols_2025):
        if col_offset_2025 + i >= len(row): break
        val = row.iloc[col_offset_2025 + i]
        if pd.isna(val) or str(val).strip().upper() == 'NEW' or val == '':
            continue
        try:
            amt = float(val)
            if amt > 0:
                FundPayment.objects.update_or_create(
                    employee=emp, year=2025, month=month, cutoff=cutoff,
                    defaults={'amount': amt}
                )
                count += 1
        except ValueError:
            pass

# Mapping for FUND 2026
df_2026 = xl.parse('FUND 2026')
cols_2026 = [
    (2025, 7, 16), (2025, 8, 1), (2025, 8, 16), (2025, 9, 1), (2025, 9, 16), 
    (2025, 10, 1), (2025, 10, 16), (2025, 11, 1), (2025, 11, 16), (2025, 12, 1), (2025, 12, 16),
    (2026, 1, 1), (2026, 1, 16), (2026, 2, 1), (2026, 2, 16), (2026, 3, 1), (2026, 3, 16),
    (2026, 4, 1), (2026, 4, 16), (2026, 5, 1), (2026, 5, 16), (2026, 6, 1)
]
col_offset_2026 = 2

for idx, row in df_2026.iterrows():
    name = row.iloc[0]
    emp_id = match_employee(name)
    if not emp_id: continue
    
    emp = Employee.objects.get(id=emp_id)
    
    for i, (year, month, cutoff) in enumerate(cols_2026):
        if col_offset_2026 + i >= len(row): break
        val = row.iloc[col_offset_2026 + i]
        if pd.isna(val) or str(val).strip().upper() == 'NEW' or val == '':
            continue
        try:
            amt = float(val)
            if amt > 0:
                FundPayment.objects.update_or_create(
                    employee=emp, year=year, month=month, cutoff=cutoff,
                    defaults={'amount': amt}
                )
                count += 1
        except ValueError:
            pass

print(f"Successfully seeded {count} payments from the Excel file (cleared old records).")
