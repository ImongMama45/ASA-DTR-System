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
from datetime import date, datetime, timedelta, timezone as dt_timezone

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
# environment variables (WSGI config or .env).
# On ephemeral filesystems (e.g. Render), set GOOGLE_SHEETS_CREDENTIALS_JSON
# to the full JSON content of the service account file instead.
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

def _get_sync_year():
    """
    Returns the calendar year to sync — always matches the year
    selector on the Fund Tracker page (the current calendar year).
    """
    return date.today().year


def _build_cutoff_columns(sync_year: int):
    """
    Returns columns for the current year up to today only.
    Future cutoffs are excluded so the sheet never shows blank advance columns.
    """
    today = date.today()
    columns = []
    for m in range(0, 12):
        last_day = calendar.monthrange(sync_year, m + 1)[1]
        month_abbr = date(sync_year, m + 1, 1).strftime("%b")
        if date(sync_year, m + 1, 15) <= today:
            columns.append((sync_year, m, 1, f"{month_abbr}-15"))
        if date(sync_year, m + 1, last_day) <= today:
            columns.append((sync_year, m, 16, f"{month_abbr}-{last_day}"))
    return columns


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

    # Prefer inline JSON credentials (required on ephemeral hosts like Render)
    credentials_json = os.environ.get("GOOGLE_SHEETS_CREDENTIALS_JSON")
    if credentials_json:
        import json
        info = json.loads(credentials_json)
        creds = Credentials.from_service_account_info(info, scopes=scopes)
    else:
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

    sync_year = _get_sync_year()
    columns = _build_cutoff_columns(sync_year)

    # ── 1. Pull employees (active first, then archived) ────────────────────
    employees = list(
        Employee.objects.all().order_by("-is_active", "name")
    )

    # ── 2. Pull all relevant FundPayments in one query ─────────────────────
    payments_qs = FundPayment.objects.filter(
        year=sync_year
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
            key = (emp.id, yr, mo + 1, cutoff)
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
    _apply_formatting(ws, employees, columns, sync_year, payment_map)

    logger.info(
        "Sheet sync complete: %d employees, %d columns, sheet ID=%s",
        len(employees), len(columns), state.spreadsheet_id,
    )


def _apply_formatting(ws, employees, columns, sync_year, payment_map):
    """
    Colors every data cell to match the Fund Tracker UI exactly:
      - Green  = Paid (amount >= 20)
      - Orange = Partial (0 < amount < 20)
      - Red    = Unpaid (employee was active, cutoff passed, no payment)
      - Yellow = Not Started / NEW (before start date)
      - Blue   = Resigned (after end date)
    """
    try:
        import gspread

        spreadsheet = ws.spreadsheet
        sheet_id = ws.id
        today = date.today()

        COLOR_PAID     = {"red": 0.133, "green": 0.773, "blue": 0.369}    # #22c55e
        COLOR_PARTIAL  = {"red": 0.976, "green": 0.451, "blue": 0.086}    # #f97316
        COLOR_UNPAID   = {"red": 0.937, "green": 0.267, "blue": 0.267}    # #ef4444
        COLOR_NOT_START= {"red": 0.996, "green": 0.941, "blue": 0.541}    # #fef08a (Yellow)
        COLOR_RESIGNED = {"red": 0.231, "green": 0.510, "blue": 0.965}    # #3b82f6 (Blue)
        COLOR_FUTURE   = {"red": 0.973, "green": 0.980, "blue": 0.988}    # #f8fafc (Not Due)
        COLOR_WHITE    = {"red": 1.0,   "green": 1.0,   "blue": 1.0}      # Future

        requests = []

        # Clear stale formatting from previous syncs (ws.clear() only clears values, not colors)
        requests.append({
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 0,
                    "endRowIndex": 200,
                    "startColumnIndex": 0,
                    "endColumnIndex": 50,
                },
                "cell": {
                    "userEnteredFormat": {
                        "backgroundColor": COLOR_WHITE
                    }
                },
                "fields": "userEnteredFormat.backgroundColor",
            }
        })

        # Freeze the header row and first column
        requests.append({
            "updateSheetProperties": {
                "properties": {
                    "sheetId": sheet_id,
                    "gridProperties": {
                        "frozenRowCount": 1,
                        "frozenColumnCount": 1
                    },
                },
                "fields": "gridProperties.frozenRowCount,gridProperties.frozenColumnCount",
            }
        })

        # Widen the Employee Name column
        requests.append({
            "updateDimensionProperties": {
                "range": {
                    "sheetId": sheet_id,
                    "dimension": "COLUMNS",
                    "startIndex": 0,
                    "endIndex": 1
                },
                "properties": {
                    "pixelSize": 280
                },
                "fields": "pixelSize"
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

        # Color each data cell
        for row_idx, emp in enumerate(employees, start=1):
            for col_idx, (yr, mo, cutoff, _label) in enumerate(columns, start=1):
                key = (emp.id, yr, mo + 1, cutoff)
                amount = float(payment_map.get(key, 0) or 0)

                # Determine cutoff boundaries (Start and End of this cutoff)
                cutoff_start_day = 1 if cutoff == 1 else 16
                cutoff_start = date(yr, mo + 1, cutoff_start_day)
                if cutoff == 1:
                    cutoff_end = date(yr, mo + 1, 15)
                else:
                    last_day = calendar.monthrange(yr, mo + 1)[1]
                    cutoff_end = date(yr, mo + 1, last_day)

                emp_start = getattr(emp, 'start_date', None)
                emp_end = getattr(emp, 'end_date', None)

                # 1. After Resignation?
                if emp_end and emp_end < cutoff_start:
                    bg_color = COLOR_RESIGNED
                # 2. Before Start Date?
                elif emp_start and emp_start > cutoff_end:
                    bg_color = COLOR_NOT_START
                # 3. Active Cutoffs
                elif amount >= 20:
                    bg_color = COLOR_PAID
                elif amount > 0:
                    bg_color = COLOR_PARTIAL
                elif (cutoff_end + timedelta(days=15)) > today:
                    bg_color = COLOR_FUTURE
                else:
                    bg_color = COLOR_UNPAID

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
                                "backgroundColor": bg_color
                            }
                        },
                        "fields": "userEnteredFormat.backgroundColor",
                    }
                })

        if requests:
            spreadsheet.batch_update({"requests": requests})

    except Exception as exc:
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
