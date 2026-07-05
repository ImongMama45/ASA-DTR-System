import { useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';           // Admin dashboard (officers)
import MemberDashboard from './pages/MemberDashboard'; // Personal stats (members)
import Employees from './pages/Employees';
import Generator from './pages/Generator';
import Review from './pages/Review';
import FundTracker from './pages/FundTracker';
import UserManagement from './pages/UserManagement';
import { useSync } from './hooks/useSync';
import { LayoutDashboard, Home, Users, Settings, Printer, Wallet, ShieldAlert, GraduationCap } from 'lucide-react';
import './App.css';

// ─── Inner app — only rendered when authenticated ─────────────────────────────
function AuthenticatedApp() {
  const { user, logout, isSuperAdmin, canManageEmployees, canCreateDTR } = useAuth();
  const { isOnline, isSyncing } = useSync();

  // Members/Secretary/Treasurer land on the personal dashboard;
  // officers (President, VP, SuperAdmin) land on the admin overview.
  const isOfficer = ['SuperAdmin', 'President', 'Vice President'].includes(user?.role);
  const defaultPage = isOfficer ? 'dashboard' : 'my-dashboard';
  const [page, setPage] = useState(defaultPage);

  // Build navigation items based on role
  const navItems = [
    // Officers see the admin overview; everyone else sees their personal page
    ...(isOfficer
      ? [{ id: 'dashboard', label: <><LayoutDashboard size={16} /> Dashboard</> }]
      : []),
    { id: 'my-dashboard', label: <><Home size={16} /> My Dashboard</> },
    { id: 'employees',    label: <><Users size={16} /> Employees</> },
    ...(canCreateDTR
      ? [
          { id: 'generator', label: <><Settings size={16} /> Generate DTR</> },
          { id: 'review',    label: <><Printer size={16} /> Review & Export</> },
        ]
      : []),
    { id: 'funds', label: <><Wallet size={16} /> Fund Tracker</> },
    ...(isSuperAdmin
      ? [{ id: 'users', label: <><ShieldAlert size={16} /> User Management</> }]
      : []),
  ];

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-brand" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ background: 'rgba(255,255,255,0.1)', padding: 6, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <GraduationCap size={24} color="#fff" />
          </div>
          <div>
            <div className="header-title">Alliance of Student Assistance — DTR System</div>
          </div>
        </div>
        <div className="header-status" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {isSyncing && <span className="status-badge syncing">↻ Syncing…</span>}
          <span className={`status-badge ${isOnline ? 'online' : 'offline'}`}>
            {isOnline ? '● Online' : '○ Offline'}
          </span>
          {/* User chip */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'rgba(255,255,255,0.08)', borderRadius: 20,
            padding: '4px 12px 4px 6px', fontSize: 12,
          }}>
            <div style={{
              width: 26, height: 26, borderRadius: '50%',
              background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 11, color: '#fff',
            }}>
              {(user?.employee_name || user?.username || '?')[0].toUpperCase()}
            </div>
            <span style={{ color: '#e2e8f0', fontWeight: 600 }}>
              {user?.employee_name || user?.username}
            </span>
            <span style={{ color: '#94a3b8', fontSize: 11 }}>({user?.role})</span>
          </div>
          <button
            id="logout-btn"
            onClick={() => { if (window.confirm('Are you sure you want to log out?')) logout(); }}
            style={{
              background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)',
              color: '#fca5a5', padding: '5px 12px', borderRadius: 8,
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Sign Out
          </button>
        </div>
      </header>

      <nav className="app-nav">
        {navItems.map(n => (
          <button
            key={n.id}
            className={`nav-item ${page === n.id ? 'active' : ''}`}
            onClick={() => setPage(n.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            {n.label}
          </button>
        ))}
      </nav>

      <main className="app-main">
        {page === 'dashboard'    && isOfficer   && <Dashboard isOnline={isOnline} setPage={setPage} />}
        {page === 'my-dashboard'                && <MemberDashboard isOnline={isOnline} />}
        {page === 'employees'                   && <Employees isOnline={isOnline} />}
        {page === 'generator'    && canCreateDTR && <Generator isOnline={isOnline} onDone={() => setPage('review')} />}
        {page === 'review'       && canCreateDTR && <Review isOnline={isOnline} />}
        {page === 'funds'                       && <FundTracker isOnline={isOnline} />}
        {page === 'users'        && isSuperAdmin  && <UserManagement />}
      </main>
    </div>
  );
}

// ─── Root — shows Login until authenticated ───────────────────────────────────
function AppInner() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(135deg,#0f172a,#1e293b)',
        color: '#94a3b8', fontSize: 14, gap: 12, flexDirection: 'column',
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%',
          border: '3px solid rgba(99,102,241,0.3)',
          borderTop: '3px solid #6366f1',
          animation: 'spin 0.8s linear infinite',
        }} />
        Loading…
      </div>
    );
  }

  if (!user) return <Login />;
  return <AuthenticatedApp />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}