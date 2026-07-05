import os
import django
import pandas as pd

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'dtr_project.settings')
django.setup()

from dtr_api.models import Employee

# Load Excel
file_path = 'FUND2026_Sync_PreFlight_Audit (1).xlsx'
df = pd.read_excel(file_path)

# Fetch all employees
employees = list(Employee.objects.values('id', 'name'))

# Function to safely parse names
def match_employee(sheet_name):
    sheet_name = str(sheet_name).strip()
    if ',' in sheet_name:
        last, first = [x.strip() for x in sheet_name.split(',', 1)]
    else:
        last = sheet_name
        first = ""
        
    for emp in employees:
        db_name = emp['name'].upper()
        # Ensure we don't accidentally match subsets, but simple last name matching
        if last.upper() in db_name:
            if first:
                # take first word of first name to handle missing middle initials
                first_part = first.split()[0].upper()
                if first_part in db_name:
                    return emp['id']
            else:
                return emp['id']
    return None

# Apply matching
for index, row in df.iterrows():
    name = row["Name (as in 'FUND 2026')"]
    emp_id = match_employee(name)
    if emp_id:
        df.at[index, 'Django Employee ID (fill in)'] = emp_id

# Write back
df.to_excel('FUND2026_Sync_PreFlight_Audit_Filled.xlsx', index=False)
print("Finished matching IDs. Output saved to FUND2026_Sync_PreFlight_Audit_Filled.xlsx")
