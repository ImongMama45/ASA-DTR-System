import React, { useState, useEffect, useCallback } from 'react';
import { getAllEmployees } from '../db';

// Mirrors the pattern in useSync.js — VITE_API_URL already contains /api
const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function getCutoffDate(yr, monthIndex, cutoffType) {
  const day = cutoffType === 1 ? 15 : new Date(yr, monthIndex + 1, 0).getDate();
  return new Date(yr, monthIndex, day);
}

function isBeforeStart(empStartStr, yr, monthIndex, cutoffType) {
  if (!empStartStr) return false;
  const startD = new Date(empStartStr);
  const cutoffD = getCutoffDate(yr, monthIndex, cutoffType);
  return startD > cutoffD;
}

function isAfterEnd(empEndStr, yr, monthIndex, cutoffType) {
  if (!empEndStr) return false;
  const endD = new Date(empEndStr);
  const cutoffStart = cutoffType === 1 ? new Date(yr, monthIndex, 1) : new Date(yr, monthIndex, 16);
  return endD < cutoffStart;
}

function getFormattedDate() {
  const d = new Date();
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`;
}

export default function FundTracker({ isOnline }) {
  const [employees, setEmployees] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [payments, setPayments] = useState({}); // key: empServerId-year-month-cutoff -> { amount, modified_at }
  const [isEditing, setIsEditing] = useState(false);
  const [viewFilter, setViewFilter] = useState('active'); // 'active' | 'archived' | 'all'
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const emps = await getAllEmployees();
      setEmployees(emps);

      if (isOnline) {
        const res = await fetch(`${API_BASE}/fund-payments/?year=${year}`);
        if (res.ok) {
          const data = await res.json();
          const map = {};
          data.forEach(p => {
            // p.employee is the server PK integer, which equals emp.id in local IndexedDB
            const key = `${p.employee}-${p.year}-${p.month}-${p.cutoff}`;
            map[key] = { amount: parseFloat(p.amount), date: p.modified_at ? p.modified_at.slice(0, 10) : '' };
          });
          setPayments(map);
          return;
        }
      }
      // Offline fallback — localStorage
      const saved = localStorage.getItem(`fundPayments-${year}`);
      if (saved) {
        setPayments(JSON.parse(saved));
      }
    } finally {
      setLoading(false);
    }
  }, [year, isOnline]);

  useEffect(() => { load(); }, [load]);

  async function savePayment(emp, monthIndex, cutoff, amount) {
    const key = `${emp.id}-${year}-${monthIndex}-${cutoff}`;
    const dateStr = getFormattedDate();
    const newVal = { amount, date: dateStr };

    setPayments(prev => {
      const next = { ...prev, [key]: newVal };
      localStorage.setItem(`fundPayments-${year}`, JSON.stringify(next));
      return next;
    });

    if (isOnline && emp.id) {
      setSaving(true);
      try {
        await fetch(`${API_BASE}/fund-payments/upsert/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            employee_id: emp.id,
            year,
            month: monthIndex,
            cutoff,
            amount,
          }),
        });
      } catch (e) {
        console.warn('Fund save failed, stored locally.', e);
      } finally {
        setSaving(false);
      }
    }
  }

  function togglePayment(emp, monthIndex, cutoff) {
    if (!isEditing) return;
    const key = `${emp.id}-${year}-${monthIndex}-${cutoff}`;
    const current = payments[key]?.amount ?? 0;
    let next;
    if (current === 0) next = 20;
    else if (current >= 20) next = 10;
    else next = 0;
    savePayment(emp, monthIndex, cutoff, next);
  }

  function updatePartial(emp, monthIndex, cutoff, amount) {
    savePayment(emp, monthIndex, cutoff, Number(amount));
  }

  function getCellStatus(emp, monthIndex, cutoffType) {
    if (isBeforeStart(emp.start, year, monthIndex, cutoffType)) return 'grey';
    if (isAfterEnd(emp.end_date, year, monthIndex, cutoffType)) return 'grey';
    const key = `${emp.id}-${year}-${monthIndex}-${cutoffType}`;
    const obj = payments[key];
    const val = obj ? obj.amount : 0;
    if (val >= 20) return 'paid';
    if (val > 0) return 'incomplete';
    const cutoffDate = getCutoffDate(year, monthIndex, cutoffType);
    const now = new Date(); now.setHours(0, 0, 0, 0);
    if (cutoffDate > now) return 'future';
    return 'unpaid';
  }

  function getEmployeeTotals(emp) {
    let totalPaid = 0, totalUnpaid = 0;
    const now = new Date(); now.setHours(0, 0, 0, 0);
    for (let m = 0; m < 12; m++) {
      for (const c of [1, 16]) {
        const s = getCellStatus(emp, m, c);
        if (s === 'grey' || s === 'future') continue;
        const key = `${emp.id}-${year}-${m}-${c}`;
        const val = payments[key]?.amount ?? 0;
        totalPaid += val;
        totalUnpaid += Math.max(0, 20 - val);
      }
    }
    return { totalPaid, totalUnpaid };
  }

  const visibleEmployees = employees.filter(emp => {
    const matchFilter =
      viewFilter === 'all' ||
      (viewFilter === 'active' && emp.is_active !== false) ||
      (viewFilter === 'archived' && emp.is_active === false);
    const matchSearch = emp.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchFilter && matchSearch;
  });

  const grandTotalPaid = visibleEmployees.reduce((sum, emp) => sum + getEmployeeTotals(emp).totalPaid, 0);

  const STATUS_COLORS = {
    grey: '#e2e8f0', future: '#f8fafc', paid: '#22c55e', incomplete: '#f97316', unpaid: '#ef4444',
  };
  const EDIT_BG = {
    grey: '#f1f5f9', future: '#f8fafc', paid: '#dcfce7', incomplete: '#ffedd5', unpaid: '#fff',
  };

  function renderEditContent(status, cType, emp, monthIndex) {
    if (status === 'grey') return <span style={{ color: '#cbd5e1' }}>—</span>;
    if (status === 'future') return <span style={{ color: '#94a3b8', fontSize: 11 }}>Not Due</span>;
    const key = `${emp.id}-${year}-${monthIndex}-${cType}`;
    const obj = payments[key] || {};
    const val = obj.amount ?? 0;
    const dateStr = obj.date || '';
    const dateDiv = dateStr ? <div style={{ fontSize: 9, color: '#64748b', marginTop: 4 }}>{dateStr}</div> : null;

    if (status === 'paid') return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <span style={{ background: '#22c55e', color: '#fff', padding: '3px 8px', borderRadius: 12, fontSize: 11, fontWeight: 'bold' }}>✓ ₱20</span>
        {dateDiv}
      </div>
    );
    if (status === 'incomplete') return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ fontSize: 11, fontWeight: 'bold', color: '#ea580c' }}>₱</span>
          <input
            type="number" value={val}
            onChange={e => updatePartial(emp, monthIndex, cType, e.target.value)}
            style={{ width: 38, padding: '2px 4px', fontSize: 11, textAlign: 'center', border: '1px solid #fdba74', borderRadius: 4, background: '#fff', color: '#ea580c', fontWeight: 'bold' }}
          />
        </div>
        {dateDiv}
      </div>
    );
    return <span style={{ color: '#cbd5e1' }}>·</span>;
  }

  return (
    <div>
      <div className="card">
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div className="card-title" style={{ margin: 0 }}>💰 SA Fund Tracker</div>
            <div style={{ fontSize: 15, fontWeight: 'bold', color: '#166534', background: '#dcfce7', padding: '6px 14px', borderRadius: 8, border: '1px solid #bbf7d0' }}>
              Total Collected ({year}): ₱{grandTotalPaid}
            </div>
            {saving && <span style={{ fontSize: 12, color: '#64748b' }}>💾 Saving…</span>}
            {!isOnline && <span style={{ fontSize: 12, color: '#b45309', background: '#fef3c7', padding: '4px 10px', borderRadius: 6 }}>⚠ Offline — changes saved locally</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button className={`btn ${isEditing ? 'btn-success' : 'btn-outline'}`} onClick={() => setIsEditing(!isEditing)}>
              {isEditing ? '✓ Done Editing' : '✏️ Edit Mode'}
            </button>
            <input type="text" className="form-input" placeholder="🔍 Search SA Name…" value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)} style={{ width: 200, padding: '6px 12px' }} />
            <label style={{ fontWeight: 600 }}>Year:</label>
            <input type="number" className="form-input" value={year}
              onChange={e => setYear(+e.target.value)} style={{ width: 100, padding: '6px 12px' }} />
          </div>
        </div>

        {/* View Filter */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {[['active', '✅ Active SAs'], ['archived', '📦 Archived SAs'], ['all', '👥 All']].map(([val, label]) => (
            <button key={val} onClick={() => setViewFilter(val)}
              style={{ padding: '6px 14px', borderRadius: 20, border: '1px solid #e2e8f0', cursor: 'pointer', fontWeight: viewFilter === val ? 700 : 400, background: viewFilter === val ? '#1e293b' : '#f8fafc', color: viewFilter === val ? '#fff' : '#64748b', fontSize: 13 }}>
              {label}
            </button>
          ))}
        </div>

        {/* Info Banner */}
        <div className={`alert ${isEditing ? 'alert-warning' : 'alert-info'}`} style={{ marginBottom: 12 }}>
          {isEditing
            ? 'Edit Mode: Click a cell to cycle Unpaid → Paid (₱20) → Incomplete. Type a partial amount in orange cells.'
            : 'View Mode: Green = Paid, Orange = Partial, Red = Unpaid, Grey = Not employed this period, White = Not due yet.'}
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          {[['#22c55e', 'Paid'], ['#f97316', 'Partial'], ['#ef4444', 'Unpaid'], ['#e2e8f0', 'Not Employed'], ['#f8fafc', 'Not Due Yet']].map(([color, label]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <div style={{ width: 14, height: 14, borderRadius: 3, background: color, border: '1px solid #e2e8f0' }} />
              {label}
            </div>
          ))}
        </div>

        {/* Table */}
        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 300px)', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: '0.875rem', background: '#fff' }}>
            <thead>
              <tr>
                <th style={{ position: 'sticky', top: 0, left: 0, zIndex: 3, background: '#f8fafc', borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0', boxShadow: '4px 0 8px rgba(0,0,0,0.05)', padding: '16px', minWidth: 220, textAlign: 'left', fontWeight: 700, color: '#334155' }}>
                  SA Name
                </th>
                <th style={{ position: 'sticky', top: 0, zIndex: 2, background: '#f8fafc', borderLeft: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0', padding: '12px 10px', minWidth: 90, textAlign: 'center', fontWeight: 600, color: '#334155', whiteSpace: 'nowrap' }}>
                  Paid
                </th>
                <th style={{ position: 'sticky', top: 0, zIndex: 2, background: '#f8fafc', borderLeft: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0', padding: '12px 10px', minWidth: 90, textAlign: 'center', fontWeight: 600, color: '#334155', whiteSpace: 'nowrap' }}>
                  Unpaid
                </th>
                {MONTH_NAMES.map((m, i) => {
                  const endDay = new Date(year, i + 1, 0).getDate();
                  const bg = i % 2 === 0 ? '#f8fafc' : '#fff';
                  const short = m.slice(0, 3);
                  return (
                    <React.Fragment key={`th-${i}`}>
                      <th style={{ position: 'sticky', top: 0, zIndex: 2, textAlign: 'center', borderLeft: '2px solid #cbd5e1', borderBottom: '1px solid #e2e8f0', background: bg, padding: '10px 8px', color: '#334155', minWidth: 68 }}>
                        <div style={{ fontWeight: 700, fontSize: 12 }}>{short}</div>
                        <div style={{ color: '#64748b', fontWeight: 400, fontSize: 11 }}>1–15</div>
                      </th>
                      <th style={{ position: 'sticky', top: 0, zIndex: 2, textAlign: 'center', borderBottom: '1px solid #e2e8f0', background: bg, padding: '10px 8px', color: '#334155', minWidth: 68 }}>
                        <div style={{ fontWeight: 700, fontSize: 12 }}>{short}</div>
                        <div style={{ color: '#64748b', fontWeight: 400, fontSize: 11 }}>16–{endDay}</div>
                      </th>
                    </React.Fragment>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={27} style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>Loading…</td></tr>
              ) : visibleEmployees.length === 0 ? (
                <tr><td colSpan={27} style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>No employees found.</td></tr>
              ) : (
                visibleEmployees.map(emp => {
                  const { totalPaid, totalUnpaid } = getEmployeeTotals(emp);
                  const isArchived = emp.is_active === false;
                  return (
                    <tr key={emp.id} style={{ opacity: isArchived ? 0.75 : 1 }}>
                      {/* Name + totals */}
                      <td style={{ position: 'sticky', left: 0, zIndex: 1, background: '#fff', fontWeight: 600, borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0', boxShadow: '4px 0 8px rgba(0,0,0,0.05)', padding: '10px 14px', color: '#1e293b', minWidth: 220 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {isArchived && <span style={{ fontSize: 10, background: '#f1f5f9', color: '#64748b', padding: '1px 6px', borderRadius: 4 }}>Archived</span>}
                            <span>{emp.name}</span>
                          </div>
                          {emp.end_date && <div style={{ fontSize: 10, color: '#94a3b8' }}>Left: {emp.end_date}</div>}
                        </div>
                      </td>
                      {/* Summary totals */}
                      <td style={{ borderLeft: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0', textAlign: 'center', padding: '8px', background: '#f0fdf4', color: '#166534', fontWeight: 700, fontSize: 13 }}>
                        ₱{totalPaid}
                      </td>
                      <td style={{ borderLeft: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0', textAlign: 'center', padding: '8px', background: totalUnpaid > 0 ? '#fef2f2' : '#f0fdf4', color: totalUnpaid > 0 ? '#991b1b' : '#166534', fontWeight: 700, fontSize: 13 }}>
                        ₱{totalUnpaid}
                      </td>
                      {/* Month cells */}
                      {MONTH_NAMES.map((m, monthIndex) => {
                        const isEvenMonth = monthIndex % 2 === 0;
                        const baseBg = isEvenMonth ? '#f8fafc' : '#fff';
                        const status1 = getCellStatus(emp, monthIndex, 1);
                        const status2 = getCellStatus(emp, monthIndex, 16);

                        const cellStyle = (status, isLeft) => ({
                          textAlign: 'center',
                          cursor: isEditing && status !== 'grey' && status !== 'future' ? 'pointer' : 'default',
                          borderLeft: isLeft ? '2px solid #cbd5e1' : '1px solid #f1f5f9',
                          borderBottom: '1px solid #e2e8f0',
                          background: isEditing ? EDIT_BG[status] : STATUS_COLORS[status],
                          userSelect: 'none',
                          padding: isEditing ? '8px 4px' : '0',
                          minWidth: 68,
                          transition: 'background 0.1s',
                        });

                        return (
                          <React.Fragment key={`cell-${monthIndex}`}>
                            <td style={cellStyle(status1, true)} onClick={() => status1 !== 'grey' && status1 !== 'future' && togglePayment(emp, monthIndex, 1)}>
                              {isEditing ? renderEditContent(status1, 1, emp, monthIndex) : <div style={{ height: 28 }} />}
                            </td>
                            <td style={cellStyle(status2, false)} onClick={() => status2 !== 'grey' && status2 !== 'future' && togglePayment(emp, monthIndex, 16)}>
                              {isEditing ? renderEditContent(status2, 16, emp, monthIndex) : <div style={{ height: 28 }} />}
                            </td>
                          </React.Fragment>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
