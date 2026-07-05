import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getAllEmployees, getAllBatches } from '../db';
import { fetchDashboardStats } from '../hooks/useSync';
import { ShieldAlert, Users, Info, CalendarDays, Calendar, Check, X, ChevronLeft, ChevronRight } from 'lucide-react';

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function MemberDashboard({ isOnline }) {
  const { user, authFetch } = useAuth();
  const [myFunds, setMyFunds] = useState([]);    // all FundPayment rows for this employee
  const [myBatches, setMyBatches] = useState([]); // DTR batches that include this employee
  const [allEmployees, setAllEmployees] = useState([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);

  // Calendar State
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [calMonth, setCalMonth] = useState(new Date().getMonth() + 1);
  const [calYear, setCalYear] = useState(new Date().getFullYear());

  useEffect(() => { load(); }, [isOnline, year]);

  async function load() {
    setLoading(true);
    try {
      // Pull the full roster from local IndexedDB (read-only, no auth required locally)
      const emps = await getAllEmployees();
      setAllEmployees(emps);

      // Find this user's linked Employee record
      const bats = await getAllBatches();
      const myEmpId = user?.employee_id;
      if (myEmpId && bats.length) {
        const mine = bats.filter(b => (b.employees || []).some(e => e.id === myEmpId || e.serverId === myEmpId));
        setMyBatches(mine.sort((a, b) => b.createdAt - a.createdAt));
      }

      // Fetch fund payments for this year (read-only for Members)
      if (isOnline && myEmpId) {
        try {
          const res = await authFetch(`${API_BASE}/fund-payments/?year=${year}`);
          if (res.ok) {
            const data = await res.json();
            // Filter to only this employee's records
            setMyFunds(data.filter(p => p.employee === myEmpId));
          }
        } catch { /* offline fallback — no fund data */ }
      }
    } finally {
      setLoading(false);
    }
  }

  // Compute totals from myFunds
  const totalPaid = myFunds.reduce((s, p) => s + parseFloat(p.amount || 0), 0);
  const paidCutoffs = myFunds.filter(p => parseFloat(p.amount) >= 20).length;
  const partialCutoffs = myFunds.filter(p => parseFloat(p.amount) > 0 && parseFloat(p.amount) < 20).length;

  const name = user?.employee_name || user?.username || 'Member';
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  // Extract attendance from all available DTR batches
  const myAttendance = {};
  myBatches.forEach(b => {
    const me = (b.employees || []).find(e => 
      e.id === user?.employee_id || 
      e.serverId === user?.employee_id || 
      e.emp?.id === user?.employee_id || 
      e.emp?.serverId === user?.employee_id
    );
    if (me && me.rows) {
      me.rows.forEach(r => {
        const dateStr = `${b.year}-${String(b.month).padStart(2, '0')}-${String(r.day).padStart(2, '0')}`;
        myAttendance[dateStr] = r;
      });
    }
  });
  const totalPresent = Object.values(myAttendance).filter(r => r.status === 'present').length;

  function navigateMonth(dir) {
    let m = calMonth + dir;
    let y = calYear;
    if (m < 1) { m = 12; y--; }
    else if (m > 12) { m = 1; y++; }
    setCalMonth(m);
    setCalYear(y);
  }

  const firstDay = new Date(calYear, calMonth - 1, 1).getDay();
  const startOffset = firstDay === 0 ? 6 : firstDay - 1; // Mon=0, Sun=6
  const daysInMonth = new Date(calYear, calMonth, 0).getDate();
  const calGrid = [];
  for (let i = 0; i < startOffset; i++) calGrid.push(null);
  for (let d = 1; d <= daysInMonth; d++) calGrid.push(d);
  while (calGrid.length % 7 !== 0) calGrid.push(null);

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>

      {/* ── Welcome Hero ── */}
      <div style={{
        background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
        borderRadius: 16, padding: '28px 32px', marginBottom: 20,
        display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap',
        border: '1px solid rgba(99,102,241,0.2)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 24, fontWeight: 800, color: '#fff', flexShrink: 0,
          boxShadow: '0 4px 14px rgba(99,102,241,0.4)',
        }}>
          {initials}
        </div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9' }}>
            Welcome back, {name.split(' ')[0]}
          </div>
          <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 2 }}>
            {user?.role} · ASA DTR System
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 12, padding: '4px 12px', borderRadius: 20, fontWeight: 600,
            background: isOnline ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.12)',
            color: isOnline ? '#4ade80' : '#f87171',
            border: `1px solid ${isOnline ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
          }}>
            {isOnline ? '● Live' : '○ Offline'}
          </span>
        </div>
      </div>

      {/* ── Fund Summary Stats ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px,1fr))', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total Paid', value: `₱${totalPaid}`, color: '#22c55e', bg: 'rgba(34,197,94,0.1)', border: 'rgba(34,197,94,0.25)' },
          { label: 'Paid Cutoffs', value: paidCutoffs, color: '#6366f1', bg: 'rgba(99,102,241,0.1)', border: 'rgba(99,102,241,0.25)' },
          { label: 'Partial Payments', value: partialCutoffs, color: '#f97316', bg: 'rgba(249,115,22,0.1)', border: 'rgba(249,115,22,0.25)' },
          { label: 'DTR Records', value: myBatches.length, color: '#0ea5e9', bg: 'rgba(14,165,233,0.1)', border: 'rgba(14,165,233,0.25)' },
        ].map(s => (
          <div key={s.label} style={{
            background: s.bg, border: `1px solid ${s.border}`,
            borderRadius: 12, padding: '16px 18px',
          }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 4, fontWeight: 600 }}>{s.label} ({year})</div>
          </div>
        ))}
      </div>

      {/* ── Main Layout: 2 Columns ── */}
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        
        {/* Left Column: Fund Tracker */}
        <div style={{ flex: '1 1 500px' }}>
          {/* ── My Fund Tracker ── */}
          <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
          <div className="card-title" style={{ margin: 0 }}>💰 My Fund Contributions</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontWeight: 600, fontSize: 13 }}>Year:</label>
            <input type="number" className="form-input" value={year}
              onChange={e => setYear(+e.target.value)} style={{ width: 90, padding: '5px 10px' }} />
          </div>
        </div>

        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12, padding: '8px 12px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Info size={14} color="#6366f1" />
          <span>View-only — fund payments are managed by the treasurer. Contact your officers for corrections.</span>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 30, color: '#64748b' }}>Loading…</div>
        ) : myFunds.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 30, color: '#94a3b8', fontSize: 13 }}>
            No fund payment records found for {year}. {!isOnline && '(Offline — data may not be loaded)'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Month</th>
                  <th style={thStyle}>Cutoff</th>
                  <th style={thStyle}>Amount</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {myFunds.sort((a, b) => a.month - b.month || a.cutoff - b.cutoff).map(p => {
                  const amt = parseFloat(p.amount);
                  const isPaid = amt >= 20;
                  const isPartial = amt > 0 && !isPaid;
                  return (
                    <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={tdStyle}>{MONTH_NAMES[p.month] || `M${p.month}`}</td>
                      <td style={tdStyle}>{p.cutoff === 1 ? '1–15' : '16–End'}</td>
                      <td style={{ ...tdStyle, fontWeight: 700, color: isPaid ? '#16a34a' : isPartial ? '#ea580c' : '#94a3b8' }}>
                        ₱{amt}
                      </td>
                      <td style={tdStyle}>
                        <span style={{
                          padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                          background: isPaid ? '#dcfce7' : isPartial ? '#ffedd5' : '#f1f5f9',
                          color: isPaid ? '#166534' : isPartial ? '#9a3412' : '#64748b',
                        }}>
                          {isPaid ? '✓ Paid' : isPartial ? 'Partial' : 'Unpaid'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
          </div>
        </div>

        {/* Right Column: Calendar Widget */}
        <div style={{ width: 300, flexShrink: 0 }}>
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <CalendarDays size={18} /> My Attendance
            </div>
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 8, marginBottom: 16 }}>
              View your daily time records and attendance history based on generated DTRs.
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, fontSize: 13, padding: '10px 12px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Check size={14} color="#16a34a" /> Total Present</div>
              <div style={{ fontWeight: 700, color: '#166534' }}>{totalPresent} days</div>
            </div>

            <button 
              className="btn btn-primary" 
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              onClick={() => setShowCalendarModal(true)}
            >
              <Calendar size={16} /> Open Calendar Overlay
            </button>
          </div>
        </div>

      </div>

      {/* ── Calendar Modal Overlay ── */}
      {showCalendarModal && (
        <div className="modal-overlay" onClick={() => setShowCalendarModal(false)} style={{ padding: 20 }}>
          <div className="modal-content card" style={{ maxWidth: 700, width: '100%', margin: '0 auto', padding: 0, overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 16, fontWeight: 700, color: '#1e293b' }}>
                <CalendarDays size={20} color="#6366f1" /> My Attendance Calendar
              </div>
              <button onClick={() => setShowCalendarModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}>
                <X size={20} />
              </button>
            </div>
            
            <div style={{ padding: 24 }}>
              {/* Controls */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <button className="btn btn-sm btn-outline" onClick={() => navigateMonth(-1)} style={{ display: 'flex', alignItems: 'center', gap: 4 }}><ChevronLeft size={16} /> Prev</button>
                <div style={{ fontWeight: 800, fontSize: 18, color: '#1e293b' }}>{MONTH_NAMES[calMonth - 1]} {calYear}</div>
                <button className="btn btn-sm btn-outline" onClick={() => navigateMonth(1)} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Next <ChevronRight size={16} /></button>
              </div>

              {/* Grid Header */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, textAlign: 'center', marginBottom: 8 }}>
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
                  <div key={d} style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>{d}</div>
                ))}
              </div>

              {/* Grid Body */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
                {calGrid.map((d, i) => {
                  if (!d) return <div key={i} style={{ background: '#f8fafc', borderRadius: 8, minHeight: 70, border: '1px dashed #e2e8f0' }} />;
                  
                  const dateStr = `${calYear}-${String(calMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                  const row = myAttendance[dateStr];
                  let bg = '#fff', border = '1px solid #e2e8f0', color = '#334155';
                  let icon = null;

                  if (row) {
                    if (row.status === 'present') { bg = '#dcfce7'; border = '1px solid #86efac'; color = '#166534'; icon = <Check size={14} color="#16a34a" />; }
                    else if (row.status === 'absent') { bg = '#fee2e2'; border = '1px solid #fca5a5'; color = '#991b1b'; icon = <X size={14} color="#dc2626" />; }
                    else if (row.status === 'holiday') { bg = '#fef9c3'; border = '1px solid #fde047'; color = '#854d0e'; }
                    else if (row.status === 'weekend') { bg = '#f1f5f9'; border = '1px solid #cbd5e1'; color = '#64748b'; }
                  }

                  return (
                    <div key={i} style={{ 
                      background: bg, border, borderRadius: 8, minHeight: 74, padding: '6px 8px',
                      display: 'flex', flexDirection: 'column', transition: 'all 0.15s',
                      boxShadow: row?.status === 'present' ? '0 2px 4px rgba(34,197,94,0.1)' : 'none'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color }}>{d}</span>
                        {icon}
                      </div>
                      
                      {row && row.status === 'present' && (
                        <div style={{ fontSize: 9, color: '#15803d', marginTop: 'auto', textAlign: 'center', lineHeight: 1.3, fontWeight: 600, background: '#bbf7d0', padding: '2px 0', borderRadius: 4 }}>
                          {row.arrival || '—'} <br/> {row.departure || '—'}
                        </div>
                      )}
                      
                      {row && row.status === 'holiday' && (
                        <div style={{ fontSize: 10, color: '#a16207', marginTop: 'auto', textAlign: 'center', fontWeight: 700 }}>HOL</div>
                      )}
                    </div>
                  );
                })}
              </div>
              
              {/* Legend */}
              <div style={{ display: 'flex', gap: 16, marginTop: 24, padding: '12px', background: '#f8fafc', borderRadius: 8, fontSize: 12, fontWeight: 600, color: '#64748b', justifyContent: 'center', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 12, height: 12, background: '#dcfce7', border: '1px solid #86efac', borderRadius: 3 }}/> Present</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 12, height: 12, background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 3 }}/> Absent</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 12, height: 12, background: '#fef9c3', border: '1px solid #fde047', borderRadius: 3 }}/> Holiday</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 12, height: 12, background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 3 }}/> Weekend</div>
              </div>

            </div>
          </div>
        </div>
      )}

    </div >
  );
}

const thStyle = {
  padding: '8px 12px', textAlign: 'left', fontWeight: 700, fontSize: 12,
  color: '#64748b', background: '#f8fafc', borderBottom: '2px solid #e2e8f0',
};
const tdStyle = { padding: '10px 12px', color: '#334155' };
