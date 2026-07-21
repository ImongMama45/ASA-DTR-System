import os
import django
from decimal import Decimal
from django.db.models import Sum

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'dtr_project.settings')
django.setup()

from dtr_api.models import TreasuryTransaction, FundPayment

def update_balances():
    contributions = FundPayment.objects.aggregate(total=Sum('amount'))['total'] or Decimal('0')
    transactions = TreasuryTransaction.objects.order_by('created_at')
    
    current_balance = contributions
    for t in transactions:
        if t.transaction_type == 'DEPOSIT':
            current_balance += t.amount
        else:
            current_balance -= t.amount
        t.running_balance = current_balance
        t.save(update_fields=['running_balance'])
    
    print("Balances updated successfully.")

if __name__ == '__main__':
    update_balances()
