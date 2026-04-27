import { useState, useEffect } from 'react';
import Dashboard from './pages/Dashboard';
import Employees from './pages/Employees';
import Generator from './pages/Generator';
import Review from './pages/Review';
import { useSync } from './hooks/useSync';
import './App.css';

export default function App() {
  const [page, setPage] = useState('dashboard');
  const { isOnline, isSyncing } = useSync();

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-brand">
          <div>
            <div className="header-title">Alliance of Student Assisstance - DTR Admin System</div>
          </div>
        </div>
        <div className="header-status">
          {isSyncing && <span className="status-badge syncing">↻ Syncing…</span>}
          <span className={`status-badge ${isOnline ? 'online' : 'offline'}`}>
            {isOnline ? '● Online' : '○ Offline'}
          </span>
        </div>
      </header>

      <nav className="app-nav">
        {[
          { id: 'dashboard', label: '⊞ Dashboard' },
          { id: 'employees', label: '👤 Employees' },
          { id: 'generator', label: '⚙ Generate DTR' },
          { id: 'review', label: '🖨 Review & Export' },
        ].map(n => (
          <button
            key={n.id}
            className={`nav-item ${page === n.id ? 'active' : ''}`}
            onClick={() => setPage(n.id)}
          >
            {n.label}
          </button>
        ))}
      </nav>

      <main className="app-main">
        {page === 'dashboard' && <Dashboard isOnline={isOnline} setPage={setPage} />}
        {page === 'employees' && <Employees />}
        {page === 'generator' && <Generator onDone={() => setPage('review')} />}
        {page === 'review' && <Review />}
      </main>
    </div>
  );
}
