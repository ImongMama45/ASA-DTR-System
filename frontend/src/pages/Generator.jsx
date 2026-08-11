import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAllEmployees, saveBatch, seedEmployees, seedBatches } from '../db';
import {
  MONTH_NAMES, DAY_NAMES, getDatesInCutoff, getWeeks,
  getWeekIndex, workdaysInWeek, isWeekend, isSaturday,
  generateTime, cutoffLabel, daysInMonth
} from '../utils/dateUtils';
import { fetchEmployees, fetchBatches, createServerBatch, fetchEmployeeAttendance } from '../hooks/useSync';
import { AlertTriangle, Users, CalendarDays, CheckCircle2, Check, X, Calendar, Loader2, Zap, Gift } from 'lucide-react';

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
  const [showBonusModal, setShowBonusModal] = useState(false);
  const [cleanupEmpIdx, setCleanupEmpIdx] = useState(0);

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

    try {
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
          const PH_TZ = 'Asia/Manila';

          const toPHTDateParts = (isoString) => {
            const parts = new Intl.DateTimeFormat('en-PH', {
              timeZone: PH_TZ, year: 'numeric', month: 'numeric', day: 'numeric',
            }).formatToParts(new Date(isoString));
            const get = (type) => parseInt(parts.find(p => p.type === type)?.value || '0', 10);
            return { y: get('year'), mo: get('month'), d: get('day') };
          };

          const dayRecords = records.filter(r => {
            const { y, mo, d } = toPHTDateParts(r.timestamp);
            return d === day && mo === month && y === year;
          });

          if (dayRecords.length === 0) {
            rows.push({ day, dow: date.getDay(), status: 'absent', arrival: '', departure: '', pmArrival: '', pmDeparture: '' });
            continue;
          }

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
            arrival: rawArrival,
            departure: rawDeparture,
            pmArrival: rawPmArrival,
            pmDeparture: rawPmDeparture,
            rawArrival, rawDeparture, rawPmArrival, rawPmDeparture,
            dutyMismatch
          });
        }
        return { emp, rows };
      }));

      const totalRecords = empDTRs.reduce((sum, e) => sum + e.rows.filter(r => r.arrival || r.departure || r.pmArrival || r.pmDeparture).length, 0);
      
      if (totalRecords === 0) {
        alert('Warning: No attendance logs found for the selected employees in this period. The generated DTRs will be mostly empty.');
      }

      setDtrSource('live');
      setLiveDTRs(empDTRs);
      setCleanupEmpIdx(0);
      setSaving(false);
      setStep(3); // Go to Weekly Hours first
    } catch (err) {
      console.error(err);
      setSaving(false);
      
      const msg = err.message || '';
      if (msg.includes('401') || msg.includes('Unauthorized')) {
        alert('Authentication failed (401 Unauthorized). Your session may have expired. Please sign out and sign back in.');
      } else if (msg.includes('Failed to fetch') || msg.includes('Network')) {
        alert('Network error. Please check your internet connection or ensure the server is running.');
      } else {
        alert(`Failed to fetch from Live Attendance logs: ${msg}`);
      }
    }
  }

  // ── Finish Saved (Live Data) ──────────────────────────────────────────────
  async function finishLiveSaved() {
    setSaving(true);
    const { month, year, cutoff } = config;

    const finalDTRs = liveDTRs.map((dtr) => {
      const newRows = dtr.rows.map(row => {
        if (bonusDays.has(row.day) && !row.arrival && !row.departure && !row.pmArrival && !row.pmDeparture && row.status !== 'weekend' && row.status !== 'holiday') {
          const date = new Date(year, month - 1, row.day);
          const wkIdx = getWeekIndex(date, weeks);
          const wkHrs = weekHours[wkIdx] || 0;
          const wd = workdaysInWeek(weeks[wkIdx]);
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
              <button className="btn btn-sm btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px' }} onClick={() => {
                const newDTRs = [...liveDTRs];
                liveDTRs[cleanupEmpIdx].rows.forEach((row, rIdx) => {
                  if (row.status === 'weekend' || row.status === 'holiday') return;
                  const emp = newDTRs[cleanupEmpIdx].emp;
                  const date = new Date(config.year, config.month - 1, row.day);
                  const wkIdx = getWeekIndex(date, weeks);
                  const wkHrs = weekHours[wkIdx] || 0;
                  const dailyTarget = wkHrs * 60;
                  const isWrongShift = row.dutyMismatch;

                  const parseHM = (timeStr, isPM) => {
                    if (!timeStr) return null;
                    let [h, m] = timeStr.split(':').map(Number);
                    if (isPM && h >= 1 && h <= 11) h += 12;
                    if (!isPM && h === 12) h = 0;
                    return { h, m, total: h * 60 + m };
                  };
                  let amIn = parseHM(row.arrival, false), amOut = parseHM(row.departure, false);
                  let pmIn = parseHM(row.pmArrival, true), pmOut = parseHM(row.pmDeparture, true);

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
                  if (duration > 0 && dailyTarget > 0) {
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
                        if (emp.duty === 'AM' && !isWrongShift && amOut) amOut.total += add;
                        else if (emp.duty === 'PM' && !isWrongShift && pmOut) pmOut.total += add;
                        else if (isWrongShift && emp.duty === 'AM' && pmOut) pmOut.total += add;
                        else if (isWrongShift && emp.duty === 'PM' && amOut) amOut.total += add;
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
              <button className="btn btn-sm btn-outline" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: '#fff' }} onClick={() => setShowBonusModal(true)}>
                <Gift size={14} /> Set Bonus Days
              </button>
            </div>
          </div>

          <div className="alert alert-info" style={{ fontSize: 11 }}>
            Review scanned times. Red rows indicate anomalies. Click <strong>Fix</strong> to normalize them to the Weekly Hours target.
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
              const isBonus = bonusDays.has(row.day) && !row.arrival && !row.departure && !row.pmArrival && !row.pmDeparture;
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

              const amIn = parseHM(displayRow.arrival, false);
              const amOut = parseHM(displayRow.departure, false);
              const pmIn = parseHM(displayRow.pmArrival, true);
              const pmOut = parseHM(displayRow.pmDeparture, true);

              // Anomaly checks
              const isWrongShift = row.dutyMismatch ||
                (emp.duty === 'AM' && (pmIn || pmOut)) ||
                (emp.duty === 'PM' && (amIn || amOut));

              let isLate = false;
              let isUndertime = false;
              let isOvertime = false;
              let duration = 0;

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

              const hasAnomaly = isWrongShift || isLate || isUndertime || isOvertime;

              const handleFix = () => {
                let curAmIn = amIn;
                let curAmOut = amOut;
                let curPmIn = pmIn;
                let curPmOut = pmOut;

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

              return (
                <div key={row.day} style={{ display: 'grid', gridTemplateColumns: '40px 60px 60px 60px 60px 1fr 60px', gap: 8, alignItems: 'center', fontSize: 12, padding: '6px 0', background: hasAnomaly ? '#fef2f2' : displayRow.isBonusPreview ? '#f0fdf4' : 'transparent', borderBottom: '1px solid #f5f5f5' }}>
                  <div style={{ fontWeight: 600 }}>{row.day}</div>
                  <div style={{ color: displayRow.isBonusPreview ? '#16a34a' : 'inherit' }}>{displayRow.arrival || '--'}</div>
                  <div style={{ color: displayRow.isBonusPreview ? '#16a34a' : 'inherit' }}>{displayRow.departure || '--'}</div>
                  <div style={{ color: displayRow.isBonusPreview ? '#16a34a' : 'inherit' }}>{displayRow.pmArrival || '--'}</div>
                  <div style={{ color: displayRow.isBonusPreview ? '#16a34a' : 'inherit' }}>{displayRow.pmDeparture || '--'}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {displayRow.isBonusPreview && <span className="badge badge-success" style={{ fontSize: 9 }}>Bonus Day Preview</span>}
                    {isWrongShift && !displayRow.isBonusPreview && <span className="badge badge-warning" style={{ fontSize: 9 }}>Wrong Shift</span>}
                    {isLate && !displayRow.isBonusPreview && <span className="badge badge-error" style={{ fontSize: 9 }}>Late</span>}
                    {isUndertime && !displayRow.isBonusPreview && <span className="badge badge-warning" style={{ fontSize: 9 }}>Undertime</span>}
                    {isOvertime && !displayRow.isBonusPreview && <span className="badge badge-warning" style={{ fontSize: 9 }}>Overtime</span>}
                  </div>
                  <div>
                    {hasAnomaly && (
                      <button className="btn btn-sm btn-outline" style={{ borderColor: '#ef4444', color: '#ef4444', padding: '2px 8px', fontSize: 10 }} onClick={handleFix}>Fix</button>
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

      {/* ── Bonus Modal ── */}
      {showBonusModal && (
        <div className="modal-overlay">
          <div className="modal-content card" style={{ maxWidth: 700, margin: '0 auto' }}>
            <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>🎁 Set Bonus Days</h3>
            <div className="alert alert-info" style={{ fontSize: 11 }}>
              Click a day to mark it as a Bonus Day. If an employee has no time-in for this day, the system will automatically fill it with a perfect generated time.
            </div>
            <div className="day-grid">
              {getDatesInCutoff(config.year, config.month, config.cutoff).map(d => {
                const day = d.getDate();
                const isWknd = isWeekend(d);
                const isHol = globalHolidays.has(day);
                const isBonus = bonusDays.has(day);

                let status = 'present';
                if (isWknd) status = 'weekend';
                else if (isHol) status = 'absent';
                else if (isBonus) status = 'holiday'; // reuse green/special styling

                return (
                  <div
                    key={day}
                    className={`day-btn ${status}`}
                    onClick={() => {
                      if (isWknd || isHol) return;
                      setBonusDays(prev => {
                        const next = new Set(prev);
                        next.has(day) ? next.delete(day) : next.add(day);
                        return next;
                      });
                    }}
                  >
                    {day}
                    <div style={{ fontSize: 9 }}>{DAY_NAMES[d.getDay()]}</div>
                    {!isWknd && !isHol && <div style={{ fontSize: 8 }}>{isBonus ? 'BONUS' : <Check size={10} strokeWidth={4} />}</div>}
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
    </div>
  );
}