import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { Edit2, Plus, Upload, Users, FileDown, User, FileJson, AlertTriangle, KeyRound, UserCog, Search, Filter, QrCode, X, Download, ChevronUp, ChevronDown, Activity, MoreVertical } from 'lucide-react';
import { getAllEmployees, addEmployee, updateEmployee, deleteEmployee, seedEmployees, initDB } from '../db';
import {
  fetchEmployees,
  createServerEmployee,
  updateServerEmployee,
  restoreServerEmployee,
  deleteServerEmployee,
  fetchQRPayload,
  reissueQRPayload,
  fetchAttendanceLeaderboard
} from '../hooks/useSync';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, Legend } from 'recharts';
import QRCode from 'qrcode';
import FileUpload from '../components/FileUpload';
import { formatUserId } from '../utils/dateUtils';

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

const ROLE_COLORS = {
  SuperAdmin: { bg: '#fef3c7', color: '#92400e' },
  President: { bg: '#ede9fe', color: '#5b21b6' },
  'Vice President': { bg: '#e0f2fe', color: '#0c4a6e' },
  Secretary: { bg: '#dcfce7', color: '#166534' },
  Treasurer: { bg: '#fce7f3', color: '#9d174d' },
  Auditor: { bg: '#fff7ed', color: '#c2410c' },
  PIO: { bg: '#f0fdf4', color: '#15803d' },
  Member: { bg: '#f1f5f9', color: '#475569' },
};
const ALL_ROLES = ['Member', 'Secretary', 'Treasurer', 'Auditor', 'PIO', 'Vice President', 'President', 'SuperAdmin'];
const OFFICES = [
  '', 'Finance Office', 'Registrar Office', 'Maintenance Office', 'Clinic',
  'Admission/Guidance Office', 'HR Office', 'BSSW Program Head Office', 'ICES Office',
  'BSE Program Head Office', 'BSPA Program Head Office', 'BTVTED/ABELS Program Head Office',
  'BSA/BSAIS Program Head Office', 'GAD Office', 'Library', 'Admin Office',
  'PE Department Office', 'BSIT Program Head Office', 'Alumni Office',
];

