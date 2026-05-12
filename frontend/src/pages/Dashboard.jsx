import { useState, useEffect } from 'react';
import { getAllEmployees, getAllBatches } from '../db';
import { fetchDashboardStats } from '../hooks/useSync';
import { MONTH_NAMES } from '../utils/dateUtils';

export default function Dashboard({ isOnline, setPage }) {
  const [employees, setEmployees] = useState([]);
  const [batches, setBatches] = useState([]);
  const [serverStats, setServerStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLocal();
    if (isOnline) loadServer();
  }, [isOnline]);

  async function loadLocal() {
    setLoading(true);
    const [emps, bats] = await Promise.all([getAllEmployees(), getAllBatches()]);
    setEmployees(emps);
    setBatches(bats.sort((a, b) => b.createdAt - a.createdAt));
    setLoading(false);
  }

  async function loadServer() {
    try {
      const stats = await fetchDashboardStats();
      setServerStats(stats);
    } catch { /* offline */ }
  }

  const totalPresent = batches.reduce((acc, b) =>
    acc + (b.employees || []).reduce((a2, ed) =>
      a2 + (ed.rows || []).filter(r => r.status === 'present').length, 0), 0);

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-box">
          <div className="stat-num">{employees.length}</div>
          <div className="stat-lbl">Total Employees</div>
        </div>
        <div className="stat-box green">
          <div className="stat-num">{batches.length}</div>
          <div className="stat-lbl">DTR Batches Generated</div>
        </div>
        <div className="stat-box amber">
          <div className="stat-num">{totalPresent}</div>
          <div className="stat-lbl">Total Present Days Recorded</div>
        </div>
        <div className="stat-box" style={{ background: '#5c3a1a' }}>
          <div className="stat-num">{isOnline ? '●' : '○'}</div>
          <div className="stat-lbl">{isOnline ? 'Online – Synced' : 'Offline Mode'}</div>
        </div>
      </div>

      {!isOnline && (
        <div className="alert alert-warning">
          ⚠ You are offline. All changes are saved locally and will sync when internet is available.
        </div>
      )}

      <div className="card">
        <div className="card-title">📂 DTR Batch History</div>
        {loading && <div className="empty-state"><div className="empty-msg">Loading…</div></div>}
        {!loading && batches.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">📄</div>
            <div className="empty-msg">No DTRs generated yet.</div>
            <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => setPage('generator')}>
              Generate First DTR
            </button>
          </div>
        )}
        {batches.map((b, i) => (
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

      {serverStats && (
        <div className="card">
          <div className="card-title">☁ Server Statistics</div>
          <div className="form-grid-3">
            <div><strong>{serverStats.total_employees || 0}</strong><br /><span style={{ fontSize: 11 }}>Server Employees</span></div>
            <div><strong>{serverStats.total_batches || 0}</strong><br /><span style={{ fontSize: 11 }}>Server Batches</span></div>
            <div><strong>{serverStats.last_sync || '—'}</strong><br /><span style={{ fontSize: 11 }}>Last Sync</span></div>
          </div>
        </div>
      )}
    </div>
  );
}
