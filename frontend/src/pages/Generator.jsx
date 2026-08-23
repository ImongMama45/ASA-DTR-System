import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAllEmployees, saveBatch, seedEmployees, seedBatches } from '../db';
import {
  MONTH_NAMES, DAY_NAMES, getDatesInCutoff, getWeeks,
  getWeekIndex, workdaysInWeek, isWeekend, isSaturday,
  generateTime, cutoffLabel, daysInMonth, formatUserId
} from '../utils/dateUtils';
import { fetchEmployees, fetchBatches, createServerBatch, fetchEmployeeAttendance, fetchDTREndpoint, setDTREndpoint, fetchEmployeeAttendanceRange } from '../hooks/useSync';
import { AlertTriangle, Users, CalendarDays, CheckCircle2, Check, X, Calendar, Loader2, Zap, Gift, Flag, ChevronDown, ChevronUp, Info, Edit, Trash2 } from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';

export default function Generator({ onDone, isOnline }) {
  const [step, setStep] = useState(1);

  // Reuse the shared employees cache — instant if Employees tab was visited first.
  // If not, reads IndexedDB immediately and syncs from server in background.
  const { data: allEmployees = [] } = useQuery({
    queryKey: ['employees', { isOnline }],
    queryFn: async () => {
      const localData = await getAllEmployees();
      if (isOnline) {
        fetchEmployees()
          .then(list => seedEmployees(list))
          .catch(() => { });
      }
      return localData;
    },
    staleTime: 1000 * 60 * 5,
  });

  const [employees, setEmployees] = useState([]);          // subset chosen in step 1
  const [selectedIds, setSelectedIds] = useState(new Set()); // for manual pick UI
  const [pickMode, setPickMode] = useState(null);        // 'all' | 'manual' | null
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDuty, setFilterDuty] = useState('ALL');

  const [config, setConfig] = useState({
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
    cutoff: new Date().getDate() <= 15 ? 1 : 16,
  });
  const [weeks, setWeeks] = useState([]);
  const [weekHours, setWeekHours] = useState([]);
  const [attendance, setAttendance] = useState({});
  const [empIdx, setEmpIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [globalHolidays, setGlobalHolidays] = useState(new Set());
  const [showHolidayModal, setShowHolidayModal] = useState(false);

  // ── New Cleanup State ──────────────────────────────────────────────────────
  const [dtrSource, setDtrSource] = useState(null); // 'live' | 'ai'
  const [liveDTRs, setLiveDTRs] = useState([]);
  const [bonusDays, setBonusDays] = useState(new Set());
  const [absentDays, setAbsentDays] = useState(new Set());
  const [showBonusModal, setShowBonusModal] = useState(false);
  const [dutyMode, setDutyMode] = useState('bonus');
  const [cleanupEmpIdx, setCleanupEmpIdx] = useState(0);

  // ── Endpoint & Carryover State ────────────────────────────────────────────
  const [prevEndpoint, setPrevEndpoint] = useState(null); // { endpoint_date, month, year, cutoff } | null
  const [carryoverAbsences, setCarryoverAbsences] = useState({}); // { [empId]: { count, dates: ['YYYY-MM-DD'] } }
  const [carryoverDeductionDays, setCarryoverDeductionDays] = useState({}); // { [empId]: [day, ...] }
  const [showEndpointModal, setShowEndpointModal] = useState(false); // endpoint date picker
  const [showConfirmFinishModal, setShowConfirmFinishModal] = useState(false); // finish confirm modal
  const [endpointDate, setEndpointDate] = useState(() => new Date().toISOString().slice(0, 10));
  // Tracks whether the secretary explicitly opened "Set Endpoint" and picked a date this session.
  // If false, Finish always saves today (the actual generation date), not the stale pre-filled reference.
  const [endpointManuallySet, setEndpointManuallySet] = useState(false);
  const [savingEndpoint, setSavingEndpoint] = useState(false);
  const [showEditEndpointModal, setShowEditEndpointModal] = useState(false); // edit prev endpoint
  const [editEndpointDate, setEditEndpointDate] = useState('');
  const [expandedCarryoverEmp, setExpandedCarryoverEmp] = useState(null); // empId of expanded details dropdown
  const [showDeductionPickerEmp, setShowDeductionPickerEmp] = useState(null); // empId of open override picker
  const [tempDeductDays, setTempDeductDays] = useState(null);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [alertModal, setAlertModal] = useState({ open: false, title: '', message: '' });
  const [confirmActionModal, setConfirmActionModal] = useState({ open: false, title: '', message: '', onConfirm: null });

  const GRACE_MINUTES = 15;
  const AM_START = { hour: 8, minute: 0 };
  const PM_START = { hour: 13, minute: 0 };
  const OVERTIME_THRESHOLD_MINUTES = 30;
  const RANDOM_BUFFER_MIN = 1;
  const RANDOM_BUFFER_MAX = 5;

  // Only active employees should be selectable for DTR generation
  const activeEmployees = allEmployees
    .filter(e => e.is_active !== false)
    .sort((a, b) => a.name.localeCompare(b.name));

  const filteredEmployees = activeEmployees.filter(emp => {
    if (filterDuty !== 'ALL' && emp.duty !== filterDuty) return false;
    if (searchTerm && !emp.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  // ── Step 1 helpers ────────────────────────────────────────────────────────

  function chooseModeAll() {
    setPickMode('all');
    setSelectedIds(new Set(activeEmployees.map(e => e.id)));
  }

  function chooseModeManual() {
    setPickMode('manual');
    setSelectedIds(new Set());
  }

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function selectAll() { setSelectedIds(new Set([...selectedIds, ...filteredEmployees.map(e => e.id)])); }
  function deselectAll() {
    const next = new Set(selectedIds);
    filteredEmployees.forEach(e => next.delete(e.id));
    setSelectedIds(next);
  }

  function proceedFromStep1() {
    const chosen = allEmployees.filter(e => selectedIds.has(e.id));
    setEmployees(chosen);
    setStep(2);
  }

  // ── Step 2 → 3 ───────────────────────────────────────────────────────────

  function proceedToStep3() {
    setDtrSource('ai');
    const dates = getDatesInCutoff(config.year, config.month, config.cutoff);
    const ws = getWeeks(dates);
    setWeeks(ws);
    setWeekHours(ws.map(() => 8));
    const att = {};
    employees.forEach((e, ei) => {
      att[ei] = {};
      dates.forEach(d => {
        const day = d.getDate();
        if (isWeekend(d)) {
          att[ei][day] = 'weekend';
        } else if (globalHolidays.has(day)) {
          att[ei][day] = 'holiday';
        } else {
          att[ei][day] = 'present';
        }
      });
    });
    setAttendance(att);
    setEmpIdx(0);
    setStep(3);
  }

  // ── Step 3 → 4 ───────────────────────────────────────────────────────────

  function proceedToStep4() { setStep(4); }

  // ── Prev-cutoff helper ────────────────────────────────────────────────────
  // Returns { month, year, cutoff } for the cutoff immediately before config.
  function getPrevCutoff() {
    const { month, year, cutoff } = config;
    if (cutoff === 16) return { month, year, cutoff: 1 };
    // cutoff === 1 → go to previous month's second half
    if (month === 1) return { month: 12, year: year - 1, cutoff: 16 };
    return { month: month - 1, year, cutoff: 16 };
  }

  // ── Day-status helper (shared between main window and gap check) ──────────
  // Returns 'present' | 'absent' for a non-weekend, non-holiday day.
  function computeDayStatus(dayRecords) {
    return dayRecords.length > 0 ? 'present' : 'absent';
  }

  // ── Last day of a cutoff ──────────────────────────────────────────────────
  function lastDayOfCutoff(year, month, cutoff) {
    if (cutoff === 1) return 15;
    return daysInMonth(year, month);
  }

  // ── Toggle attendance ─────────────────────────────────────────────────────

  function toggleDay(ei, day) {
    setAttendance(prev => {
      const copy = { ...prev, [ei]: { ...prev[ei] } };
      copy[ei][day] = copy[ei][day] === 'present' ? 'absent' : 'present';
      return copy;
    });
  }

  // ── Finish ────────────────────────────────────────────────────────────────

  async function finish() {
    setSaving(true);
    const { month, year, cutoff } = config;
    const dates = getDatesInCutoff(year, month, cutoff);
    const start = cutoff === 1 ? 1 : 16;
    const endDay = cutoff === 1 ? 15 : daysInMonth(year, month);

    const empDTRs = employees.map((emp, ei) => {
      const rows = [];
      for (let day = start; day <= endDay; day++) {
        const date = new Date(year, month - 1, day);
        const wknd = isWeekend(date);
        const status = attendance[ei]?.[day] || (wknd ? 'weekend' : 'present');
        const wkIdx = getWeekIndex(date, weeks);
        const wkHrs = weekHours[wkIdx] || 0;
        const wd = workdaysInWeek(weeks[wkIdx]);
        const seed = ei * 97 + day * 37 + month * 13;
        const hoursForThisDay = wkHrs > 0 ? wkHrs + (seed % 31) / 60 : 0;

        let times = { arrival: '', departure: '', pmArrival: '', pmDeparture: '' };
        if (wknd) {
          const label = isSaturday(date) ? 'SAT' : 'SUN';
          times = { arrival: label, departure: label, pmArrival: '', pmDeparture: '' };
        } else if (status === 'holiday') {
          times = { arrival: '', departure: '', pmArrival: '', pmDeparture: '' };
        } else if (status === 'present' && wkHrs > 0) {
          times = generateTime(emp.duty, hoursForThisDay, seed);
        }
        rows.push({ day, dow: date.getDay(), status, ...times });
      }
      return { emp, rows };
    });

    const label = cutoffLabel(month, year, cutoff);
    const batchPayload = { label, month, year, cutoff, employees: empDTRs };

    if (isOnline) {
      try {
        await createServerBatch(batchPayload);
        const list = await fetchBatches();
        await seedBatches(list);
      } catch {
        await saveBatch(batchPayload);
      }
    } else {
      await saveBatch(batchPayload);
    }

    setSaving(false);
    onDone();
  }

  // ── Fetch Live Data (Replaces old finishLive) ────────────────────────────
  async function fetchLiveData() {
    setSaving(true);
    const { month, year, cutoff } = config;
    const dates = getDatesInCutoff(config.year, config.month, config.cutoff);
    const ws = getWeeks(dates);
    setWeeks(ws);
    setWeekHours(ws.map(() => 8));

    const start = cutoff === 1 ? 1 : 16;
    const endDay = cutoff === 1 ? 15 : daysInMonth(year, month);

    const PH_TZ = 'Asia/Manila';
    const toPHTDateParts = (isoString) => {
      const parts = new Intl.DateTimeFormat('en-PH', {
        timeZone: PH_TZ, year: 'numeric', month: 'numeric', day: 'numeric',
      }).formatToParts(new Date(isoString));
      const get = (type) => parseInt(parts.find(p => p.type === type)?.value || '0', 10);
      return { y: get('year'), mo: get('month'), d: get('day') };
    };
    const formatTime = (isoString) => {
      if (!isoString) return '';
      const parts = new Intl.DateTimeFormat('en-PH', {
        timeZone: PH_TZ, hour: 'numeric', minute: '2-digit', hour12: false,
      }).formatToParts(new Date(isoString));
      let h = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
      const m = parts.find(p => p.type === 'minute')?.value || '00';
      if (h === 0) h = 12;
      else if (h > 12) h -= 12;
      return `${h}:${m}`;
    };

    try {
      // ── Change A: pre-fill the Endpoint Date button for this period ───────
      // If a saved endpoint already exists for this exact period (e.g., the
      // secretary is regenerating the same period), restore the stored date
      // so the button shows the previously-used value instead of resetting to today.
      // A 404 is expected the first time any period is generated — it must fail
      // silently in its own try/catch, not inside the carryover block below.
      if (isOnline) {
        try {
          const existingEp = await fetchDTREndpoint({ month, year, cutoff });
          if (existingEp?.endpoint_date) {
            setEndpointDate(existingEp.endpoint_date);
          } else {
            setEndpointDate(new Date().toISOString().slice(0, 10));
          }
        } catch {
          // 404 = first time generating this period; default to today.
          setEndpointDate(new Date().toISOString().slice(0, 10));
        }
        setEndpointManuallySet(false);
      }

      const empDTRs = await Promise.all(employees.map(async (emp) => {
        const records = isOnline ? await fetchEmployeeAttendance(emp.id, { month, year, cutoff: cutoff }) : [];

        const rows = [];
        for (let day = start; day <= endDay; day++) {
          const date = new Date(year, month - 1, day);
          const wknd = isWeekend(date);
          const hol = globalHolidays.has(day);

          if (wknd) {
            const label = isSaturday(date) ? 'SAT' : 'SUN';
            rows.push({ day, dow: date.getDay(), status: 'weekend', arrival: label, departure: label, pmArrival: '', pmDeparture: '' });
            continue;
          }
          if (hol) {
            rows.push({ day, dow: date.getDay(), status: 'holiday', arrival: '', departure: '', pmArrival: '', pmDeparture: '' });
            continue;
          }

          const dayRecords = records.filter(r => {
            const { y, mo, d } = toPHTDateParts(r.timestamp);
            return d === day && mo === month && y === year;
          });

          if (computeDayStatus(dayRecords) === 'absent') {
            rows.push({ day, dow: date.getDay(), status: 'absent', arrival: '', departure: '', pmArrival: '', pmDeparture: '' });
            continue;
          }

          const amIn = dayRecords.find(r => r.scan_type === 'AM_ARRIVAL');
          const amOut = dayRecords.find(r => r.scan_type === 'AM_DEPARTURE');
          const pmIn = dayRecords.find(r => r.scan_type === 'PM_ARRIVAL');
          const pmOut = dayRecords.find(r => r.scan_type === 'PM_DEPARTURE');

          const rawArrival = formatTime(amIn?.timestamp);
          const rawDeparture = formatTime(amOut?.timestamp);
          const rawPmArrival = formatTime(pmIn?.timestamp);
          const rawPmDeparture = formatTime(pmOut?.timestamp);

          let dutyMismatch = false;
          if (emp.duty === 'AM' && (pmIn || pmOut)) dutyMismatch = true;
          if (emp.duty === 'PM' && (amIn || amOut)) dutyMismatch = true;

          rows.push({
            day, dow: date.getDay(), status: 'present',
            arrival: rawArrival, departure: rawDeparture,
            pmArrival: rawPmArrival, pmDeparture: rawPmDeparture,
            rawArrival, rawDeparture, rawPmArrival, rawPmDeparture,
            dutyMismatch,
          });
        }
        return { emp, rows };
      }));

      const totalRecords = empDTRs.reduce((sum, e) => sum + e.rows.filter(r => r.arrival || r.departure || r.pmArrival || r.pmDeparture).length, 0);
      if (totalRecords === 0) {
        alert('Warning: No attendance logs found for the selected employees in this period. The generated DTRs will be mostly empty.');
      }

      // ── Carryover: look up previous period's endpoint ────────────────────
      let computedPrevEndpoint = null;
      let newCarryoverAbsences = {};
      let newCarryoverDeductionDays = {};

      if (isOnline) {
        try {
          const prev = getPrevCutoff();
          const ep = await fetchDTREndpoint(prev);

          if (ep && ep.endpoint_date) {
            computedPrevEndpoint = ep;
            const epDate = new Date(ep.endpoint_date);
            const prevEnd = lastDayOfCutoff(prev.year, prev.month, prev.cutoff);
            // Build gap date range strings
            const gapDates = [];
            for (let d = new Date(epDate); ; d.setDate(d.getDate() + 1)) {
              const dayNum = d.getDate();
              const mo = d.getMonth() + 1;
              const yr = d.getFullYear();
              if (yr !== prev.year || mo !== prev.month || dayNum > prevEnd) break;
              if (!isWeekend(d)) gapDates.push(d.toISOString().slice(0, 10));
            }

            if (gapDates.length > 0) {
              // ── Change C: use server-stored holidays from the endpoint response ───
              // Previously read from the local IndexedDB batch (getAllBatches()),
              // which was unreliable if the cache was cleared or a different
              // browser/device generated the next DTR. ep.holidays is now stored
              // server-side alongside the endpoint date and returned by the GET API.
              const prevHolidayDays = new Set(ep.holidays || []);

              // ── Change D: wasInPrevBatch check removed ───────────────────────────
              // The old check skipped employees not found in the local IndexedDB
              // batch. Now that getAllBatches() is gone, prevBatch is never defined,
              // so that check would silently evaluate to false for everyone and
              // disable carryover entirely. The employment-window guards below
              // (emp.start / emp.end_date vs the endpoint date) already cover the
              // "employee didn't exist during the gap" case using server-backed data.

              // Fetch gap attendance for each employee
              await Promise.all(empDTRs.map(async ({ emp }) => {
                // Skip if employee was inactive during the gap
                if (emp.start && new Date(ep.endpoint_date) < new Date(emp.start)) return;
                if (emp.end_date && new Date(ep.endpoint_date) > new Date(emp.end_date)) return;

                let gapRecords = [];
                try {
                  gapRecords = await fetchEmployeeAttendanceRange(emp.id, {
                    date_from: gapDates[0],
                    date_to: gapDates[gapDates.length - 1],
                  });
                } catch { return; }

                const absentDates = [];
                for (const dateStr of gapDates) {
                  const d = new Date(dateStr);
                  const dayNum = d.getDate();
                  if (prevHolidayDays.has(dayNum)) continue; // holiday in prev batch
                  const dayRecs = gapRecords.filter(r => {
                    const { y, mo, dl } = (() => {
                      const parts = new Intl.DateTimeFormat('en-PH', {
                        timeZone: PH_TZ, year: 'numeric', month: 'numeric', day: 'numeric',
                      }).formatToParts(new Date(r.timestamp));
                      const get = (type) => parseInt(parts.find(p => p.type === type)?.value || '0', 10);
                      return { y: get('year'), mo: get('month'), dl: get('day') };
                    })();
                    return dl === dayNum && mo === (d.getMonth() + 1) && y === d.getFullYear();
                  });
                  if (computeDayStatus(dayRecs) === 'absent') absentDates.push(dateStr);
                }

                if (absentDates.length > 0) {
                  newCarryoverAbsences[emp.id] = { count: absentDates.length, dates: absentDates };

                  // Auto-select the first N present days in the current cutoff for deduction
                  const currentEmpDTR = empDTRs.find(e => e.emp.id === emp.id);
                  if (currentEmpDTR) {
                    const deductDays = [];
                    for (const row of currentEmpDTR.rows) {
                      if (deductDays.length >= absentDates.length) break;
                      if (row.status === 'present' && !row.carryover) deductDays.push(row.day);
                    }
                    newCarryoverDeductionDays[emp.id] = deductDays;
                    // Apply deductions to empDTRs in-memory
                    deductDays.forEach(day => {
                      const rowIdx = currentEmpDTR.rows.findIndex(r => r.day === day);
                      if (rowIdx !== -1) {
                        currentEmpDTR.rows[rowIdx] = {
                          ...currentEmpDTR.rows[rowIdx],
                          status: 'absent', arrival: '', departure: '', pmArrival: '', pmDeparture: '',
                          carryover: true,
                        };
                      }
                    });
                  }
                }
              }));
            }
          }
        } catch (epErr) {
          // Endpoint lookup failure is non-fatal — silently skip carryover
          console.warn('Could not load previous period endpoint:', epErr);
        }
      }

      setPrevEndpoint(computedPrevEndpoint);
      setCarryoverAbsences(newCarryoverAbsences);
      setCarryoverDeductionDays(newCarryoverDeductionDays);
      setDtrSource('live');
      setLiveDTRs(empDTRs);
      setCleanupEmpIdx(0);
      setStep(3); // Go to Weekly Hours first
    } catch (err) {
      console.error(err);
      const msg = err.message || '';
      if (msg.includes('401') || msg.includes('Unauthorized')) {
        alert('Authentication failed (401 Unauthorized). Your session may have expired. Please sign out and sign back in.');
      } else if (msg.includes('Failed to fetch') || msg.includes('Network')) {
        alert('Network error. Please check your internet connection or ensure the server is running.');
      } else {
        alert(`Failed to fetch from Live Attendance logs: ${msg}`);
      }
    } finally {
      // Always clear the saving flag — button must never stay permanently disabled.
      setSaving(false);
    }
  }

  // ── Finish Saved (Live Data) — called after endpoint is confirmed ────────
  // holidayDays: array of day-number integers that were holidays in this cutoff.
  // Stored server-side alongside the endpoint so the next generation can
  // exclude them reliably from the carryover gap check.
  async function doFinishLiveSaved(chosenEndpointDate, holidayDays = []) {
    setSaving(true);
    const { month, year, cutoff } = config;

    const finalDTRs = liveDTRs.map((dtr) => {
      const newRows = dtr.rows.map(row => {
        if (absentDays.has(row.day) && row.status !== 'weekend' && row.status !== 'holiday' && !row.carryover) {
          return { ...row, status: 'absent', arrival: '', departure: '', pmArrival: '', pmDeparture: '' };
        }
        if (bonusDays.has(row.day) && !row.arrival && !row.departure && !row.pmArrival && !row.pmDeparture && row.status !== 'weekend' && row.status !== 'holiday' && !row.carryover) {
          const date = new Date(year, month - 1, row.day);
          const wkIdx = getWeekIndex(date, weeks);
          const wkHrs = weekHours[wkIdx] || 0;
          const seed = dtr.emp.id * 97 + row.day * 37 + month * 13;
          const hoursForThisDay = wkHrs > 0 ? wkHrs + (seed % 31) / 60 : 0;
          if (hoursForThisDay > 0) {
            const times = generateTime(dtr.emp.duty, hoursForThisDay, seed);
            return { ...row, ...times, status: 'present' };
          }
        }
        return row;
      });
      return { emp: dtr.emp, rows: newRows };
    });

    const label = cutoffLabel(month, year, cutoff) + ' (Live)';
    const batchPayload = { label, month, year, cutoff, employees: finalDTRs };

    if (isOnline) {
      // ── 1. Save the DTR batch to the server ─────────────────────────────────
      // Completely independent from the endpoint save — a failure here falls
      // back to the local IndexedDB store; endpoint is then handled separately.
      try {
        await createServerBatch(batchPayload);
        const list = await fetchBatches();
        await seedBatches(list);
      } catch (err) {
        console.error('Failed to save batch to server, falling back to local:', err);
        await saveBatch(batchPayload);
      }

      // ── 2. Save the endpoint + holidays (if requested) ──────────────────────
      // Kept separate so a permission/validation/network error here doesn't:
      //   (a) swallow silently into the batch catch block, or
      //   (b) trigger a duplicate local batch save.
      if (chosenEndpointDate) {
        try {
          await setDTREndpoint({ month, year, cutoff, endpoint_date: chosenEndpointDate, holidays: holidayDays });
        } catch (err) {
          console.error('Failed to save endpoint:', err);
          alert('DTR saved, but the endpoint date could not be saved. Please try setting it again from the Endpoint button on the cleanup screen.');
        }
      }
    } else {
      await saveBatch(batchPayload);
    }

    setSaving(false);
    onDone();
  }

  // ── Intercept finish to show confirmation modal ─────────────────────────
  function finishLiveSaved() {
    setShowConfirmFinishModal(true);
  }

  // ── Guards ────────────────────────────────────────────────────────────────

  const emp = employees[empIdx];
  const dates = weeks.flat();

  if (!allEmployees.length) return (
    <div className="card">
      <div className="alert alert-warning" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <AlertTriangle size={16} /> No employees found. Please add employees first before generating DTRs.
      </div>
    </div>
  );

  // ── Step labels ───────────────────────────────────────────────────────────

  const stepLabels = ['1. Select Employees', '2. Period', '3. Weekly Hours', '4. Attendance'];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      <div className="wizard-steps">
        {stepLabels.map((s, i) => (
          <div
            key={i}
            className={`wizard-step ${step === i + 1 ? 'active' : step > i + 1 ? 'done' : ''}`}
          >
            {s}
          </div>
        ))}
      </div>

      {/* ═══ STEP 1 — Choose employees ══════════════════════════════════════ */}
      {step === 1 && (
        <div className="card">
          <div className="card-title">Step 1: Who are you making DTRs for?</div>

          {/* Mode picker — shown until a mode is chosen */}
          {!pickMode && (
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
              <button
                className="btn btn-primary"
                style={{ flex: 1, minWidth: 160, padding: '20px 16px', fontSize: '1rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
                onClick={chooseModeAll}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Users size={18} /> All Employees</div>
                <div style={{ fontSize: '0.75rem', fontWeight: 400, marginTop: 4, opacity: 0.85 }}>
                  Generate DTR for everyone ({activeEmployees.length})
                </div>
              </button>
              <button
                className="btn btn-outline"
                style={{ flex: 1, minWidth: 160, padding: '20px 16px', fontSize: '1rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
                onClick={chooseModeManual}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><CheckCircle2 size={18} /> Choose Manually</div>
                <div style={{ fontSize: '0.75rem', fontWeight: 400, marginTop: 4, opacity: 0.85 }}>
                  Pick specific employees
                </div>
              </button>
            </div>
          )}

          {/* All mode — show confirmation */}
          {pickMode === 'all' && (
            <>
              <div className="alert alert-success" style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <CheckCircle2 size={16} /> All <strong>{activeEmployees.length}</strong> active employee(s) selected.
              </div>
              <div className="emp-list" style={{ maxHeight: 320, overflowY: 'auto' }}>
                {activeEmployees.map(emp => (
                  <div className="emp-item" key={emp.id} style={{ opacity: 0.85 }}>
                    <div className="emp-avatar">{emp.name.split(' ').map(w => w[0]).join('').slice(0, 2)}</div>
                    <div style={{ flex: 1 }}>
                      <div className="emp-name">{emp.name}</div>
                      <span className={`badge badge-${emp.duty.toLowerCase()}`}>{emp.duty} Duty</span>
                    </div>
                    <span style={{ fontSize: 18, color: 'var(--color-success, #22c55e)' }}><Check size={18} /></span>
                  </div>
                ))}
              </div>
              <div className="btn-row" style={{ marginTop: 16 }}>
                <button className="btn btn-secondary" onClick={() => { setPickMode(null); setSelectedIds(new Set()); }}>← Change</button>
                <button className="btn btn-primary" onClick={proceedFromStep1}>
                  Next: Set Period →
                </button>
              </div>
            </>
          )}

          {/* Manual mode — multi-select list */}
          {pickMode === 'manual' && (
            <>
              <div style={{ display: 'flex', gap: 12, margin: '12px 0 8px' }}>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Search by name..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  style={{ flex: 1, padding: '8px 12px', fontSize: '0.9rem' }}
                />
                <select
                  className="form-select"
                  value={filterDuty}
                  onChange={e => setFilterDuty(e.target.value)}
                  style={{ width: 140, padding: '8px 12px', fontSize: '0.9rem' }}
                >
                  <option value="ALL">All Duties</option>
                  <option value="AM">AM Duty</option>
                  <option value="PM">PM Duty</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: '0.85rem', color: '#555' }}>
                  {selectedIds.size} / {activeEmployees.length} selected
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-sm btn-outline" onClick={selectAll}>Select All Shown</button>
                  <button className="btn btn-sm btn-outline" onClick={deselectAll}>Deselect Shown</button>
                </div>
              </div>

              <div
                className="emp-list"
                style={{ maxHeight: 380, overflowY: 'auto', gap: 6 }}
              >
                {filteredEmployees.map(emp => {
                  const active = selectedIds.has(emp.id);
                  return (
                    <div
                      key={emp.id}
                      className="emp-item"
                      onClick={() => toggleSelect(emp.id)}
                      style={{
                        cursor: 'pointer',
                        border: `2px solid ${active ? 'var(--color-success, #22c55e)' : 'transparent'}`,
                        background: active ? 'var(--color-success-bg, #f0fdf4)' : undefined,
                        borderRadius: 8,
                        transition: 'border-color 0.15s, background 0.15s',
                        userSelect: 'none',
                      }}
                    >
                      {/* Checkbox visual */}
                      <div style={{
                        width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                        border: `2px solid ${active ? 'var(--color-success, #22c55e)' : '#ccc'}`,
                        background: active ? 'var(--color-success, #22c55e)' : '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff',
                        transition: 'all 0.15s',
                      }}>
                        {active ? <Check size={14} strokeWidth={3} /> : ''}
                      </div>

                      <div className="emp-avatar" style={{ margin: '0 4px' }}>
                        {emp.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div className="emp-name">{emp.name}</div>
                        <span className={`badge badge-${emp.duty.toLowerCase()}`}>{emp.duty} Duty</span>
                        {emp.start && <span style={{ marginLeft: 8, fontSize: '0.75rem', color: '#666' }}>Since {emp.start}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="btn-row" style={{ marginTop: 16 }}>
                <button className="btn btn-secondary" onClick={() => { setPickMode(null); setSelectedIds(new Set()); }}>← Change</button>
                <button
                  className="btn btn-primary"
                  onClick={proceedFromStep1}
                  disabled={selectedIds.size === 0}
                >
                  Next: Set Period → {selectedIds.size > 0 && `(${selectedIds.size} selected)`}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══ STEP 2 — Period ════════════════════════════════════════════════ */}
      {step === 2 && (
        <div className="card">
          <div className="card-title">Step 2: Select Period</div>
          <div className="form-grid-3">
            <div className="form-group">
              <label className="form-label">Month</label>
              <select className="form-select" value={config.month}
                onChange={e => { setConfig(c => ({ ...c, month: +e.target.value })); setGlobalHolidays(new Set()); }}>
                {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Year</label>
              <input type="number" className="form-input" value={config.year} min={2020} max={2030}
                onChange={e => { setConfig(c => ({ ...c, year: +e.target.value })); setGlobalHolidays(new Set()); }} />
            </div>
            <div className="form-group">
              <label className="form-label">Cutoff</label>
              <select className="form-select" value={config.cutoff}
                onChange={e => { setConfig(c => ({ ...c, cutoff: +e.target.value })); setGlobalHolidays(new Set()); }}>
                <option value={1}>1 – 15</option>
                <option value={16}>16 – 31</option>
              </select>
            </div>
          </div>
          <div className="alert alert-info" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div>
              Period: <strong>{cutoffLabel(config.month, config.year, config.cutoff)}</strong>
              &nbsp;·&nbsp; {employees.length} employee(s) selected
            </div>
            <button className="btn btn-sm btn-outline" style={{ background: '#fff' }} onClick={() => setShowHolidayModal(true)}>
              🗓 Set Holidays
            </button>
          </div>
          <div className="btn-row" style={{ marginTop: 24, justifyContent: 'space-between' }}>
            <button className="btn btn-secondary" onClick={() => setStep(1)} disabled={saving}>← Back</button>
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                className="btn btn-primary"
                style={{ background: '#3b82f6', border: 'none', display: 'flex', alignItems: 'center', gap: 6 }}
                onClick={fetchLiveData}
                disabled={saving || !isOnline}
                title={!isOnline ? "Live Attendance requires an internet connection" : ""}
              >
                {saving ? <Loader2 size={16} className="spin" /> : <Calendar size={16} />}
                {saving ? 'Fetching...' : 'From Attendance Logs'}
              </button>
              <button className="btn btn-primary" onClick={proceedToStep3} disabled={saving}>
                Next: AI Simulated →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ STEP 3 — Weekly Hours ══════════════════════════════════════════ */}
      {step === 3 && (
        <div className="card">
          <div className="card-title">Step 3: Daily Target Hours</div>
          <div className="alert alert-info">
            Weeks are grouped <strong>Monday → Sunday</strong>. Set the daily target working hours for each week.
          </div>
          {weeks.map((w, i) => {
            const wStart = w[0].getDate();
            const wEnd = w[w.length - 1].getDate();
            const wd = workdaysInWeek(w);
            return (
              <div className="week-row" key={i}>
                <label>Week {i + 1}</label>
                <span className="week-dates">Days {wStart}–{wEnd} &nbsp;({wd} workday{wd !== 1 ? 's' : ''})</span>
                <input type="number" className="form-input" value={weekHours[i]} min={0} max={24}
                  style={{ width: 72 }}
                  onChange={e => setWeekHours(h => { const n = [...h]; n[i] = +e.target.value; return n; })} />
                <span style={{ fontSize: 12, color: '#555' }}>hrs/day</span>
              </div>
            );
          })}
          <div className="btn-row">
            <button className="btn btn-secondary" onClick={() => setStep(2)}>← Back</button>
            <button className="btn btn-primary" onClick={() => dtrSource === 'live' ? setStep(3.1) : setStep(4)}>
              Next: {dtrSource === 'live' ? 'Clean up →' : 'Enter Attendance →'}
            </button>
          </div>
        </div>
      )}

      {/* ═══ STEP 3.1 — Cleanup (Live Data Only) ════════════════════════════ */}
      {step === 3.1 && liveDTRs[cleanupEmpIdx] && (
        <div className="card">
          <div className="card-title">Step 3.1: Clean up Attendance</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
            <span><strong>{liveDTRs[cleanupEmpIdx].emp.name}</strong></span>
            <span>{cleanupEmpIdx + 1} / {liveDTRs.length}</span>
          </div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${((cleanupEmpIdx) / liveDTRs.length) * 100}%` }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '10px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="emp-avatar" style={{ width: 32, height: 32, fontSize: 11 }}>
                {liveDTRs[cleanupEmpIdx].emp.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
              </div>
              <div>
                <strong>{liveDTRs[cleanupEmpIdx].emp.name}</strong>
                <span className={`badge badge-${liveDTRs[cleanupEmpIdx].emp.duty.toLowerCase()}`} style={{ marginLeft: 8 }}>{liveDTRs[cleanupEmpIdx].emp.duty} Duty</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(() => {
                const hasAnyAnomaly = liveDTRs[cleanupEmpIdx].rows.some(row => {
                  if (row.status === 'weekend' || row.status === 'holiday' || row.carryover) return false;
                  const isBonus = bonusDays.has(row.day) && !row.arrival && !row.departure && !row.pmArrival && !row.pmDeparture;
                  if (isBonus) return false;

                  const emp = liveDTRs[cleanupEmpIdx].emp;
                  const date = new Date(config.year, config.month - 1, row.day);
                  const wkIdx = getWeekIndex(date, weeks);
                  const dailyTarget = (weekHours[wkIdx] || 0) * 60;

                  const parseHM = (timeStr, isPM) => {
                    if (!timeStr) return null;
                    let [h, m] = timeStr.split(':').map(Number);
                    if (isPM && h >= 1 && h <= 11) h += 12;
                    if (!isPM && h === 12) h = 0;
                    return { h, m, total: h * 60 + m };
                  };
                  const rawAmIn = parseHM(row.arrival, false), rawAmOut = parseHM(row.departure, false);
                  const rawPmIn = parseHM(row.pmArrival, true), rawPmOut = parseHM(row.pmDeparture, true);

                  const isWrongShift = row.dutyMismatch ||
                    (emp.duty === 'AM' && (rawPmIn || rawPmOut)) ||
                    (emp.duty === 'PM' && (rawAmIn || rawAmOut));

                  let isLate = false, isUndertime = false, isOvertime = false, duration = 0;
                  if (!isWrongShift) {
                    if (emp.duty === 'AM') {
                      if (rawAmIn) isLate = rawAmIn.total > (AM_START.hour * 60 + AM_START.minute + GRACE_MINUTES);
                      if (rawAmIn && rawAmOut) duration = rawAmOut.total - rawAmIn.total;
                    } else {
                      if (rawPmIn) isLate = rawPmIn.total > (PM_START.hour * 60 + PM_START.minute + GRACE_MINUTES);
                      if (rawPmIn && rawPmOut) duration = rawPmOut.total - rawPmIn.total;
                    }
                  } else {
                    if (emp.duty === 'AM' && rawPmIn && rawPmOut) duration = rawPmOut.total - rawPmIn.total;
                    if (emp.duty === 'PM' && rawAmIn && rawAmOut) duration = rawAmOut.total - rawAmIn.total;
                  }

                  const hasLogs = rawAmIn || rawAmOut || rawPmIn || rawPmOut;
                  if (hasLogs && dailyTarget > 0) {
                    if (duration < dailyTarget - 2) isUndertime = true;
                    if (duration > dailyTarget + OVERTIME_THRESHOLD_MINUTES) isOvertime = true;
                  }
                  return isWrongShift || isLate || isUndertime || isOvertime;
                });
                return (
                  <button
                    className="btn btn-sm btn-primary"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
                      opacity: hasAnyAnomaly ? 1 : 0.5,
                      cursor: hasAnyAnomaly ? 'pointer' : 'not-allowed'
                    }}
                    disabled={!hasAnyAnomaly}
                    onClick={() => {
                      const newDTRs = [...liveDTRs];
                      liveDTRs[cleanupEmpIdx].rows.forEach((row, rIdx) => {
                        if (row.status === 'weekend' || row.status === 'holiday' || row.carryover) return;
                        // Skip bonus day preview rows — they're already filled, not anomalous
                        const isBonus = bonusDays.has(row.day) && !row.arrival && !row.departure && !row.pmArrival && !row.pmDeparture;
                        if (isBonus) return;

                        const emp = newDTRs[cleanupEmpIdx].emp;
                        const date = new Date(config.year, config.month - 1, row.day);
                        const wkIdx = getWeekIndex(date, weeks);
                        const wkHrs = weekHours[wkIdx] || 0;
                        const dailyTarget = wkHrs * 60;

                        const parseHM = (timeStr, isPM) => {
                          if (!timeStr) return null;
                          let [h, m] = timeStr.split(':').map(Number);
                          if (isPM && h >= 1 && h <= 11) h += 12;
                          if (!isPM && h === 12) h = 0;
                          return { h, m, total: h * 60 + m };
                        };
                        let amIn = parseHM(row.arrival, false), amOut = parseHM(row.departure, false);
                        let pmIn = parseHM(row.pmArrival, true), pmOut = parseHM(row.pmDeparture, true);

                        const isWrongShift = row.dutyMismatch ||
                          (emp.duty === 'AM' && (pmIn || pmOut)) ||
                          (emp.duty === 'PM' && (amIn || amOut));

                        let isLate = false, isUndertime = false, isOvertime = false, duration = 0;
                        if (!isWrongShift) {
                          if (emp.duty === 'AM') {
                            if (amIn) isLate = amIn.total > (AM_START.hour * 60 + AM_START.minute + GRACE_MINUTES);
                            if (amIn && amOut) duration = amOut.total - amIn.total;
                          } else {
                            if (pmIn) isLate = pmIn.total > (PM_START.hour * 60 + PM_START.minute + GRACE_MINUTES);
                            if (pmIn && pmOut) duration = pmOut.total - pmIn.total;
                          }
                        } else {
                          if (emp.duty === 'AM' && pmIn && pmOut) duration = pmOut.total - pmIn.total;
                          if (emp.duty === 'PM' && amIn && amOut) duration = amOut.total - amIn.total;
                        }
                        const hasLogs = amIn || amOut || pmIn || pmOut;
                        if (hasLogs && dailyTarget > 0) {
                          if (duration < dailyTarget - 2) isUndertime = true;
                          if (duration > dailyTarget + OVERTIME_THRESHOLD_MINUTES) isOvertime = true;
                        }

                        if (isWrongShift || isLate || isUndertime || isOvertime) {
                          const fmt = (tot) => {
                            if (tot == null) return '';
                            let h = Math.floor(tot / 60), m = Math.floor(tot % 60);
                            if (h === 0) h = 12; if (h > 12) h -= 12;
                            return `${h}:${m.toString().padStart(2, '0')}`;
                          };
                          const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

                          if (isLate && !isWrongShift) {
                            const targetStart = emp.duty === 'AM' ? (AM_START.hour * 60 + AM_START.minute) : (PM_START.hour * 60 + PM_START.minute);
                            const newArr = targetStart + rand(0, GRACE_MINUTES);
                            if (emp.duty === 'AM') amIn = { total: newArr }; else pmIn = { total: newArr };
                          }

                          let curDuration = 0;
                          if (emp.duty === 'AM' && !isWrongShift && amIn && amOut) curDuration = amOut.total - amIn.total;
                          else if (emp.duty === 'PM' && !isWrongShift && pmIn && pmOut) curDuration = pmOut.total - pmIn.total;
                          else if (isWrongShift && emp.duty === 'AM' && pmIn && pmOut) curDuration = pmOut.total - pmIn.total;
                          else if (isWrongShift && emp.duty === 'PM' && amIn && amOut) curDuration = amOut.total - amIn.total;

                          if (isUndertime || isOvertime) {
                            if (isUndertime) {
                              const add = (dailyTarget - curDuration) + rand(RANDOM_BUFFER_MIN, RANDOM_BUFFER_MAX);
                              if (emp.duty === 'AM' && !isWrongShift) {
                                if (amOut) amOut.total += add;
                                else amOut = { total: (amIn ? amIn.total : AM_START.hour * 60 + AM_START.minute) + add };
                              } else if (emp.duty === 'PM' && !isWrongShift) {
                                if (pmOut) pmOut.total += add;
                                else pmOut = { total: (pmIn ? pmIn.total : PM_START.hour * 60 + PM_START.minute) + add };
                              }
                              curDuration += add;
                            } else {
                              const sub = (curDuration - dailyTarget) - rand(RANDOM_BUFFER_MIN, RANDOM_BUFFER_MAX);
                              if (emp.duty === 'AM' && !isWrongShift && amOut) amOut.total -= sub;
                              else if (emp.duty === 'PM' && !isWrongShift && pmOut) pmOut.total -= sub;
                              else if (isWrongShift && emp.duty === 'AM' && pmOut) pmOut.total -= sub;
                              else if (isWrongShift && emp.duty === 'PM' && amOut) amOut.total -= sub;
                              curDuration -= sub;
                            }
                          }

                          if (isWrongShift) {
                            if (emp.duty === 'AM') {
                              amIn = { total: AM_START.hour * 60 + AM_START.minute }; amOut = { total: amIn.total + curDuration };
                              pmIn = null; pmOut = null;
                            } else {
                              pmIn = { total: PM_START.hour * 60 + PM_START.minute }; pmOut = { total: pmIn.total + curDuration };
                              amIn = null; amOut = null;
                            }
                          }

                          newDTRs[cleanupEmpIdx].rows[rIdx].arrival = fmt(amIn?.total);
                          newDTRs[cleanupEmpIdx].rows[rIdx].departure = fmt(amOut?.total);
                          newDTRs[cleanupEmpIdx].rows[rIdx].pmArrival = fmt(pmIn?.total);
                          newDTRs[cleanupEmpIdx].rows[rIdx].pmDeparture = fmt(pmOut?.total);
                          newDTRs[cleanupEmpIdx].rows[rIdx].dutyMismatch = false;
                        }
                      });
                      setLiveDTRs(newDTRs);
                    }}>
                    <Zap size={14} fill="currentColor" /> Fix All
                  </button>
                )
              })()}
              <button className="btn btn-sm btn-outline" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: '#fff' }} onClick={() => setShowBonusModal(true)}>
                <Edit size={14} /> Edit Duty
              </button>
              <button className="btn btn-sm btn-outline" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: '#fff' }} onClick={() => setShowEndpointModal(true)}>
                <Calendar size={14} />
                {endpointDate ? `Endpoint: ${new Date(endpointDate).toLocaleDateString()}` : 'Set Endpoint'}
              </button>

            </div>
          </div>

          {/* ── TEMP DEBUG PANEL — remove once carryover testing is done ── */}
          <div style={{ marginBottom: 10 }}>
            <button
              className="btn btn-sm btn-outline"
              style={{ fontSize: 10, padding: '3px 8px' }}
              onClick={() => setShowDebugPanel(v => !v)}
            >
              {showDebugPanel ? 'Hide' : 'Show'} Debug Info
            </button>
            {showDebugPanel && (
              <pre style={{
                marginTop: 6, padding: 10, background: '#0f172a', color: '#e2e8f0',
                fontSize: 11, borderRadius: 6, overflowX: 'auto', maxHeight: 300,
              }}>
                {JSON.stringify({
                  currentPeriod: config,
                  prevCutoffLookedUp: getPrevCutoff(),
                  prevEndpoint,
                  carryoverAbsences,
                  carryoverDeductionDays,
                  currentEmployeeId: liveDTRs[cleanupEmpIdx]?.emp?.id,
                  currentEmployeeIdFormatted: (() => {
                    const emp = liveDTRs[cleanupEmpIdx]?.emp;
                    return emp ? formatUserId(emp.id, emp.duty, emp.date_hired) : null;
                  })(),
                  currentEmployeeName: liveDTRs[cleanupEmpIdx]?.emp?.name,
                }, null, 2)}
              </pre>
            )}
          </div>

          {/* ── Carryover/Endpoint Banner ── */}
          {prevEndpoint && (
            <div style={{
              background: '#fefce8', border: '1px solid #fde047', borderRadius: 8,
              padding: '10px 14px', marginBottom: 10, display: 'flex', alignItems: 'center',
              justifyContent: 'space-between', gap: 8, fontSize: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Flag size={14} style={{ color: '#ca8a04', flexShrink: 0 }} />
                <span>
                  <strong>Last Endpoint:</strong>{' '}
                  {new Date(prevEndpoint.endpoint_date + 'T00:00:00').toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}
                  {' '}<span style={{ color: '#78716c' }}>({prevEndpoint.year}/{String(prevEndpoint.month).padStart(2, '0')} cutoff {prevEndpoint.cutoff})</span>
                </span>
              </div>
              <button
                className="btn btn-sm btn-outline"
                style={{ fontSize: 11, padding: '4px 10px', borderColor: '#ca8a04', color: '#ca8a04' }}
                onClick={() => {
                  setEditEndpointDate(prevEndpoint.endpoint_date);
                  setShowEditEndpointModal(true);
                }}
              >
                Edit
              </button>
            </div>
          )}

          {/* ── Per-employee Carryover Card ── */}
          {(() => {
            const currentEmpData = liveDTRs[cleanupEmpIdx];
            const empId = currentEmpData?.emp?.id;
            const co = empId !== undefined ? carryoverAbsences[empId] : null;
            if (!co || co.count === 0) return null;
            const deductDays = carryoverDeductionDays[empId] || [];
            const isExpanded = expandedCarryoverEmp === empId;
            return (
              <div style={{
                background: '#fefce8', border: '1px solid #fde047', borderRadius: 8,
                padding: '10px 14px', marginBottom: 10, fontSize: 12,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ color: '#92400e', fontWeight: 600 }}>
                    ⚠ This person has been deducted <strong>{co.count} day{co.count !== 1 ? 's' : ''}</strong> because of an absent on the previous cutoff.
                  </span>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button
                      className="btn btn-sm btn-outline"
                      style={{ fontSize: 10, padding: '3px 8px', borderColor: '#b45309', color: '#b45309', display: 'flex', alignItems: 'center', gap: 4 }}
                      onClick={() => setExpandedCarryoverEmp(isExpanded ? null : empId)}
                    >
                      {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />} <Info size={12} /> Details
                    </button>
                    <button
                      className="btn btn-sm btn-outline"
                      style={{ fontSize: 10, padding: '3px 8px', borderColor: '#b45309', color: '#b45309' }}
                      onClick={() => {
                        setShowDeductionPickerEmp(empId);
                        setTempDeductDays(new Set(carryoverDeductionDays[empId] || []));
                      }}
                    >
                      Override
                    </button>
                  </div>
                </div>
                {isExpanded && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #fde047' }}>
                    <div style={{ marginBottom: 6, color: '#78350f', fontWeight: 600 }}>Absent on previous cutoff (gap period):</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {co.dates.map(d => (
                        <span key={d} style={{ background: '#fef3c7', border: '1px solid #fde047', borderRadius: 6, padding: '2px 8px', fontSize: 11 }}>
                          {new Date(d + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}
                        </span>
                      ))}
                    </div>
                    {deductDays.length > 0 && (
                      <div style={{ marginTop: 6, color: '#78350f' }}>
                        Deducted from current cutoff: <strong>{deductDays.map(d => `Day ${d}`).join(', ')}</strong>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          <div className="alert alert-info" style={{ fontSize: 11 }}>
            Review scanned times. Red rows indicate anomalies. Click <strong>Fix</strong> to normalize them to the Weekly Hours target.
            <br />
            Rows marked with <strong>Carryover ↩</strong> are automatically marked as absent to pay back absences from the previous period's gap.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '40px 60px 60px 60px 60px 1fr 60px', gap: 8, fontSize: 10, fontWeight: 600, color: '#666', borderBottom: '1px solid #eee', paddingBottom: 4 }}>
              <div>Day</div>
              <div>AM In</div>
              <div>AM Out</div>
              <div>PM In</div>
              <div>PM Out</div>
              <div>Flags</div>
              <div>Action</div>
            </div>

            {liveDTRs[cleanupEmpIdx].rows.map((row, rIdx) => {
              if (row.status === 'weekend' || row.status === 'holiday') return null;

              const dtr = liveDTRs[cleanupEmpIdx];
              const emp = dtr.emp;

              const date = new Date(config.year, config.month - 1, row.day);
              const wkIdx = getWeekIndex(date, weeks);
              const wkHrs = weekHours[wkIdx] || 0;
              const dailyTarget = wkHrs * 60; // in minutes

              let displayRow = { ...row };
              const seed = emp.id * 97 + row.day * 37 + config.month * 13;
              const isForcedAbsent = absentDays.has(row.day);
              if (isForcedAbsent) {
                displayRow = { ...displayRow, arrival: '', departure: '', pmArrival: '', pmDeparture: '', status: 'absent', isForcedAbsent: true };
              }
              const isBonus = bonusDays.has(row.day) && !row.arrival && !row.departure && !row.pmArrival && !row.pmDeparture && !row.carryover && !isForcedAbsent;
              if (isBonus && wkHrs > 0) {
                const hoursForThisDay = wkHrs + (seed % 31) / 60;
                const times = generateTime(emp.duty, hoursForThisDay, seed);
                displayRow = { ...displayRow, ...times, isBonusPreview: true, dutyMismatch: false };
              }

              const parseHM = (timeStr, isPM) => {
                if (!timeStr) return null;
                let [h, m] = timeStr.split(':').map(Number);
                if (isPM && h >= 1 && h <= 11) h += 12;
                if (!isPM && h === 12) h = 0;
                return { h, m, total: h * 60 + m };
              };

              // Anomaly checks use raw row times, not displayRow, so bonus previews never
              // falsely trigger anomaly flags (bonus times exist only in displayRow).
              const rawAmIn = parseHM(isForcedAbsent ? '' : row.arrival, false);
              const rawAmOut = parseHM(isForcedAbsent ? '' : row.departure, false);
              const rawPmIn = parseHM(isForcedAbsent ? '' : row.pmArrival, true);
              const rawPmOut = parseHM(isForcedAbsent ? '' : row.pmDeparture, true);

              // Anomaly checks
              const isWrongShift = row.dutyMismatch ||
                (emp.duty === 'AM' && (rawPmIn || rawPmOut)) ||
                (emp.duty === 'PM' && (rawAmIn || rawAmOut));

              let isLate = false;
              let isUndertime = false;
              let isOvertime = false;
              let duration = 0;

              if (!isWrongShift) {
                if (emp.duty === 'AM') {
                  if (rawAmIn) isLate = rawAmIn.total > (AM_START.hour * 60 + AM_START.minute + GRACE_MINUTES);
                  if (rawAmIn && rawAmOut) duration = rawAmOut.total - rawAmIn.total;
                } else {
                  if (rawPmIn) isLate = rawPmIn.total > (PM_START.hour * 60 + PM_START.minute + GRACE_MINUTES);
                  if (rawPmIn && rawPmOut) duration = rawPmOut.total - rawPmIn.total;
                }
              } else {
                if (emp.duty === 'AM' && rawPmIn && rawPmOut) duration = rawPmOut.total - rawPmIn.total;
                if (emp.duty === 'PM' && rawAmIn && rawAmOut) duration = rawAmOut.total - rawAmIn.total;
              }

              const hasLogs = rawAmIn || rawAmOut || rawPmIn || rawPmOut;

              if (hasLogs && dailyTarget > 0) {
                if (duration < dailyTarget - 2) isUndertime = true;
                if (duration > dailyTarget + OVERTIME_THRESHOLD_MINUTES) isOvertime = true;
              }

              const hasAnomaly = isWrongShift || isLate || isUndertime || isOvertime;

              // handleFix works on the actual raw row times (not bonus preview)
              const handleFix = () => {
                let curAmIn = rawAmIn;
                let curAmOut = rawAmOut;
                let curPmIn = rawPmIn;
                let curPmOut = rawPmOut;

                const fmt = (tot) => {
                  if (tot == null) return '';
                  let h = Math.floor(tot / 60);
                  const m = Math.floor(tot % 60);
                  if (h === 0) h = 12;
                  if (h > 12) h -= 12;
                  return `${h}:${m.toString().padStart(2, '0')}`;
                };

                const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

                // Step A: Fix Late
                if (isLate && !isWrongShift) {
                  const targetStart = emp.duty === 'AM' ? (AM_START.hour * 60 + AM_START.minute) : (PM_START.hour * 60 + PM_START.minute);
                  const newArr = targetStart + rand(0, GRACE_MINUTES);
                  if (emp.duty === 'AM') curAmIn = { total: newArr };
                  else curPmIn = { total: newArr };
                }

                // Step B: Recompute Duration
                let curDuration = 0;
                if (emp.duty === 'AM' && !isWrongShift && curAmIn && curAmOut) curDuration = curAmOut.total - curAmIn.total;
                else if (emp.duty === 'PM' && !isWrongShift && curPmIn && curPmOut) curDuration = curPmOut.total - curPmIn.total;
                else if (isWrongShift && emp.duty === 'AM' && curPmIn && curPmOut) curDuration = curPmOut.total - curPmIn.total;
                else if (isWrongShift && emp.duty === 'PM' && curAmIn && curAmOut) curDuration = curAmOut.total - curAmIn.total;

                // Step C: Fix Undertime / Overtime
                if (isUndertime || isOvertime) {
                  if (isUndertime) {
                    const missing = dailyTarget - curDuration;
                    // Add enough to clear the undertime threshold (-2 min), safely add 0 to MAX
                    const add = missing + Math.floor(Math.random() * (RANDOM_BUFFER_MAX + 1));
                    if (emp.duty === 'AM' && !isWrongShift) {
                      if (curAmOut) curAmOut.total += add;
                      else curAmOut = { total: (curAmIn ? curAmIn.total : AM_START.hour * 60 + AM_START.minute) + add };
                    } else if (emp.duty === 'PM' && !isWrongShift) {
                      if (curPmOut) curPmOut.total += add;
                      else curPmOut = { total: (curPmIn ? curPmIn.total : PM_START.hour * 60 + PM_START.minute) + add };
                    }
                    curDuration += add;
                  } else {
                    const excess = curDuration - dailyTarget;
                    // Subtract enough to clear the overtime threshold
                    const minSub = Math.max(0, excess - OVERTIME_THRESHOLD_MINUTES);
                    const sub = minSub + Math.floor(Math.random() * (RANDOM_BUFFER_MAX + 1));
                    if (emp.duty === 'AM' && !isWrongShift && curAmOut) curAmOut.total -= sub;
                    else if (emp.duty === 'PM' && !isWrongShift && curPmOut) curPmOut.total -= sub;
                    curDuration -= sub;
                  }
                }

                // Step D: Fix Wrong Shift
                if (isWrongShift) {
                  if (emp.duty === 'AM') {
                    curAmIn = { total: AM_START.hour * 60 + AM_START.minute };
                    curAmOut = { total: curAmIn.total + curDuration };
                    curPmIn = null;
                    curPmOut = null;
                  } else {
                    curPmIn = { total: PM_START.hour * 60 + PM_START.minute };
                    curPmOut = { total: curPmIn.total + curDuration };
                    curAmIn = null;
                    curAmOut = null;
                  }
                }

                // Apply updates
                const newDTRs = [...liveDTRs];
                newDTRs[cleanupEmpIdx].rows[rIdx].arrival = fmt(curAmIn?.total);
                newDTRs[cleanupEmpIdx].rows[rIdx].departure = fmt(curAmOut?.total);
                newDTRs[cleanupEmpIdx].rows[rIdx].pmArrival = fmt(curPmIn?.total);
                newDTRs[cleanupEmpIdx].rows[rIdx].pmDeparture = fmt(curPmOut?.total);
                newDTRs[cleanupEmpIdx].rows[rIdx].dutyMismatch = false;
                setLiveDTRs(newDTRs);
              };

              const handleRemoveCarryover = () => {
                const empId = emp.id;
                const newDTRs = [...liveDTRs];
                const rowIdx = newDTRs[cleanupEmpIdx].rows.findIndex(r => r.day === row.day);
                if (rowIdx !== -1) {
                  newDTRs[cleanupEmpIdx].rows[rowIdx] = {
                    ...newDTRs[cleanupEmpIdx].rows[rowIdx],
                    status: 'absent',
                    carryover: false,
                  };
                }
                setLiveDTRs(newDTRs);
                setCarryoverDeductionDays(prev => {
                  const current = prev[empId] || [];
                  return { ...prev, [empId]: current.filter(d => d !== row.day) };
                });
              };

              return (
                <div key={row.day} style={{
                  display: 'grid', gridTemplateColumns: '40px 60px 60px 60px 60px 1fr 60px', gap: 8, alignItems: 'center', fontSize: 12, padding: '6px 0',
                  background: row.carryover ? '#fffbeb' : hasAnomaly ? '#fef2f2' : displayRow.isBonusPreview ? '#f0fdf4' : 'transparent',
                  borderBottom: '1px solid #f5f5f5',
                  borderLeft: row.carryover ? '3px solid #f59e0b' : 'none',
                  paddingLeft: row.carryover ? 5 : 0,
                }}>
                  <div style={{ fontWeight: 600 }}>{row.day}</div>
                  <div style={{ color: displayRow.isBonusPreview ? '#16a34a' : 'inherit' }}>{displayRow.arrival || '--'}</div>
                  <div style={{ color: displayRow.isBonusPreview ? '#16a34a' : 'inherit' }}>{displayRow.departure || '--'}</div>
                  <div style={{ color: displayRow.isBonusPreview ? '#16a34a' : 'inherit' }}>{displayRow.pmArrival || '--'}</div>
                  <div style={{ color: displayRow.isBonusPreview ? '#16a34a' : 'inherit' }}>{displayRow.pmDeparture || '--'}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {displayRow.isBonusPreview && <span className="badge badge-success" style={{ fontSize: 9 }}>Bonus Day Preview</span>}
                    {row.carryover && <span className="badge" style={{ fontSize: 9, background: '#fef3c7', color: '#92400e', border: '1px solid #fde047' }}>Carryover ↩</span>}
                    {isWrongShift && !displayRow.isBonusPreview && !row.carryover && <span className="badge badge-warning" style={{ fontSize: 9 }}>Wrong Shift</span>}
                    {isLate && !displayRow.isBonusPreview && !row.carryover && <span className="badge badge-error" style={{ fontSize: 9 }}>Late</span>}
                    {isUndertime && !displayRow.isBonusPreview && !row.carryover && <span className="badge badge-warning" style={{ fontSize: 9 }}>Undertime</span>}
                    {isOvertime && !displayRow.isBonusPreview && !row.carryover && <span className="badge badge-warning" style={{ fontSize: 9 }}>Overtime</span>}
                  </div>
                  <div>
                    {hasAnomaly && !row.carryover && !displayRow.isBonusPreview && (
                      <button className="btn btn-sm btn-outline" style={{ borderColor: '#ef4444', color: '#ef4444', padding: '2px 8px', fontSize: 10 }} onClick={handleFix}>Fix</button>
                    )}
                    {row.carryover && (
                      <button className="btn btn-sm btn-outline" style={{ borderColor: '#f59e0b', color: '#f59e0b', padding: '2px 8px', fontSize: 10 }} onClick={handleRemoveCarryover}>Remove</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="btn-row" style={{ marginTop: 24 }}>
            {cleanupEmpIdx > 0
              ? <button className="btn btn-secondary" onClick={() => setCleanupEmpIdx(i => i - 1)}>← Prev</button>
              : <button className="btn btn-secondary" onClick={() => setStep(3)}>← Back</button>
            }
            {cleanupEmpIdx < liveDTRs.length - 1 && (
              <button className="btn btn-primary" onClick={() => setCleanupEmpIdx(i => i + 1)}>Next Employee →</button>
            )}
            {cleanupEmpIdx === liveDTRs.length - 1 && (
              <button className="btn btn-success" onClick={finishLiveSaved} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {saving ? <><Loader2 size={16} className="login-spinner" /> Generating…</> : <><CheckCircle2 size={16} /> Finish & Generate DTRs</>}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ═══ STEP 4 — Attendance ════════════════════════════════════════════ */}
      {step === 4 && emp && (
        <div className="card">
          <div className="card-title">Step 4: Attendance Input</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
            <span><strong>{emp.name}</strong></span>
            <span>{empIdx + 1} / {employees.length}</span>
          </div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${(empIdx / employees.length) * 100}%` }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0' }}>
            <div className="emp-avatar" style={{ width: 32, height: 32, fontSize: 11 }}>
              {emp.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
            </div>
            <div>
              <strong>{emp.name}</strong>
              <span className={`badge badge-${emp.duty.toLowerCase()}`} style={{ marginLeft: 8 }}>{emp.duty} Duty</span>
            </div>
          </div>
          <div className="alert alert-info" style={{ fontSize: 11 }}>
            Click a day to toggle <strong>Present ↔ Absent</strong>. Weekends are auto-set.
          </div>
          <div className="day-grid">
            {dates.map(d => {
              const day = d.getDate();
              const status = attendance[empIdx]?.[day] || 'present';
              const displayStatus = status === 'holiday' ? 'absent' : status;
              return (
                <div
                  key={day}
                  className={`day-btn ${displayStatus}`}
                  onClick={() => status !== 'weekend' && status !== 'holiday' && toggleDay(empIdx, day)}
                >
                  {day}
                  <div style={{ fontSize: 9 }}>{DAY_NAMES[d.getDay()]}</div>
                  {status !== 'weekend' && (
                    <div style={{ fontSize: 8 }}>
                      {status === 'holiday' ? 'HOL' : (status === 'present' ? <Check size={10} strokeWidth={4} /> : <X size={10} strokeWidth={4} />)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="btn-row">
            {empIdx > 0
              ? <button className="btn btn-secondary" onClick={() => setEmpIdx(i => i - 1)}>← Prev</button>
              : <button className="btn btn-secondary" onClick={() => setStep(3)}>← Back</button>
            }
            {empIdx < employees.length - 1 && (
              <button className="btn btn-primary" onClick={() => setEmpIdx(i => i + 1)}>Next Employee →</button>
            )}
            {empIdx === employees.length - 1 && (
              <button className="btn btn-success" onClick={finish} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {saving ? <><Loader2 size={16} className="login-spinner" /> Generating…</> : <><CheckCircle2 size={16} /> Finish & Generate DTRs</>}
              </button>
            )}
          </div>
        </div>
      )}
      {/* ── Holiday Modal ── */}
      {showHolidayModal && (
        <div className="modal-overlay">
          <div className="modal-content card" style={{ maxWidth: 700, margin: '0 auto' }}>
            <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}><CalendarDays size={20} /> Set Global Holidays</h3>
            <div className="alert alert-info" style={{ fontSize: 11 }}>
              Click a day to mark it as a Holiday/Non-working day. This applies to all employees.
            </div>
            <div className="day-grid">
              {getDatesInCutoff(config.year, config.month, config.cutoff).map(d => {
                const day = d.getDate();
                const isWknd = isWeekend(d);
                const isHol = globalHolidays.has(day);
                const status = isWknd ? 'weekend' : (isHol ? 'absent' : 'present');
                return (
                  <div
                    key={day}
                    className={`day-btn ${status}`}
                    onClick={() => {
                      if (isWknd) return;
                      setGlobalHolidays(prev => {
                        const next = new Set(prev);
                        next.has(day) ? next.delete(day) : next.add(day);
                        return next;
                      });
                    }}
                  >
                    {day}
                    <div style={{ fontSize: 9 }}>{DAY_NAMES[d.getDay()]}</div>
                    {!isWknd && <div style={{ fontSize: 8 }}>{isHol ? 'HOL' : <Check size={10} strokeWidth={4} />}</div>}
                  </div>
                );
              })}
            </div>
            <div className="btn-row" style={{ marginTop: 24, justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={() => setShowHolidayModal(false)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Duty Modal ── */}
      {showBonusModal && (
        <div className="modal-overlay">
          <div className="modal-content card" style={{ maxWidth: 700, margin: '0 auto' }}>
            <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}><Edit size={20} /> Edit Duty</h3>

            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, padding: '8px 12px', background: dutyMode === 'bonus' ? '#f0fdf4' : '#f8fafc', border: `1px solid ${dutyMode === 'bonus' ? '#22c55e' : '#e2e8f0'}`, borderRadius: 6 }}>
                <input type="radio" name="dutyMode" value="bonus" checked={dutyMode === 'bonus'} onChange={() => setDutyMode('bonus')} />
                <strong>🎁 Add Bonus Day</strong>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, padding: '8px 12px', background: dutyMode === 'absent' ? '#fef2f2' : '#f8fafc', border: `1px solid ${dutyMode === 'absent' ? '#ef4444' : '#e2e8f0'}`, borderRadius: 6 }}>
                <input type="radio" name="dutyMode" value="absent" checked={dutyMode === 'absent'} onChange={() => setDutyMode('absent')} />
                <strong><Trash2 size={14} style={{ display: 'inline', verticalAlign: 'text-bottom' }} /> Delete / Make Absent</strong>
              </label>
            </div>

            <div className="alert alert-info" style={{ fontSize: 11 }}>
              {dutyMode === 'bonus'
                ? "Click a day to mark it as a Bonus Day. If an employee has no time-in for this day, the system will fill it with a perfect generated time."
                : "Click a day to Force Delete it. This will mark the day as absent and wipe any existing scanned logs for that day."}
            </div>

            <div className="day-grid">
              {getDatesInCutoff(config.year, config.month, config.cutoff).map(d => {
                const day = d.getDate();
                const isWknd = isWeekend(d);
                const isHol = globalHolidays.has(day);
                const isBonus = bonusDays.has(day);
                const isAbsent = absentDays.has(day);

                let status = 'present';
                if (isWknd) status = 'weekend';
                else if (isHol) status = 'absent';
                else if (isAbsent) status = 'absent';
                else if (isBonus) status = 'holiday'; // reuse green/special styling

                return (
                  <div
                    key={day}
                    className={`day-btn ${status}`}
                    style={{ border: isAbsent ? '2px solid #ef4444' : (isBonus ? '2px solid #22c55e' : undefined) }}
                    onClick={() => {
                      if (isWknd || isHol) return;
                      if (dutyMode === 'bonus') {
                        setBonusDays(prev => {
                          const next = new Set(prev);
                          next.has(day) ? next.delete(day) : next.add(day);
                          return next;
                        });
                        if (!bonusDays.has(day)) {
                          setAbsentDays(prev => { const n = new Set(prev); n.delete(day); return n; });
                        }
                      } else {
                        setAbsentDays(prev => {
                          const next = new Set(prev);
                          next.has(day) ? next.delete(day) : next.add(day);
                          return next;
                        });
                        if (!absentDays.has(day)) {
                          setBonusDays(prev => { const n = new Set(prev); n.delete(day); return n; });
                        }
                      }
                    }}
                  >
                    {day}
                    <div style={{ fontSize: 9 }}>{DAY_NAMES[d.getDay()]}</div>
                    {!isWknd && !isHol && <div style={{ fontSize: 8 }}>{isAbsent ? <X size={10} strokeWidth={4} color="#ef4444" /> : (isBonus ? 'BONUS' : <Check size={10} strokeWidth={4} />)}</div>}
                  </div>
                );
              })}
            </div>
            <div className="btn-row" style={{ marginTop: 24, justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={() => setShowBonusModal(false)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Finish Confirmation Modal ── */}
      <ConfirmModal
        isOpen={showConfirmFinishModal}
        title="Confirm DTR Generation"
        showCloseIcon={true}
        onCancel={() => setShowConfirmFinishModal(false)}
        message="Are you sure you want to finish and save these DTRs?"
        customActions={
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
            <button
              onClick={() => {
                setShowConfirmFinishModal(false);
                doFinishLiveSaved(null); // Passing null will skip setting the endpoint date
              }}
              style={{ width: '100%', padding: '12px 16px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', color: '#475569', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
              Save but don't update endpoint
            </button>
            <button
              onClick={() => {
                setShowConfirmFinishModal(false);
                // Always today — this is unconditional, ignores any prior manual pick.
                const dateToSave = new Date().toISOString().slice(0, 10);
                doFinishLiveSaved(dateToSave, [...globalHolidays]);
              }}
              style={{ width: '100%', padding: '12px 16px', borderRadius: 8, border: 'none', background: '#1e293b', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
              Save and Update endpoints
            </button>
          </div>
        }

      />

      {/* ── Endpoint Selection Modal ── */}
      <ConfirmModal
        isOpen={showEndpointModal}
        title="Set Endpoint Date"
        message="Endpoints mark the date this DTR was generated ahead of the cutoff's end. Any absences that occur between this date and the actual end of the cutoff will be automatically checked and deducted from the next DTR."
        showCloseIcon={true}
        onCancel={() => !savingEndpoint && setShowEndpointModal(false)}
        customActions={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, width: '100%' }}>
            <button
              onClick={() => setShowEndpointModal(false)}
              disabled={savingEndpoint}
              style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #cbd5e1', background: 'transparent', cursor: 'pointer', fontWeight: 600, color: '#475569', opacity: savingEndpoint ? 0.5 : 1 }}>
              Cancel
            </button>
            <button
              onClick={() => {
                setConfirmActionModal({
                  open: true,
                  title: 'Confirm Save Endpoint',
                  message: `Are you sure you want to save ${new Date(endpointDate).toLocaleDateString()} as the endpoint? This marks the date the DTR was generated.`,
                  onConfirm: async () => {
                    setConfirmActionModal(prev => ({ ...prev, open: false }));
                    if (savingEndpoint) return;
                    setSavingEndpoint(true);
                    try {
                      await setDTREndpoint({
                        month: config.month,
                        year: config.year,
                        cutoff: config.cutoff,
                        endpoint_date: endpointDate,
                        holidays: [...globalHolidays],
                      });
                      setEndpointManuallySet(true);
                      setAlertModal({ open: true, title: 'Success', message: 'Endpoint saved successfully.' });
                    } catch (err) {
                      setAlertModal({ open: true, title: 'Error', message: 'Failed to save endpoint: ' + (err.message || err) });
                    } finally {
                      setSavingEndpoint(false);
                      setShowEndpointModal(false);
                    }
                  }
                });
              }}
              disabled={savingEndpoint}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 6, border: 'none', background: '#1e293b', color: '#fff', cursor: 'pointer', fontWeight: 600, opacity: savingEndpoint ? 0.5 : 1 }}>
              {savingEndpoint ? <><Loader2 size={16} className="spin" /> Saving...</> : 'Save Date'}
            </button>
          </div>
        }
      >
        <div>
          <label style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 6, color: '#374151' }}>
            DTR Generated On (Endpoint Date)
          </label>
          <input
            type="date"
            value={endpointDate}
            max={new Date().toISOString().slice(0, 10)}
            onChange={e => setEndpointDate(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, boxSizing: 'border-box' }}
          />
          <p style={{ fontSize: 11, color: '#6b7280', marginTop: 6, marginBottom: 0 }}>
            Endpoints are the date you generate this DTR. Days between this date and the actual cutoff end will be automatically checked for real absences when generating the next DTR.
          </p>
        </div>
      </ConfirmModal>

      {/* ── Edit Previous Endpoint Modal ── */}
      <ConfirmModal
        isOpen={showEditEndpointModal}
        title="Edit Previous Endpoint"
        message="Changing the previous endpoint will affect which gap days are checked for carryover absences. This action is logged."
        confirmLabel="Update Endpoint"
        cancelLabel="Cancel"
        onCancel={() => setShowEditEndpointModal(false)}
        onConfirm={() => {
          setConfirmActionModal({
            open: true,
            title: 'Confirm Update Endpoint',
            message: `Are you sure you want to change the previous endpoint to ${new Date(editEndpointDate).toLocaleDateString()}? This will affect gap days checked for carryover absences.`,
            onConfirm: async () => {
              setConfirmActionModal(prev => ({ ...prev, open: false }));
              if (!prevEndpoint) return;
              try {
                await setDTREndpoint({ month: prevEndpoint.month, year: prevEndpoint.year, cutoff: prevEndpoint.cutoff, endpoint_date: editEndpointDate });
                setPrevEndpoint({ ...prevEndpoint, endpoint_date: editEndpointDate });
                setAlertModal({ open: true, title: 'Success', message: 'Previous endpoint updated successfully.' });
              } catch (err) {
                setAlertModal({ open: true, title: 'Error', message: 'Failed to update endpoint: ' + (err.message || err) });
              }
              setShowEditEndpointModal(false);
            }
          });
        }}
      >
        <div>
          <label style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 6, color: '#374151' }}>New Endpoint Date</label>
          <input type="date" value={editEndpointDate} onChange={e => setEditEndpointDate(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, boxSizing: 'border-box' }} />
        </div>
      </ConfirmModal>

      {/* ── Deduction Override Picker Modal ── */}
      {showDeductionPickerEmp !== null && (() => {
        const targetEmpDTR = liveDTRs.find(d => d.emp.id === showDeductionPickerEmp);
        const co = carryoverAbsences[showDeductionPickerEmp];
        if (!targetEmpDTR || !co) return null;
        const currentDeductDays = tempDeductDays || new Set(carryoverDeductionDays[showDeductionPickerEmp] || []);
        const workdays = targetEmpDTR.rows.filter(r => r.status !== 'weekend' && r.status !== 'holiday');
        const needed = co.count;
        return (
          <div className="modal-overlay">
            <div className="modal-content card" style={{ maxWidth: 520 }}>
              <h3 style={{ marginTop: 0, fontSize: 16 }}>⚠ Override Deduction Days</h3>
              <div className="alert alert-info" style={{ fontSize: 11, marginBottom: 12 }}>
                Select exactly <strong>{needed}</strong> day{needed !== 1 ? 's' : ''} to mark as absent (carryover deduction). Currently selected: <strong>{currentDeductDays.size}</strong>.
              </div>
              <div className="day-grid">
                {workdays.map(row => {
                  const isSelected = currentDeductDays.has(row.day);
                  return (
                    <div key={row.day} className={`day-btn ${isSelected ? 'absent' : row.status}`}
                      style={{ cursor: 'pointer', border: isSelected ? '2px solid #f59e0b' : undefined }}
                      onClick={() => {
                        const next = new Set(currentDeductDays);
                        if (next.has(row.day)) { next.delete(row.day); } else if (next.size < needed) { next.add(row.day); }
                        setTempDeductDays(next);
                      }}>
                      {row.day}
                      <div style={{ fontSize: 9 }}>{DAY_NAMES[new Date(config.year, config.month - 1, row.day).getDay()]}</div>
                      <div style={{ fontSize: 8 }}>{isSelected ? '↩' : (row.status === 'present' ? <Check size={10} strokeWidth={4} /> : <X size={10} strokeWidth={4} />)}</div>
                    </div>
                  );
                })}
              </div>
              <div className="btn-row" style={{ marginTop: 20, justifyContent: 'flex-end', gap: 12 }}>
                <button className="btn btn-outline" onClick={() => {
                  setShowDeductionPickerEmp(null);
                  setTempDeductDays(null);
                }}>
                  Cancel
                </button>
                <button className="btn btn-primary" disabled={currentDeductDays.size !== needed} onClick={() => {
                  const next = currentDeductDays;
                  const newDTRs = liveDTRs.map(d => {
                    if (d.emp.id !== showDeductionPickerEmp) return d;
                    return {
                      ...d, rows: d.rows.map(r => {
                        if (r.status === 'weekend' || r.status === 'holiday') return r;
                        if (next.has(r.day)) return { ...r, status: 'absent', arrival: '', departure: '', pmArrival: '', pmDeparture: '', carryover: true };
                        if (r.carryover) return { ...r, status: 'absent', carryover: false };
                        return r;
                      })
                    };
                  });
                  setLiveDTRs(newDTRs);
                  setCarryoverDeductionDays(prev => ({ ...prev, [showDeductionPickerEmp]: [...next] }));
                  setShowDeductionPickerEmp(null);
                  setTempDeductDays(null);
                }}>
                  Done ({currentDeductDays.size}/{needed} selected)
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Generic Alert Modal */}
      <ConfirmModal
        isOpen={alertModal.open}
        title={alertModal.title}
        message={alertModal.message}
        showCloseIcon={true}
        onCancel={() => setAlertModal(prev => ({ ...prev, open: false }))}
        customActions={
          <button
            onClick={() => setAlertModal(prev => ({ ...prev, open: false }))}
            style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#1e293b', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
            OK
          </button>
        }
      />

      {/* Generic Confirm Action Modal */}
      <ConfirmModal
        isOpen={confirmActionModal.open}
        title={confirmActionModal.title}
        message={confirmActionModal.message}
        showCloseIcon={true}
        onCancel={() => setConfirmActionModal(prev => ({ ...prev, open: false }))}
        onConfirm={confirmActionModal.onConfirm}
        confirmLabel="Yes, I am sure"
        cancelLabel="Cancel"
      />
    </div>
  );
}