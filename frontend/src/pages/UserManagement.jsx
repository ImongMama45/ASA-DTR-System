import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Search, RefreshCw, ShieldAlert, KeyRound, UserCog, Lock, CheckCircle2, UserCircle } from 'lucide-react';

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

const ROLE_COLORS = {
  SuperAdmin: { bg: '#fef3c7', color: '#92400e', border: '#fde68a' },
  President:  { bg: '#ede9fe', color: '#5b21b6', border: '#ddd6fe' },
  'Vice President': { bg: '#e0f2fe', color: '#0c4a6e', border: '#bae6fd' },
  Secretary:  { bg: '#dcfce7', color: '#166534', border: '#bbf7d0' },
  Treasurer:  { bg: '#fce7f3', color: '#9d174d', border: '#fbcfe8' },
  Member:     { bg: '#f1f5f9', color: '#475569', border: '#e2e8f0' },
};

const ALL_ROLES = ['Member', 'Secretary', 'Treasurer', 'Vice President', 'President', 'SuperAdmin'];

export default function UserManagement() {
  const { authFetch, user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  // Modal state
  const [modal, setModal] = useState(null); // null | 'set-password' | 'set-role' | 'deactivate' | 'activate'
  const [targetUser, setTargetUser] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('Member');
  const [modalLoading, setModalLoading] = useState(false);
  const [modalMsg, setModalMsg] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await authFetch(`${API_BASE}/auth/users/`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setUsers(await res.json());
    } catch (e) {
      setError('Failed to load users. ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  function openModal(type, u) {
    setTargetUser(u);
    setModal(type);
    setNewPassword('');
    setNewRole(u?.role || 'Member');
    setModalMsg(null);
  }
  function closeModal() { setModal(null); setTargetUser(null); setModalMsg(null); }

  async function handleSetPassword() {
    if (newPassword.length < 8) { setModalMsg({ type: 'error', text: 'Password must be at least 8 characters.' }); return; }
    setModalLoading(true);
    try {
      const res = await authFetch(`${API_BASE}/auth/set-password/${targetUser.id}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed.');
      setModalMsg({ type: 'success', text: data.message });
      await load();
    } catch (e) {
      setModalMsg({ type: 'error', text: e.message });
    } finally {
      setModalLoading(false);
    }
  }

  async function handleSetRole() {
    setModalLoading(true);
    try {
      const res = await authFetch(`${API_BASE}/auth/set-role/${targetUser.id}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed.');
      setModalMsg({ type: 'success', text: data.message });
      await load();
    } catch (e) {
      setModalMsg({ type: 'error', text: e.message });
    } finally {
      setModalLoading(false);
    }
  }

  async function handleToggleActive(u, activate) {
    setModalLoading(true);
    try {
      const res = await authFetch(`${API_BASE}/auth/toggle-active/${u.id}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: activate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed.');
      await load();
      closeModal();
    } catch (e) {
      setModalMsg({ type: 'error', text: e.message });
    } finally {
      setModalLoading(false);
    }
  }

  const filtered = users.filter(u =>
    u.username.toLowerCase().includes(search.toLowerCase()) ||
    (u.employee_name || '').toLowerCase().includes(search.toLowerCase()) ||
    u.role.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <div className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShieldAlert size={20} /> User Management
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#64748b' }} />
              <input type="text" className="form-input" placeholder="Search users…"
                value={search} onChange={e => setSearch(e.target.value)}
                style={{ width: 220, padding: '6px 12px 6px 28px' }} />
            </div>
            <button className="btn btn-primary btn-sm" onClick={load} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
        </div>

        <div className="alert alert-info" style={{ marginBottom: 12, fontSize: 12, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
          <Lock size={14} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            SuperAdmin only. Set passwords to activate accounts for new SAs, or change roles for existing members.
            Accounts migrated from the old system show <strong>No Password Set</strong> until activated.
          </span>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>Loading users…</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
              <thead>
                <tr>
                  {['Username', 'SA Name', 'Role', 'Password', 'Status', 'Actions'].map(h => (
                    <th key={h} style={{
                      padding: '10px 12px', textAlign: 'left', fontWeight: 700,
                      fontSize: 11, color: '#64748b', background: '#f8fafc',
                      borderBottom: '2px solid #e2e8f0', whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => {
                  const roleStyle = ROLE_COLORS[u.role] || ROLE_COLORS.Member;
                  const isSelf = u.id === currentUser?.id;
                  return (
                    <tr key={u.id} style={{ borderBottom: '1px solid #f1f5f9', opacity: u.is_active ? 1 : 0.55 }}>
                      <td style={{ padding: '10px 12px', fontWeight: 600, color: '#1e293b' }}>
                        {u.username}
                        {isSelf && <span style={{ fontSize: 10, color: '#6366f1', marginLeft: 6, fontWeight: 700 }}>(You)</span>}
                      </td>
                      <td style={{ padding: '10px 12px', color: '#334155' }}>{u.employee_name || '—'}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{
                          padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                          background: roleStyle.bg, color: roleStyle.color, border: `1px solid ${roleStyle.border}`,
                        }}>{u.role}</span>
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        {u.has_usable_password ? (
                          <span style={{ color: '#16a34a', fontWeight: 600, fontSize: 11 }}>✓ Set</span>
                        ) : (
                          <span style={{ color: '#dc2626', fontWeight: 600, fontSize: 11 }}>⚠ Not Set</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{
                          padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                          background: u.is_active ? '#dcfce7' : '#fee2e2',
                          color: u.is_active ? '#166534' : '#991b1b',
                        }}>
                          {u.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={() => openModal('set-password', u)}
                            title="Set or reset this user's password"
                            style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                          >
                            <KeyRound size={12} /> {u.has_usable_password ? 'Reset PW' : 'Set PW'}
                          </button>
                          {!isSelf && (
                            <button
                              className="btn btn-sm btn-outline"
                              onClick={() => openModal('set-role', u)}
                              title="Change this user's role"
                              style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                            >
                              <UserCog size={12} /> Role
                            </button>
                          )}
                          {!isSelf && (
                            <button
                              className={`btn btn-sm ${u.is_active ? 'btn-danger' : 'btn-success'}`}
                              onClick={() => handleToggleActive(u, !u.is_active)}
                              title={u.is_active ? 'Deactivate account' : 'Reactivate account'}
                              style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                            >
                              {u.is_active ? <><Lock size={12} /> Deactivate</> : <><CheckCircle2 size={12} /> Activate</>}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div style={{ textAlign: 'center', padding: 30, color: '#94a3b8', fontSize: 13 }}>
                No users match "{search}".
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Set Password Modal ── */}
      {modal === 'set-password' && targetUser && (
        <div className="modal-overlay">
          <div className="modal-content card" style={{ margin: 0, maxWidth: 420 }}>
            <h3 style={{ marginTop: 0, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>
              <KeyRound size={20} /> {targetUser.has_usable_password ? 'Reset Password' : 'Set Password'}
            </h3>
            <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
              Setting password for: <strong>{targetUser.employee_name || targetUser.username}</strong>
              {!targetUser.has_usable_password && (
                <span style={{ display: 'block', marginTop: 6, color: '#dc2626', fontSize: 12 }}>
                  ⚠ This account has no password yet. Set one to allow login.
                </span>
              )}
            </p>
            {modalMsg && (
              <div className={`alert alert-${modalMsg.type === 'success' ? 'success' : 'danger'}`} style={{ marginBottom: 12 }}>
                {modalMsg.text}
              </div>
            )}
            <div className="form-group">
              <label className="form-label">New Password (min 8 chars)</label>
              <input type="password" className="form-input" value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Enter new password" autoFocus />
            </div>
            <div className="btn-row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={closeModal}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSetPassword} disabled={modalLoading}>
                {modalLoading ? 'Setting…' : 'Set Password'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Set Role Modal ── */}
      {modal === 'set-role' && targetUser && (
        <div className="modal-overlay">
          <div className="modal-content card" style={{ margin: 0, maxWidth: 380 }}>
            <h3 style={{ marginTop: 0, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>
              <UserCircle size={20} /> Change Role
            </h3>
            <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
              Changing role for: <strong>{targetUser.employee_name || targetUser.username}</strong>
              <br /><span style={{ fontSize: 12 }}>Current role: <strong>{targetUser.role}</strong></span>
            </p>
            {modalMsg && (
              <div className={`alert alert-${modalMsg.type === 'success' ? 'success' : 'danger'}`} style={{ marginBottom: 12 }}>
                {modalMsg.text}
              </div>
            )}
            <div className="form-group">
              <label className="form-label">New Role</label>
              <select className="form-select" value={newRole} onChange={e => setNewRole(e.target.value)}>
                {ALL_ROLES.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div className="btn-row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={closeModal}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSetRole} disabled={modalLoading}>
                {modalLoading ? 'Saving…' : 'Update Role'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
