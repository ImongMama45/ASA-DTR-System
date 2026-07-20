import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);       // { id, username, role, employee_id, employee_name, has_usable_password }
  const [loading, setLoading] = useState(true); // true while checking stored token on mount

  const logout = useCallback((reason) => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    setUser(null);
    if (reason) {
      // Stash a reason message that the Login page can display
      sessionStorage.setItem('logout_reason', reason);
    }
  }, []);

  // Silently refresh the access token using the stored refresh token
  const refreshAccessToken = useCallback(async () => {
    const refresh = localStorage.getItem('refresh_token');
    if (!refresh) return null;
    try {
      const res = await fetch(`${API_BASE}/auth/token/refresh/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh }),
      });
      if (!res.ok) {
        logout('Your session has expired. Please log in again.');
        return null;
      }
      const data = await res.json();
      localStorage.setItem('access_token', data.access);
      localStorage.setItem('refresh_token', data.refresh);
      return data.access;
    } catch {
      logout('Connection error. Please log in again.');
      return null;
    }
  }, [logout]);

  // Fetch /me with the stored access token; refresh once if it's expired
  const fetchMe = useCallback(async () => {
    let token = localStorage.getItem('access_token');
    if (!token) { setLoading(false); return; }

    const tryFetch = async (tok) => {
      const res = await fetch(`${API_BASE}/auth/me/`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      return res;
    };

    try {
      let res = await tryFetch(token);
      if (res.status === 401) {
        // Token expired — try refreshing once
        token = await refreshAccessToken();
        if (!token) { setLoading(false); return; }
        res = await tryFetch(token);
      }
      if (res.ok) {
        setUser(await res.json());
      } else {
        logout();
      }
    } catch {
      logout('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }, [refreshAccessToken, logout]);

  useEffect(() => { fetchMe(); }, [fetchMe]);

  const login = useCallback(async (username, password) => {
    const res = await fetch(`${API_BASE}/auth/login/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed.');
    localStorage.setItem('access_token', data.access);
    localStorage.setItem('refresh_token', data.refresh);
    sessionStorage.removeItem('logout_reason');
    setUser(data.user);
    return data.user;
  }, []);

  // Authenticated fetch wrapper — auto-attaches Bearer token and retries once on 401
  const authFetch = useCallback(async (url, options = {}) => {
    let token = localStorage.getItem('access_token');
    const doFetch = (tok) => fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${tok}` },
    });

    let res = await doFetch(token);
    if (res.status === 401) {
      token = await refreshAccessToken();
      if (!token) throw new Error('Session expired.');
      res = await doFetch(token);
    }
    return res;
  }, [refreshAccessToken]);

  const value = {
    user,
    loading,
    login,
    logout,
    fetchMe,
    authFetch,
    // Role helpers
    isSuperAdmin: user?.role === 'SuperAdmin',
    canManageEmployees: ['SuperAdmin', 'President', 'Vice President'].includes(user?.role),
    canDeleteEmployees: user?.role === 'SuperAdmin',
    canCreateDTR: ['SuperAdmin', 'President', 'Vice President', 'Secretary'].includes(user?.role),
    canEditFunds: ['SuperAdmin', 'President', 'Vice President', 'Treasurer'].includes(user?.role),
    canManageUsers: user?.role === 'SuperAdmin',
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
