import { useEffect, useRef, useState } from 'react';
import { getSyncQueue, clearSyncItem, seedEmployees, seedBatches } from '../db';

// Use VITE_API_URL from .env for production builds (Netlify).
// Falls back to '/api' which Vite's dev-server proxy rewrites to localhost:8000.
const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

// ── Low-level helper ──────────────────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.status === 204 ? null : res.json();
}

// ── Read helpers ──────────────────────────────────────────────────────────────
export async function fetchEmployees() {
  const data = await apiFetch('/employees/');
  return Array.isArray(data) ? data : (data.results ?? []);
}

export async function fetchBatches() {
  const data = await apiFetch('/batches/');
  return Array.isArray(data) ? data : (data.results ?? []);
}

export async function fetchDashboardStats() {
  return apiFetch('/dashboard/');
}

// ── Employee write helpers ────────────────────────────────────────────────────
export async function createServerEmployee(emp) {
  return apiFetch('/employees/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: emp.name, duty: emp.duty, start_date: emp.start || null }),
  });
}

export async function updateServerEmployee(id, emp) {
  return apiFetch(`/employees/${id}/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: emp.name, duty: emp.duty, start_date: emp.start || null }),
  });
}

export async function deleteServerEmployee(id) {
  return apiFetch(`/employees/${id}/`, { method: 'DELETE' });
}

// ── Batch write helpers ───────────────────────────────────────────────────────
export async function createServerBatch(batch) {
  return apiFetch('/batches/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(batch),
  });
}

export async function updateServerBatch(id, batch) {
  return apiFetch(`/batches/${id}/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(batch),
  });
}

// ── Sync hook ─────────────────────────────────────────────────────────────────
export function useSync() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const syncTimerRef = useRef(null);

  useEffect(() => {
    const onOnline = () => { setIsOnline(true); triggerSync(); };
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  async function triggerSync() {
    if (!navigator.onLine) return;
    clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(runSync, 2000);
  }

  async function runSync() {
    setIsSyncing(true);
    try {
      const queue = await getSyncQueue();
      for (const item of queue) {
        try {
          await fetch(`${API_BASE}/sync/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item),
          });
          await clearSyncItem(item.id);
        } catch (e) {
          // Backend unavailable – keep in queue
        }
      }
      // After draining the queue, re-seed local DB from server
      // so all records flip from synced:false → synced:true
      if (navigator.onLine) {
        try {
          const [emps, bats] = await Promise.all([fetchEmployees(), fetchBatches()]);
          await Promise.all([seedEmployees(emps), seedBatches(bats)]);
        } catch (e) { /* seed failed, not critical */ }
      }
    } finally {
      setIsSyncing(false);
    }
  }

  return { isOnline, isSyncing, triggerSync };
}