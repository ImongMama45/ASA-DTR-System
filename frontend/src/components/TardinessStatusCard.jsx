import { useState, useEffect, Fragment } from 'react';
import { AlertTriangle, Clock, Users, ChevronLeft, ChevronRight, RefreshCw, ChevronDown, ChevronUp, Sun, Moon, Calendar, Info } from 'lucide-react';

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
const PH_TZ = 'Asia/Manila';

function getCurrentCutoff() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: PH_TZ }));
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    cutoff: now.getDate() <= 15 ? 1 : 2,
  };
}

function cutoffLabel(year, month, cutoff) {
  const monthName = new Date(year, month - 1, 1).toLocaleString('en-PH', { month: 'long' });
  const days = cutoff === 1 ? '1–15' : '16–31';
  return `${monthName} ${year} (${days})`;
}

function prevCutoff(year, month, cutoff) {
  if (cutoff === 2) return { year, month, cutoff: 1 };
  if (month === 1) return { year: year - 1, month: 12, cutoff: 2 };
  return { year, month: month - 1, cutoff: 2 };
}

function nextCutoff(year, month, cutoff) {
  if (cutoff === 1) return { year, month, cutoff: 2 };
  if (month === 12) return { year: year + 1, month: 1, cutoff: 1 };
  return { year, month: month + 1, cutoff: 1 };
}

function isCurrentCutoff(year, month, cutoff) {
  const cur = getCurrentCutoff();
  return cur.year === year && cur.month === month && cur.cutoff === cutoff;
}

const STATUS_CONFIG = {
  green:  { bg: '#f0fdf4', color: '#166534', dot: '#22c55e', label: 'On Time' },
  orange: { bg: '#fff7ed', color: '#9a3412', dot: '#f97316', label: 'Warning' },
  red:    { bg: '#fef2f2', color: '#991b1b', dot: '#ef4444', label: 'Critical' },
};

