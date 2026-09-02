import { useState, useEffect, Fragment } from 'react';
import { Users, ChevronLeft, ChevronRight, RefreshCw, ChevronDown, ChevronUp, Sun, Moon, Calendar, Info, Clock, UserX } from 'lucide-react';

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

const DAILY_STATUS_CONFIG = {
  blank:  { bg: 'transparent', color: '#cbd5e1', dot: 'transparent', label: '—' },
  ontime: { bg: '#f0fdf4', color: '#166534', dot: '#22c55e', label: 'On Time' },
  late:   { bg: '#fff7ed', color: '#9a3412', dot: '#f97316', label: 'Late' },
  absent: { bg: '#fef2f2', color: '#991b1b', dot: '#ef4444', label: 'Absent' },
};

// Lates thresholds: 0 → green, 1-2 → orange, 3+ → red
function lateStatusCfg(count) {
  if (count === 0) return { bg: '#f0fdf4', color: '#166534', dot: '#22c55e', label: 'Good' };
  if (count <= 2)  return { bg: '#fff7ed', color: '#9a3412', dot: '#f97316', label: 'Warning' };
  return { bg: '#fef2f2', color: '#991b1b', dot: '#ef4444', label: 'Critical' };
}

// Absences thresholds (stricter): 0 → green, 1 → orange, 2+ → red
function absentStatusCfg(count) {
  if (count === 0) return { bg: '#f0fdf4', color: '#166534', dot: '#22c55e', label: 'Good' };
  if (count === 1) return { bg: '#fff7ed', color: '#9a3412', dot: '#f97316', label: 'Warning' };
  return { bg: '#fef2f2', color: '#991b1b', dot: '#ef4444', label: 'Critical' };
}

