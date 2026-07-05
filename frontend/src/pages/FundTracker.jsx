import React, { useState, useEffect, useCallback } from 'react';
import { getAllEmployees } from '../db';
import { useAuth } from '../contexts/AuthContext';
import { Wallet, Search, Filter, History, Cloud, CloudOff, RefreshCw, AlertTriangle, Info, Edit3, X, Eye, EyeOff, ChevronLeft, ChevronRight } from 'lucide-react';

// Mirrors the pattern in useSync.js — VITE_API_URL already contains /api
const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
function getAuthHeaders() {
  const token = localStorage.getItem('access_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}
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
  const { canEditFunds } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [payments, setPayments] = useState({}); // key: empServerId-year-month-cutoff -> { amount, modified_at }
  const [isEditing, setIsEditing] = useState(false);
  const [isNameCollapsed, setIsNameCollapsed] = useState(false);
  const [viewFilter, setViewFilter] = useState('active'); // 'active' | 'archived' | 'all'
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncStatus, setSyncStatus] = useState({ last_synced_at: null, spreadsheet_id: null });
  const [syncing, setSyncing] = useState(false);

  const fetchSyncStatus = useCallback(async () => {
    if (!isOnline) return;
    try {
      const res = await fetch(`${API_BASE}/sheets-sync-status/`, { headers: getAuthHeaders() });
      if (res.ok) setSyncStatus(await res.json());
    } catch (_) { }
  }, [isOnline]);

  async function triggerSyncNow() {
    if (!isOnline || syncing) return;
    setSyncing(true);
    try {
      const res = await fetch(`${API_BASE}/sheets-sync-now/`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setSyncStatus(prev => ({ ...prev, last_synced_at: data.last_synced_at, spreadsheet_id: data.spreadsheet_id }));
      }
    } catch (e) {
      console.warn('Sync Now failed:', e);
    } finally {
      setSyncing(false);
    }
  }

  function formatLastSynced(isoStr) {
    if (!isoStr) return 'Never synced';
    const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return new Date(isoStr).toLocaleDateString();
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const emps = await getAllEmployees();
      setEmployees(emps);

      if (isOnline) {
        const res = await fetch(`${API_BASE}/fund-payments/?year=${year}`, { headers: getAuthHeaders() });
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
  useEffect(() => { fetchSyncStatus(); }, [fetchSyncStatus]);

  async function savePayment(emp, monthIndex, cutoff, amount) {
    const key = `${emp.id}-${year}-${monthIndex + 1}-${cutoff}`;
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
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({
            employee_id: emp.id,
            year,
            month: monthIndex + 1,
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
    if (!isEditing || !canEditFunds) return;
    const key = `${emp.id}-${year}-${monthIndex + 1}-${cutoff}`;
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

  function toggleEditMode() {
    if (!canEditFunds) return;
    setIsEditing(v => !v);
  }

  function getCellStatus(emp, monthIndex, cutoffType) {
    if (isAfterEnd(emp.end_date, year, monthIndex, cutoffType)) return 'resigned';
    if (isBeforeStart(emp.start, year, monthIndex, cutoffType)) return 'grey';
    const key = `${emp.id}-${year}-${monthIndex + 1}-${cutoffType}`;
    const obj = payments[key];
    const val = obj ? obj.amount : 0;
    if (val >= 20) return 'paid';
    if (val > 0) return 'incomplete';
    const cutoffDate = getCutoffDate(year, monthIndex, cutoffType);
    
    // Add 15 days of grace period so a cutoff isn't instantly red the day after it ends
    const graceDate = new Date(cutoffDate);
    graceDate.setDate(graceDate.getDate() + 15);
    
    const now = new Date(); now.setHours(0, 0, 0, 0);
    if (graceDate > now) return 'future';
    return 'unpaid';
  }

  function getEmployeeTotals(emp) {
    let totalPaid = 0, totalUnpaid = 0;
    const now = new Date(); now.setHours(0, 0, 0, 0);
    for (let m = 0; m < 12; m++) {
      for (const c of [1, 16]) {
        const s = getCellStatus(emp, m, c);
        if (s === 'grey' || s === 'resigned' || s === 'future') continue;
        const key = `${emp.id}-${year}-${m + 1}-${c}`;
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
    grey: '#fef08a', resigned: '#3b82f6', future: '#f8fafc', paid: '#22c55e', incomplete: '#f97316', unpaid: '#ef4444',
  };
  const EDIT_BG = {
    grey: '#fef9c3', resigned: '#60a5fa', future: '#f8fafc', paid: '#dcfce7', incomplete: '#ffedd5', unpaid: '#fff',
  };

  function renderEditContent(status, cType, emp, monthIndex) {
    if (status === 'grey') return <span style={{ color: '#854d0e', fontWeight: 800, fontSize: 11 }}>NEW</span>;
    if (status === 'resigned') return null; // Solid blue handled by background
    if (status === 'future') return <span style={{ color: '#94a3b8', fontSize: 11 }}>Not Due</span>;
    const key = `${emp.id}-${year}-${monthIndex + 1}-${cType}`;
    const obj = payments[key] || {};
    const val = obj.amount ?? 0;
    const dateStr = obj.date || '';
    const dateDiv = dateStr ? <div style={{ fontSize: 9, color: '#64748b', marginTop: 4 }}>{dateStr}</div> : null;

    if (status === 'paid') return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <span style={{ background: '#22c55e', color: '#fff', padding: '3px 8px', borderRadius: 12, fontSize: 11, fontWeight: 'bold' }}>
          <Check size={10} style={{ display: 'inline', marginRight: 2 }} /> ₱20
        </span>
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
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <div className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Wallet size={20} /> Fund Tracker
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#64748b' }} />
              <input type="text" className="form-input" placeholder="Search SAs…"
                value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                style={{ width: 160, padding: '6px 12px 6px 28px' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <History size={14} color="#64748b" />
              <input type="number" className="form-input" value={year} onChange={e => setYear(+e.target.value)} style={{ width: 80, padding: '6px 12px' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Filter size={14} color="#64748b" />
              <select className="form-select" value={viewFilter} onChange={e => setViewFilter(e.target.value)} style={{ padding: '6px 12px' }}>
                <option value="active">Active Only</option>
                <option value="archived">Archived SAs</option>
                <option value="all">All SAs</option>
              </select>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 16, alignItems: 'center', background: '#f8fafc', padding: '12px 16px', borderRadius: 12, border: '1px solid #e2e8f0', marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Total Fund Collected ({year})</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#10b981', marginTop: 2 }}>₱ {grandTotalPaid.toLocaleString()}</div>
          </div>
          <div style={{ width: 1, height: 40, background: '#cbd5e1' }} />
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: isOnline ? 'rgba(34,197,94,0.1)' : 'rgba(100,116,139,0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: isOnline ? '#22c55e' : '#64748b',
            }}>
              {isOnline ? <Cloud size={18} /> : <CloudOff size={18} />}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>
                {isOnline ? 'Connected to Sheets API' : 'Offline Mode'}
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                Last synced: <strong style={{ color: '#475569' }}>{formatLastSynced(syncStatus.last_synced_at)}</strong>
                {syncStatus.spreadsheet_id && isOnline && (
                  <a href={`https://docs.google.com/spreadsheets/d/${syncStatus.spreadsheet_id}`}
                    target="_blank" rel="noreferrer"
                    style={{ color: '#3b82f6', textDecoration: 'none', marginLeft: 4 }}>
                    Open ↗
                  </a>
                )}
              </div>
            </div>
            <button
              className="btn btn-sm btn-outline"
              onClick={triggerSyncNow}
              disabled={!isOnline || syncing}
              style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 100, justifyContent: 'center' }}
            >
              <RefreshCw size={14} className={syncing ? 'login-spinner' : ''} />
              {syncing ? 'Syncing…' : 'Sync Now'}
            </button>
          </div>
        </div>

        {saving && (
          <div style={{ fontSize: 12, color: '#3b82f6', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={14} className="login-spinner" /> Saving changes...
          </div>
        )}
        {!isOnline && (
          <div className="alert alert-warning" style={{ fontSize: 12, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={14} /> You are offline. Changes saved locally.
          </div>
        )}

        {canEditFunds && (
          <div style={{ marginBottom: 16 }}>
            <button className={`btn ${isEditing ? 'btn-success' : 'btn-outline'}`} onClick={toggleEditMode}>
              {isEditing ? <><Check size={16} /> Done Editing</> : <><Edit3 size={16} /> Edit Mode</>}
            </button>
          </div>
        )}

        <div className="alert alert-info" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Info size={16} /> {isEditing ? 'Click a cell to cycle: Unpaid → Paid (₱20) → Partial (₱10) → Unpaid.' : 'View mode enabled.'}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, flexWrap: 'wrap', fontSize: 11, fontWeight: 600, color: '#64748b' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: STATUS_COLORS.paid, border: '1px solid #86efac' }} /> Paid
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: STATUS_COLORS.incomplete, border: '1px solid #fdba74' }} /> Partial
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: STATUS_COLORS.unpaid, border: '1px solid #fca5a5' }} /> Unpaid
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: STATUS_COLORS.grey, border: '1px solid #fde047' }} /> New / Not Started
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: STATUS_COLORS.resigned, border: '1px solid #93c5fd' }} /> Resigned
          </span>
        </div>

        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 300px)', border: '1px solid #e2e8f0', borderRadius: 8 }}>
          <table style={{ borderCollapse: 'collapse', fontSize: '0.75rem', background: '#fff' }}>
            <thead>
              <tr>
                <th style={{ position: 'sticky', top: 0, left: 0, zIndex: 3, background: '#f8fafc', padding: isNameCollapsed ? '12px 6px' : '12px 14px', minWidth: isNameCollapsed ? 70 : 180, maxWidth: isNameCollapsed ? 70 : 180, textAlign: 'left', borderRight: '1px solid #e2e8f0', boxShadow: '4px 0 8px rgba(0,0,0,0.05)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    {!isNameCollapsed && <span>SA Name</span>}
                    <button 
                      onClick={() => setIsNameCollapsed(!isNameCollapsed)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', borderRadius: 4 }}
                      title={isNameCollapsed ? "Expand Name Column" : "Collapse Name Column"}
                    >
                      {isNameCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                    </button>
                  </div>
                </th>
                <th style={{ position: 'sticky', top: 0, zIndex: 2, background: '#f8fafc', textAlign: 'center', padding: '12px' }}>Paid</th>
                <th style={{ position: 'sticky', top: 0, zIndex: 2, background: '#f8fafc', textAlign: 'center', padding: '12px' }}>Unpaid</th>
                {MONTH_NAMES.map((m, i) => (
                  <React.Fragment key={i}>
                    <th style={{ position: 'sticky', top: 0, zIndex: 2, background: '#f8fafc', textAlign: 'center', padding: '8px 4px' }}>{m.slice(0, 3)} (1-15)</th>
                    <th style={{ position: 'sticky', top: 0, zIndex: 2, background: '#f8fafc', textAlign: 'center', padding: '8px 4px' }}>{m.slice(0, 3)} (16+)</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={27} style={{ textAlign: 'center', padding: 40 }}>Loading...</td></tr>
              ) : visibleEmployees.length === 0 ? (
                <tr><td colSpan={27} style={{ textAlign: 'center', padding: 40 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                    <Search size={32} color="#94a3b8" />
                    No employees found.
                  </div>
                </td></tr>
              ) : (
                visibleEmployees.map(emp => {
                  const { totalPaid, totalUnpaid } = getEmployeeTotals(emp);
                  const isArchived = emp.is_active === false;
                  return (
                    <tr key={emp.id} style={{ opacity: isArchived ? 0.75 : 1 }}>
                      <td style={{ position: 'sticky', left: 0, zIndex: 1, background: '#fff', fontWeight: 600, borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0', boxShadow: '4px 0 8px rgba(0,0,0,0.05)', padding: isNameCollapsed ? '8px 6px' : '8px 14px', color: '#1e293b', minWidth: isNameCollapsed ? 70 : 180, maxWidth: isNameCollapsed ? 70 : 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, overflow: 'hidden' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                            {!isNameCollapsed && isArchived && <span style={{ fontSize: 10, background: '#f1f5f9', color: '#64748b', padding: '1px 6px', borderRadius: 4, flexShrink: 0 }}>Archived</span>}
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={emp.name}>{emp.name}</span>
                          </div>
                          {!isNameCollapsed && emp.end_date && <div style={{ fontSize: 10, color: '#94a3b8' }}>Left: {emp.end_date}</div>}
                        </div>
                      </td>
                      {/* Summary totals */}
                      <td style={{ borderLeft: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0', textAlign: 'center', padding: '6px', background: '#f0fdf4', color: '#166534', fontWeight: 700, fontSize: 12 }}>
                        ₱{totalPaid}
                      </td>
                      <td style={{ borderLeft: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0', textAlign: 'center', padding: '6px', background: totalUnpaid > 0 ? '#fef2f2' : '#f0fdf4', color: totalUnpaid > 0 ? '#991b1b' : '#166534', fontWeight: 700, fontSize: 12 }}>
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
                          cursor: isEditing && status !== 'grey' && status !== 'resigned' && status !== 'future' ? 'pointer' : 'default',
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
                            <td style={cellStyle(status1, true)} onClick={() => status1 !== 'grey' && status1 !== 'resigned' && status1 !== 'future' && togglePayment(emp, monthIndex, 1)}>
                              {isEditing ? renderEditContent(status1, 1, emp, monthIndex) : <div style={{ height: 20 }} />}
                            </td>
                            <td style={cellStyle(status2, false)} onClick={() => status2 !== 'grey' && status2 !== 'resigned' && status2 !== 'future' && togglePayment(emp, monthIndex, 16)}>
                              {isEditing ? renderEditContent(status2, 16, emp, monthIndex) : <div style={{ height: 20 }} />}
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
