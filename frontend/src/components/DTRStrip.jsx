import { MONTH_NAMES, daysInMonth } from '../utils/dateUtils';

/**
 * Single DTR strip — exact replication of Civil Service Form No. 48.
 * Three of these are placed side-by-side per employee page.
 *
 * Props:
 *  empData   { emp: {name, duty}, rows: [{day, status, arrival, departure, pmArrival, pmDeparture}] }
 *  batch     { month, year, cutoff }
 *  editable  boolean — renders <input> cells when true
 *  onChange  (newEmpData) => void — called when an editable cell changes
 */
export default function DTRStrip({ empData, batch, editable = false, onChange }) {
  const { month, year, cutoff } = batch;
  const monthLabel = `${MONTH_NAMES[month - 1]} ${cutoff === 1 ? '1-15' : '16-31'}, ${year}`;
  const start  = cutoff === 1 ? 1 : 16;
  const endDay = cutoff === 1 ? 15 : daysInMonth(year, month);

  const DAY_NAMES = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

  function updateCell(day, field, value) {
    if (!onChange) return;
    onChange({
      ...empData,
      rows: empData.rows.map(r => r.day === day ? { ...r, [field]: value } : r),
    });
  }

  // Build all day rows
  const rows = [];
  for (let day = start; day <= endDay; day++) {
    const row   = empData.rows.find(r => r.day === day) || { day, status: 'present' };
    const wknd  = row.status === 'weekend';
    const isSat = new Date(year, month - 1, day).getDay() === 6;

    const timeCell = (field, val) => (
      <td key={field}>
        {editable && !wknd ? (
          <input
            value={val || ''}
            onChange={e => updateCell(day, field, e.target.value)}
            style={{
              width: '100%', border: 'none', background: 'transparent',
              textAlign: 'center', fontSize: '6.5px', padding: '0 1px',
              fontFamily: 'Arial, sans-serif',
            }}
          />
        ) : (
          val || ''
        )}
      </td>
    );

    rows.push(
      <tr key={day}>
        <td className="dn">{day}</td>
        {wknd ? (
          <>
            <td className="wknd" colSpan={2}>{isSat ? 'SAT' : 'SUN'}</td>
            <td></td><td></td><td></td><td></td>
          </>
        ) : (
          <>
            {timeCell('arrival',    row.arrival    || '')}
            {timeCell('departure',  row.departure  || '')}
            {timeCell('pmArrival',  row.pmArrival  || '')}
            {timeCell('pmDeparture',row.pmDeparture|| '')}
            <td></td>
            <td></td>
          </>
        )}
      </tr>
    );
  }

  return (
    <div className="dtr-strip">

      {/* ── Header ─────────────────────────────── */}
      <div className="dtr-cs-form">Civil Service Form No. 48</div>
      <div className="dtr-h1">DAILY TIME RECORD</div>
      <div className="dtr-sep">-----o0o-----</div>

      {/* ── Name ──────────────────────────────── */}
      <div className="dtr-name">{empData.emp.name}</div>
      <div className="dtr-name-sub">(Name)</div>

      {/* ── Month ─────────────────────────────── */}
      <div className="dtr-month-row">
        <span>For the month of</span>
        <span className="dtr-month-val">{monthLabel}</span>
      </div>

      {/* ── Official hours ────────────────────── */}
      <div className="dtr-hours-row">
        <span className="dtr-hours-lbl">Official hours for<br/>arrival and departure</span>
        <div className="dtr-hours-fields">
          <div className="dtr-hours-field">
            <span>Regular days</span><span className="uline">&nbsp;</span>
          </div>
          <div className="dtr-hours-field">
            <span>Saturdays</span><span className="uline">&nbsp;</span>
          </div>
        </div>
      </div>

      {/* ── Time Table ───────────────────────── */}
      <table className="dtr-table">
        <thead>
          <tr>
            <th rowSpan={2}>Day</th>
            <th colSpan={2}>A.M.</th>
            <th colSpan={2}>P.M.</th>
            <th colSpan={2}>Undertime</th>
          </tr>
          <tr>
            <th>Arrival</th>
            <th>Depar-<br />ture</th>
            <th>Arrival</th>
            <th>Depar-<br />ture</th>
            <th>Hours</th>
            <th>Min-<br />utes</th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
        <tfoot>
          <tr>
            <td colSpan={1} className="total-label">Total</td>
            <td></td>
            <td></td>
          </tr>
        </tfoot>
      </table>

      {/* ── Certification ─────────────────────── */}
      <div className="dtr-cert">
        I certify on my honor that the above is a true and correct report
        of the hours of work performed, record of which was made daily
        at the time of arrival and departure from office.
      </div>

      {/* ── Employee Signature ────────────────── */}
      <div className="dtr-sig">{empData.emp.name}</div>

      {/* ── Verified by ───────────────────────── */}
      <div className="dtr-verified">
        <em>VERIFIED as to the prescribed office hours:</em>
      </div>

      {/* ── Administrator ─────────────────────── */}
      <div className="dtr-verifier">ALYSSA MARIE L. MIJARES</div>
      <div className="dtr-verifier-sub">Acting College Administrator</div>

    </div>
  );
}
