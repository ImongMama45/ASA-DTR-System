import React, { useState, useEffect } from 'react';
import { Activity, Clock, AlertTriangle, CalendarDays } from 'lucide-react';

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

function getAuthHeaders() {
  const token = localStorage.getItem('access_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function AttendanceStatsCard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('week'); // 'week', 'month', 'year'

  useEffect(() => {
    let isMounted = true;
    fetch(`${API_BASE}/attendance/stats/`, { headers: getAuthHeaders() })
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch');
        return res.json();
      })
      .then(data => {
        if (isMounted) {
          setStats(data);
          setLoading(false);
        }
      })
      .catch(err => {
        console.error('Failed to fetch attendance stats', err);
        if (isMounted) setLoading(false);
      });
    return () => { isMounted = false; };
  }, []);

  if (loading) {
    return (
      <div className="card" style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>
        Loading stats...
      </div>
    );
  }

  if (!stats) return null;

  const currentStats = stats[view];

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <CalendarDays size={18} color="#3b82f6" />
          <span style={{ fontWeight: 700, fontSize: 15, color: '#1e293b' }}>Attendance Overview</span>
        </div>
        <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: 8, padding: 4 }}>
          {['week', 'month', 'year'].map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                padding: '4px 12px',
                border: 'none',
                background: view === v ? '#fff' : 'transparent',
                color: view === v ? '#0f172a' : '#64748b',
                fontWeight: view === v ? 600 : 500,
                fontSize: 12,
                borderRadius: 6,
                cursor: 'pointer',
                boxShadow: view === v ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                textTransform: 'capitalize'
              }}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, padding: 20, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200, background: '#f8fafc', padding: 16, borderRadius: 12, border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#64748b', marginBottom: 8 }}>
            <Activity size={16} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>Total Scans</span>
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#0f172a' }}>
            {currentStats.total_logs}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 200, background: '#fffbeb', padding: 16, borderRadius: 12, border: '1px solid #fde68a' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#b45309', marginBottom: 8 }}>
            <AlertTriangle size={16} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>Anomalies</span>
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#92400e' }}>
            {currentStats.anomalies}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 200, background: '#f0fdf4', padding: 16, borderRadius: 12, border: '1px solid #bbf7d0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#15803d', marginBottom: 8 }}>
            <Clock size={16} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>Hours Rendered</span>
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#166534' }}>
            {currentStats.hours_rendered}
          </div>
          <div style={{ fontSize: 11, color: '#166534', opacity: 0.8, marginTop: 4 }}>
            *Only counts fully-paired days
          </div>
        </div>
      </div>
    </div>
  );
}
