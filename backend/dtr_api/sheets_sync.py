"""
sheets_sync.py — System → Google Sheets mirror engine.

One-way: Django DB is the single source of truth.
The Sheet is a generated, read-only dashboard for Finance.

Entry point: run_sync_if_needed()  ← call this from fund_payment_upsert
             run_sync_now()         ← call this from the manual "Sync Now" endpoint
"""
import os
import logging
import calendar
from datetime import date, datetime, timezone as dt_timezone

from django.utils import timezone

logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────

# Emails that get Editor access whenever a new sheet is auto-created.
SHARE_EMAILS = [
    "quert.number2@gmail.com",
    # Add Finance or adviser emails here later — no other code change needed.
]

# Sheet title shown in Google Drive.
SHEET_TITLE = "SA Fund Tracker — System Mirror"

# Name of the tab inside the spreadsheet.
TAB_NAME = "Fund Tracker"

# Path to credentials JSON.  Set GOOGLE_SHEETS_CREDENTIALS_PATH in the
# PythonAnywhere environment variables (WSGI config or .env).
CREDENTIALS_PATH = os.environ.get(
    "GOOGLE_SHEETS_CREDENTIALS_PATH",
    # Local fallback — update this path on your machine if testing locally.
    os.path.join(os.path.dirname(__file__), "..", "dtr-sheets-sync.json"),
)

# Throttle: don't sync more than once per this many seconds from inline calls.
THROTTLE_SECONDS = 60

# Academic year cutoff columns span Aug (month=7) of year N through
# Jun (month=5) of year N+1.  Adjust if the school calendar changes.
ACADEMIC_START_MONTH = 7   # August (0-indexed)
ACADEMIC_END_MONTH = 5     # June   (0-indexed)

# Yellow fill for "NEW" cells (first eligible cutoff for an employee).
NEW_HIGHLIGHT_COLOR = {"red": 1.0, "green": 0.949, "blue": 0.4}  # #FFF266-ish


# ── Header triple generation ──────────────────────────────────────────────────

def _build_cutoff_columns(academic_year_start: int):
    """
    Returns an ordered list of (year, month, cutoff, label) tuples covering
    one academic year: Aug–Dec of academic_year_start, then Jan–Jun of
    academic_year_start+1.

    label examples: "Aug-31", "Sep-15", "Sep-30", ...
    """
    columns = []

    # Aug–Dec → academic_year_start
    for m in range(7, 12):  # 7=Aug, 8=Sep, …, 11=Dec
        yr = academic_year_start
        last_day = calendar.monthrange(yr, m + 1)[1]
        month_abbr = date(yr, m + 1, 1).strftime("%b")
        columns.append((yr, m, 1,  f"{month_abbr}-15"))
        columns.append((yr, m, 16, f"{month_abbr}-{last_day}"))

    # Jan–Jun → academic_year_start + 1
    for m in range(0, 6):   # 0=Jan, 1=Feb, …, 5=Jun
        yr = academic_year_start + 1
        last_day = calendar.monthrange(yr, m + 1)[1]
        month_abbr = date(yr, m + 1, 1).strftime("%b")
        columns.append((yr, m, 1,  f"{month_abbr}-15"))
        columns.append((yr, m, 16, f"{month_abbr}-{last_day}"))

    return columns


def _get_academic_year_start():
    """
    Derive the current academic year's start year from today's date.
    Aug 1 → next academic year starts.
    """
    today = date.today()
    if today.month >= 8:
        return today.year
    return today.year - 1


# ── "NEW" highlight rule ──────────────────────────────────────────────────────

