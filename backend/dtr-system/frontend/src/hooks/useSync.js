import { useEffect, useRef, useState } from 'react';
import { getSyncQueue, clearSyncItem } from '../db';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

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
    } finally {
      setIsSyncing(false);
    }
  }

  return { isOnline, isSyncing, triggerSync };
}

export async function fetchDashboardStats() {
  const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';
  const res = await fetch(`${API_BASE}/dashboard/`);
  if (!res.ok) throw new Error('offline');
  return res.json();
}