export default function TardinessStatusCard() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState(getCurrentCutoff());
  const [expanded, setExpanded] = useState(true);
  const [expandedDetailsMap, setExpandedDetailsMap] = useState({});
  const [activeTab, setActiveTab] = useState('lates'); // 'lates' | 'absences'

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
  // Reset detail expansions when switching tabs
  useEffect(() => { setExpandedDetailsMap({}); }, [activeTab]);

  const counts = { blank: 0, ontime: 0, late: 0, absent: 0 };
  data.forEach(e => {
    if (e.daily_status && counts[e.daily_status] !== undefined) {
      counts[e.daily_status]++;
    } else if (!e.daily_status) {
      counts.blank++;
    }
  });

  const goNext = () => {
    if (!isCurrentCutoff(period.year, period.month, period.cutoff)) {
      setPeriod(nextCutoff(period.year, period.month, period.cutoff));
    }
  };

  const toggleDetail = (empId) => {
    setExpandedDetailsMap(prev => ({ ...prev, [empId]: !prev[empId] }));
  };

  const amDuty = data.filter(e => e.duty === 'AM');
  const pmDuty = data.filter(e => e.duty === 'PM');

  const renderScheduleTable = (list, title, icon, timeLabel) => {
    const isAbsences = activeTab === 'absences';

    return (
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

        {list.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>No employees in this duty schedule.</div>
        ) : (
          <div style={{ maxHeight: 280, overflowY: 'auto', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={th}>Employee</th>
                  {isAbsences ? (
                    <th style={{ ...th, textAlign: 'center' }}>Absences</th>
                  ) : (
                    <>
                      <th style={{ ...th, textAlign: 'center' }}>Lates</th>
                      <th style={{ ...th, textAlign: 'center' }}>Total</th>
                    </>
                  )}
                  <th style={{ ...th, textAlign: 'center' }}>Status</th>
                  <th style={{ ...th, textAlign: 'center' }}>Details</th>
                </tr>
              </thead>
              <tbody>
                {list.map(e => {
                  const isDetailOpen = !!expandedDetailsMap[e.employee_id];
                  const dCfg = DAILY_STATUS_CONFIG[e.daily_status] || DAILY_STATUS_CONFIG.blank;

                  if (isAbsences) {
                    const sCfg = absentStatusCfg(e.absent_count ?? 0);
                    const hasAbsences = (e.absent_count ?? 0) > 0;

                    return (
                      <Fragment key={e.employee_id}>
                        <tr style={{ borderBottom: '1px solid #f1f5f9' }} className="tardiness-row">
                          <td style={td}>
                            <span style={{ fontWeight: 600, color: '#1e293b' }}>{e.name}</span>
                          </td>
                          <td style={{ ...td, textAlign: 'center', fontWeight: 700, color: (e.absent_count ?? 0) > 0 ? '#dc2626' : '#64748b' }}>
                            {e.absent_count ?? 0}
                          </td>
                          <td style={{ ...td, textAlign: 'center' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 10, background: sCfg.bg, color: sCfg.color, fontSize: 11, fontWeight: 700 }}>
                              {sCfg.dot !== 'transparent' && (
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: sCfg.dot, display: 'inline-block' }} />
                              )}
                              {sCfg.label}
                            </span>
                          </td>
                          <td style={{ ...td, textAlign: 'center' }}>
                            {hasAbsences ? (
                              <button
                                onClick={() => toggleDetail(e.employee_id)}
                                style={{
                                  background: isDetailOpen ? '#fef2f2' : '#f8fafc',
                                  border: `1px solid ${isDetailOpen ? '#fca5a5' : '#cbd5e1'}`,
                                  color: isDetailOpen ? '#991b1b' : '#475569',
                                  borderRadius: 6, padding: '2px 6px', fontSize: 10, fontWeight: 700,
                                  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3, transition: 'all 0.15s'
                                }}
                              >
                                Details {isDetailOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                              </button>
                            ) : (
                              <span style={{ color: '#cbd5e1', fontSize: 11 }}>—</span>
                            )}
                          </td>
                        </tr>
                        {isDetailOpen && hasAbsences && (
                          <tr style={{ background: '#fef2f2' }}>
                            <td colSpan={4} style={{ padding: '8px 12px', fontSize: 11, borderBottom: '1px solid #fecaca' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: '#991b1b', marginBottom: 4 }}>
                                <UserX size={13} color="#ef4444" /> Absent Days:
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginLeft: 18 }}>
                                {(e.absent_details ?? []).map((dateStr, idx) => (
                                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#7f1d1d' }}>
                                    <Calendar size={12} color="#ef4444" />
                                    <span><strong>{dateStr}</strong></span>
                                    <span style={{ color: '#991b1b', background: '#fee2e2', border: '1px solid #fecaca', padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600 }}>
                                      No arrival scan
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  }

                  // --- Lates tab ---
                  const sCfg = lateStatusCfg(e.late_count ?? 0);
                  const hasLates = (e.late_count ?? 0) > 0 || (e.late_details && e.late_details.length > 0);

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
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 10, background: dCfg.bg, color: dCfg.color, fontSize: 11, fontWeight: 700 }}>
                            {dCfg.dot !== 'transparent' && (
                              <span style={{ width: 6, height: 6, borderRadius: '50%', background: dCfg.dot, display: 'inline-block' }} />
                            )}
                            {dCfg.label}
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
                                borderRadius: 6, padding: '2px 6px', fontSize: 10, fontWeight: 700,
                                cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3, transition: 'all 0.15s'
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
  };

  return (
    <div className="card" style={{ marginBottom: 20, padding: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: '12px 16px',
          background: 'linear-gradient(135deg, #1e293b, #334155)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
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
            {Object.entries(DAILY_STATUS_CONFIG).map(([s, cfg]) => {
              if (s === 'blank') return null;
              return (
                <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 10, background: 'rgba(255,255,255,0.1)', color: '#f8fafc', fontSize: 11, fontWeight: 600 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: cfg.dot, display: 'inline-block' }} />
                  {counts[s]}
                </span>
              );
            })}
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

      {/* Body */}
      {expanded && (
        <div style={{ padding: 12, background: '#fafafa' }}>
          {/* Cutoff Selector Bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, padding: '4px 8px', background: '#fff', borderRadius: 6, border: '1px solid #e2e8f0' }}>
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

          {/* Tab Selector */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 12, background: '#f1f5f9', borderRadius: 8, padding: 4 }}>
            <button
              onClick={() => setActiveTab('lates')}
              style={{
                flex: 1, padding: '6px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6,
                border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                background: activeTab === 'lates' ? '#fff' : 'transparent',
                color: activeTab === 'lates' ? '#f97316' : '#64748b',
                boxShadow: activeTab === 'lates' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              <Clock size={13} /> Tardiness (Lates)
            </button>
            <button
              onClick={() => setActiveTab('absences')}
              style={{
                flex: 1, padding: '6px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6,
                border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                background: activeTab === 'absences' ? '#fff' : 'transparent',
                color: activeTab === 'absences' ? '#ef4444' : '#64748b',
                boxShadow: activeTab === 'absences' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              <UserX size={13} /> Absences
            </button>
          </div>

          {loading ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>Loading records...</div>
          ) : data.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>No data for this cutoff.</div>
          ) : (
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
