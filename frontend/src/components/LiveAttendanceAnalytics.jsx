import { useState, useEffect } from 'react';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from 'recharts';
import { TrendingUp, AlertTriangle, Clock, Activity } from 'lucide-react';

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
const PH_TZ = 'Asia/Manila';

function getDateRange(period, selectedDate) {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: PH_TZ }));
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (period === 'day') return { start: selectedDate, end: selectedDate, groupBy: 'day' };
  if (period === 'week') { const s = new Date(now); s.setDate(now.getDate() - 6); return { start: fmt(s), end: fmt(now), groupBy: 'day' }; }
  if (period === 'month') { const s = new Date(now); s.setDate(now.getDate() - 29); return { start: fmt(s), end: fmt(now), groupBy: 'week' }; }
  const s = new Date(now); s.setDate(now.getDate() - 364); return { start: fmt(s), end: fmt(now), groupBy: 'month' };
}

function fmtBarLabel(label, groupBy) {
  if (groupBy === 'day') return new Date(label + 'T00:00:00').toLocaleDateString('en-PH', { timeZone: PH_TZ, month: 'short', day: 'numeric' });
  if (groupBy === 'week') return 'Wk ' + new Date(label + 'T00:00:00').toLocaleDateString('en-PH', { timeZone: PH_TZ, month: 'short', day: 'numeric' });
  if (groupBy === 'month') return new Date(label + '-01T00:00:00').toLocaleDateString('en-PH', { timeZone: PH_TZ, month: 'short', year: '2-digit' });
  return label;
}

const PRESENT_COLOR = '#10b981'; // emerald-500
const ABSENT_COLOR = '#f43f5e';  // rose-500
const LATE_COLOR = '#f59e0b';    // amber-500
const SHIFT_COLOR = '#8b5cf6';   // violet-500

export default function LiveAttendanceAnalytics({ period, selectedDate }) {
  const [stats, setStats] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    setLoading(true);

    const { start, end, groupBy } = getDateRange(period, selectedDate);

    let statsUrl;
    if (period === 'day') {
      statsUrl = `${API_BASE}/attendance/stats/?period=day&date=${selectedDate}`;
    } else {
      statsUrl = `${API_BASE}/attendance/stats/`;
    }

    const chartUrl = `${API_BASE}/attendance/history/?start_date=${start}&end_date=${end}&group_by=${groupBy}`;

    Promise.all([
      fetch(statsUrl, { headers }).then(r => r.json()),
      fetch(chartUrl, { headers }).then(r => r.json()),
    ]).then(([statsData, chartRaw]) => {
      let s;
      if (period === 'day') s = statsData.day;
      else if (period === 'week') s = statsData.week;
      else if (period === 'month') s = statsData.month;
      else s = statsData.year;
      setStats(s || null);
      
      const raw = chartRaw.chart_data || [];
      setChartData(raw.map(d => ({ ...d, name: fmtBarLabel(d.label, groupBy) })));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [period, selectedDate]);

  const kpis = stats ? [
    { label: 'Total Scans', value: stats.total_logs, color: '#6366f1', bg: 'rgba(99,102,241,0.08)', icon: <Activity size={18} color="#6366f1" /> },
    { label: 'Anomalies', value: `${stats.anomalies} (${stats.anomaly_rate}%)`, color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', icon: <AlertTriangle size={18} color="#f59e0b" /> },
    { label: 'Avg Hours Rendered', value: stats.hours_rendered != null ? `${stats.hours_rendered}h` : '--', color: '#10b981', bg: 'rgba(16,185,129,0.08)', icon: <Clock size={18} color="#10b981" /> },
  ] : [];

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div style={{ background: '#1e293b', padding: '12px 16px', border: 'none', borderRadius: 8, color: '#f1f5f9', fontSize: 12, boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }}>
          <div style={{ fontWeight: 700, marginBottom: 8, color: '#cbd5e1' }}>{label || payload[0].payload.name}</div>
          {payload.map((entry, index) => (
            <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: entry.color }} />
              <span>{entry.name}:</span>
              <span style={{ fontWeight: 700, marginLeft: 'auto' }}>{entry.value}</span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  const renderDailyCharts = () => {
    const todayData = chartData[0] || { present: 0, absent: 0, late: 0, wrong_shift: 0 };
    const pieData = [
      { name: 'Present', value: todayData.present || 0 },
      { name: 'Absent', value: todayData.absent || 0 },
    ];
    
    // Only show anomalies that have values, or all if none
    const anomalyData = [
      { name: 'Lates', count: todayData.late || 0, fill: LATE_COLOR },
      { name: 'Wrong Shift', count: todayData.wrong_shift || 0, fill: SHIFT_COLOR },
    ];

    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
        {/* Present vs Absent Donut */}
        <div style={{ flex: '1 1 300px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Attendance Split
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={2} dataKey="value">
                <Cell fill={PRESENT_COLOR} />
                <Cell fill={ABSENT_COLOR} />
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend iconType="circle" iconSize={10} formatter={(v) => <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>{v}</span>} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Anomalies Bar */}
        <div style={{ flex: '1 1 300px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Anomalies Breakdown
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={anomalyData} margin={{ top: 20, right: 30, left: -20, bottom: 5 }} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
              <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: 'rgba(0,0,0,0.02)' }} contentStyle={{ background: '#1e293b', borderRadius: 8, color: '#fff', border: 'none' }} />
              <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                {anomalyData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  };

  const renderTrendCharts = () => {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
        {/* Present vs Absent Stacked Bar */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 16, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Attendance Volume (Present vs Absent)
          </div>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.02)' }} />
              <Legend iconType="circle" iconSize={10} wrapperStyle={{ paddingTop: 16 }} formatter={(v) => <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>{v}</span>} />
              <Bar dataKey="present" name="Present" stackId="a" fill={PRESENT_COLOR} radius={[0, 0, 4, 4]} />
              <Bar dataKey="absent" name="Absent" stackId="a" fill={ABSENT_COLOR} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Anomalies Trend */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 16, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Anomalies Trend
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.02)' }} />
              <Legend iconType="circle" iconSize={10} wrapperStyle={{ paddingTop: 16 }} formatter={(v) => <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>{v}</span>} />
              <Bar dataKey="late" name="Lates" fill={LATE_COLOR} radius={[4, 4, 0, 0]} />
              <Bar dataKey="wrong_shift" name="Wrong Shift" fill={SHIFT_COLOR} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  };

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>
        <TrendingUp size={18} color="#6366f1" />
        <span style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>Attendance Analytics</span>
        <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 4 }}>
          {period === 'day' ? 'today' : period === 'week' ? '— last 7 days' : period === 'month' ? '— last 30 days' : '— rolling 12 months'}
        </span>
      </div>

      <div style={{ padding: 24 }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: '#94a3b8', padding: 40 }}>Loading analytics...</div>
        ) : !stats ? (
          <div style={{ textAlign: 'center', color: '#94a3b8', padding: 40 }}>No data for this period.</div>
        ) : (
          <>
            {/* KPI row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px,1fr))', gap: 16, marginBottom: 32 }}>
              {kpis.map(k => (
                <div key={k.label} style={{ background: k.bg, borderRadius: 12, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ flexShrink: 0 }}>{k.icon}</div>
                  <div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: k.color, lineHeight: 1 }}>{k.value}</div>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{k.label}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Charts section */}
            <div style={{ background: '#fff', borderRadius: 12, padding: '24px 0 0 0' }}>
              {period === 'day' ? renderDailyCharts() : renderTrendCharts()}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