function getAuthHeaders() {
  const token = localStorage.getItem('access_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function SearchableDropdown({ employees, onSelect }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const ref = useRef();

  useEffect(() => {
    const handler = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = employees.filter(e => e.name.toLowerCase().includes(query.toLowerCase()));

  function pick(emp) { setSelected(emp); setQuery(emp.name); setOpen(false); onSelect(emp); }

  return (
    <div className="search-dropdown" ref={ref}>
      <input className="form-input" placeholder="Type to search employees…" value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); setSelected(null); onSelect(null); }}
        onFocus={() => setOpen(true)} />
      {open && filtered.length > 0 && (
        <div className="dropdown-list">
          {filtered.map(emp => (
            <div key={emp.id} className={`dropdown-item ${selected?.id === emp.id ? 'selected' : ''}`}
              onMouseDown={() => pick(emp)}>
              <strong>{emp.name}</strong>
              <span className={`badge badge-${emp.duty.toLowerCase()}`} style={{ marginLeft: 8 }}>{emp.duty}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error('CSV has no data rows.');
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const nameIdx = headers.indexOf('name'), dutyIdx = headers.indexOf('duty'), startIdx = headers.indexOf('start');
  if (nameIdx === -1) throw new Error('CSV is missing a "name" column.');
  return lines.slice(1).map((line, i) => {
    const cols = line.split(',').map(c => c.trim());
    const name = cols[nameIdx]?.toUpperCase();
    if (!name) throw new Error(`Row ${i + 2}: name is empty.`);
    const duty = dutyIdx !== -1 ? cols[dutyIdx]?.toUpperCase() : 'AM';
    if (!['AM', 'PM'].includes(duty)) throw new Error(`Row ${i + 2}: duty must be AM or PM.`);
    return { name, duty, start: startIdx !== -1 ? (cols[startIdx] || '') : '' };
  });
}

function parseJSON(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('Invalid JSON file.'); }
  const list = Array.isArray(parsed) ? parsed : parsed.employees;
  if (!Array.isArray(list)) throw new Error('JSON must be an array or { employees: [...] }.');
  return list.map((row, i) => {
    const name = (row.name || '').toString().toUpperCase().trim();
    if (!name) throw new Error(`Item ${i + 1}: name is empty.`);
    const duty = (row.duty || 'AM').toString().toUpperCase().trim();
    if (!['AM', 'PM'].includes(duty)) throw new Error(`Item ${i + 1}: duty must be AM or PM.`);
    return { name, duty, start: row.start || '' };
  });
}

function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── main component ────────────────────────────────────────────────────────────

export default function Employees({ isOnline }) {
  const { canManageEmployees, isSuperAdmin, authFetch } = useAuth();
  const queryClient = useQueryClient();

  const { data: employees = [], isLoading } = useQuery({
    // Include isOnline in the key so a change from false→true triggers a fresh fetch
    queryKey: ['employees', { isOnline }],
    queryFn: async () => {
      // 1. Read local IndexedDB immediately — this is instant and populates the UI right away
      const localData = await getAllEmployees();

      // 2. If online, sync from the server in the background — don't block the return
      if (isOnline) {
        fetchEmployees()
          .then(list => seedEmployees(list))
          .then(() => queryClient.invalidateQueries({ queryKey: ['employees'] }))
          .catch(() => { /* offline / server error — local data is fine */ });
      }

      return localData;
    },
    staleTime: 1000 * 60 * 5,
  });

  const { data: leaderboardData, isLoading: loadingLeaderboard } = useQuery({
    queryKey: ['attendanceLeaderboard'],
    queryFn: fetchAttendanceLeaderboard,
    staleTime: 1000 * 60 * 10,
    enabled: isOnline,
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [dutyFilter, setDutyFilter] = useState('all');
  const [activeFilter, setActiveFilter] = useState('active');
  const [officersOnly, setOfficersOnly] = useState(false);
  const [sortJoined, setSortJoined] = useState('newest');

  const [form, setForm] = useState({ id: null, name: '', duty: 'AM', office: '', start: '' });
  const [replacedEmployeeId, setReplacedEmployeeId] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [showImportForm, setShowImportForm] = useState(false);

  // QR generation state
  const [qrModal, setQrModal] = useState({ isOpen: false, employee: null, dataUrl: null, loading: false, error: null, showReissueConfirm: false });

  const openQrModal = async (emp) => {
    setQrModal({ isOpen: true, employee: emp, dataUrl: null, loading: true, error: null, showReissueConfirm: false });
    try {
      const res = await fetchQRPayload(emp.id);
      const dataUrl = await QRCode.toDataURL(res.qr_payload, {
        width: 300,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' }
      });
      setQrModal(prev => ({ ...prev, dataUrl, loading: false }));
      if (!emp.has_qr_code) {
        queryClient.setQueryData(['employees', { isOnline }], old =>
          old ? old.map(e => e.id === emp.id ? { ...e, has_qr_code: true } : e) : old
        );
        initDB().then(db => db.get('employees', emp.id)).then(record => {
          if (record) {
            record.has_qr_code = true;
            initDB().then(db => db.put('employees', record));
          }
        });
      }
    } catch (err) {
      setQrModal(prev => ({ ...prev, error: 'Failed to generate QR code.', loading: false }));
    }
  };

  const handleReissueCard = () => {
    if (!qrModal.employee) return;
    setQrModal(prev => ({ ...prev, showReissueConfirm: true }));
  };

  const confirmReissueCard = async () => {
    setQrModal(prev => ({ ...prev, loading: true, error: null, dataUrl: null, showReissueConfirm: false }));
    try {
      const res = await reissueQRPayload(qrModal.employee.id);
      const dataUrl = await QRCode.toDataURL(res.qr_payload, {
        width: 300,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' }
      });
      setQrModal(prev => ({ ...prev, dataUrl, loading: false }));
      alert(`Card for ${qrModal.employee.name} successfully reissued!`);
    } catch (err) {
      setQrModal(prev => ({ ...prev, error: 'Failed to reissue QR code.', loading: false }));
    }
  };

  // User creation fields (only shown when adding a new employee as SuperAdmin)
  const [createUser, setCreateUser] = useState(false);
  const [userForm, setUserForm] = useState({ username: '', password: '', role: 'Member' });

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [importStatus, setImportStatus] = useState(null);
  const [importing, setImporting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const fileInputRef = useRef();
  const [openMenuId, setOpenMenuId] = useState(null);

  function setField(k, v) { setForm(f => ({ ...f, [k]: v })); }
  function setUField(k, v) { setUserForm(f => ({ ...f, [k]: v })); }

  async function save() {
    if (!form.name.trim()) { setMsg({ type: 'danger', text: 'Please enter a name.' }); return; }
    if (createUser) {
      if (!userForm.username.trim()) { setMsg({ type: 'danger', text: 'Username is required.' }); return; }
      if (userForm.password.length < 8) { setMsg({ type: 'danger', text: 'Password must be at least 8 characters.' }); return; }
    }
    setSaving(true);
    const data = {
      name: form.name.trim().toUpperCase(),
      duty: form.duty,
      office: form.office,
      start: form.start,
      replacedEmployeeId: replacedEmployeeId ? Number(replacedEmployeeId) : null,
      replacedLocalId: replacedEmployeeId ? String(replacedEmployeeId) : null
    };

    try {
      let serverId = form.id;
      if (isOnline) {
        if (form.id) {
          await updateServerEmployee(form.id, data);
          setMsg({ type: 'success', text: 'Employee updated.' });
        } else {
          const res = await createServerEmployee(data);
          // If it was a swap, res is { new_employee, replaced_employee }
          const created = res.new_employee || res;
          serverId = created?.id;
          setMsg({ type: 'success', text: 'Employee added.' });
        }

        // Also create the linked user account if requested (works for both new and existing)
        if (createUser && serverId && isSuperAdmin) {
          const res = await authFetch(`${API_BASE}/auth/users/create/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...userForm, employee_id: serverId }),
          });
          const resData = await res.json();
          if (!res.ok) {
            setMsg({ type: 'danger', text: `Employee saved but user creation failed: ${resData.error}` });
          } else {
            setMsg({ type: 'success', text: `Employee saved & user account "${userForm.username}" created!` });
          }
        }
      } else {
        if (form.id) await updateEmployee({ ...data, id: form.id });
        else await addEmployee(data);
        setMsg({ type: 'success', text: 'Saved locally (will sync when online).' });
      }
    } catch {
      if (form.id) await updateEmployee({ ...data, id: form.id });
      else await addEmployee(data);
      setMsg({ type: 'success', text: 'Saved locally (will sync when online).' });
    }

    setSaving(false);
    clearForm();
    queryClient.invalidateQueries({ queryKey: ['employees'] });
    setTimeout(() => setMsg(null), 4000);
  }

  async function executeDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    const isArchived = deleteTarget.is_active === false;

    if (isArchived && deleteTarget._action === 'activate') {
      // Re-activate: call the dedicated restore endpoint which also re-enables the linked user account
      if (isOnline) {
        try {
          await restoreServerEmployee(id);
          // Optimistically update local IndexedDB so the UI reflects the change immediately
          const db = await initDB();
          const record = await db.get('employees', id);
          if (record) {
            await db.put('employees', { ...record, is_active: true, end_date: '' });
          }
        } catch {
          setMsg({ type: 'danger', text: 'Failed to activate employee. Please try again.' });
          setDeleteTarget(null);
          return;
        }
      } else {
        // Offline: update local DB and queue a sync action
        const db = await initDB();
        const record = await db.get('employees', id);
        if (record) {
          await db.put('employees', { ...record, is_active: true, end_date: '' });
        }
      }
    } else if (isArchived && deleteTarget._action === 'delete') {
      // Hard delete
      if (isOnline) {
        try { await deleteServerEmployee(id); }
        catch { await deleteEmployee(id); }
      } else {
        await deleteEmployee(id);
      }
    } else {
      // Normal archive of an active employee
      if (isOnline) {
        try { await deleteServerEmployee(id); }
        catch { await deleteEmployee(id); }
      } else {
        await deleteEmployee(id);
      }
    }

    setDeleteTarget(null);
    queryClient.invalidateQueries({ queryKey: ['employees'] });
  }

  function edit(emp) {
    setForm({ id: emp.id, name: emp.name, duty: emp.duty, office: emp.office || '', start: emp.start || '' });
    setCreateUser(false);
    setUserForm({ username: `sa_${emp.name.split(',')[0].toLowerCase().replace(/\s+/g, '')}`, password: '', role: 'Member' });
    setShowAddForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function clearForm() {
    setForm({ id: null, name: '', duty: 'AM', office: '', start: '' });
    setReplacedEmployeeId('');
    setUserForm({ username: '', password: '', role: 'Member' });
    setCreateUser(false);
  }

  function initials(name) { return name.split(' ').map(w => w[0]).join('').slice(0, 2); }

  async function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImporting(true); setImportStatus(null);
    let rows;
    try {
      const text = await file.text();
      const ext = file.name.split('.').pop().toLowerCase();
      rows = ext === 'json' ? parseJSON(text) : parseCSV(text);
    } catch (err) { setImportStatus({ ok: 0, skipped: 0, errors: [err.message] }); setImporting(false); return; }

    let ok = 0, skipped = 0;
    const errors = [];
    const existing = await getAllEmployees();
    const existingNames = new Set(existing.map(e => e.name));

    for (const row of rows) {
      if (existingNames.has(row.name)) { skipped++; continue; }
      try {
        if (isOnline) { try { await createServerEmployee(row); } catch { await addEmployee(row); } }
        else { await addEmployee(row); }
        existingNames.add(row.name); ok++;
      } catch (err) { errors.push(`${row.name}: ${err.message}`); }
    }
    if (isOnline) { try { const list = await fetchEmployees(); await seedEmployees(list); } catch { } }
    setImportStatus({ ok, skipped, errors });
    setImporting(false);
    queryClient.invalidateQueries({ queryKey: ['employees'] });
  }

  function exportCSV() {
    const rows = employees.map(e => `${e.name},${e.duty},${e.office || ''},${e.start || ''}`);
    downloadFile(['name,duty,office,start', ...rows].join('\n'), 'employees.csv', 'text/csv');
  }
  function exportJSON() {
    downloadFile(JSON.stringify(employees.map(({ name, duty, office, start }) => ({ name, duty, office: office || '', start: start || '' })), null, 2), 'employees.json', 'application/json');
  }

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* ── Leaderboard Visualization ── */}
      {isOnline && leaderboardData && (
        <div className="card" style={{ marginBottom: 24, padding: 24 }}>
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
            Student Assistant Leaderboard
          </div>

          <div className="leaderboard-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 24 }}>
            <div>
              <h4 style={{ fontSize: 14, color: '#475569', marginBottom: 12, textAlign: 'center' }}>Most Present</h4>
              <div style={{ height: 220, width: '100%' }}>
                {leaderboardData.most_present.length > 0 ? (
                  <ResponsiveContainer>
                    <BarChart data={leaderboardData.most_present} margin={{ top: 10, right: 10, left: -20, bottom: 0 }} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#e2e8f0" />
                      <XAxis type="number" hide />
                      <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} width={100} />
                      <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 15px rgba(0,0,0,0.1)' }} />
                      <Bar dataKey="count" name="Days Present" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={20}>
                        {leaderboardData.most_present.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={['#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe', '#dbeafe'][index % 5]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8', fontSize: 13, background: '#f8fafc', borderRadius: 8, border: '1px dashed #cbd5e1' }}>
                    No data available
                  </div>
                )}
              </div>
            </div>

            <div>
              <h4 style={{ fontSize: 14, color: '#475569', marginBottom: 12, textAlign: 'center' }}>Most Early</h4>
              <div style={{ height: 220, width: '100%' }}>
                {leaderboardData.most_early.length > 0 ? (
                  <ResponsiveContainer>
                    <BarChart data={leaderboardData.most_early} margin={{ top: 10, right: 10, left: -20, bottom: 0 }} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#e2e8f0" />
                      <XAxis type="number" hide />
                      <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} width={100} />
                      <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 15px rgba(0,0,0,0.1)' }} />
                      <Bar dataKey="count" name="Early Arrivals" fill="#10b981" radius={[0, 4, 4, 0]} barSize={20}>
                        {leaderboardData.most_early.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={['#10b981', '#34d399', '#6ee7b7', '#a7f3d0', '#d1fae5'][index % 5]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8', fontSize: 13, background: '#f8fafc', borderRadius: 8, border: '1px dashed #cbd5e1' }}>
                    No data available
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Add / Edit form ── */}
      {canManageEmployees && (
        <div className="card">
          <div
            className="card-title"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', marginBottom: showAddForm ? 16 : 0 }}
            onClick={() => setShowAddForm(!showAddForm)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {form.id ? <><Edit2 size={18} /> Edit Employee</> : <><Plus size={18} /> Add Employee</>}
            </div>
            {showAddForm ? <ChevronUp size={20} color="#64748b" /> : <ChevronDown size={20} color="#64748b" />}
          </div>
          {msg && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}

          {showAddForm && (
            <>
              <div className="form-grid">
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label className="form-label">Full Name (ALL CAPS)</label>
                  <input className="form-input" placeholder="e.g. JUAN DELA CRUZ"
                    value={form.name} onChange={e => setField('name', e.target.value.toUpperCase())} />
                </div>
                <div className="form-group">
                  <label className="form-label">Duty Type</label>
                  <select className="form-select" value={form.duty} onChange={e => setField('duty', e.target.value)}>
                    <option value="AM">AM (Morning Duty)</option>
                    <option value="PM">PM (Afternoon Duty)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Office (Optional)</label>
                  <select className="form-select" value={form.office} onChange={e => setField('office', e.target.value)}>
                    {OFFICES.map(o => <option key={o} value={o}>{o || '-- None --'}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Start Date</label>
                  <input type="date" className="form-input" value={form.start} onChange={e => setField('start', e.target.value)} />
                </div>
              </div>

              {!form.id && (
                <div style={{ marginBottom: 12 }}>
                  <label className="form-label">Replaces (Optional Swap)</label>
                  <select
                    className="form-select"
                    value={replacedEmployeeId}
                    onChange={e => {
                      const id = e.target.value;
                      setReplacedEmployeeId(id);
                      if (id) {
                        const oldEmp = employees.find(emp => String(emp.id) === id);
                        if (oldEmp) {
                          setForm(f => ({
                            ...f,
                            duty: oldEmp.duty,
                            office: oldEmp.office || '',
                            start: new Date().toISOString().split('T')[0]
                          }));
                        }
                      }
                    }}
                  >
                    <option value="">-- No replacement --</option>
                    {employees.filter(e => e.is_active !== false).map(e => (
                      <option key={e.id} value={e.id}>{e.name} ({e.duty})</option>
                    ))}
                  </select>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                    Selecting an active employee will automatically archive them and inherit their duty and office.
                  </div>
                </div>
              )}

              {/* Create user account toggle — only when SuperAdmin, and employee doesn't have an account */}
              {isSuperAdmin && (!form.id || !employees.find(e => e.id === form.id)?.username) && (
                <div style={{ marginTop: 12, padding: '12px 16px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13, color: '#334155' }}>
                    <input type="checkbox" checked={createUser} onChange={e => setCreateUser(e.target.checked)} />
                    <KeyRound size={15} /> Also create a login account for this employee
                  </label>

                  {createUser && (
                    <div className="form-grid" style={{ marginTop: 12 }}>
                      <div className="form-group">
                        <label className="form-label">Username</label>
                        <input className="form-input" placeholder="e.g. sa_juan" value={userForm.username}
                          onChange={e => setUField('username', e.target.value)} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Password (min 8 chars)</label>
                        <input type="password" className="form-input" placeholder="••••••••" value={userForm.password}
                          onChange={e => setUField('password', e.target.value)} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Role</label>
                        <select className="form-select" value={userForm.role} onChange={e => setUField('role', e.target.value)}>
                          {ALL_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="btn-row" style={{ marginTop: 16 }}>
                <button className="btn btn-primary" onClick={save} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {saving ? 'Saving…' : form.id ? <><Edit2 size={16} /> Update Employee</> : <><Plus size={16} /> {createUser ? 'Add Employee + Create Account' : 'Add Employee'}</>}
                </button>
                {form.id && <button className="btn btn-secondary" onClick={clearForm}>Cancel</button>}
              </div>

              {/* File Upload testing block for Employees */}
              {form.id && showAddForm && (
                <div style={{ marginTop: 24, padding: '16px', background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0' }}>
                  <h4 style={{ margin: '0 0 8px 0', color: '#166534', fontSize: '14px' }}>
                    📎 Attach File to this Employee
                  </h4>
                  <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: '#166534' }}>
                    Upload ID photos or documents directly to Google Drive.
                  </p>
                  <FileUpload
                    employeeId={form.id}
                    onUploaded={(data) => alert(`Upload successful! Drive ID: ${data.drive_file_id}`)}
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Import card ── */}
      {canManageEmployees && (
        <div className="card">
          <div
            className="card-title"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', marginBottom: showImportForm ? 16 : 0 }}
            onClick={() => setShowImportForm(!showImportForm)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Upload size={18} /> Import Employees
            </div>
            {showImportForm ? <ChevronUp size={20} color="#64748b" /> : <ChevronDown size={20} color="#64748b" />}
          </div>

          {showImportForm && (
            <>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted, #666)', marginBottom: 12 }}>
                Upload a <strong>.csv</strong> or <strong>.json</strong> file to bulk-add employees. Duplicate names are skipped.
              </p>
              <input ref={fileInputRef} type="file" accept=".csv,.json" style={{ display: 'none' }} onChange={handleFileUpload} />
              <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()} disabled={importing}
                style={{ background: '#1e293b', display: 'flex', alignItems: 'center', gap: 6 }}>
                {importing ? 'Importing…' : <><Upload size={16} /> Choose File (.csv / .json)</>}
              </button>
              {importStatus && (
                <div style={{ marginTop: 14 }}>
                  {importStatus.ok > 0 && <div className="alert alert-success">✅ {importStatus.ok} employee{importStatus.ok !== 1 ? 's' : ''} imported.</div>}
                  {importStatus.skipped > 0 && <div className="alert alert-warning">⏭ {importStatus.skipped} duplicate{importStatus.skipped !== 1 ? 's' : ''} skipped.</div>}
                  {importStatus.errors.length > 0 && (
                    <div className="alert alert-danger">
                      <strong>⚠ {importStatus.errors.length} error{importStatus.errors.length !== 1 ? 's' : ''}:</strong>
                      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{importStatus.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Employee list ── */}
      {(() => {
        const filteredEmployees = employees.filter(emp => {
          const lowerQuery = searchQuery.toLowerCase();
          const matchSearch = emp.name.toLowerCase().includes(lowerQuery) ||
            (emp.office || '').toLowerCase().includes(lowerQuery);
          const matchDuty = dutyFilter === 'all' || emp.duty === dutyFilter;
          const matchActive = activeFilter === 'all' ||
            (activeFilter === 'active' && emp.is_active !== false) ||
            (activeFilter === 'archived' && emp.is_active === false);

          const isOfficer = emp.role && emp.role !== 'Member';
          const matchOfficers = !officersOnly || isOfficer;

          return matchSearch && matchDuty && matchActive && matchOfficers;
        });

        filteredEmployees.sort((a, b) => {
          if (!a.start && b.start) return 1;
          if (a.start && !b.start) return -1;
          if (!a.start && !b.start) return 0;
          return sortJoined === 'newest' ? b.start.localeCompare(a.start) : a.start.localeCompare(b.start);
        });

        return (
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
              <div className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Users size={18} /> Employee List ({filteredEmployees.length})
              </div>

              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ position: 'relative' }}>
                  <Search size={14} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#64748b' }} />
                  <input type="text" className="form-input" placeholder="Search SAs…"
                    value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                    style={{ width: 160, padding: '6px 12px 6px 28px' }} />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Filter size={14} color="#64748b" />
                  <select className="form-select" value={dutyFilter} onChange={e => setDutyFilter(e.target.value)} style={{ padding: '6px 12px' }}>
                    <option value="all">All Duties</option>
                    <option value="AM">AM Duty</option>
                    <option value="PM">PM Duty</option>
                  </select>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Filter size={14} color="#64748b" />
                  <select className="form-select" value={activeFilter} onChange={e => setActiveFilter(e.target.value)} style={{ padding: '6px 12px' }}>
                    <option value="active">Active Only</option>
                    <option value="archived">Archived</option>
                    <option value="all">All Status</option>
                  </select>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <select className="form-select" value={sortJoined} onChange={e => setSortJoined(e.target.value)} style={{ padding: '6px 12px' }}>
                    <option value="newest">Newest First</option>
                    <option value="oldest">Oldest First</option>
                  </select>
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#475569', cursor: 'pointer', userSelect: 'none' }}>
                  <input type="checkbox" checked={officersOnly} onChange={e => setOfficersOnly(e.target.checked)} />
                  Officers Only
                </label>

                {employees.length > 0 && (
                  <div className="btn-row" style={{ margin: 0, marginLeft: 8 }}>
                    <button className="btn btn-sm btn-outline" onClick={exportCSV} style={{ display: 'flex', alignItems: 'center', gap: 4 }}><FileDown size={14} /> CSV</button>
                    <button className="btn btn-sm btn-outline" onClick={exportJSON} style={{ display: 'flex', alignItems: 'center', gap: 4 }}><FileJson size={14} /> JSON</button>
                  </div>
                )}
              </div>
            </div>

            {filteredEmployees.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon"><User size={32} color="#94a3b8" /></div>
                <div className="empty-msg">No employees found matching your filters.</div>
              </div>
            ) : (
              <div className="emp-list">
                {filteredEmployees.map(emp => {
                  const roleStyle = emp.role ? (ROLE_COLORS[emp.role] || ROLE_COLORS.Member) : null;
                  return (
                    <div className="emp-item" key={emp.id}>
                      <div className="emp-avatar" style={{ overflow: 'hidden' }}>
                        {emp.profile_pic ? (
                          <img src={emp.profile_pic} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          initials(emp.name)
                        )}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div className="emp-name" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {emp.name}
                          <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>{formatUserId(emp.id, emp.duty, emp.start, emp.createdAt)}</span>
                        </div>
                        <div className="emp-meta">
                          <span className={`badge badge-${emp.duty.toLowerCase()}`}>{emp.duty} Duty</span>
                          {emp.office && <span className="badge badge-gray" style={{ marginLeft: 6 }}>{emp.office}</span>}
                          {emp.start && <span style={{ marginLeft: 8, fontSize: '0.8rem', color: '#666' }}>Since {emp.start}</span>}
                          {emp.username ? (
                            <span style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700, background: roleStyle.bg, color: roleStyle.color }}>
                              <UserCog size={10} style={{ display: 'inline', marginRight: 3 }} />{emp.username} · {emp.role}
                            </span>
                          ) : isSuperAdmin ? (
                            <span style={{ marginLeft: 8, fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>No account</span>
                          ) : null}
                        </div>
                      </div>
                      <div className="emp-actions-container" style={{ position: 'relative' }}>
                        <button
                          className="btn btn-sm btn-outline mobile-menu-toggle"
                          onClick={() => setOpenMenuId(openMenuId === emp.id ? null : emp.id)}
                        >
                          <MoreVertical size={16} />
                        </button>
                        <div className={`emp-actions ${openMenuId === emp.id ? 'mobile-open' : ''}`}>
                          {isSuperAdmin && emp.is_active !== false && (
                            <button className="btn btn-sm btn-outline" style={{ display: 'flex', alignItems: 'center', gap: 4 }} onClick={() => { openQrModal(emp); setOpenMenuId(null); }}>
                              <QrCode size={14} /> {emp.has_qr_code ? 'View QR' : 'Generate QR'}
                            </button>
                          )}
                          {canManageEmployees && <button className="btn btn-sm btn-outline" onClick={() => { setEditTarget(emp); setOpenMenuId(null); }}>Edit</button>}
                          {isSuperAdmin && emp.is_active !== false && (
                            <button className="btn btn-sm btn-danger" onClick={() => { setDeleteTarget({ ...emp, _action: 'archive' }); setOpenMenuId(null); }}>Archive</button>
                          )}
                          {isSuperAdmin && emp.is_active === false && (
                            <>
                              <button className="btn btn-sm btn-success" style={{ background: '#22c55e', color: '#fff', border: 'none' }} onClick={() => { setDeleteTarget({ ...emp, _action: 'activate' }); setOpenMenuId(null); }}>Activate</button>
                              <button className="btn btn-sm btn-danger" onClick={() => { setDeleteTarget({ ...emp, _action: 'delete' }); setOpenMenuId(null); }}>Delete Permanently</button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Delete Modal ── */}
      {deleteTarget && (
        <div className="modal-overlay">
          <div className="modal-content card" style={{ margin: 0 }}>
            <h3 style={{ marginTop: 0, color: deleteTarget?._action === 'activate' ? '#22c55e' : 'var(--red)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={20} />
              {deleteTarget?._action === 'activate' ? 'Confirm Activate' : deleteTarget?._action === 'delete' ? 'Confirm Permanent Delete' : 'Confirm Archive'}
            </h3>
            {deleteTarget?._action === 'activate' && (
              <p style={{ margin: '16px 0' }}>Re-activate <strong>{deleteTarget.name}</strong>? They will appear as an active employee again.</p>
            )}
            {deleteTarget?._action === 'delete' && (
              <>
                <p style={{ margin: '16px 0' }}>Permanently delete <strong>{deleteTarget.name}</strong>? This cannot be undone.</p>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Their fund history and login account (if any) will also be removed.</p>
              </>
            )}
            {(!deleteTarget?._action || deleteTarget?._action === 'archive') && (
              <>
                <p style={{ margin: '16px 0' }}>Archive <strong>{deleteTarget?.name}</strong>? Their fund history will be preserved.</p>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Their login account (if any) will also be disabled.</p>
              </>
            )}
            <div className="btn-row" style={{ marginTop: 24, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button
                className={`btn ${deleteTarget?._action === 'activate' ? 'btn-success' : 'btn-danger'}`}
                style={deleteTarget?._action === 'activate' ? { background: '#22c55e', color: '#fff', border: 'none' } : {}}
                onClick={executeDelete}
              >
                {deleteTarget?._action === 'activate' ? 'Yes, Activate' : deleteTarget?._action === 'delete' ? 'Yes, Delete Permanently' : 'Yes, Archive'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Confirm Modal ── */}
      {editTarget && (
        <div className="modal-overlay">
          <div className="modal-content card" style={{ maxWidth: 400, margin: '20px auto', padding: 24 }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: 18, fontWeight: 700, color: '#d97706', display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={20} />
              Confirm Edit
            </h3>
            <p style={{ margin: '16px 0' }}>
              Are you sure you want to edit the profile of <strong>{editTarget.name}</strong>?
            </p>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              Please be careful not to accidentally overwrite data that shouldn't be changed.
            </p>
            <div className="btn-row" style={{ marginTop: 24, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setEditTarget(null)}>Cancel</button>
              <button
                className="btn btn-primary"
                style={{ background: '#d97706', color: '#fff', border: 'none' }}
                onClick={() => { edit(editTarget); setEditTarget(null); }}
              >
                Yes, Edit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── QR Modal ── */}
      {qrModal.isOpen && (
        <div className="modal-overlay">
          <div className="modal-content card" style={{ maxWidth: 400, margin: '20px auto', padding: 24, textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Attendance ID</h3>
              <button onClick={() => setQrModal({ isOpen: false, employee: null, dataUrl: null, loading: false, error: null })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>{qrModal.employee?.name}</div>
            <div style={{ color: '#64748b', fontSize: 13, marginBottom: 20 }}>Scan this code to log attendance</div>

            <div style={{ minHeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0', marginBottom: 20 }}>
              {qrModal.loading ? (
                <div style={{ color: '#94a3b8' }}>Generating QR code...</div>
              ) : qrModal.error ? (
                <div style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AlertTriangle size={16} /> {qrModal.error}
                </div>
              ) : qrModal.dataUrl ? (
                <img src={qrModal.dataUrl} alt="QR Code" style={{ width: 280, height: 280 }} />
              ) : null}
            </div>

            <button
              onClick={() => {
                if (qrModal.dataUrl) {
                  const a = document.createElement('a');
                  a.href = qrModal.dataUrl;
                  a.download = `QR_${qrModal.employee.name.replace(/\s+/g, '_')}.png`;
                  a.click();
                }
              }}
              disabled={!qrModal.dataUrl}
              className="btn btn-primary"
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8 }}
            >
              <Download size={18} /> Download ID Card
            </button>

            {qrModal.employee?.has_qr_code && (
              <button
                onClick={handleReissueCard}
                disabled={qrModal.loading}
                className="btn btn-outline"
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#ef4444', borderColor: '#fca5a5' }}
              >
                <AlertTriangle size={18} /> Re-generate QR / Revoke
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Re-generate QR Confirm Modal ── */}
      {qrModal.showReissueConfirm && (
        <div className="modal-overlay" style={{ zIndex: 1050 }}>
          <div className="modal-content card" style={{ margin: 0, maxWidth: 400 }}>
            <h3 style={{ marginTop: 0, color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={20} />
              Confirm Re-generation
            </h3>
            <p style={{ margin: '16px 0', lineHeight: 1.5 }}>
              This person already has a generated QR code. Are you sure you want to regenerate a new one?
            </p>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: 24, lineHeight: 1.5 }}>
              This will <strong>permanently invalidate</strong> their current QR code, and they will need the new one to log attendance.
            </p>
            <div className="btn-row">
              <button className="btn btn-outline" onClick={() => setQrModal(prev => ({ ...prev, showReissueConfirm: false }))}>Cancel</button>
              <button className="btn btn-danger" onClick={confirmReissueCard}>Yes, Re-generate</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}