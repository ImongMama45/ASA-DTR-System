import React, { useState, useEffect } from 'react';
import {
  GraduationCap,
  User,
  Lock,
  Eye,
  EyeOff,
  AlertTriangle,
  XCircle,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const reason = sessionStorage.getItem('logout_reason');
    if (reason) { setWarning(reason); sessionStorage.removeItem('logout_reason'); }
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(''); setWarning('');
    if (!username.trim() || !password) { setError('Please enter your username and password.'); return; }
    setLoading(true);
    try { await login(username.trim(), password); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

        .login-root {
          min-height: 100vh;
          display: grid;
          grid-template-columns: 1fr 1fr;
          font-family: 'Inter', system-ui, sans-serif;
          background: #0f172a;
        }

        /* ── Left panel ── */
        .login-left {
          position: relative;
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 60px 56px;
          background: linear-gradient(160deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%);
          overflow: hidden;
        }
        .login-left::before {
          content: '';
          position: absolute; inset: 0;
          background:
            radial-gradient(ellipse 60% 60% at 20% 80%, rgba(99,102,241,0.25) 0%, transparent 60%),
            radial-gradient(ellipse 50% 50% at 80% 20%, rgba(139,92,246,0.2) 0%, transparent 60%);
        }
        .login-left-content { position: relative; z-index: 1; }
        .login-logo-wrap {
          width: 56px; height: 56px; border-radius: 14px;
          background: rgba(255,255,255,0.12);
          backdrop-filter: blur(8px);
          border: 1px solid rgba(255,255,255,0.2);
          display: flex; align-items: center; justify-content: center;
          margin-bottom: 28px;
        }
        .login-brand {
          font-size: 28px; font-weight: 800;
          color: #fff; line-height: 1.2;
          margin: 0 0 8px;
          letter-spacing: -0.5px;
        }
        .login-brand-sub {
          font-size: 14px; font-weight: 500;
          color: rgba(255,255,255,0.6);
          margin: 0 0 48px;
          letter-spacing: 0.2px;
        }
        .login-feature-list {
          display: flex; flex-direction: column; gap: 20px;
        }
        .login-feature {
          display: flex; align-items: flex-start; gap: 14px;
        }
        .login-feature-icon {
          width: 38px; height: 38px; border-radius: 10px; flex-shrink: 0;
          background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.12);
          display: flex; align-items: center; justify-content: center;
          color: rgba(255,255,255,0.8);
        }
        .login-feature-title {
          font-size: 14px; font-weight: 600; color: #fff; margin-bottom: 2px;
        }
        .login-feature-desc {
          font-size: 12px; color: rgba(255,255,255,0.5); line-height: 1.5;
        }
        .login-left-footer {
          position: absolute; bottom: 28px; left: 56px;
          font-size: 11px; color: rgba(255,255,255,0.3);
        }

        /* ── Right panel ── */
        .login-right {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 40px 32px;
          background: #0f172a;
          overflow-y: auto;
        }
        .login-form-box {
          width: 100%; max-width: 420px;
        }
        .login-form-header { margin-bottom: 32px; }
        .login-form-title {
          font-size: 24px; font-weight: 800;
          color: #f1f5f9; margin: 0 0 6px;
          letter-spacing: -0.4px;
        }
        .login-form-subtitle {
          font-size: 14px; color: #64748b; margin: 0;
          font-weight: 400;
        }
        .login-divider {
          width: 40px; height: 3px;
          background: linear-gradient(90deg, #6366f1, #8b5cf6);
          border-radius: 2px;
          margin: 12px 0 0;
        }

        /* Banners */
        .login-banner {
          display: flex; align-items: flex-start; gap: 10px;
          border-radius: 10px; padding: 12px 14px;
          margin-bottom: 20px; font-size: 13px; line-height: 1.5;
        }
        .login-banner.warning {
          background: rgba(251,191,36,0.08);
          border: 1px solid rgba(251,191,36,0.25);
          color: #fde68a;
        }
        .login-banner.error {
          background: rgba(239,68,68,0.08);
          border: 1px solid rgba(239,68,68,0.25);
          color: #fca5a5;
        }
        .login-banner-icon { flex-shrink: 0; margin-top: 1px; }

        /* Form */
        .login-form { display: flex; flex-direction: column; gap: 20px; }
        .login-field { display: flex; flex-direction: column; gap: 6px; }
        .login-label {
          font-size: 11px; font-weight: 600;
          color: #64748b; letter-spacing: 0.8px;
          text-transform: uppercase;
        }
        .login-input-wrap { position: relative; }
        .login-input-icon {
          position: absolute; left: 14px; top: 50%; transform: translateY(-50%);
          color: #475569; pointer-events: none;
        }
        .login-input {
          width: 100%; box-sizing: border-box;
          padding: 12px 14px 12px 42px;
          background: rgba(30,41,59,0.8);
          border: 1px solid rgba(99,102,241,0.2);
          border-radius: 10px;
          font-size: 14px; color: #e2e8f0;
          outline: none;
          transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
          font-family: inherit;
        }
        .login-input::placeholder { color: #475569; }
        .login-input:focus {
          border-color: #6366f1;
          background: rgba(30,41,59,1);
          box-shadow: 0 0 0 3px rgba(99,102,241,0.15);
        }
        .login-eye-btn {
          position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
          background: none; border: none; cursor: pointer;
          color: #475569; padding: 4px;
          display: flex; align-items: center;
          transition: color 0.15s;
        }
        .login-eye-btn:hover { color: #94a3b8; }

        /* Submit */
        .login-submit {
          width: 100%; padding: 13px;
          background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
          border: none; border-radius: 10px;
          font-size: 15px; font-weight: 700;
          color: #fff; cursor: pointer;
          display: flex; align-items: center; justify-content: center; gap: 8px;
          box-shadow: 0 4px 16px rgba(99,102,241,0.35);
          transition: opacity 0.2s, transform 0.1s, box-shadow 0.2s;
          font-family: inherit; letter-spacing: 0.2px;
        }
        .login-submit:hover:not(:disabled) {
          opacity: 0.9;
          box-shadow: 0 6px 20px rgba(99,102,241,0.45);
          transform: translateY(-1px);
        }
        .login-submit:active:not(:disabled) { transform: translateY(0); }
        .login-submit:disabled { opacity: 0.65; cursor: not-allowed; }

        @keyframes spin { to { transform: rotate(360deg); } }
        .login-spinner { animation: spin 0.7s linear infinite; }

        /* Footer note */
        .login-note {
          margin-top: 28px;
          display: flex; align-items: flex-start; gap: 10px;
          padding: 14px 16px;
          background: rgba(99,102,241,0.06);
          border: 1px solid rgba(99,102,241,0.15);
          border-radius: 10px;
          color: #64748b; font-size: 12px; line-height: 1.6;
        }
        .login-note-icon { color: #6366f1; flex-shrink: 0; margin-top: 1px; }

        /* ── Responsive: collapse to single column on mobile ── */
        @media (max-width: 768px) {
          .login-root { grid-template-columns: 1fr; }
          .login-left { display: none; }
          .login-right { padding: 32px 24px; background: #0f172a; }
        }
        @media (max-width: 380px) {
          .login-right { padding: 24px 16px; }
          .login-form-title { font-size: 20px; }
        }
      `}</style>

      <div className="login-root">

        {/* ── Left panel: brand + feature highlights ── */}
        <div className="login-left">
          <div className="login-left-content">
            <div className="login-logo-wrap">
              <GraduationCap size={28} color="#fff" />
            </div>
            <h1 className="login-brand">ASA DTR System</h1>
            <p className="login-brand-sub">Alliance of Student Assistance</p>

            <div className="login-feature-list">
              {[
                {
                  icon: <ShieldCheck size={18} />,
                  title: 'Role-Based Access Control',
                  desc: 'Every action is gated by your assigned role — SuperAdmin down to Member.',
                },
                {
                  icon: <Lock size={18} />,
                  title: 'Secure JWT Authentication',
                  desc: 'Token rotation and blacklisting on every session. Automatic expiry.',
                },
                {
                  icon: <GraduationCap size={18} />,
                  title: 'Daily Time Records',
                  desc: 'Generate, review, and export formatted CS-Form 48 DTR batches.',
                },
              ].map((f, i) => (
                <div className="login-feature" key={i}>
                  <div className="login-feature-icon">{f.icon}</div>
                  <div>
                    <div className="login-feature-title">{f.title}</div>
                    <div className="login-feature-desc">{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="login-left-footer">ASA DTR &copy; {new Date().getFullYear()}</div>
        </div>

        {/* ── Right panel: login form ── */}
        <div className="login-right">
          <div className="login-form-box">

            <div className="login-form-header">
              <h2 className="login-form-title">Welcome back</h2>
              <p className="login-form-subtitle">Sign in to your account to continue.</p>
              <div className="login-divider" />
            </div>

            {warning && (
              <div className="login-banner warning">
                <AlertTriangle size={16} className="login-banner-icon" />
                <span>{warning}</span>
              </div>
            )}
            {error && (
              <div className="login-banner error">
                <XCircle size={16} className="login-banner-icon" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="login-form" noValidate>
              <div className="login-field">
                <label className="login-label" htmlFor="login-username">Username</label>
                <div className="login-input-wrap">
                  <User size={16} className="login-input-icon" />
                  <input
                    id="login-username"
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder="Enter your username"
                    autoComplete="username"
                    autoFocus
                    disabled={loading}
                    className="login-input"
                  />
                </div>
              </div>

              <div className="login-field">
                <label className="login-label" htmlFor="login-password">Password</label>
                <div className="login-input-wrap">
                  <Lock size={16} className="login-input-icon" />
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    disabled={loading}
                    className="login-input"
                    style={{ paddingRight: 44 }}
                  />
                  <button
                    type="button"
                    className="login-eye-btn"
                    onClick={() => setShowPassword(v => !v)}
                    tabIndex={-1}
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <button
                id="login-submit-btn"
                type="submit"
                disabled={loading}
                className="login-submit"
              >
                {loading ? (
                  <>
                    <Loader2 size={18} className="login-spinner" />
                    Signing in…
                  </>
                ) : 'Sign In'}
              </button>
            </form>

            <div className="login-note">
              <ShieldCheck size={15} className="login-note-icon" />
              <span>
                Accounts are provisioned by the system administrator only.
                Contact your officer if you need access.
              </span>
            </div>

          </div>
        </div>
      </div>
    </>
  );
}