export default function TardinessStatusCard() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState(getCurrentCutoff());
  const [expanded, setExpanded] = useState(true);
  const [expandedDetailsMap, setExpandedDetailsMap] = useState({});

  const isCurrent = isCurrentCutoff(period.year, period.month, period.cutoff);

  function fetchData(p) {
    setLoading(true);
    const token = localStorage.getItem('access_token');
    fetch(`${API_BASE}/attendance/tardiness/?year=${p.year}&month=${p.month}&cutoff=${p.cutoff}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.json())
      .then(d => { setData(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }

  useEffect(() => { fetchData(period); }, [period]);

  const counts = { green: 0, orange: 0, red: 0 };
  data.forEach(e => { if (counts[e.status] !== undefined) counts[e.status]++; });

  const goNext = () => {
    const n = nextCutoff(period.year, period.month, period.cutoff);
    if (!isCurrentCutoff(period.year, period.month, period.cutoff)) setPeriod(n);
  };

  const toggleDetail = (empId) => {
    setExpandedDetailsMap(prev => ({
      ...prev,
      [empId]: !prev[empId]
    }));
  };

  const amDuty = data.filter(e => e.duty === 'AM');
  const pmDuty = data.filter(e => e.duty === 'PM');

  const renderScheduleTable = (list, title, icon, timeLabel) => (
    <div style={{ flex: 1, minWidth: 290, background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
      {/* Sub-header */}
      <div style={{
        padding: '8px 12px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, color: '#334155'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {icon}
          <span>{title}</span>
          <span style={{ fontSize: 10, background: '#e2e8f0', color: '#475569', padding: '1px 6px', borderRadius: 8, fontWeight: 600 }}>{timeLabel}</span>
        </div>
        <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>
          {list.length} employee{list.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table Content */}
      {list.length === 0 ? (
        <div style={{ padding: 16, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>No employees in this duty schedule.</div>
      ) : (
        <div style={{ maxHeight: 240, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
                <th style={th}>Employee</th>
                <th style={{ ...th, textAlign: 'center' }}>Lates</th>
                <th style={{ ...th, textAlign: 'center' }}>Total</th>
                <th style={{ ...th, textAlign: 'center' }}>Status</th>
                <th style={{ ...th, textAlign: 'center' }}>Details</th>
              </tr>
            </thead>
            <tbody>
              {list.map(e => {
                const cfg = STATUS_CONFIG[e.status] || STATUS_CONFIG.green;
                const isDetailOpen = !!expandedDetailsMap[e.employee_id];
                const hasLates = e.late_count > 0 || (e.late_details && e.late_details.length > 0);

                return (
                  <Fragment key={e.employee_id}>
                    <tr style={{ borderBottom: '1px solid #f1f5f9' }} className="tardiness-row">
                      <td style={td}>
                      <span style={{ fontWeight: 600, color: '#1e293b' }}>{e.name}</span>
                    </td>
                    <td style={{ ...td, textAlign: 'center', fontWeight: 700, color: e.late_count > 0 ? '#dc2626' : '#64748b' }}>
                      {e.late_count}
                    </td>
                    <td style={{ ...td, textAlign: 'center', color: '#64748b', fontSize: 11 }}>
                      {e.minutes_late_total > 0 ? `${e.minutes_late_total}m` : '--'}
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 10, background: cfg.bg, color: cfg.color, fontSize: 11, fontWeight: 700 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.dot, display: 'inline-block' }} />
                        {cfg.label}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      {hasLates ? (
                        <button
                          onClick={() => toggleDetail(e.employee_id)}
                          style={{
                            background: isDetailOpen ? '#fff7ed' : '#f8fafc',
                            border: `1px solid ${isDetailOpen ? '#fdba74' : '#cbd5e1'}`,
                            color: isDetailOpen ? '#c2410c' : '#475569',
                            borderRadius: 6,
                            padding: '2px 6px',
                            fontSize: 10,
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 3,
                            transition: 'all 0.15s'
                          }}
                        >
                          Details {isDetailOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </button>
                      ) : (
                        <span style={{ color: '#cbd5e1', fontSize: 11 }}>—</span>
                      )}
                    </td>
                  </tr>
                  {isDetailOpen && hasLates && (
                    <tr style={{ background: '#fffbeb' }}>
                      <td colSpan={5} style={{ padding: '8px 12px', fontSize: 11, borderBottom: '1px solid #fef3c7' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: '#b45309', marginBottom: 4 }}>
                          <Info size={13} color="#d97706" /> Late Arrival Logs:
                        </div>
                        {e.late_details && e.late_details.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginLeft: 18 }}>
                            {e.late_details.map((d, idx) => (
                              <div key={d.id || idx} style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#78350f' }}>
                                <Calendar size={12} color="#d97706" />
                                <span><strong>{d.date}</strong> at <strong>{d.time}</strong></span>
                                <span style={{ color: '#92400e', background: '#fef3c7', border: '1px solid #fde68a', padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600 }}>
                                  {d.reason}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div style={{ marginLeft: 18, color: '#92400e', fontStyle: 'italic' }}>
                            {e.late_count} late arrival(s) recorded for this cutoff.
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <div className="card" style={{ marginBottom: 20, padding: 0, overflow: 'hidden' }}>
      {/* Header — Click to collapse/expand */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: '12px 16px',
          background: 'linear-gradient(135deg, #1e293b, #334155)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justify: 'space-between',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Users size={16} color="#818cf8" />
          <span style={{ fontWeight: 700, fontSize: 14 }}>Tardiness Status</span>
          <span style={{ fontSize: 11, opacity: 0.75 }}>— {cutoffLabel(period.year, period.month, period.cutoff)}</span>

          {/* Quick summary status dots */}
          <div style={{ display: 'flex', gap: 6, marginLeft: 8 }} onClick={e => e.stopPropagation()}>
            {Object.entries(STATUS_CONFIG).map(([s, cfg]) => (
              <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 10, background: 'rgba(255,255,255,0.1)', color: '#f8fafc', fontSize: 11, fontWeight: 600 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: cfg.dot, display: 'inline-block' }} />
                {counts[s]}
              </span>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} onClick={e => e.stopPropagation()}>
          <button
            onClick={() => fetchData(period)}
            title="Refresh"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center', padding: 2 }}
          >
            <RefreshCw size={13} />
          </button>
          <div onClick={() => setExpanded(!expanded)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            <ChevronDown size={18} style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', color: '#cbd5e1' }} />
          </div>
        </div>
      </div>

      {/* Body — rendered when expanded */}
      {expanded && (
        <div style={{ padding: 12, background: '#fafafa' }}>
          {/* Cutoff Selector Bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, padding: '4px 8px', background: '#fff', borderRadius: 6, border: '1px solid #e2e8f0' }}>
            <button
              onClick={() => setPeriod(prevCutoff(period.year, period.month, period.cutoff))}
              style={{ background: 'none', border: 'none', borderRadius: 4, cursor: 'pointer', padding: '2px 6px', display: 'flex', alignItems: 'center', color: '#64748b' }}>
              <ChevronLeft size={14} /> <span style={{ fontSize: 11, marginLeft: 2 }}>Prev Cutoff</span>
            </button>

            <span style={{ fontSize: 11, color: '#334155', fontWeight: 700 }}>
              {cutoffLabel(period.year, period.month, period.cutoff)}
              {isCurrent && <span style={{ marginLeft: 6, fontSize: 9, background: '#eff6ff', color: '#1d4ed8', borderRadius: 6, padding: '1px 5px', fontWeight: 700 }}>CURRENT</span>}
            </span>

            <button
              onClick={goNext}
              disabled={isCurrent}
              style={{ background: 'none', border: 'none', borderRadius: 4, cursor: isCurrent ? 'not-allowed' : 'pointer', padding: '2px 6px', display: 'flex', alignItems: 'center', color: isCurrent ? '#cbd5e1' : '#64748b', opacity: isCurrent ? 0.5 : 1 }}>
              <span style={{ fontSize: 11, marginRight: 2 }}>Next Cutoff</span> <ChevronRight size={14} />
            </button>
          </div>

          {loading ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>Loading tardiness records...</div>
          ) : data.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>No data for this cutoff.</div>
          ) : (
            /* Grouped 2 Schedules Side-by-Side Grid */
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {renderScheduleTable(amDuty, 'AM Duty Schedule', <Sun size={14} color="#d97706" />, '8:00 AM')}
              {renderScheduleTable(pmDuty, 'PM Duty Schedule', <Moon size={14} color="#2563eb" />, '1:00 PM')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const th = { padding: '6px 10px', textAlign: 'left', fontWeight: 700, fontSize: 11, color: '#64748b' };
const td = { padding: '6px 10px', color: '#334155', verticalAlign: 'middle' };
