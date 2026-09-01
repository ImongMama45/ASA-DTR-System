"""
Management command: fix_treasury

Usage (run from Render Shell or local):

  # 1. Just inspect — shows all FUND_EDIT transactions + current balance breakdown
  python manage.py fix_treasury --inspect

  # 2. Recalculate running_balance on every TreasuryTransaction (safe, no deletes)
  python manage.py fix_treasury --recalc-balances

  # 3. Delete specific FUND_EDIT_ADD transactions by their DB id (comma-separated)
  python manage.py fix_treasury --delete-ids 5,8,12

  # 4. Delete ALL FUND_EDIT_ADD transactions (nuclear — confirm interactively)
  python manage.py fix_treasury --delete-all-fund-edit-adds

  # 5. Full clean: delete all FUND_EDIT_ADD + FUND_EDIT_SUB, then recalc balances
  python manage.py fix_treasury --delete-all-fund-edit-adds --delete-all-fund-edit-subs --recalc-balances
"""

from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Sum
from decimal import Decimal

from dtr_api.models import TreasuryTransaction, FundPayment


def _fmt(d):
    return f"PHP {float(d):,.2f}"


class Command(BaseCommand):
    help = "Inspect and clean phantom treasury FUND_EDIT transactions, and recalculate running balances."

    def add_arguments(self, parser):
        parser.add_argument(
            "--inspect",
            action="store_true",
            help="Print all FUND_EDIT transactions and current balance breakdown. No changes made.",
        )
        parser.add_argument(
            "--recalc-balances",
            action="store_true",
            help="Recalculate and update running_balance on every TreasuryTransaction in chronological order.",
        )
        parser.add_argument(
            "--delete-ids",
            type=str,
            default="",
            help="Comma-separated list of TreasuryTransaction primary-key IDs to delete.",
        )
        parser.add_argument(
            "--delete-all-fund-edit-adds",
            action="store_true",
            help="Delete ALL FUND_EDIT_ADD transactions (requires interactive confirmation).",
        )
        parser.add_argument(
            "--delete-all-fund-edit-subs",
            action="store_true",
            help="Delete ALL FUND_EDIT_SUB transactions (requires interactive confirmation).",
        )

    # ──────────────────────────────────────────────────────────────────────────
    def handle(self, *args, **options):
        did_something = False

        if options["inspect"]:
            self._inspect()
            did_something = True

        if options["delete_ids"]:
            self._delete_by_ids(options["delete_ids"])
            did_something = True

        if options["delete_all_fund_edit_adds"]:
            self._delete_all("FUND_EDIT_ADD")
            did_something = True

        if options["delete_all_fund_edit_subs"]:
            self._delete_all("FUND_EDIT_SUB")
            did_something = True

        if options["recalc_balances"]:
            self._recalc_balances()
            did_something = True

        if not did_something:
            self.stdout.write(self.style.WARNING(
                "No action specified. Run with --help to see available options."
            ))

    # ──────────────────────────────────────────────────────────────────────────
    def _inspect(self):
        self.stdout.write("\n" + "=" * 65)
        self.stdout.write(self.style.SUCCESS("  TREASURY BALANCE BREAKDOWN"))
        self.stdout.write("=" * 65)

        fp = FundPayment.objects.aggregate(total=Sum("amount"))["total"] or Decimal("0")
        deps = TreasuryTransaction.objects.filter(
            transaction_type="DEPOSIT"
        ).aggregate(total=Sum("amount"))["total"] or Decimal("0")
        wds = TreasuryTransaction.objects.filter(
            transaction_type="WITHDRAWAL"
        ).aggregate(total=Sum("amount"))["total"] or Decimal("0")
        fa = TreasuryTransaction.objects.filter(
            transaction_type="FUND_EDIT_ADD"
        ).aggregate(total=Sum("amount"))["total"] or Decimal("0")
        fs = TreasuryTransaction.objects.filter(
            transaction_type="FUND_EDIT_SUB"
        ).aggregate(total=Sum("amount"))["total"] or Decimal("0")

        self.stdout.write(f"  FundPayment sum (SA contributions):  {_fmt(fp)}")
        self.stdout.write(f"  Deposits:                            {_fmt(deps)}")
        self.stdout.write(f"  Withdrawals:                        -{_fmt(wds)}")
        self.stdout.write(f"  FUND_EDIT_ADD total:                +{_fmt(fa)}")
        self.stdout.write(f"  FUND_EDIT_SUB total:                -{_fmt(fs)}")
        self.stdout.write("-" * 65)
        self.stdout.write(f"  Current live balance:                {_fmt(fp + deps - wds + fa - fs)}")
        self.stdout.write("=" * 65 + "\n")

        self.stdout.write(self.style.SUCCESS("  ALL FUND_EDIT TRANSACTIONS"))
        self.stdout.write("=" * 65)
        fe_qs = TreasuryTransaction.objects.filter(
            transaction_type__in=["FUND_EDIT_ADD", "FUND_EDIT_SUB"]
        ).order_by("created_at")

        if not fe_qs.exists():
            self.stdout.write("  (none)")
        else:
            for tx in fe_qs:
                sign = "+" if tx.transaction_type == "FUND_EDIT_ADD" else "-"
                self.stdout.write(
                    f"  ID={tx.pk:<5} {tx.transaction_type:<15} "
                    f"{sign}{_fmt(tx.amount):<14} "
                    f"balance_snap={_fmt(tx.running_balance):<14} "
                    f"{tx.created_at.strftime('%Y-%m-%d %H:%M')}  "
                    f"by={tx.recorded_by_name}"
                )

        self.stdout.write("=" * 65 + "\n")

    # ──────────────────────────────────────────────────────────────────────────
    def _delete_by_ids(self, ids_str):
        ids = [int(i.strip()) for i in ids_str.split(",") if i.strip().isdigit()]
        if not ids:
            self.stdout.write(self.style.ERROR("No valid IDs provided."))
            return

        qs = TreasuryTransaction.objects.filter(pk__in=ids)
        found = list(qs.values("id", "transaction_type", "amount", "created_at"))
        if not found:
            self.stdout.write(self.style.WARNING("No transactions found with those IDs."))
            return

        self.stdout.write("\nAbout to DELETE:")
        for tx in found:
            self.stdout.write(f"  ID={tx['id']}  {tx['transaction_type']}  {_fmt(tx['amount'])}  {tx['created_at']}")

        confirm = input("\nType YES to confirm permanent deletion: ")
        if confirm.strip() != "YES":
            self.stdout.write(self.style.WARNING("Aborted."))
            return

        with transaction.atomic():
            deleted_count, _ = qs.delete()
        self.stdout.write(self.style.SUCCESS(f"Deleted {deleted_count} transaction(s)."))

    # ──────────────────────────────────────────────────────────────────────────
    def _delete_all(self, tx_type):
        qs = TreasuryTransaction.objects.filter(transaction_type=tx_type)
        count = qs.count()
        if count == 0:
            self.stdout.write(self.style.WARNING(f"No {tx_type} transactions found."))
            return

        total = qs.aggregate(t=Sum("amount"))["t"] or Decimal("0")
        self.stdout.write(
            f"\nFound {count} {tx_type} transaction(s) totalling {_fmt(total)}."
        )
        confirm = input(f"Type YES to permanently delete ALL {count} {tx_type} records: ")
        if confirm.strip() != "YES":
            self.stdout.write(self.style.WARNING("Aborted."))
            return

        with transaction.atomic():
            deleted_count, _ = qs.delete()
        self.stdout.write(self.style.SUCCESS(f"Deleted {deleted_count} {tx_type} transaction(s)."))

    # ──────────────────────────────────────────────────────────────────────────
    def _recalc_balances(self):
        """
        Walk all TreasuryTransactions in created_at order and rewrite
        running_balance so that the Fund Logs panel shows correct historical
        snapshots.

        Balance formula (same as _current_total_budget + FundPayments):
          running total starts at SUM(FundPayment.amount) at the point of the
          FIRST transaction, then each transaction adjusts it.

        NOTE: FundPayment records don't have timestamps that map perfectly
        to the TreasuryTransaction timeline, so we treat the current
        FundPayment sum as a fixed baseline and adjust from there.
        """
        self.stdout.write("\nRecalculating running_balance for all TreasuryTransactions…")

        txs = list(TreasuryTransaction.objects.order_by("created_at", "pk"))
        if not txs:
            self.stdout.write(self.style.WARNING("No transactions found."))
            return

        fp_total = FundPayment.objects.aggregate(total=Sum("amount"))["total"] or Decimal("0")

        # Reconstruct the balance as of each transaction by replaying forwards.
        # Start from 0 (the FundPayment contributions are already factored in
        # through the live formula; recalc only affects the stored snapshot).
        # We use the same formula as _current_total_budget() but replay the
        # TreasuryTransaction ledger entries in order.
        running = fp_total  # baseline: current SA contributions

        # First pass: subtract all existing TreasuryTransaction effects so
        # we get back to a "pre-all-transactions" starting point.
        for tx in txs:
            if tx.transaction_type == "DEPOSIT":
                running -= tx.amount
            elif tx.transaction_type == "WITHDRAWAL":
                running += tx.amount
            elif tx.transaction_type == "FUND_EDIT_ADD":
                running -= tx.amount
            elif tx.transaction_type == "FUND_EDIT_SUB":
                running += tx.amount

        # running is now the estimated pre-transaction baseline.
        self.stdout.write(f"  Estimated pre-transaction baseline: {_fmt(running)}")

        # Second pass: replay forwards and update snapshots.
        updated = 0
        with transaction.atomic():
            for tx in txs:
                if tx.transaction_type == "DEPOSIT":
                    running += tx.amount
                elif tx.transaction_type == "WITHDRAWAL":
                    running -= tx.amount
                elif tx.transaction_type == "FUND_EDIT_ADD":
                    running += tx.amount
                elif tx.transaction_type == "FUND_EDIT_SUB":
                    running -= tx.amount

                if tx.running_balance != running:
                    tx.running_balance = running
                    tx.save(update_fields=["running_balance"])
                    updated += 1

        self.stdout.write(self.style.SUCCESS(
            f"Done. Updated {updated} / {len(txs)} transaction(s). "
            f"Final balance: {_fmt(running)}"
        ))
