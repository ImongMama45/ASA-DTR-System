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

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse a CSV string into an array of employee-shaped objects.
 * Expected columns (case-insensitive, any order): name, duty, start
 */
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error('CSV has no data rows.');

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const nameIdx = headers.indexOf('name');
  const dutyIdx = headers.indexOf('duty');
  const startIdx = headers.indexOf('start');

  if (nameIdx === -1) throw new Error('CSV is missing a "name" column.');

  return lines.slice(1).map((line, i) => {
    const cols = line.split(',').map(c => c.trim());
    const name = cols[nameIdx]?.toUpperCase();
    if (!name) throw new Error(`Row ${i + 2}: name is empty.`);

    const duty = dutyIdx !== -1 ? cols[dutyIdx]?.toUpperCase() : 'AM';
    if (!['AM', 'PM'].includes(duty)) throw new Error(`Row ${i + 2}: duty must be AM or PM, got "${duty}".`);

    return {
      name,
      duty,
      start: startIdx !== -1 ? (cols[startIdx] || '') : '',
    };
  });
}

/**
 * Parse a JSON string — accepts either an array or { employees: [...] }.
 */
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
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── main component ────────────────────────────────────────────────────────────

export default function Employees({ isOnline }) {
  const [employees, setEmployees] = useState([]);
  const [form, setForm] = useState({ id: null, name: '', duty: 'AM', office: '', start: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [importStatus, setImportStatus] = useState(null); // { ok, skipped, errors[] }
  const [importing, setImporting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const fileInputRef = useRef();

  useEffect(() => { load(); }, [isOnline]);

  async function load() {
    if (isOnline) {
      try {
        const list = await fetchEmployees();
        await seedEmployees(list);
      } catch { /* fall through */ }
    }
    setEmployees(await getAllEmployees());
  }

  function setField(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function save() {
    if (!form.name.trim()) { setMsg({ type: 'danger', text: 'Please enter a name.' }); return; }
    setSaving(true);
    const data = { name: form.name.trim().toUpperCase(), duty: form.duty, office: form.office, start: form.start };

    if (isOnline) {
      try {
        if (form.id) { await updateServerEmployee(form.id, data); setMsg({ type: 'success', text: 'Employee updated.' }); }
        else { await createServerEmployee(data); setMsg({ type: 'success', text: 'Employee added.' }); }
        const list = await fetchEmployees();
        await seedEmployees(list);
      } catch {
        if (form.id) await updateEmployee({ ...data, id: form.id });
        else await addEmployee(data);
        setMsg({ type: 'success', text: 'Saved locally (will sync when online).' });
      }
    } else {
      if (form.id) await updateEmployee({ ...data, id: form.id });
      else await addEmployee(data);
      setMsg({ type: 'success', text: 'Saved locally (will sync when online).' });
    }

    setSaving(false);
    clearForm();
    load();
    setTimeout(() => setMsg(null), 3000);
  }

  function confirmDelete(emp) {
    setDeleteTarget(emp);
  }

  async function executeDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    if (isOnline) {
      try { await deleteServerEmployee(id); const list = await fetchEmployees(); await seedEmployees(list); }
      catch { await deleteEmployee(id); }
    } else {
      await deleteEmployee(id);
    }
    setDeleteTarget(null);
    load();
  }

  function edit(emp) {
    setForm({ id: emp.id, name: emp.name, duty: emp.duty, office: emp.office || '', start: emp.start || '' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function clearForm() { setForm({ id: null, name: '', duty: 'AM', office: '', start: '' }); }
  function initials(name) { return name.split(' ').map(w => w[0]).join('').slice(0, 2); }

  // ── import ──────────────────────────────────────────────────────────────────

  async function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset so the same file can be re-selected
    e.target.value = '';

    setImporting(true);
    setImportStatus(null);

    let rows;
    try {
      const text = await file.text();
      const ext = file.name.split('.').pop().toLowerCase();
      rows = ext === 'json' ? parseJSON(text) : parseCSV(text);
    } catch (err) {
      setImportStatus({ ok: 0, skipped: 0, errors: [err.message] });
      setImporting(false);
      return;
    }

    let ok = 0, skipped = 0;
    const errors = [];
    const existing = await getAllEmployees();
    const existingNames = new Set(existing.map(e => e.name));

    for (const row of rows) {
      if (existingNames.has(row.name)) { skipped++; continue; }

      try {
        if (isOnline) {
          try { await createServerEmployee(row); }
          catch { await addEmployee(row); }
        } else {
          await addEmployee(row);
        }
        existingNames.add(row.name);
        ok++;
      } catch (err) {
        errors.push(`${row.name}: ${err.message}`);
      }
    }

    // Re-seed from server if online so everything is in sync
    if (isOnline) {
      try { const list = await fetchEmployees(); await seedEmployees(list); } catch { /* ok */ }
    }

    setImportStatus({ ok, skipped, errors });
    setImporting(false);
    load();
  }

  // ── export ──────────────────────────────────────────────────────────────────

  function exportCSV() {
    const header = 'name,duty,office,start';
    const rows = employees.map(e => `${e.name},${e.duty},${e.office || ''},${e.start || ''}`);
    downloadFile([header, ...rows].join('\n'), 'employees.csv', 'text/csv');
  }

  function exportJSON() {
    const data = employees.map(({ name, duty, office, start }) => ({ name, duty, office: office || '', start: start || '' }));
    downloadFile(JSON.stringify(data, null, 2), 'employees.json', 'application/json');
  }

  // ── render ───────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* ── Add / Edit form ── */}
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
            <label className="form-label">Office (Optional)</label>
            <select className="form-select" value={form.office} onChange={e => setField('office', e.target.value)}>
              <option value="">-- None --</option>
              <option value="Finance Office">Finance Office</option>
              <option value="Registrar Office">Registrar Office</option>
              <option value="Maintenance Office">Maintenance Office</option>
              <option value="Clinic">Clinic</option>
              <option value="Admission/Guidance Office">Admission/Guidance Office</option>
              <option value="HR Office">HR Office</option>
              <option value="BSSW Program Head Office">BSSW Program Head Office</option>
              <option value="ICES Office">ICES Office</option>
              <option value="BSE Program Head Office">BSE Program Head Office</option>
              <option value="BSPA Program Head Office">BSPA Program Head Office</option>
              <option value="BTVTED/ABELS Program Head Office">BTVTED/ABELS Program Head Office</option>
              <option value="BSA/BSAIS Program Head Office">BSA/BSAIS Program Head Office</option>
              <option value="GAD Office">GAD Office</option>
              <option value="Library">Library</option>
              <option value="Admin Office">Admin Office</option>
              <option value="PE Department Office">PE Department Office</option>
              <option value="BSIT Program Head Office">BSIT Program Head Office</option>
              <option value="Alumni Office">Alumni Office</option>
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

      {/* ── Import card ── */}
      <div className="card">
        <div className="card-title">📂 Import Employees</div>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted, #666)', marginBottom: 12 }}>
          Upload a <strong>.csv</strong> or <strong>.json</strong> file to bulk-add employees.
          Duplicate names are skipped automatically.
        </p>

        {/* Template hint */}
        <details style={{ marginBottom: 12, fontSize: '0.8rem', color: 'var(--text-muted, #666)' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>View expected format</summary>
          <div style={{ marginTop: 8, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <strong>CSV</strong>
              <pre style={{ margin: '4px 0 0', background: 'var(--bg-muted, #f4f4f4)', padding: '8px 12px', borderRadius: 6, fontSize: '0.78rem' }}>
                {`name,duty,start
JUAN DELA CRUZ,AM,2023-01-15
MARIA SANTOS,PM,2022-06-01`}
              </pre>
            </div>
            <div>
              <strong>JSON</strong>
              <pre style={{ margin: '4px 0 0', background: 'var(--bg-muted, #f4f4f4)', padding: '8px 12px', borderRadius: 6, fontSize: '0.78rem' }}>
                {`[
  { "name": "JUAN DELA CRUZ", "duty": "AM", "start": "2023-01-15" },
  { "name": "MARIA SANTOS",   "duty": "PM", "start": "2022-06-01" }
]`}
              </pre>
            </div>
          </div>
        </details>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.json"
          style={{ display: 'none' }}
          onChange={handleFileUpload}
        />
        <button
          className="btn btn-primary"
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
        >
          {importing ? '⏳ Importing…' : '📁 Choose File (.csv / .json)'}
        </button>

        {/* Import result summary */}
        {importStatus && (
          <div style={{ marginTop: 14 }}>
            {importStatus.ok > 0 && (
              <div className="alert alert-success">
                ✅ {importStatus.ok} employee{importStatus.ok !== 1 ? 's' : ''} imported successfully.
              </div>
            )}
            {importStatus.skipped > 0 && (
              <div className="alert alert-warning">
                ⏭ {importStatus.skipped} duplicate{importStatus.skipped !== 1 ? 's' : ''} skipped (already exist).
              </div>
            )}
            {importStatus.errors.length > 0 && (
              <div className="alert alert-danger">
                <strong>⚠ {importStatus.errors.length} error{importStatus.errors.length !== 1 ? 's' : ''}:</strong>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {importStatus.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            )}
            {importStatus.ok === 0 && importStatus.skipped === 0 && importStatus.errors.length === 0 && (
              <div className="alert alert-warning">⚠ File was empty or had no valid rows.</div>
            )}
          </div>
        )}
      </div>

      {/* ── Employee list ── */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <div className="card-title" style={{ margin: 0 }}>👥 Employee List ({employees.length})</div>
          {employees.length > 0 && (
            <div className="btn-row" style={{ margin: 0 }}>
              <button className="btn btn-sm btn-outline" onClick={exportCSV} title="Download as CSV">⬇ CSV</button>
              <button className="btn btn-sm btn-outline" onClick={exportJSON} title="Download as JSON">⬇ JSON</button>
            </div>
          )}
        </div>

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
                    {emp.office && <span className="badge badge-gray" style={{ marginLeft: 6 }}>{emp.office}</span>}
                    {emp.start && <span style={{ marginLeft: 8 }}>Since {emp.start}</span>}
                    {!emp.synced && <span className="badge badge-gray" style={{ marginLeft: 6 }}>Unsynced</span>}
                  </div>
                </div>
                <div className="emp-actions">
                  <button className="btn btn-sm btn-outline" onClick={() => edit(emp)}>Edit</button>
                  <button className="btn btn-sm btn-danger" onClick={() => confirmDelete(emp)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* ── Delete Modal ── */}
      {deleteTarget && (
        <div className="modal-overlay">
          <div className="modal-content card" style={{ margin: 0 }}>
            <h3 style={{ marginTop: 0, color: 'var(--red)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              ⚠️ Confirm Deletion
            </h3>
            <p style={{ margin: '16px 0' }}>Are you sure you want to delete <strong>{deleteTarget.name}</strong>?</p>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>This action cannot be undone.</p>
            <div className="btn-row" style={{ marginTop: 24, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={executeDelete}>Yes, Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export { SearchableDropdown };