def _is_new_cell(employee, year: int, month: int, cutoff: int) -> bool:
    """
    Returns True if this cutoff is the employee's FIRST eligible cutoff,
    defined as: the first cutoff whose END date is >= employee.start_date.

    Cutoff 1  → ends on the 15th
    Cutoff 16 → ends on the last day of the month
    """
    if not employee.start_date:
        return False

    if cutoff == 1:
        cutoff_end = date(year, month + 1, 15)
    else:
        last_day = calendar.monthrange(year, month + 1)[1]
        cutoff_end = date(year, month + 1, last_day)

    if cutoff_end < employee.start_date:
        return False  # this cutoff ended before the employee even started

    # Check if there's any earlier cutoff that is also >= start_date
    if cutoff == 16:
        # The 1st-cutoff of the same month ends on the 15th
        earlier_end = date(year, month + 1, 15)
        if earlier_end >= employee.start_date:
            return False  # the 1st cutoff is earlier and also eligible

    # Walk backwards through columns to see if an earlier column also qualifies
    # (simpler: just check if start_date falls inside this cutoff's window)
    if cutoff == 1:
        cutoff_start = date(year, month + 1, 1)
    else:
        cutoff_start = date(year, month + 1, 16)

    # This is the first eligible cutoff if start_date falls in this window,
    # OR if start_date is before this window but no earlier column was eligible
    # (handled by the early-return checks above).
    return cutoff_start <= employee.start_date <= cutoff_end


# ── gspread helpers ───────────────────────────────────────────────────────────

def _get_gspread_client():
    """Returns an authenticated gspread client using the service account JSON."""
    try:
        import gspread
        from google.oauth2.service_account import Credentials
    except ImportError as exc:
        raise RuntimeError(
            "gspread is not installed. Run: pip install gspread google-auth"
        ) from exc

    scopes = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive",
    ]
    creds = Credentials.from_service_account_file(CREDENTIALS_PATH, scopes=scopes)
    return gspread.authorize(creds)


def _get_or_create_spreadsheet(gc, state):
    """
    Returns (spreadsheet, worksheet).
    Creates a new spreadsheet + shares it if no ID is stored yet.
    """
    import gspread

    if state.spreadsheet_id:
        try:
            sh = gc.open_by_key(state.spreadsheet_id)
            try:
                ws = sh.worksheet(TAB_NAME)
            except gspread.WorksheetNotFound:
                ws = sh.add_worksheet(title=TAB_NAME, rows=200, cols=50)
            return sh, ws
        except gspread.SpreadsheetNotFound:
            logger.warning("Stored spreadsheet ID not found — creating a new one.")
            state.spreadsheet_id = None

    # Create new spreadsheet
    sh = gc.create(SHEET_TITLE)
    ws = sh.get_worksheet(0)
    ws.update_title(TAB_NAME)

    # Share with all configured emails
    for email in SHARE_EMAILS:
        try:
            sh.share(email, perm_type="user", role="writer")
            logger.info("Shared sheet with %s", email)
        except Exception as exc:
            logger.error("Failed to share with %s: %s", email, exc)

    # Persist the new ID
    state.spreadsheet_id = sh.id
    state.save(update_fields=["spreadsheet_id"])
    logger.info("Created new spreadsheet: %s", sh.id)
    return sh, ws


# ── Main sync logic ───────────────────────────────────────────────────────────

def _build_and_push(state):
    """
    Pulls all data from DB, builds the grid in memory, and does a
    wholesale overwrite of the Sheet.  Raises on any error.
    """
    from .models import Employee, FundPayment

    academic_year = _get_academic_year_start()
    columns = _build_cutoff_columns(academic_year)

    # ── 1. Pull employees (active first, then archived) ────────────────────
    employees = list(
        Employee.objects.all().order_by("-is_active", "name")
    )

    # ── 2. Pull all relevant FundPayments in one query ─────────────────────
    years_needed = {academic_year, academic_year + 1}
    payments_qs = FundPayment.objects.filter(
        year__in=years_needed
    ).select_related("employee")

    # Index: (employee_id, year, month, cutoff) → amount
    payment_map = {}
    for fp in payments_qs:
        key = (fp.employee_id, fp.year, fp.month, fp.cutoff)
        payment_map[key] = fp.amount

    # ── 3. Build grid in memory ────────────────────────────────────────────
    header_row = ["Employee Name"] + [col[3] for col in columns]
    data_rows = [header_row]

    for emp in employees:
        row = [emp.name]
        for (yr, mo, cutoff, _label) in columns:
            key = (emp.id, yr, mo, cutoff)
            amount = payment_map.get(key, 0)
            if not amount or amount == 0 or amount == "0":
                row.append("")
            else:
                row.append(float(amount))
        data_rows.append(row)

    # ── 4. Push to Sheets ──────────────────────────────────────────────────
    gc = _get_gspread_client()
    _sh, ws = _get_or_create_spreadsheet(gc, state)

    ws.clear()
    ws.update(data_rows, "A1")

    # ── 5. Apply formatting ────────────────────────────────────────────────
    _apply_formatting(ws, employees, columns, academic_year)

    logger.info(
        "Sheet sync complete: %d employees, %d columns, sheet ID=%s",
        len(employees), len(columns), state.spreadsheet_id,
    )


