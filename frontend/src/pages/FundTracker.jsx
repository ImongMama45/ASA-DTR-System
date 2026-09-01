import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAllEmployees, seedEmployees } from '../db';
import { useAuth } from '../contexts/AuthContext';
import ConfirmModal from '../components/ConfirmModal';
import Toast from '../components/Toast';
import { useSync } from '../hooks/useSync';
import { fetchEmployees } from '../hooks/useSync';
import { Wallet, Search, Filter, History, Cloud, CloudOff, RefreshCw, AlertTriangle, Info, Edit3, X, Eye, EyeOff, ChevronLeft, ChevronRight, Check, Lock, Loader2 } from 'lucide-react';
import { TreasuryActions, FundLogsButton } from '../components/TreasuryPanel';

// Mirrors the pattern in useSync.js — VITE_API_URL already contains /api
const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

// ─── Password Gate Modal ───────────────────────────────────────────────────────
function PasswordGateModal({ title, subtitle, warningText, onVerified, onCancel }) {
  const [pw, setPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!pw) { setError('Please enter your password.'); return; }
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`${API_BASE}/auth/verify-password/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ password: pw }),
      });
      if (res.ok) {
        onVerified();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Incorrect password. Please try again.');
        setPw('');
        inputRef.current?.focus();
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(15,23,42,0.6)',
        backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 20, padding: 32, width: 420,
          boxShadow: '0 25px 60px rgba(0,0,0,0.3)',
          animation: 'pwGatePop 0.18s ease-out',
        }}
      >
        <style>{`@keyframes pwGatePop { from { opacity:0; transform:scale(0.95) } to { opacity:1; transform:scale(1) } }`}</style>

        {/* Icon + title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
          <div style={{
            width: 48, height: 48, borderRadius: '50%',
            background: 'linear-gradient(135deg,#fef3c7,#fde68a)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#92400e', flexShrink: 0,
            boxShadow: '0 4px 12px rgba(251,191,36,0.3)',
          }}>
            <Lock size={22} />
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#1e293b', lineHeight: 1.2 }}>{title}</div>
            {subtitle && <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>{subtitle}</div>}
          </div>
        </div>

        {warningText && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px',
            background: '#fef9c3', borderRadius: 10, border: '1px solid #fde047',
            marginBottom: 20, fontSize: 13, color: '#854d0e', lineHeight: 1.5,
          }}>
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            {warningText}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Your Password
          </label>
          <div style={{ position: 'relative' }}>
            <input
              ref={inputRef}
              type={showPw ? 'text' : 'password'}
              value={pw}
              onChange={(e) => { setPw(e.target.value); setError(''); }}
              placeholder="Enter your password…"
              className="form-input"
              style={{ width: '100%', padding: '11px 44px 11px 14px', fontSize: 14, boxSizing: 'border-box', borderRadius: 10 }}
            />
            <button
              type="button"
              onClick={() => setShowPw(v => !v)}
              style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 4 }}
            >
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, color: '#b91c1c', fontSize: 13, fontWeight: 600 }}>
              <AlertTriangle size={14} /> {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
            <button type="button" onClick={onCancel} className="btn btn-outline" style={{ flex: 1 }} disabled={loading}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !pw}
              style={{
                flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '11px 20px', borderRadius: 10, border: 'none', color: '#fff', fontWeight: 700, fontSize: 14,
                background: loading ? '#94a3b8' : 'linear-gradient(135deg,#3b82f6,#6366f1)',
                cursor: loading || !pw ? 'not-allowed' : 'pointer',
                opacity: !pw ? 0.7 : 1,
                transition: 'opacity 0.15s',
              }}
            >
              {loading && <Loader2 size={16} className="login-spinner" />}
              {loading ? 'Verifying…' : 'Confirm'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
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

function PartialInput({ initialValue, dateStr, onSave }) {
  const [val, setVal] = useState(String(initialValue));
  const [hovered, setHovered] = useState(false);
  const onSaveRef = useRef(onSave);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    if (String(initialValue) !== '0') {
      setVal(String(initialValue));
    }
  }, [initialValue]);

  useEffect(() => {
    if ((val === '' || Number(val) === 0) && !hovered) {
      const timer = setTimeout(() => {
        onSaveRef.current(0);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [val, hovered]);

  const handleChange = (e) => {
    const v = e.target.value;
    setVal(v);
    if (v !== '' && Number(v) !== 0) {
      onSaveRef.current(Number(v));
    }
  };

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}
      onClick={e => e.stopPropagation()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <span style={{ fontSize: 11, fontWeight: 'bold', color: '#ea580c' }}>₱</span>
        <input
          type="number" value={val}
          onChange={handleChange}
          style={{ width: 38, padding: '2px 4px', fontSize: 11, textAlign: 'center', border: '1px solid #fdba74', borderRadius: 4, background: '#fff', color: '#ea580c', fontWeight: 'bold' }}
        />
      </div>
      {dateStr && <div style={{ fontSize: 9, color: '#64748b', marginTop: 4 }}>{dateStr}</div>}
    </div>
  );
}

export default function FundTracker({ isOnline }) {
  const { canEditFunds, authFetch } = useAuth();
  const { isSyncing } = useSync();
  const queryClient = useQueryClient();

  // Reuse the shared employees cache — instant if Employees tab was visited first
  const { data: employees = [] } = useQuery({
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

  const [searchQuery, setSearchQuery] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());

  // Fetch payments — reads localStorage immediately, syncs from API in background
  const { data: payments = {}, refetch: refetchPayments } = useQuery({
    queryKey: ['fund-payments', year, { isOnline }],
    queryFn: async () => {
      // 1. Show local data immediately
      const saved = localStorage.getItem(`fundPayments-${year}`);
      const localData = saved ? JSON.parse(saved) : {};

      // 2. Sync from server in background
      if (isOnline) {
        authFetch(`${API_BASE}/fund-payments/?year=${year}`)
          .then(res => res.ok ? res.json() : Promise.reject())
          .then(data => {
            const map = {};
            data.forEach(p => {
              const key = `${p.employee}-${p.year}-${p.month}-${p.cutoff}`;
              map[key] = { amount: parseFloat(p.amount), date: p.modified_at ? p.modified_at.slice(0, 10) : '' };
            });
            localStorage.setItem(`fundPayments-${year}`, JSON.stringify(map));
            queryClient.invalidateQueries({ queryKey: ['fund-payments', year] });
          })
          .catch(() => { });
      }

      return localData;
    },
    staleTime: 1000 * 60 * 2, // payments are more time-sensitive — 2 min
  });

  const [pendingPayment, setPendingPayment] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editUnlocked, setEditUnlocked] = useState(false); // true after password verified
  const [initialEditState, setInitialEditState] = useState(null);
  const [baselineFetching, setBaselineFetching] = useState(false); // true while syncing before edit mode
  // pwGate: null | 'enter' | 'exit'
  const [pwGate, setPwGate] = useState(null);
  const [isNameCollapsed, setIsNameCollapsed] = useState(false);
  const [viewFilter, setViewFilter] = useState('active'); // 'active' | 'archived' | 'all'
  const [saving, setSaving] = useState(false);
  const [syncStatus, setSyncStatus] = useState({ last_synced_at: null, spreadsheet_id: null });
  const [syncing, setSyncing] = useState(false);
  const [totalBudget, setTotalBudget] = useState('0.00');
  const [toastMessage, setToastMessage] = useState(null);

  const fetchTotalBudget = useCallback(async () => {
    if (!isOnline) return;
    try {
      const res = await authFetch(`${API_BASE}/treasury/summary/`);
      if (res.ok) {
        const data = await res.json();
        setTotalBudget(data.total_budget);
      }
    } catch (_) { }
  }, [isOnline]);

  const fetchSyncStatus = useCallback(async () => {
    if (!isOnline) return;
    try {
      const res = await authFetch(`${API_BASE}/sheets-sync-status/`);
      if (res.ok) setSyncStatus(await res.json());
    } catch (_) { }
  }, [isOnline, authFetch]);

  async function triggerSyncNow() {
    if (!isOnline || syncing) return;
    setSyncing(true);
    try {
      const res = await authFetch(`${API_BASE}/sheets-sync-now/`, { method: 'POST' });
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

  const prevSyncing = useRef(isSyncing);
  useEffect(() => {
    if (prevSyncing.current && !isSyncing) {
      queryClient.invalidateQueries({ queryKey: ['fund-payments', year] });
    }
    prevSyncing.current = isSyncing;
  }, [isSyncing]);

  useEffect(() => { fetchSyncStatus(); }, [fetchSyncStatus]);
  useEffect(() => { fetchTotalBudget(); }, [fetchTotalBudget]);

  async function savePayment(emp, monthIndex, cutoff, amount, isUndo = false) {
    const key = `${emp.id}-${year}-${monthIndex + 1}-${cutoff}`;
    const dateStr = getFormattedDate();
    const newVal = { amount, date: dateStr };

    const prevValObj = payments[key];
    const prevAmount = prevValObj?.amount ?? 0;

    // Optimistic update: instantly update the React Query cache so the UI reflects
    // the change immediately without waiting for a network round-trip.
    queryClient.setQueryData(['fund-payments', year, { isOnline }], prev => {
      const next = { ...(prev || {}), [key]: newVal };
      localStorage.setItem(`fundPayments-${year}`, JSON.stringify(next));
      return next;
    });

    if (isOnline && emp.id) {
      setSaving(true);
      try {
        await authFetch(`${API_BASE}/fund-payments/upsert/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            employee_id: emp.id,
            year,
            month: monthIndex + 1,
            cutoff,
            amount,
          }),
        });
        if (!isUndo) {
          setToastMessage({
            type: 'success',
            message: `Updated payment for ${emp.name}`,
            onUndo: () => {
              savePayment(emp, monthIndex, cutoff, prevAmount, true);
              setToastMessage({ type: 'success', message: 'Action undone.', onUndo: null });
            }
          });
        }
      } catch (e) {
        console.warn('Fund save failed, stored locally.', e);
        if (!isUndo) {
          setToastMessage({ type: 'warning', message: 'Saved locally (offline)', onUndo: null });
        }
      } finally {
        setSaving(false);
      }
    } else if (!isUndo) {
      setToastMessage({
        type: 'success',
        message: `Updated payment for ${emp.name} (local)`,
        onUndo: () => {
          savePayment(emp, monthIndex, cutoff, prevAmount, true);
          setToastMessage({ type: 'success', message: 'Action undone.', onUndo: null });
        }
      });
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

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthName = monthNames[monthIndex];
    const cutoffName = cutoff === 1 ? '15' : '31';

    let statusName = 'Unpaid';
    if (next === 20) statusName = 'Paid (₱20)';
    if (next === 10) statusName = 'Partial (₱10)';

    setPendingPayment({
      emp, monthIndex, cutoff, amount: next,
      message: `Change ${emp.name}'s payment for ${monthName} ${cutoffName} to ${statusName}?`
    });
  }

  function updatePartial(emp, monthIndex, cutoff, amount) {
    savePayment(emp, monthIndex, cutoff, Number(amount));
  }

  function toggleEditMode() {
    if (!canEditFunds) return;
    if (!isEditing) {
      // Must verify password to ENTER edit mode
      setPwGate('enter');
    } else {
      // Must verify password to EXIT edit mode
      setPwGate('exit');
    }
  }

  async function onPasswordVerifiedEnter() {
    setPwGate(null);
    // ── Baseline sync ────────────────────────────────────────────────────────
    // We MUST fetch a fresh snapshot from the server BEFORE capturing the
    // initial state.  Without this, the background API sync that runs on page
    // load can update `payments` AFTER the baseline is captured, causing
    // finalizeEditMode() to mistake those server-side changes for user edits
    // and create spurious FUND_EDIT_ADD transactions (the "adding too much" bug).
    let baseline = { ...payments };
    if (isOnline) {
      setBaselineFetching(true);
      try {
        const res = await authFetch(`${API_BASE}/fund-payments/?year=${year}`);
        if (res.ok) {
          const data = await res.json();
          const map = {};
          data.forEach(p => {
            const key = `${p.employee}-${p.year}-${p.month}-${p.cutoff}`;
            map[key] = { amount: parseFloat(p.amount), date: p.modified_at ? p.modified_at.slice(0, 10) : '' };
          });
          localStorage.setItem(`fundPayments-${year}`, JSON.stringify(map));
          queryClient.setQueryData(['fund-payments', year, { isOnline }], map);
          baseline = map;
        }
      } catch (e) {
        // Network error — fall back to whatever is currently in the local cache.
        // No phantom edits can occur because we simply use the existing `payments`
        // object (which is what finalizeEditMode() will also read from).
        console.warn('Could not sync before entering edit mode, using local cache.', e);
      } finally {
        setBaselineFetching(false);
      }
    }
    setIsEditing(true);
    setEditUnlocked(true);
    setInitialEditState(baseline);
  }

  function onPasswordVerifiedExit() {
    setPwGate(null);
    finalizeEditMode();
  }

  async function finalizeEditMode() {
    setIsEditing(false);
    setEditUnlocked(false);
    setPwGate(null);

    if (!initialEditState) return;

    let netChange = 0;
    let totalAbsolute = 0;
    const additions = [];
    const subtractions = [];
    const employeeChanges = [];

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    for (const [key, currentValObj] of Object.entries(payments)) {
      const initialValObj = initialEditState[key];
      const initialAmount = initialValObj ? Number(initialValObj.amount) : 0;
      const currentAmount = currentValObj ? Number(currentValObj.amount) : 0;

      const diff = currentAmount - initialAmount;
      if (Math.abs(diff) < 0.01) continue;

      netChange += diff;
      totalAbsolute += Math.abs(diff);

      const parts = key.split('-');
      if (parts.length >= 4) {
        const empId = parts[0];
        const emp = employees.find(e => String(e.id) === String(empId));
        const empName = emp ? emp.name : 'Unknown Employee';
        const month = Number(parts[2]);
        const cutoff = parts[3] === '1' ? '15' : '31';
        const monthName = monthNames[month - 1] || month;
        const sign = diff > 0 ? '+' : '-';
        const line = `    \u2022 ${empName} (${monthName} ${cutoff}): ${sign}PHP ${Math.abs(diff).toFixed(2)}`;
        if (diff > 0) additions.push(line);
        else subtractions.push(line);

        employeeChanges.push({
          emp_id: empId,
          diff: diff,
          month_name: monthName,
          cutoff: cutoff
        });
      }
    }

    if (totalAbsolute < 0.01) {
      setInitialEditState(null);
      return;
    }

    const transactionType = netChange >= 0 ? 'FUND_EDIT_ADD' : 'FUND_EDIT_SUB';
    const netSign = netChange >= 0 ? '+' : '-';

    let descLines = [];
    descLines.push(`Total Collected: ${netSign}PHP ${Math.abs(netChange).toFixed(2)} (net)  |  PHP ${totalAbsolute.toFixed(2)} total moved`);
    descLines.push('');
    if (additions.length > 0) {
      descLines.push('Added:');
      descLines.push(...additions);
    }
    if (subtractions.length > 0) {
      if (additions.length > 0) descLines.push('');
      descLines.push('Retracted:');
      descLines.push(...subtractions);
    }

    try {
      const res = await authFetch(`${API_BASE}/treasury/transactions/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction_type: transactionType,
          amount: Math.abs(netChange).toFixed(2),
          description: descLines.join('\n'),
          employee_changes: employeeChanges
        })
      });
      if (res.ok) {
        fetchTotalBudget();
        setToastMessage({
          type: 'success',
          message: `Fund edit logged: ${netSign}PHP ${Math.abs(netChange).toFixed(2)} net (PHP ${totalAbsolute.toFixed(2)} total)`,
          onUndo: null
        });
      } else {
        const errData = await res.json().catch(() => ({}));
        setToastMessage({ type: 'error', message: errData?.detail || 'Failed to log fund edits.', onUndo: null });
      }
    } catch (e) {
      console.warn('Failed to log fund edits', e);
      setToastMessage({ type: 'error', message: 'Network error \u2014 fund edit not logged.', onUndo: null });
    }

    setInitialEditState(null);
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
      <PartialInput
        initialValue={val}
        dateStr={dateStr}
        onSave={(newAmount) => updatePartial(emp, monthIndex, cType, newAmount)}
      />
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
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 6 }}>
              Total Accumulative Funds
              <Info size={14} color="#94a3b8" title="Total funds available in the treasury." style={{ cursor: 'help' }} />
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#3b82f6', marginTop: 2 }}>₱ {Number(totalBudget).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
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
            {canEditFunds && (
              <button
                className="btn btn-sm btn-outline"
                onClick={triggerSyncNow}
                disabled={!isOnline || syncing}
                style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 100, justifyContent: 'center' }}
              >
                <RefreshCw size={14} className={syncing ? 'login-spinner' : ''} />
                {syncing ? 'Syncing…' : 'Sync Now'}
              </button>
            )}
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

        <div style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {canEditFunds && (
            <>
              <button
                className={`btn ${isEditing ? 'btn-success' : 'btn-outline'}`}
                onClick={toggleEditMode}
                disabled={baselineFetching}
                style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: baselineFetching ? 0.7 : 1 }}
              >
                {baselineFetching
                  ? <><Loader2 size={16} className="login-spinner" /> Syncing…</>
                  : isEditing
                    ? <><Check size={16} /> Done Editing<Lock size={14} style={{ marginLeft: 2, opacity: 0.7 }} /></>
                    : <><Edit3 size={16} /> Edit Mode<Lock size={14} style={{ marginLeft: 2, opacity: 0.6 }} /></>}
              </button>
              <TreasuryActions canEditFunds={canEditFunds} editUnlocked={editUnlocked} onComplete={fetchTotalBudget} />
            </>
          )}
          <FundLogsButton />
        </div>

        {/* Password gate — enter edit mode */}
        {pwGate === 'enter' && (
          <PasswordGateModal
            title="Enable Edit Mode"
            subtitle="You are about to make changes to fund records."
            warningText="This will allow you to modify payment data. A full log of all edits will be recorded. Proceed with caution."
            onVerified={onPasswordVerifiedEnter}
            onCancel={() => setPwGate(null)}
          />
        )}

        {/* Password gate — exit edit mode */}
        {pwGate === 'exit' && (
          <PasswordGateModal
            title="Confirm & Save Edits"
            subtitle="Re-enter your password to finalize and log all edits."
            warningText="All changes made during this session will be permanently logged. Please ensure all payments are correctly recorded before confirming."
            onVerified={onPasswordVerifiedExit}
            onCancel={() => setPwGate(null)}
          />
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
                {MONTH_NAMES.map((m, i) => {
                  const lastDay = new Date(year, i + 1, 0).getDate();
                  return (
                    <React.Fragment key={i}>
                      <th style={{ position: 'sticky', top: 0, zIndex: 2, background: '#f8fafc', textAlign: 'center', padding: '8px 4px' }}>{m.slice(0, 3)}-15</th>
                      <th style={{ position: 'sticky', top: 0, zIndex: 2, background: '#f8fafc', textAlign: 'center', padding: '8px 4px' }}>{m.slice(0, 3)}-{lastDay}</th>
                    </React.Fragment>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 ? (
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

      <ConfirmModal
        isOpen={!!pendingPayment}
        title="Confirm Payment Change"
        message={pendingPayment?.message}
        onConfirm={() => {
          savePayment(pendingPayment.emp, pendingPayment.monthIndex, pendingPayment.cutoff, pendingPayment.amount);
          setPendingPayment(null);
        }}
        onCancel={() => setPendingPayment(null)}
      />

      {toastMessage && (
        <Toast
          type={toastMessage.type}
          message={toastMessage.message}
          onUndo={toastMessage.onUndo}
          onClose={() => setToastMessage(null)}
        />
      )}
    </div>
  );
}
