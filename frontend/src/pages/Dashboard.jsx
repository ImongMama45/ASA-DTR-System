import { useState, useEffect, useRef } from 'react';
import { getAllEmployees, getAllBatches } from '../db';
import { fetchDashboardStats, fetchOnlineUsers, sendHeartbeat, fetchTreasurySummary } from '../hooks/useSync';
import { Users, FileText, UserCheck, Archive, Wifi, WifiOff, FileSpreadsheet, Server, Circle, Wallet, ChevronDown } from 'lucide-react';

const ROLE_COLORS = {
  SuperAdmin:     { bg: '#7c3aed', text: '#fff' },
  President:      { bg: '#1d4ed8', text: '#fff' },
  'Vice President': { bg: '#0369a1', text: '#fff' },
  Secretary:      { bg: '#0f766e', text: '#fff' },
  Treasurer:      { bg: '#b45309', text: '#fff' },
  Member:         { bg: '#374151', text: '#fff' },
};

export default function Dashboard({ isOnline, setPage }) {
  const [employees, setEmployees] = useState([]);
  const [batches, setBatches] = useState([]);
  const [serverStats, setServerStats] = useState(null);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [treasury, setTreasury] = useState(null);
  const [loading, setLoading] = useState(true);
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [serverExpanded, setServerExpanded] = useState(false);

  const heartbeatRef = useRef(null);
  const pollRef = useRef(null);

  // ── Local data ──────────────────────────────────────────────────────────────
  useEffect(() => {
    loadLocal();
  }, []);

  async function loadLocal() {
    setLoading(true);
    const [emps, bats] = await Promise.all([getAllEmployees(), getAllBatches()]);
    setEmployees(emps);
    setBatches(bats.sort((a, b) => b.createdAt - a.createdAt));
    setLoading(false);
  }

  // ── Server stats + online users (when online) ───────────────────────────────
  useEffect(() => {
    if (!isOnline) {
      setOnlineUsers([]);
      clearInterval(heartbeatRef.current);
      clearInterval(pollRef.current);
      return;
    }

    // Initial fetch
    loadServer();
    loadOnlineUsers();

    // Heartbeat every 10 s (keeps our own last_seen fresh)
    heartbeatRef.current = setInterval(() => {
      sendHeartbeat().catch(() => {});
    }, 10_000);

    // Poll online users every 10 s
    pollRef.current = setInterval(() => {
      loadOnlineUsers();
    }, 10_000);

    return () => {
      clearInterval(heartbeatRef.current);
      clearInterval(pollRef.current);
    };
  }, [isOnline]);

  async function loadServer() {
    try {
      const [stats, tSummary] = await Promise.all([
        fetchDashboardStats(),
        fetchTreasurySummary()
      ]);
      setServerStats(stats);
      setTreasury(tSummary);
    } catch { /* offline */ }
  }

  async function loadOnlineUsers() {
    try {
      const users = await fetchOnlineUsers();
      setOnlineUsers(Array.isArray(users) ? users : []);
    } catch { /* offline */ }
  }

  // ── Derived counts (from local IndexedDB data) ──────────────────────────────
  const activeCount   = employees.filter(e => e.is_active !== false).length;
  const archivedCount = employees.filter(e => e.is_active === false).length;
  const totalCount    = employees.length;

  const totalPresent = batches.reduce((acc, b) =>
    acc + (b.employees || []).reduce((a2, ed) =>
      a2 + (ed.rows || []).filter(r => r.status === 'present').length, 0), 0);

  return (
    <div>
      {/* ── Primary stat row ─────────────────────────────────────────────── */}
      <div className="stats-grid">
        {/* Total Employees */}
        <div className="stat-box" style={{ background: 'linear-gradient(135deg, #1e3a5f, #1d4ed8)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <Users size={22} color="rgba(255,255,255,0.75)" />
          </div>
          <div className="stat-num">{serverStats ? serverStats.total_employees : totalCount}</div>
          <div className="stat-lbl">Total Employees</div>
        </div>

        {/* Active Employees */}
        <div className="stat-box" style={{ background: 'linear-gradient(135deg, #065f46, #059669)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <UserCheck size={22} color="rgba(255,255,255,0.75)" />
          </div>
          <div className="stat-num">{serverStats ? serverStats.active_employees : activeCount}</div>
          <div className="stat-lbl">Active Employees</div>
        </div>

        {/* Archived Employees */}
        <div className="stat-box" style={{ background: 'linear-gradient(135deg, #78350f, #d97706)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <Archive size={22} color="rgba(255,255,255,0.75)" />
          </div>
          <div className="stat-num">{serverStats ? serverStats.archived_employees : archivedCount}</div>
          <div className="stat-lbl">Archived Employees</div>
        </div>

        {/* DTR Batches */}
        <div className="stat-box" style={{ background: 'linear-gradient(135deg, #3b0764, #7c3aed)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <FileSpreadsheet size={22} color="rgba(255,255,255,0.75)" />
          </div>
          <div className="stat-num">{batches.length}</div>
          <div className="stat-lbl">DTR Batches Generated</div>
        </div>

        {/* Total Accumulated Fund */}
        <div className="stat-box" style={{ background: 'linear-gradient(135deg, #854d0e, #ca8a04)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <Wallet size={22} color="rgba(255,255,255,0.75)" />
          </div>
          <div className="stat-num">{treasury ? `₱${parseFloat(treasury.total_budget).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</div>
          <div className="stat-lbl">Total Accumulated Fund</div>
        </div>
      </div>

      {/* ── Offline banner ───────────────────────────────────────────────── */}
      {!isOnline && (
        <div className="alert alert-warning" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <WifiOff size={16} /> You are offline. All changes are saved locally and will sync when internet is available.
        </div>
      )}

      {/* ── Main content row ─────────────────────────────────────────────── */}
      <div className={`dashboard-layout ${isOnline ? '' : 'offline'}`}>

        {/* Left Column: Accordions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          
          {/* DTR Batch History Card */}
          <div className="card" style={{ marginBottom: 0 }}>
            <div 
              className="card-title" 
              style={{ 
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
                cursor: 'pointer', 
                paddingBottom: historyExpanded ? 10 : 0, 
                borderBottom: historyExpanded ? '2px solid var(--gray)' : 'none', 
                marginBottom: historyExpanded ? 14 : 0 
              }}
              onClick={() => setHistoryExpanded(!historyExpanded)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileSpreadsheet size={18} /> DTR Batch History
              </div>
              <ChevronDown size={18} style={{ transform: historyExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} />
            </div>

            {historyExpanded && (
              <>
                {loading && <div className="empty-state"><div className="empty-msg">Loading…</div></div>}
                {!loading && batches.length === 0 && (
                  <div className="empty-state">
                    <div className="empty-icon"><FileText size={32} color="#94a3b8" /></div>
                    <div className="empty-msg">No DTRs generated yet.</div>
                    <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => setPage('generator')}>
                      Generate First DTR
                    </button>
                  </div>
                )}
                
                {/* Scrollable container for batches */}
                <div style={{ maxHeight: 350, overflowY: 'auto', paddingRight: 4 }}>
                  {batches.map((b) => (
                    <div className="history-item" key={b.id}>
                      <div>
                        <div className="history-label">{b.label}</div>
                        <div className="history-meta">
                          {(b.employees || []).length} employee(s) &nbsp;·&nbsp;
                          {new Date(b.createdAt).toLocaleDateString()}
                          {!b.synced && <span className="badge badge-gray" style={{ marginLeft: 6 }}>Local</span>}
                        </div>
                      </div>
                      <button className="btn btn-sm btn-outline" onClick={() => setPage('review')}>View</button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Server Statistics Card */}
          {serverStats && (
            <div className="card" style={{ marginBottom: 0 }}>
              <div 
                className="card-title" 
                style={{ 
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
                  cursor: 'pointer', 
                  paddingBottom: serverExpanded ? 10 : 0, 
                  borderBottom: serverExpanded ? '2px solid var(--gray)' : 'none', 
                  marginBottom: serverExpanded ? 14 : 0 
                }}
                onClick={() => setServerExpanded(!serverExpanded)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Server size={18} /> Server Statistics
                </div>
                <ChevronDown size={18} style={{ transform: serverExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} />
              </div>

              {serverExpanded && (
                <div className="form-grid-3" style={{ padding: '8px 0' }}>
                  <div><strong>{serverStats.total_employees || 0}</strong><br /><span style={{ fontSize: 11 }}>Total Employees (Server)</span></div>
                  <div><strong>{serverStats.active_employees ?? '—'}</strong><br /><span style={{ fontSize: 11 }}>Active</span></div>
                  <div><strong>{serverStats.archived_employees ?? '—'}</strong><br /><span style={{ fontSize: 11 }}>Archived</span></div>
                  <div><strong>{serverStats.total_batches || 0}</strong><br /><span style={{ fontSize: 11 }}>Server Batches</span></div>
                  <div><strong>{serverStats.last_sync || '—'}</strong><br /><span style={{ fontSize: 11 }}>Last Sync</span></div>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Online Users Panel (only shown when online) */}
        {isOnline && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {/* Header */}
            <div style={{
              padding: '14px 16px',
              background: 'linear-gradient(135deg, #0f172a, #1e3a5f)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#fff', fontWeight: 600, fontSize: '0.95rem' }}>
                <Wifi size={16} />
                Online Users
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {/* Pulsing dot */}
                <span style={{
                  display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                  background: '#22c55e',
                  boxShadow: '0 0 0 2px rgba(34,197,94,0.4)',
                  animation: 'pulse 2s infinite',
                }} />
                <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.75rem' }}>
                  {onlineUsers.length} online
                </span>
              </div>
            </div>

            {/* User list */}
            <div style={{ maxHeight: 420, overflowY: 'auto' }}>
              {onlineUsers.length === 0 ? (
                <div style={{ padding: '24px 16px', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
                  No users online right now
                </div>
              ) : (
                onlineUsers.map(u => {
                  const roleStyle = ROLE_COLORS[u.role] || ROLE_COLORS.Member;
                  const initials = u.name
                    ? u.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
                    : u.username.slice(0, 2).toUpperCase();

                  return (
                    <div key={u.id} style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 16px',
                      borderBottom: '1px solid var(--border, #e5e7eb)',
                    }}>
                      {/* Avatar */}
                      <div style={{
                        width: 36, height: 36, borderRadius: '50%',
                        background: u.profile_pic ? `url(${u.profile_pic}) center/cover` : roleStyle.bg,
                        color: roleStyle.text,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 700, fontSize: '0.8rem', flexShrink: 0,
                        position: 'relative',
                      }}>
                        {!u.profile_pic && initials}
                        {/* Online indicator */}
                        <span style={{
                          position: 'absolute', bottom: 0, right: 0,
                          width: 10, height: 10, borderRadius: '50%',
                          background: '#22c55e', border: '2px solid #fff',
                        }} />
                      </div>

                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontWeight: 600, fontSize: '0.85rem',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {u.name || u.username}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                          <span style={{
                            fontSize: '0.7rem', fontWeight: 700, padding: '1px 7px',
                            borderRadius: 10, background: roleStyle.bg, color: roleStyle.text,
                          }}>
                            {u.role}
                          </span>
                          {u.office && (
                            <span style={{ fontSize: '0.7rem', color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {u.office}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Live dot */}
                      <Circle size={8} fill="#22c55e" stroke="none" />
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer: refresh note */}
            <div style={{
              padding: '8px 16px', fontSize: '0.7rem', color: '#94a3b8',
              borderTop: '1px solid var(--border, #e5e7eb)',
              textAlign: 'center',
            }}>
              Updates every 10 seconds
            </div>
          </div>
        )}
      </div>

      {/* Pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
