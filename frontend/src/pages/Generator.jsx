import { useState, useEffect } from 'react';
import { getAllEmployees, saveBatch, seedEmployees, seedBatches } from '../db';
import {
  MONTH_NAMES, DAY_NAMES, getDatesInCutoff, getWeeks,
  getWeekIndex, workdaysInWeek, isWeekend, isSaturday,
  generateTime, cutoffLabel, daysInMonth
} from '../utils/dateUtils';
import { fetchEmployees, fetchBatches, createServerBatch } from '../hooks/useSync';

export default function Generator({ onDone, isOnline }) {
  const [step, setStep] = useState(1);
  const [allEmployees, setAllEmployees] = useState([]);   // everyone in DB
  const [employees, setEmployees] = useState([]);          // subset chosen in step 1
  const [selectedIds, setSelectedIds] = useState(new Set()); // for manual pick UI
  const [pickMode, setPickMode] = useState(null);        // 'all' | 'manual' | null

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

  useEffect(() => { loadEmployees(); }, [isOnline]);

  async function loadEmployees() {
    if (isOnline) {
      try {
        const list = await fetchEmployees();
        await seedEmployees(list);
      } catch { /* use local */ }
    }
    const list = await getAllEmployees();
    setAllEmployees(list);
  }

  // ── Step 1 helpers ────────────────────────────────────────────────────────

  function chooseModeAll() {
    setPickMode('all');
    setSelectedIds(new Set(allEmployees.map(e => e.id)));
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

  function selectAll() { setSelectedIds(new Set(allEmployees.map(e => e.id))); }
  function deselectAll() { setSelectedIds(new Set()); }

  function proceedFromStep1() {
    const chosen = allEmployees.filter(e => selectedIds.has(e.id));
    setEmployees(chosen);
    setStep(2);
  }

  // ── Step 2 → 3 ───────────────────────────────────────────────────────────

  function proceedToStep3() {
    const dates = getDatesInCutoff(config.year, config.month, config.cutoff);
    const ws = getWeeks(dates);
    setWeeks(ws);
    setWeekHours(ws.map(w => workdaysInWeek(w)));
    const att = {};
    employees.forEach((e, ei) => {
      att[ei] = {};
      dates.forEach(d => {
        att[ei][d.getDate()] = isWeekend(d) ? 'weekend' : 'present';
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
        const seed = ei * 97 + day * 37 + month * 13;
        const hoursForThisDay = wkHrs + (seed % 31) / 60;

        let times = { arrival: '', departure: '', pmArrival: '', pmDeparture: '' };
        if (wknd) {
          const label = isSaturday(date) ? 'SAT' : 'SUN';
          times = { arrival: label, departure: label, pmArrival: '', pmDeparture: '' };
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

  // ── Guards ────────────────────────────────────────────────────────────────

  const emp = employees[empIdx];
  const dates = weeks.flat();

  if (!allEmployees.length) return (
    <div className="card">
      <div className="alert alert-warning">
        ⚠ No employees found. Please add employees first before generating DTRs.
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
                style={{ flex: 1, minWidth: 160, padding: '20px 16px', fontSize: '1rem' }}
                onClick={chooseModeAll}
              >
                👥 All Employees
                <div style={{ fontSize: '0.75rem', fontWeight: 400, marginTop: 4, opacity: 0.85 }}>
                  Generate DTR for everyone ({allEmployees.length})
                </div>
              </button>
              <button
                className="btn btn-outline"
                style={{ flex: 1, minWidth: 160, padding: '20px 16px', fontSize: '1rem' }}
                onClick={chooseModeManual}
              >
                ✅ Choose Manually
                <div style={{ fontSize: '0.75rem', fontWeight: 400, marginTop: 4, opacity: 0.85 }}>
                  Pick specific employees
                </div>
              </button>
            </div>
          )}

          {/* All mode — show confirmation */}
          {pickMode === 'all' && (
            <>
              <div className="alert alert-success" style={{ marginTop: 12 }}>
                ✅ All <strong>{allEmployees.length}</strong> employee(s) selected.
              </div>
              <div className="emp-list" style={{ maxHeight: 320, overflowY: 'auto' }}>
                {allEmployees.map(emp => (
                  <div className="emp-item" key={emp.id} style={{ opacity: 0.85 }}>
                    <div className="emp-avatar">{emp.name.split(' ').map(w => w[0]).join('').slice(0, 2)}</div>
                    <div style={{ flex: 1 }}>
                      <div className="emp-name">{emp.name}</div>
                      <span className={`badge badge-${emp.duty.toLowerCase()}`}>{emp.duty} Duty</span>
                    </div>
                    <span style={{ fontSize: 18, color: 'var(--color-success, #22c55e)' }}>✓</span>
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
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '12px 0 8px' }}>
                <span style={{ fontSize: '0.85rem', color: '#555' }}>
                  {selectedIds.size} / {allEmployees.length} selected
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-sm btn-outline" onClick={selectAll}>Select All</button>
                  <button className="btn btn-sm btn-outline" onClick={deselectAll}>Deselect All</button>
                </div>
              </div>

              <div
                className="emp-list"
                style={{ maxHeight: 380, overflowY: 'auto', gap: 6 }}
              >
                {allEmployees.map(emp => {
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
                        color: '#fff', fontSize: 13, fontWeight: 700,
                        transition: 'all 0.15s',
                      }}>
                        {active ? '✓' : ''}
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
                onChange={e => setConfig(c => ({ ...c, month: +e.target.value }))}>
                {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Year</label>
              <input type="number" className="form-input" value={config.year} min={2020} max={2030}
                onChange={e => setConfig(c => ({ ...c, year: +e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Cutoff</label>
              <select className="form-select" value={config.cutoff}
                onChange={e => setConfig(c => ({ ...c, cutoff: +e.target.value }))}>
                <option value={1}>1 – 15</option>
                <option value={16}>16 – 31</option>
              </select>
            </div>
          </div>
          <div className="alert alert-info">
            Period: <strong>{cutoffLabel(config.month, config.year, config.cutoff)}</strong>
            &nbsp;·&nbsp; {employees.length} employee(s) selected
          </div>
          <div className="btn-row">
            <button className="btn btn-secondary" onClick={() => setStep(1)}>← Back</button>
            <button className="btn btn-primary" onClick={proceedToStep3}>Next: Set Weekly Hours →</button>
          </div>
        </div>
      )}

      {/* ═══ STEP 3 — Weekly Hours ══════════════════════════════════════════ */}
      {step === 3 && (
        <div className="card">
          <div className="card-title">Step 3: Weekly Hours (Mon → Sun)</div>
          <div className="alert alert-info">
            Weeks are grouped <strong>Monday → Sunday</strong>. Set total working hours per week.
          </div>
          {weeks.map((w, i) => {
            const wStart = w[0].getDate();
            const wEnd = w[w.length - 1].getDate();
            const wd = workdaysInWeek(w);
            return (
              <div className="week-row" key={i}>
                <label>Week {i + 1}</label>
                <span className="week-dates">Days {wStart}–{wEnd} &nbsp;({wd} workday{wd !== 1 ? 's' : ''})</span>
                <input type="number" className="form-input" value={weekHours[i]} min={0} max={60}
                  style={{ width: 72 }}
                  onChange={e => setWeekHours(h => { const n = [...h]; n[i] = +e.target.value; return n; })} />
                <span style={{ fontSize: 12, color: '#555' }}>hrs/week</span>
                <span style={{ fontSize: 11, color: '#888' }}>
                  ({wd > 0 ? (weekHours[i] / wd).toFixed(1) : 0} hrs/day avg)
                </span>
              </div>
            );
          })}
          <div className="btn-row">
            <button className="btn btn-secondary" onClick={() => setStep(2)}>← Back</button>
            <button className="btn btn-primary" onClick={proceedToStep4}>Next: Enter Attendance →</button>
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
              return (
                <div
                  key={day}
                  className={`day-btn ${status}`}
                  onClick={() => status !== 'weekend' && toggleDay(empIdx, day)}
                >
                  {day}
                  <div style={{ fontSize: 9 }}>{DAY_NAMES[d.getDay()]}</div>
                  {status !== 'weekend' && (
                    <div style={{ fontSize: 8 }}>{status === 'present' ? '✓' : '✗'}</div>
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
              <button className="btn btn-success" onClick={finish} disabled={saving}>
                {saving ? '⏳ Generating…' : '✓ Finish & Generate DTRs'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}