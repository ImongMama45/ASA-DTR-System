import { useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import MemberDashboard from './pages/MemberDashboard';
import Employees from './pages/Employees';
import Generator from './pages/Generator';
import Review from './pages/Review';
import FundTracker from './pages/FundTracker';
import UserManagement from './pages/UserManagement';
import UserSettings from './pages/Settings';
import ConfirmModal from './components/ConfirmModal';
import { useSync } from './hooks/useSync';
import { LayoutDashboard, Home, Users, Settings as SettingsIcon, Printer, Wallet, ShieldAlert, GraduationCap, UserCircle, Menu, X, ChevronRight } from 'lucide-react';
import './App.css';

const PAGE_LABELS = {
  dashboard: 'Dashboard',
  'my-dashboard': 'My Dashboard',
  employees: 'Employees',
  generator: 'Generate DTR',
  review: 'Review & Export',
  funds: 'Fund Tracker',
  users: 'User Management',
  settings: 'User Settings',
};

// ─── Inner app — only rendered when authenticated ─────────────────────────────
function AuthenticatedApp() {
  const { user, logout, isSuperAdmin, canManageEmployees, canCreateDTR } = useAuth();
  const { isOnline, isSyncing } = useSync();
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isOfficer = ['SuperAdmin', 'President', 'Vice President'].includes(user?.role);
  const defaultPage = isOfficer ? 'dashboard' : 'my-dashboard';
  const [page, setPage] = useState(defaultPage);

  const navItems = [
    ...(isOfficer
      ? [{ id: 'dashboard',  label: 'Dashboard',       icon: <LayoutDashboard size={18} /> }]
      : []),
    { id: 'my-dashboard',   label: 'My Dashboard',    icon: <Home size={18} /> },
    { id: 'employees',      label: 'Employees',        icon: <Users size={18} /> },
    ...(canCreateDTR
      ? [
          { id: 'generator', label: 'Generate DTR',   icon: <SettingsIcon size={18} /> },
          { id: 'review',    label: 'Review & Export', icon: <Printer size={18} /> },
        ]
      : []),
    { id: 'funds',          label: 'Fund Tracker',     icon: <Wallet size={18} /> },
    ...(isSuperAdmin
      ? [{ id: 'users',     label: 'User Management',  icon: <ShieldAlert size={18} /> }]
      : []),
    { id: 'settings',       label: 'User Settings',    icon: <UserCircle size={18} /> },
  ];

  function navigate(id) {
    setPage(id);
    setSidebarOpen(false);
  }

  function SidebarContent({ mobile }) {
    return (
      <aside className={`sidebar ${mobile ? 'sidebar-mobile' : 'sidebar-desktop'}`}>
        {/* Brand */}
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">
            <GraduationCap size={22} color="#fff" />
          </div>
          <div className="sidebar-brand-text">
            <div className="sidebar-brand-title">ASA — DTR</div>
            <div className="sidebar-brand-sub">System</div>
          </div>
          {mobile && (
            <button className="sidebar-close-btn" onClick={() => setSidebarOpen(false)}>
              <X size={20} />
            </button>
          )}
        </div>

        {/* Nav */}
        <nav className="sidebar-nav">
          <div className="sidebar-section-label">NAVIGATION</div>
          {navItems.map(n => (
            <button
              key={n.id}
              className={`sidebar-nav-item ${page === n.id ? 'active' : ''}`}
              onClick={() => navigate(n.id)}
            >
              <span className="sidebar-nav-icon">{n.icon}</span>
              <span className="sidebar-nav-label">{n.label}</span>
              {page === n.id && <ChevronRight size={14} className="sidebar-nav-arrow" />}
            </button>
          ))}
        </nav>

        {/* User card at bottom */}
        <div className="sidebar-user">
          <div className="sidebar-user-avatar">
            {user?.profile_pic
              ? <img src={user.profile_pic} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
              : (user?.employee_name || user?.username || '?')[0].toUpperCase()
            }
          </div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{user?.employee_name || user?.username}</div>
            <div className="sidebar-user-role">{user?.role}</div>
          </div>
          <button className="sidebar-signout-btn" onClick={() => setShowLogoutModal(true)} title="Sign Out">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>
      </aside>
    );
  }

  return (
    <div className="app-shell">
      {/* Desktop sidebar — always visible on wide screens */}
      <SidebarContent mobile={false} />

      {/* Mobile: dim overlay + slide-in drawer */}
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}
      {sidebarOpen && <SidebarContent mobile={true} />}

      {/* Right-hand panel: topbar + scrollable content */}
      <div className="app-body">
        <header className="app-topbar">
          <div className="topbar-left">
            <button className="hamburger-btn" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
              <Menu size={20} />
            </button>
            <div className="topbar-page-title">{PAGE_LABELS[page] || 'DTR System'}</div>
          </div>
          <div className="topbar-right">
            {isSyncing && <span className="status-badge syncing">↻ Syncing…</span>}
            <span className={`status-badge ${isOnline ? 'online' : 'offline'}`}>
              {isOnline ? '● Online' : '○ Offline'}
            </span>
            <button
              id="logout-btn"
              className="topbar-signout-btn"
              onClick={() => setShowLogoutModal(true)}
            >
              Sign Out
            </button>
          </div>
        </header>

        <main className="app-main">
          {page === 'dashboard'    && isOfficer    && <Dashboard isOnline={isOnline} setPage={setPage} />}
          {page === 'my-dashboard'                 && <MemberDashboard isOnline={isOnline} />}
          {page === 'employees'                    && <Employees isOnline={isOnline} />}
          {page === 'generator'    && canCreateDTR  && <Generator isOnline={isOnline} onDone={() => setPage('review')} />}
          {page === 'review'       && canCreateDTR  && <Review isOnline={isOnline} />}
          {page === 'funds'                        && <FundTracker isOnline={isOnline} />}
          {page === 'settings'                     && <UserSettings />}
          {page === 'users'        && isSuperAdmin   && <UserManagement />}
        </main>
      </div>

      <ConfirmModal
        isOpen={showLogoutModal}
        title="Sign Out"
        message="Are you sure you want to sign out? Any unsaved changes may be lost."
        onConfirm={() => { setShowLogoutModal(false); logout(); }}
        onCancel={() => setShowLogoutModal(false)}
      />
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