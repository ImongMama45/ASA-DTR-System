import React, { useState, useCallback, useEffect } from 'react';
import { Plus, Minus, X, History, Loader2, AlertTriangle, ChevronDown, ChevronUp, Calculator } from 'lucide-react';
import Toast from './Toast';

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '') + '/treasury';

function apiFetch(path, options = {}) {
  const token = localStorage.getItem('access_token');
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
}

const peso = (n) =>
  `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ─── Shared modal shell ──────────────────────────────────────────────────
function ModalShell({ children, onClose, width = 420, side = false }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(15, 23, 42, 0.55)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: side ? 'stretch' : 'center',
        justifyContent: side ? 'flex-end' : 'center',
        padding: side ? 0 : 16,
        animation: 'twFadeIn 0.15s ease-out',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: side ? 420 : '100%',
          maxWidth: side ? 420 : width,
          height: side ? '100%' : 'auto',
          maxHeight: side ? '100%' : '90vh',
          overflowY: 'auto',
          background: '#fff',
          borderRadius: side ? 0 : 16,
          boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
          animation: side ? 'twSlideIn 0.2s ease-out' : 'twPopIn 0.15s ease-out',
        }}
      >
        {children}
        <style>{`
          @keyframes twFadeIn { from { opacity: 0 } to { opacity: 1 } }
          @keyframes twPopIn { from { opacity: 0; transform: scale(0.96) } to { opacity: 1; transform: scale(1) } }
          @keyframes twSlideIn { from { transform: translateX(100%) } to { transform: translateX(0) } }
        `}</style>
      </div>
    </div>
  );
}

// ─── Deposit / Disburse buttons + 2-step confirmation flow ──────────────────

export function TreasuryActions({ canEditFunds, onComplete }) {
  const [mode, setMode] = useState(null); // 'DEPOSIT' | 'WITHDRAWAL' | null
  const [step, setStep] = useState('form'); // 'form' | 'confirm'
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [timer, setTimer] = useState(0);
  const [toastMessage, setToastMessage] = useState(null);

  useEffect(() => {
    if (step === 'confirm' && timer > 0) {
      const id = setTimeout(() => setTimer(t => t - 1), 1000);
      return () => clearTimeout(id);
    }
  }, [step, timer]);

  if (!canEditFunds) return null;

  const openModal = (type) => {
    setMode(type);
    setStep('form');
    setAmount('');
    setDescription('');
    setError('');
  };

  const closeModal = () => {
    if (submitting) return;
    setMode(null);
    setStep('form');
  };

  const goToConfirm = (e) => {
    e.preventDefault();
    setError('');
    const num = Number(amount);
    if (!amount || isNaN(num) || num <= 0) {
      setError('Enter a valid amount greater than 0.');
      return;
    }
    if (!description.trim()) {
      setError('A reason/description is required.');
      return;
    }
    setTimer(5);
    setStep('confirm');
  };

  const submit = async () => {
    setSubmitting(true);
    setError('');
    try {
      const res = await apiFetch('/transactions/', {
        method: 'POST',
        body: JSON.stringify({
          transaction_type: mode,
          amount: Number(amount).toFixed(2),
          description: description.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.amount?.[0] || data.error || data.detail || 'Transaction failed.');
      }

      const savedMode = mode;
      const savedAmount = amount;
      const transactionId = data.id;

      setMode(null);
      setStep('form');
      if (onComplete) onComplete();

      setToastMessage({
        type: 'success',
        message: `Successfully ${savedMode === 'DEPOSIT' ? 'deposited' : 'disbursed'} ${peso(savedAmount)}`,
        onUndo: async () => {
          try {
            await apiFetch(`/transactions/${transactionId}/`, {
              method: 'DELETE',
            });
            if (onComplete) onComplete();
            setToastMessage({ type: 'success', message: 'Transaction completely erased.', onUndo: null });
          } catch (e) {
            setToastMessage({ type: 'error', message: 'Failed to erase transaction.', onUndo: null });
          }
        }
      });
    } catch (err) {
      setError(err.message);
      setStep('form');
    } finally {
      setSubmitting(false);
    }
  };

  const isDeposit = mode === 'DEPOSIT';
  const accent = isDeposit ? '#22c55e' : '#ef4444';
  const accentSoft = isDeposit ? '#dcfce7' : '#fee2e2';
  const accentDark = isDeposit ? '#15803d' : '#b91c1c';

  return (
    <>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => openModal('DEPOSIT')}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 10, border: '1px solid #86efac',
            background: '#f0fdf4', color: '#15803d', fontSize: 13, fontWeight: 700,
            cursor: 'pointer', transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#dcfce7')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '#f0fdf4')}
        >
          <Plus size={15} /> Deposit Funds
        </button>
        <button
          onClick={() => openModal('WITHDRAWAL')}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 10, border: '1px solid #fca5a5',
            background: '#fef2f2', color: '#b91c1c', fontSize: 13, fontWeight: 700,
            cursor: 'pointer', transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#fee2e2')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '#fef2f2')}
        >
          <Minus size={15} /> Disburse Funds
        </button>
      </div>

      {mode && (
        <ModalShell onClose={closeModal}>
          {step === 'form' && (
            <form onSubmit={goToConfirm}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px', borderBottom: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%', background: accentSoft,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: accentDark,
                  }}>
                    {isDeposit ? <Plus size={16} /> : <Minus size={16} />}
                  </div>
                  <span style={{ fontSize: 16, fontWeight: 700, color: '#1e293b' }}>
                    {isDeposit ? 'Deposit Funds' : 'Disburse Funds'}
                  </span>
                </div>
                <button type="button" onClick={closeModal} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 4 }}>
                  <X size={18} />
                </button>
              </div>

              <div style={{ padding: 20 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>Amount (₱)</label>
                <input
                  type="number" step="0.01" min="0.01" autoFocus
                  className="form-input"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  style={{ width: '100%', padding: '10px 12px', fontSize: 14, marginBottom: 16, boxSizing: 'border-box' }}
                />

                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>Reason / Description</label>
                <textarea
                  className="form-input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder={isDeposit ? 'e.g. Weekly SA fund collection' : 'e.g. Office supplies reimbursement'}
                  style={{ width: '100%', padding: '10px 12px', fontSize: 14, resize: 'vertical', boxSizing: 'border-box' }}
                />

                {error && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, color: '#b91c1c', fontSize: 13 }}>
                    <AlertTriangle size={14} /> {error}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 20px', borderTop: '1px solid #e2e8f0', background: '#f8fafc', borderRadius: '0 0 16px 16px' }}>
                <button type="button" onClick={closeModal} className="btn btn-outline">Cancel</button>
                <button
                  type="submit"
                  style={{
                    padding: '8px 16px', borderRadius: 8, border: 'none', color: '#fff',
                    fontWeight: 700, fontSize: 13, cursor: 'pointer', background: accent,
                  }}
                >
                  Continue
                </button>
              </div>
            </form>
          )}

          {step === 'confirm' && (
            <div>
              <div style={{ padding: '20px 20px 0' }}>
                <div style={{
                  width: 44, height: 44, borderRadius: '50%', background: '#fef9c3',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a16207', marginBottom: 12,
                }}>
                  <AlertTriangle size={20} />
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>
                  Confirm {isDeposit ? 'Deposit' : 'Disbursement'}
                </div>
                <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.6 }}>
                  You are about to {isDeposit ? 'deposit' : 'disburse'}{' '}
                  <strong style={{ color: accentDark }}>{peso(amount)}</strong>
                  {isDeposit ? ' into' : ' from'} the treasury for{' '}
                  <em>&ldquo;{description.trim()}&rdquo;</em>.
                </p>
                <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                  This action is permanent and will be publicly logged.
                </p>
                {error && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, color: '#b91c1c', fontSize: 13 }}>
                    <AlertTriangle size={14} /> {error}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: 20, marginTop: 8 }}>
                <button type="button" onClick={() => setStep('form')} className="btn btn-outline" disabled={submitting}>
                  Back
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={submitting || timer > 0}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '8px 16px', borderRadius: 8, border: 'none', color: '#fff',
                    fontWeight: 700, fontSize: 13, cursor: submitting || timer > 0 ? 'not-allowed' : 'pointer',
                    background: accent, opacity: submitting || timer > 0 ? 0.6 : 1,
                  }}
                >
                  {submitting && <Loader2 size={14} className="login-spinner" />}
                  {submitting ? 'Processing…' : timer > 0 ? `Confirm in ${timer}s` : 'Confirm & Proceed'}
                </button>
              </div>
            </div>
          )}
        </ModalShell>
      )}

      {toastMessage && (
        <Toast
          type={toastMessage.type}
          message={toastMessage.message}
          onUndo={toastMessage.onUndo}
          onClose={() => setToastMessage(null)}
        />
      )}
    </>
  );
}

// ─── "View Fund Logs" — visible to everyone, no permission gate ─────────────

export function FundLogsButton() {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedLogs, setExpandedLogs] = useState({});   // computation panel
  const [expandedCards, setExpandedCards] = useState({}); // card body

  // ── Filter state ──────────────────────────────────────────────
  const [search, setSearch]         = useState('');
  const [filterDir, setFilterDir]   = useState('all');   // all | add | sub
  const [filterType, setFilterType] = useState('all');   // all | DEPOSIT | WITHDRAWAL | FUND_EDIT_ADD | FUND_EDIT_SUB
  const [filterYear, setFilterYear] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const [filterDay, setFilterDay]   = useState('');
  const [filterBy, setFilterBy]     = useState('');

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch('/transactions/');
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to load logs.');
      setLogs(data.results ?? data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleOpen = () => { setOpen(true); loadLogs(); };

  // ── Derived: filtered + searched logs ────────────────────────
  const filteredLogs = logs.filter(log => {
    const isDeduction = log.transaction_type === 'WITHDRAWAL' || log.transaction_type === 'FUND_EDIT_SUB';

    if (filterDir === 'add' && isDeduction) return false;
    if (filterDir === 'sub' && !isDeduction) return false;
    if (filterType !== 'all' && log.transaction_type !== filterType) return false;

    if (filterYear || filterMonth || filterDay) {
      const d = new Date(log.created_at);
      if (filterYear  && d.getFullYear()  !== Number(filterYear))  return false;
      if (filterMonth && (d.getMonth() + 1) !== Number(filterMonth)) return false;
      if (filterDay   && d.getDate()        !== Number(filterDay))   return false;
    }

    if (filterBy) {
      const byStr = `${log.recorded_by_name} ${log.recorded_by_role}`.toLowerCase();
      if (!byStr.includes(filterBy.toLowerCase())) return false;
    }

    if (search) {
      const q = search.toLowerCase();
      const haystack = [
        log.transaction_id, log.description,
        log.recorded_by_name, log.recorded_by_role,
        peso(log.amount),
      ].join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }

    return true;
  });

  const resetFilters = () => {
    setSearch(''); setFilterDir('all'); setFilterType('all');
    setFilterYear(''); setFilterMonth(''); setFilterDay(''); setFilterBy('');
  };

  // Collect unique auditor names for the datalist
  const auditorNames = [...new Set(logs.map(l => l.recorded_by_name).filter(Boolean))];

  const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  return (
    <>
      <button
        onClick={handleOpen}
        className="btn btn-outline"
        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
      >
        <History size={14} /> View Fund Logs
      </button>

      {open && (
        <ModalShell onClose={() => setOpen(false)} side>
          {/* ── Header ── */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '18px 20px', borderBottom: '1px solid #e2e8f0',
            position: 'sticky', top: 0, background: '#fff', zIndex: 2,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 700, color: '#1e293b' }}>
              <History size={18} /> Fund Logs
              {filteredLogs.length !== logs.length && (
                <span style={{ fontSize: 11, fontWeight: 600, background: '#eff6ff', color: '#3b82f6', padding: '2px 8px', borderRadius: 10 }}>
                  {filteredLogs.length} / {logs.length}
                </span>
              )}
            </div>
            <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 4 }}>
              <X size={18} />
            </button>
          </div>

          {/* ── Search + Filter toolbar ── */}
          <div style={{
            padding: '12px 16px', borderBottom: '1px solid #e2e8f0',
            position: 'sticky', top: 57, background: '#f8fafc', zIndex: 1,
            display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            {/* Search bar */}
            <div style={{ position: 'relative' }}>
              <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}
                width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                type="text"
                placeholder="Search by ID, description, auditor, amount…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  paddingLeft: 32, paddingRight: 10, paddingTop: 8, paddingBottom: 8,
                  border: '1px solid #e2e8f0', borderRadius: 8,
                  fontSize: 13, color: '#334155', background: '#fff', outline: 'none',
                  fontFamily: 'inherit',
                }}
              />
            </div>

            {/* Filter row 1: Direction + Type */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {/* Direction */}
              <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid #e2e8f0', fontSize: 12, fontWeight: 600 }}>
                {[['all','All'], ['add','+ Addition'], ['sub','− Subtraction']].map(([v, label]) => (
                  <button key={v} onClick={() => setFilterDir(v)} style={{
                    padding: '5px 10px', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                    background: filterDir === v ? '#1e293b' : '#fff',
                    color: filterDir === v ? '#fff' : '#64748b',
                    fontWeight: 600, fontSize: 12,
                    borderRight: '1px solid #e2e8f0',
                  }}>{label}</button>
                ))}
              </div>

              {/* Type */}
              <select
                value={filterType}
                onChange={e => setFilterType(e.target.value)}
                style={{
                  padding: '5px 10px', borderRadius: 8, border: '1px solid #e2e8f0',
                  fontSize: 12, fontWeight: 600, color: '#475569', background: '#fff',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <option value="all">All Types</option>
                <option value="DEPOSIT">Deposit</option>
                <option value="WITHDRAWAL">Withdrawal</option>
                <option value="FUND_EDIT_ADD">Fund Edit (Add)</option>
                <option value="FUND_EDIT_SUB">Fund Edit (Subtract)</option>
              </select>
            </div>

            {/* Filter row 2: Date (Year / Month / Day) */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', whiteSpace: 'nowrap' }}>Date:</span>
              <input
                type="number" placeholder="Year" value={filterYear}
                onChange={e => setFilterYear(e.target.value)}
                style={{ width: 72, padding: '5px 8px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 12, fontFamily: 'inherit' }}
              />
              <select
                value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
                style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 12, color: '#475569', fontFamily: 'inherit' }}
              >
                <option value="">Month</option>
                {MONTH_LABELS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
              <input
                type="number" placeholder="Day" min="1" max="31" value={filterDay}
                onChange={e => setFilterDay(e.target.value)}
                style={{ width: 54, padding: '5px 8px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 12, fontFamily: 'inherit' }}
              />
            </div>

            {/* Filter row 3: Auditor */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', whiteSpace: 'nowrap' }}>By:</span>
              <input
                type="text" placeholder="Auditor name or role…" list="auditor-list"
                value={filterBy} onChange={e => setFilterBy(e.target.value)}
                style={{ flex: 1, padding: '5px 8px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 12, fontFamily: 'inherit' }}
              />
              <datalist id="auditor-list">
                {auditorNames.map(n => <option key={n} value={n} />)}
              </datalist>
              {(search || filterDir !== 'all' || filterType !== 'all' || filterYear || filterMonth || filterDay || filterBy) && (
                <button
                  onClick={resetFilters}
                  style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #fca5a5', background: '#fef2f2', color: '#b91c1c', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                >
                  Clear All
                </button>
              )}
            </div>
          </div>

          {/* ── Log cards ── */}
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#64748b', fontSize: 13 }}>
                <Loader2 size={14} className="login-spinner" /> Loading…
              </div>
            )}
            {error && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#b91c1c', fontSize: 13 }}>
                <AlertTriangle size={14} /> {error}
              </div>
            )}
            {!loading && !error && filteredLogs.length === 0 && (
              <p style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center', marginTop: 24 }}>
                {logs.length === 0 ? 'No transactions recorded yet.' : 'No logs match your filters.'}
              </p>
            )}

            {filteredLogs.map((log) => {
              const isDeduction = log.transaction_type === 'WITHDRAWAL' || log.transaction_type === 'FUND_EDIT_SUB';
              const isExpanded = !!expandedLogs[log.id];
              const prevBalance = isDeduction
                ? Number(log.running_balance) + Number(log.amount)
                : Number(log.running_balance) - Number(log.amount);

              const toggleExpand = () => setExpandedLogs(prev => ({ ...prev, [log.id]: !prev[log.id] }));

              let actionLabel = 'Amount Deposited';
              if (log.transaction_type === 'WITHDRAWAL') actionLabel = 'Amount Disbursed';
              else if (log.transaction_type === 'FUND_EDIT_ADD') actionLabel = 'Fund Edit (Added)';
              else if (log.transaction_type === 'FUND_EDIT_SUB') actionLabel = 'Fund Edit (Subtracted)';

              // Type badge
              const typeBadge = {
                DEPOSIT:       { label: 'Deposit',       bg: '#dcfce7', color: '#15803d' },
                WITHDRAWAL:    { label: 'Withdrawal',    bg: '#fee2e2', color: '#b91c1c' },
                FUND_EDIT_ADD: { label: 'Fund Edit ＋',  bg: '#eff6ff', color: '#1d4ed8' },
                FUND_EDIT_SUB: { label: 'Fund Edit −',  bg: '#fef9c3', color: '#854d0e' },
              }[log.transaction_type] || { label: log.transaction_type, bg: '#f1f5f9', color: '#475569' };

              return (
                <div key={log.id} style={{ borderRadius: 12, border: '1px solid #e2e8f0', background: '#f8fafc', overflow: 'hidden' }}>

                  {/* ── Collapsed header (always visible) ── */}
                  <div
                    onClick={() => setExpandedCards(prev => ({ ...prev, [log.id]: !prev[log.id] }))}
                    style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6 }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: isDeduction ? '#dc2626' : '#16a34a' }}>
                        {isDeduction ? '− ' : '+ '}{peso(log.amount)}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: typeBadge.bg, color: typeBadge.color }}>
                          {typeBadge.label}
                        </span>
                        {expandedCards[log.id]
                          ? <ChevronUp size={14} color="#94a3b8" />
                          : <ChevronDown size={14} color="#94a3b8" />}
                      </div>
                    </div>
                    <div style={{ fontSize: 13, color: '#64748b' }}>
                      <span style={{ color: '#94a3b8' }}>Title:</span> {log.transaction_id}
                    </div>
                  </div>

                  {/* ── Expanded body ── */}
                  {expandedCards[log.id] && (
                    <div style={{ borderTop: '1px solid #e2e8f0', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: '#334155' }}>
                        <div style={{ whiteSpace: 'pre-wrap' }}><span style={{ color: '#94a3b8' }}>Description:</span> {log.description}</div>
                        <div>
                          <span style={{ color: '#94a3b8' }}>Time and Date:</span>{' '}
                          {new Date(log.created_at).toLocaleString('en-PH', { dateStyle: 'long', timeStyle: 'short' })}
                        </div>
                        <div>
                          <span style={{ color: '#94a3b8' }}>By:</span> {log.recorded_by_name}
                          {log.recorded_by_role ? ` (${log.recorded_by_role})` : ''}
                        </div>
                      </div>

                  {/* Computation always inside expanded body */}
                  {expandedCards[log.id] && (
                    <div style={{ marginTop: 12, borderTop: '1px dashed #cbd5e1', paddingTop: 12 }}>
                      <button
                        onClick={() => setExpandedLogs(prev => ({ ...prev, [log.id]: !prev[log.id] }))}
                        style={{
                          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#64748b'
                        }}
                      >
                        <Calculator size={14} />
                        {isExpanded ? 'Hide Computation' : 'Show Computation'}
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>

                    {isExpanded && (() => {
                        const isFundEdit = log.transaction_type === 'FUND_EDIT_ADD' || log.transaction_type === 'FUND_EDIT_SUB';

                        // Parse "Added:" / "Retracted:" bullet lines from description
                        let addedLines = [];
                        let retractedLines = [];
                        if (isFundEdit && log.description) {
                          const lines = log.description.split('\n');
                          let section = null;
                          for (const line of lines) {
                            const t = line.trim();
                            if (t === 'Added:')     { section = 'add'; continue; }
                            if (t === 'Retracted:') { section = 'ret'; continue; }
                            if (t.startsWith('\u2022 ') || t.startsWith('• ')) {
                              const item = t.replace(/^[•\u2022]\s*/, '');
                              if (section === 'add') addedLines.push(item);
                              if (section === 'ret') retractedLines.push(item);
                            }
                          }
                        }

                        return (
                          <div style={{
                            marginTop: 12, padding: 12, background: '#fff', borderRadius: 8,
                            border: '1px solid #e2e8f0', fontSize: 13, display: 'flex', flexDirection: 'column', gap: 8
                          }}>
                            {/* Previous balance */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                              <span>Previous Balance</span>
                              <span>{peso(prevBalance)}</span>
                            </div>

                            {/* Fund Edit breakdown */}
                            {isFundEdit && (addedLines.length > 0 || retractedLines.length > 0) && (
                              <>
                                <div style={{ borderTop: '1px dashed #e2e8f0', margin: '2px 0' }} />

                                {addedLines.length > 0 && (
                                  <div>
                                    <div style={{ fontSize: 11, fontWeight: 700, color: '#15803d', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                                      Added
                                    </div>
                                    {addedLines.map((item, i) => (
                                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', color: '#16a34a', paddingLeft: 8, marginBottom: 2 }}>
                                        <span style={{ color: '#334155' }}>• {item.split(': ')[0]}</span>
                                        <span style={{ fontWeight: 600 }}>{item.split(': ')[1] ?? ''}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {retractedLines.length > 0 && (
                                  <div>
                                    <div style={{ fontSize: 11, fontWeight: 700, color: '#b91c1c', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                                      Retracted
                                    </div>
                                    {retractedLines.map((item, i) => (
                                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', color: '#dc2626', paddingLeft: 8, marginBottom: 2 }}>
                                        <span style={{ color: '#334155' }}>• {item.split(': ')[0]}</span>
                                        <span style={{ fontWeight: 600 }}>{item.split(': ')[1] ?? ''}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                <div style={{ borderTop: '1px dashed #e2e8f0', margin: '2px 0' }} />
                              </>
                            )}

                            {/* Net change row */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', color: isDeduction ? '#dc2626' : '#16a34a' }}>
                              <span>{actionLabel}</span>
                              <span>{isDeduction ? '− ' : '+ '}{peso(log.amount)}</span>
                            </div>
                            <div style={{ borderTop: '1px solid #e2e8f0', margin: '4px 0' }} />
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: '#1e293b' }}>
                              <span>New Balance</span>
                              <span>{peso(log.running_balance)}</span>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ModalShell>
      )}
    </>
  );
}
