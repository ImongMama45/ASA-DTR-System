import { useState, useEffect, useRef } from 'react';
import { getAllEmployees, addEmployee, updateEmployee, deleteEmployee, seedEmployees } from '../db';
import {
  fetchEmployees,
  createServerEmployee,
  updateServerEmployee,
  deleteServerEmployee,
} from '../hooks/useSync';

function SearchableDropdown({ employees, onSelect }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const ref = useRef();

  useEffect(() => {
    const handler = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = employees.filter(e =>
    e.name.toLowerCase().includes(query.toLowerCase())
  );

  function pick(emp) {
    setSelected(emp);
    setQuery(emp.name);
    setOpen(false);
    onSelect(emp);
  }

  return (
    <div className="search-dropdown" ref={ref}>
      <input
        className="form-input"
        placeholder="Type to search employees…"
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); setSelected(null); onSelect(null); }}
        onFocus={() => setOpen(true)}
      />
      {open && filtered.length > 0 && (
        <div className="dropdown-list">
          {filtered.map(emp => (
            <div
              key={emp.id}
              className={`dropdown-item ${selected?.id === emp.id ? 'selected' : ''}`}
              onMouseDown={() => pick(emp)}
            >
              <strong>{emp.name}</strong>
              <span className={`badge badge-${emp.duty.toLowerCase()}`} style={{ marginLeft: 8 }}>{emp.duty}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Employees({ isOnline }) {
  const [employees, setEmployees] = useState([]);
  const [form, setForm] = useState({ id: null, name: '', duty: 'AM', start: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  // Reload whenever online status changes so new devices get server data immediately
  useEffect(() => { load(); }, [isOnline]);

  async function load() {
    if (isOnline) {
      try {
        const list = await fetchEmployees();
        await seedEmployees(list);
      } catch (e) {
        // Server unreachable — fall through to local
      }
    }
    setEmployees(await getAllEmployees());
  }

  function setField(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function save() {
    if (!form.name.trim()) { setMsg({ type: 'danger', text: 'Please enter a name.' }); return; }
    setSaving(true);
    const data = { name: form.name.trim().toUpperCase(), duty: form.duty, start: form.start };

    if (isOnline) {
      try {
        if (form.id) {
          await updateServerEmployee(form.id, data);
          setMsg({ type: 'success', text: 'Employee updated.' });
        } else {
          await createServerEmployee(data);
          setMsg({ type: 'success', text: 'Employee added.' });
        }
        // Re-seed so local DB reflects server state (synced: true)
        const list = await fetchEmployees();
        await seedEmployees(list);
      } catch (e) {
        // Server error — fall back to local queue
        if (form.id) {
          await updateEmployee({ ...data, id: form.id });
        } else {
          await addEmployee(data);
        }
        setMsg({ type: 'success', text: 'Saved locally (will sync when online).' });
      }
    } else {
      // Offline — write to IndexedDB + sync queue
      if (form.id) {
        await updateEmployee({ ...data, id: form.id });
      } else {
        await addEmployee(data);
      }
      setMsg({ type: 'success', text: 'Saved locally (will sync when online).' });
    }

    setSaving(false);
    clearForm();
    load();
    setTimeout(() => setMsg(null), 3000);
  }

  async function del(id) {
    if (!confirm('Delete this employee?')) return;
    if (isOnline) {
      try {
        await deleteServerEmployee(id);
        const list = await fetchEmployees();
        await seedEmployees(list);
      } catch (e) {
        await deleteEmployee(id);
      }
    } else {
      await deleteEmployee(id);
    }
    load();
  }

  function edit(emp) {
    setForm({ id: emp.id, name: emp.name, duty: emp.duty, start: emp.start || '' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function clearForm() { setForm({ id: null, name: '', duty: 'AM', start: '' }); }

  function initials(name) { return name.split(' ').map(w => w[0]).join('').slice(0, 2); }

  return (
    <div>
      <div className="card">
        <div className="card-title">{form.id ? '✏ Edit Employee' : '➕ Add Employee'}</div>
        {msg && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}
        <div className="form-grid">
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label className="form-label">Full Name (ALL CAPS)</label>
            <input
              className="form-input"
              placeholder="e.g. JUAN DELA CRUZ"
              value={form.name}
              onChange={e => setField('name', e.target.value.toUpperCase())}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Duty Type</label>
            <select className="form-select" value={form.duty} onChange={e => setField('duty', e.target.value)}>
              <option value="AM">AM (Morning Duty)</option>
              <option value="PM">PM (Afternoon Duty)</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Start Date</label>
            <input type="date" className="form-input" value={form.start} onChange={e => setField('start', e.target.value)} />
          </div>
        </div>
        <div className="btn-row">
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : (form.id ? '💾 Update Employee' : '➕ Add Employee')}
          </button>
          {form.id && <button className="btn btn-secondary" onClick={clearForm}>Cancel</button>}
        </div>
      </div>

      <div className="card">
        <div className="card-title">👥 Employee List ({employees.length})</div>

        {employees.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">👤</div>
            <div className="empty-msg">No employees added yet.</div>
          </div>
        ) : (
          <div className="emp-list">
            {employees.map(emp => (
              <div className="emp-item" key={emp.id}>
                <div className="emp-avatar">{initials(emp.name)}</div>
                <div style={{ flex: 1 }}>
                  <div className="emp-name">{emp.name}</div>
                  <div className="emp-meta">
                    <span className={`badge badge-${emp.duty.toLowerCase()}`}>{emp.duty} Duty</span>
                    {emp.start && <span style={{ marginLeft: 8 }}>Since {emp.start}</span>}
                    {!emp.synced && <span className="badge badge-gray" style={{ marginLeft: 6 }}>Unsynced</span>}
                  </div>
                </div>
                <div className="emp-actions">
                  <button className="btn btn-sm btn-outline" onClick={() => edit(emp)}>Edit</button>
                  <button className="btn btn-sm btn-danger" onClick={() => del(emp.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export { SearchableDropdown };
