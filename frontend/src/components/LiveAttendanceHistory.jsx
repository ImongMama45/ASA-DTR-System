import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, Calendar, Eye, X } from 'lucide-react';

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
const PH_TZ = 'Asia/Manila';

const SCAN_TYPE_LABELS = {
  AM_ARRIVAL: 'AM In', AM_DEPARTURE: 'AM Out',
  PM_ARRIVAL: 'PM In', PM_DEPARTURE: 'PM Out',
};

function fmtTimePHT(iso) {
  if (!iso) return '--';
  return new Date(iso).toLocaleTimeString('en-PH', {
    timeZone: PH_TZ, hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function fmtDateLabel(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-PH', {
    timeZone: PH_TZ, weekday: 'short', month: 'short', day: 'numeric',
  });
}

function getDateRange(period, selectedDate) {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: PH_TZ }));
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (period === 'day') return { start: selectedDate, end: selectedDate };
  if (period === 'week') { const s = new Date(now); s.setDate(now.getDate() - 6); return { start: fmt(s), end: fmt(now) }; }
  if (period === 'month') { const s = new Date(now); s.setDate(now.getDate() - 29); return { start: fmt(s), end: fmt(now) }; }
  const s = new Date(now); s.setDate(now.getDate() - 364); return { start: fmt(s), end: fmt(now) };
}