def _apply_formatting(ws, employees, columns, academic_year):
    """
    Applies: frozen header row, bold header, "NEW" yellow highlights.
    Uses batchUpdate for efficiency (single API call).
    """
    try:
        import gspread
        from gspread.utils import rowcol_to_a1

        spreadsheet = ws.spreadsheet
        sheet_id = ws.id

        requests = []

        # Freeze the header row
        requests.append({
            "updateSheetProperties": {
                "properties": {
                    "sheetId": sheet_id,
                    "gridProperties": {"frozenRowCount": 1},
                },
                "fields": "gridProperties.frozenRowCount",
            }
        })

        # Bold the header row
        requests.append({
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 0, "endRowIndex": 1,
                },
                "cell": {
                    "userEnteredFormat": {
                        "textFormat": {"bold": True},
                        "backgroundColor": {"red": 0.85, "green": 0.85, "blue": 0.85},
                    }
                },
                "fields": "userEnteredFormat(textFormat,backgroundColor)",
            }
        })

        # "NEW" highlight: yellow on the first eligible cutoff per employee
        for row_idx, emp in enumerate(employees, start=1):  # row 0 = header
            for col_idx, (yr, mo, cutoff, _label) in enumerate(columns, start=1):
                if _is_new_cell(emp, yr, mo, cutoff):
                    requests.append({
                        "repeatCell": {
                            "range": {
                                "sheetId": sheet_id,
                                "startRowIndex": row_idx,
                                "endRowIndex": row_idx + 1,
                                "startColumnIndex": col_idx,
                                "endColumnIndex": col_idx + 1,
                            },
                            "cell": {
                                "userEnteredFormat": {
                                    "backgroundColor": NEW_HIGHLIGHT_COLOR
                                }
                            },
                            "fields": "userEnteredFormat.backgroundColor",
                        }
                    })

        if requests:
            spreadsheet.batch_update({"requests": requests})

    except Exception as exc:
        # Formatting is cosmetic — log but don't fail the sync over it
        logger.warning("Formatting step failed (non-fatal): %s", exc)


# ── Public API ────────────────────────────────────────────────────────────────

def run_sync_now():
    """
    Runs a full sync unconditionally.
    Call from the manual "Sync Now" endpoint.
    Returns a dict with outcome info.
    """
    from .models import SheetsSyncState
    state = SheetsSyncState.get()
    try:
        _build_and_push(state)
        state.is_dirty = False
        state.last_synced_at = timezone.now()
        state.save(update_fields=["is_dirty", "last_synced_at"])
        return {"synced": True, "spreadsheet_id": state.spreadsheet_id}
    except Exception as exc:
        logger.error("Sheets sync failed: %s", exc, exc_info=True)
        # Leave dirty flag set — next call will retry
        return {"synced": False, "error": str(exc)}


def run_sync_if_needed():
    """
    Throttled sync: only runs if dirty AND at least THROTTLE_SECONDS have
    passed since the last successful sync.  Call from fund_payment_upsert.
    Returns immediately (no-op) if the throttle window hasn't elapsed.
    """
    from .models import SheetsSyncState
    state = SheetsSyncState.get()

    if not state.is_dirty:
        return  # nothing changed, skip

    if state.last_synced_at is not None:
        elapsed = (timezone.now() - state.last_synced_at).total_seconds()
        if elapsed < THROTTLE_SECONDS:
            return  # throttled, will catch up on next save or manual trigger

    run_sync_now()
