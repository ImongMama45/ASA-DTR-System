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
  const [employees, setEmployees] = useState([]);
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
      } catch (e) { /* use local */ }
    }
    setEmployees(await getAllEmployees());
  }

  // ---- Step 1 → 2 ----
  function proceedToStep2() {
    const dates = getDatesInCutoff(config.year, config.month, config.cutoff);
    const ws = getWeeks(dates);
    setWeeks(ws);
    setWeekHours(ws.map(w => workdaysInWeek(w))); // default: 1hr/workday * workdays
    // Init attendance
    const att = {};
    employees.forEach((e, ei) => {
      att[ei] = {};
      dates.forEach(d => {
        att[ei][d.getDate()] = isWeekend(d) ? 'weekend' : 'present';
      });
    });
    setAttendance(att);
    setEmpIdx(0);
    setStep(2);
  }

  // ---- Step 2 → 3 ----
  function proceedToStep3() {
    setStep(3);
  }

  // ---- Toggle day ----
  function toggleDay(ei, day) {
    setAttendance(prev => {
      const copy = { ...prev, [ei]: { ...prev[ei] } };
      copy[ei][day] = copy[ei][day] === 'present' ? 'absent' : 'present';
      return copy;
    });
  }

  // ---- Finish ----
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
        const dow = date.getDay();
        const wknd = isWeekend(date);
        const status = attendance[ei]?.[day] || (wknd ? 'weekend' : 'present');
        const wkIdx = getWeekIndex(date, weeks);
        const wkHrs = weekHours[wkIdx] || 0;
        const seed = ei * 97 + day * 37 + month * 13;
        const minHoursPerDay = wkHrs;
        const extraMins = (seed % 31) / 60;
        const hoursForThisDay = minHoursPerDay + extraMins;

        let times = { arrival: '', departure: '', pmArrival: '', pmDeparture: '' };
        if (wknd) {
          const label = isSaturday(date) ? 'SAT' : 'SUN';
          times = { arrival: label, departure: label, pmArrival: '', pmDeparture: '' };
        } else if (status === 'present' && minHoursPerDay > 0) {
          times = generateTime(emp.duty, hoursForThisDay, seed);
        }
        rows.push({ day, dow, status, ...times });
      }
      return { emp, rows };
    });

    const label = cutoffLabel(month, year, cutoff);
    const batchPayload = { label, month, year, cutoff, employees: empDTRs };

    if (isOnline) {
      try {
        await createServerBatch(batchPayload);
        // Re-seed local batches from server so the new batch appears everywhere
        const list = await fetchBatches();
        await seedBatches(list);
      } catch (e) {
        // Server unreachable — save locally and queue
        await saveBatch(batchPayload);
      }
    } else {
      await saveBatch(batchPayload);
    }

    setSaving(false);
    onDone();
  }

  const emp = employees[empIdx];
  const dates = weeks.flat();

  // ---- Render ----
  if (!employees.length) return (
    <div className="card">
      <div className="alert alert-warning">⚠ No employees found. Please add employees first before generating DTRs.</div>
    </div>
  );

  return (
    <div>
      <div className="wizard-steps">
        {['1. Period & Employees', '2. Weekly Hours', '3. Attendance'].map((s, i) => (
          <div key={i} className={`wizard-step ${step === i + 1 ? 'active' : step > i + 1 ? 'done' : ''}`}>{s}</div>
        ))}
      </div>

      {/* STEP 1 */}
      {step === 1 && (
        <div className="card">
          <div className="card-title">Step 1: Select Period</div>
          <div className="form-grid-3">
            <div className="form-group">
              <label className="form-label">Month</label>
              <select className="form-select" value={config.month} onChange={e => setConfig(c => ({ ...c, month: +e.target.value }))}>
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
              <select className="form-select" value={config.cutoff} onChange={e => setConfig(c => ({ ...c, cutoff: +e.target.value }))}>
                <option value={1}>1 – 15</option>
                <option value={16}>16 – 31</option>
              </select>
            </div>
          </div>
          <div className="alert alert-info">
            Period: <strong>{cutoffLabel(config.month, config.year, config.cutoff)}</strong>
            &nbsp;·&nbsp; {employees.length} employee(s) will be processed
          </div>
          <div className="btn-row">
            <button className="btn btn-primary" onClick={proceedToStep2}>
              Next: Set Weekly Hours →
            </button>
          </div>
        </div>
      )}

      {/* STEP 2 */}
      {step === 2 && (
        <div className="card">
          <div className="card-title">Step 2: Weekly Hours (Mon → Sun)</div>
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
            <button className="btn btn-secondary" onClick={() => setStep(1)}>← Back</button>
            <button className="btn btn-primary" onClick={proceedToStep3}>Next: Enter Attendance →</button>
          </div>
        </div>
      )}

      {/* STEP 3 */}
      {step === 3 && emp && (
        <div className="card">
          <div className="card-title">Step 3: Attendance Input</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
            <span><strong>{emp.name}</strong></span>
            <span>{empIdx + 1} / {employees.length}</span>
          </div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${((empIdx) / employees.length) * 100}%` }} />
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
            {empIdx > 0 && (
              <button className="btn btn-secondary" onClick={() => setEmpIdx(i => i - 1)}>← Prev</button>
            )}
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