export default function LiveAttendanceHistory({ period, selectedDate }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedEmployee, setExpandedEmployee] = useState(null);
  const [proofModal, setProofModal] = useState({ isOpen: false, imageUrl: null, adminNotes: null });

  useEffect(() => {
    const { start, end } = getDateRange(period, selectedDate);
    setLoading(true);
    setExpandedEmployee(null);
    const token = localStorage.getItem('access_token');
    fetch(`${API_BASE}/attendance/history/?start_date=${start}&end_date=${end}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.json())
      .then(data => { setRecords(data.records || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [period, selectedDate]);

  const byEmployee = {};
  records.forEach(r => {
    if (!byEmployee[r.employee]) byEmployee[r.employee] = { name: r.employee_name, scans: [] };
    byEmployee[r.employee].scans.push(r);
  });

  const buildDayLog = (scans) => {
    const m = {};
    scans.forEach(s => { m[s.scan_type] = s; });
    return m;
  };

  const th = { padding: '10px 16px', textAlign: 'left', fontWeight: 700, fontSize: 12, color: '#64748b' };
  const td = { padding: '10px 16px', color: '#334155', verticalAlign: 'middle' };

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Calendar size={18} color="#6366f1" />
        <span style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>Attendance History</span>
        <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 4 }}>
          {period === 'day' ? `for ${fmtDateLabel(selectedDate)}` :
           period === 'week' ? '— last 7 days' :
           period === 'month' ? '— last 30 days' : '— rolling 12 months'}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#94a3b8' }}>
          {Object.keys(byEmployee).length} employee(s) · {records.length} scans
        </span>
      </div>

      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>Loading...</div>
      ) : records.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>No records found for this period.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                <th style={th}>Employee</th>
                <th style={{ ...th, textAlign: 'center' }}>Scans</th>
                <th style={{ ...th, textAlign: 'center' }}>AM In</th>
                <th style={{ ...th, textAlign: 'center' }}>AM Out</th>
                <th style={{ ...th, textAlign: 'center' }}>PM In</th>
                <th style={{ ...th, textAlign: 'center' }}>PM Out</th>
                {period === 'day' && <th style={{ ...th, textAlign: 'center' }}>Details</th>}
              </tr>
            </thead>
            <tbody>
              {Object.entries(byEmployee).map(([eid, { name, scans }]) => {
                const dayLog = buildDayLog(scans);
                const isExpanded = expandedEmployee === eid;
                return (
                  <React.Fragment key={eid}>
                    <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={td}><span style={{ fontWeight: 600, color: '#1e293b' }}>{name}</span></td>
                      <td style={{ ...td, textAlign: 'center' }}>
                        <span style={{ background: '#eff6ff', color: '#1d4ed8', borderRadius: 12, padding: '2px 10px', fontWeight: 700, fontSize: 12 }}>{scans.length}</span>
                      </td>
                      {['AM_ARRIVAL', 'AM_DEPARTURE', 'PM_ARRIVAL', 'PM_DEPARTURE'].map(st => (
                        <td key={st} style={{ ...td, textAlign: 'center' }}>
                          {period === 'day'
                            ? <span style={{ color: dayLog[st] ? '#1e293b' : '#cbd5e1', fontWeight: dayLog[st] ? 600 : 400 }}>{dayLog[st] ? fmtTimePHT(dayLog[st].timestamp) : '--'}</span>
                            : <span style={{ color: '#64748b', fontSize: 12 }}>{scans.filter(s => s.scan_type === st).length || '--'}</span>}
                        </td>
                      ))}
                      {period === 'day' && (
                        <td style={{ ...td, textAlign: 'center' }}>
                          <button onClick={() => setExpandedEmployee(isExpanded ? null : eid)}
                            style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer', padding: '4px 10px', fontSize: 12, color: '#6366f1', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            {isExpanded ? <><ChevronUp size={14} /> Hide</> : <><ChevronDown size={14} /> Full log</>}
                          </button>
                        </td>
                      )}
                    </tr>
                    {isExpanded && period === 'day' && (
                      <tr key={`${eid}-exp`}>
                        <td colSpan={7} style={{ padding: '0 0 0 32px', background: '#f8fafc' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, margin: '8px 0' }}>
                            <thead>
                              <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                                <th style={{ ...th, fontSize: 11 }}>Scan Type</th>
                                <th style={{ ...th, fontSize: 11, textAlign: 'center' }}>Time (PHT)</th>
                                <th style={{ ...th, fontSize: 11, textAlign: 'center' }}>Source</th>
                                <th style={{ ...th, fontSize: 11 }}>Scanned By</th>
                              </tr>
                            </thead>
                            <tbody>
                              {scans.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)).map(s => (
                                <tr key={s.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                  <td style={td}>{SCAN_TYPE_LABELS[s.scan_type] || s.scan_type}</td>
                                  <td style={{ ...td, textAlign: 'center', fontWeight: 600 }}>{fmtTimePHT(s.timestamp)}</td>
                                  <td style={{ ...td, textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                                    <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700, background: s.source === 'MANUAL' ? '#ede9fe' : '#dcfce7', color: s.source === 'MANUAL' ? '#5b21b6' : '#166534' }}>{s.source}</span>
                                    {s.source === 'MANUAL' && (
                                      <button
                                        onClick={() => s.proof_image ? setProofModal({ isOpen: true, imageUrl: s.proof_image, adminNotes: s.admin_notes }) : alert('No proof image available.')}
                                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6366f1', padding: 0, display: 'flex' }}
                                        title={s.proof_image ? "View Proof" : "No image"}
                                      >
                                        <Eye size={14} />
                                      </button>
                                    )}
                                  </td>
                                  <td style={td}>{s.scanned_by_name || '--'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Proof Modal */}
      {proofModal.isOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#fff', padding: 24, borderRadius: 12, maxWidth: 500, width: '100%', position: 'relative' }}>
            <button
              onClick={() => setProofModal({ isOpen: false, imageUrl: null, adminNotes: null })}
              style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', cursor: 'pointer' }}
            >
              <X size={20} color="#64748b" />
            </button>
            <h3 style={{ marginTop: 0, marginBottom: 16, fontSize: 18, color: '#0f172a' }}>Manual Entry Proof</h3>
            
            {proofModal.imageUrl ? (
              <img src={proofModal.imageUrl} alt="Proof" style={{ width: '100%', borderRadius: 8, maxHeight: 400, objectFit: 'contain', background: '#f8fafc' }} />
            ) : (
              <div style={{ padding: 40, textAlign: 'center', background: '#f8fafc', borderRadius: 8, color: '#94a3b8' }}>
                No image provided
              </div>
            )}
            
            {proofModal.adminNotes && (
              <div style={{ marginTop: 16, padding: 12, background: '#f1f5f9', borderRadius: 8, fontSize: 13, color: '#334155' }}>
                <strong>Admin Notes:</strong><br />
                {proofModal.adminNotes}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
