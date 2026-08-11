import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchLiveAttendance,
  fetchAttendanceAnomalies,
  dismissAnomaly,
  submitManualAttendance,
  fetchEmployees,
} from '../hooks/useSync';
import {
  Activity, AlertTriangle, CheckCircle, Clock, Upload, X,
  ChevronDown, ChevronUp, UserCheck, UserX, Eye, FileText, Camera,
} from 'lucide-react';
import Toast from '../components/Toast';
import ConfirmModal from '../components/ConfirmModal';
import LiveAttendanceHistory from '../components/LiveAttendanceHistory';
import LiveAttendanceAnalytics from '../components/LiveAttendanceAnalytics';

const SCAN_TYPE_LABELS = {
  AM_ARRIVAL: 'AM In',
  AM_DEPARTURE: 'AM Out',
  PM_ARRIVAL: 'PM In',
  PM_DEPARTURE: 'PM Out',
};

const SCAN_TYPE_COLORS = {
  AM_ARRIVAL: { bg: '#dcfce7', color: '#166534' },
  AM_DEPARTURE: { bg: '#fef3c7', color: '#92400e' },
  PM_ARRIVAL: { bg: '#dbeafe', color: '#1e40af' },
  PM_DEPARTURE: { bg: '#fce7f3', color: '#9d174d' },
};

export default function LiveAttendance() {
  const { isSuperAdmin } = useAuth();
  const [records, setRecords] = useState([]);
  const [anomalies, setAnomalies] = useState([]);
  const [unreviewedCount, setUnreviewedCount] = useState(0);
  const [serverTime, setServerTime] = useState('');
  const [loading, setLoading] = useState(true);
  const [localTime, setLocalTime] = useState(new Date());

  // Shared period selector — drives both History and Analytics
  const todayPHT = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }); // YYYY-MM-DD
  const [period, setPeriod] = useState('week');
  const [selectedDate, setSelectedDate] = useState(todayPHT);

  useEffect(() => {
    const timer = setInterval(() => setLocalTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Anomaly panel
  const [showAnomalies, setShowAnomalies] = useState(false);
  const [anomalyFilter, setAnomalyFilter] = useState('false'); // 'false' = unreviewed

  // Manual override form
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualData, setManualData] = useState({
    employee_id: '', scan_type: 'AM_ARRIVAL', location: '', admin_notes: '', anomaly_id: null,
  });
  const [proofFile, setProofFile] = useState(null);
  const [submittingManual, setSubmittingManual] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [proofModal, setProofModal] = useState({ isOpen: false, imageUrl: null, adminNotes: null });
  const [overwriteConfirm, setOverwriteConfirm] = useState(null);

  const [toast, setToast] = useState({ isOpen: false, type: 'success', message: '' });
  const showToast = (type, message) => setToast({ isOpen: true, type, message });

  const [todayAnomalyMap, setTodayAnomalyMap] = useState({});

  const [showNotLoggedInModal, setShowNotLoggedInModal] = useState(false);

  const pollRef = useRef(null);

  // Load employees for the manual form dropdown
  useEffect(() => {
    fetchEmployees().then(emps => setEmployees(emps.filter(e => e.is_active))).catch(() => { });
  }, []);

  // Poll attendance data every 5s
  useEffect(() => {
    const poll = async () => {
      try {
        const [data, todayAnoms] = await Promise.all([
          fetchLiveAttendance(),
          fetchAttendanceAnomalies('false').catch(() => []),
        ]);
        setRecords(data.records || []);
        setUnreviewedCount(data.unreviewed_anomalies || 0);
        setServerTime(data.server_time || '');
        // Build per-employee anomaly lookup for inline badges
        const map = {};
        (todayAnoms || []).forEach(a => {
          if (!a.employee) return;
          if (!map[a.employee]) map[a.employee] = [];
          if (!map[a.employee].includes(a.reason)) map[a.employee].push(a.reason);
        });
        setTodayAnomalyMap(map);
      } catch (e) {
        console.error('[LiveAttendance] poll failed:', e);
      }
      setLoading(false);
    };

    poll();
    pollRef.current = setInterval(poll, 5000);
    return () => clearInterval(pollRef.current);
  }, []);

  // Load anomalies when panel is opened or filter changes
  useEffect(() => {
    if (showAnomalies) {
      fetchAttendanceAnomalies(anomalyFilter).then(setAnomalies).catch(() => setAnomalies([]));
    }
  }, [showAnomalies, anomalyFilter]);

  // Refresh anomalies
  const refreshAnomalies = () => {
    fetchAttendanceAnomalies(anomalyFilter).then(setAnomalies).catch(() => setAnomalies([]));
  };

  // Dismiss anomaly
  const handleDismiss = async (anomalyId) => {
    try {
      await dismissAnomaly(anomalyId);
      showToast('success', 'Anomaly dismissed.');
      refreshAnomalies();
      setUnreviewedCount(c => Math.max(0, c - 1));
    } catch {
      showToast('error', 'Failed to dismiss anomaly.');
    }
  };

  // Group records by employee for the table view and collision detection
  const employeeMap = {};
  records.forEach(r => {
    const eid = r.employee || 'unknown';
    if (!employeeMap[eid]) {
      employeeMap[eid] = { name: r.employee_name, records: {} };
    }
    employeeMap[eid].records[r.scan_type] = r;
  });

  const loggedInIds = new Set(Object.keys(employeeMap).map(id => String(id)));
  const notLoggedInEmployees = employees.filter(e => !loggedInIds.has(String(e.id)));

  // Compute collision warning for manual modal
  let manualCollisionWarning = null;
  if (showManualForm && manualData.employee_id) {
    const empData = employeeMap[manualData.employee_id];
    if (empData) {
      const isArrival = manualData.scan_type.includes('ARRIVAL');
      const hasArrival = empData.records['AM_ARRIVAL'] || empData.records['PM_ARRIVAL'];
      const hasDeparture = empData.records['AM_DEPARTURE'] || empData.records['PM_DEPARTURE'];

      if (isArrival && hasArrival) {
        manualCollisionWarning = "This person has already logged in today.";
      } else if (!isArrival && hasDeparture) {
        manualCollisionWarning = "This person has already logged out today.";
      }
    }
  }

  const handleCreateManualFromAnomaly = (anomaly) => {
    setManualData({
      employee_id: anomaly.employee || '',
      scan_type: 'AM_ARRIVAL',
      time: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }),
      location: '',
      admin_notes: `Corrective entry for anomaly #${anomaly.id}: ${anomaly.reason}`,
      anomaly_id: anomaly.id,
    });
    setShowManualForm(true);
  };

  // Submit manual entry
  const handleManualSubmit = async (e, skipConfirm = false) => {
    if (e) e.preventDefault();
    if (!manualData.employee_id || !manualData.scan_type) {
      showToast('error', 'Please select an employee and scan type.');
      return;
    }
    if (!manualData.admin_notes.trim()) {
      showToast('error', 'Admin notes are required for manual entry.');
      return;
    }
    if (!proofFile) {
      showToast('error', 'Photo proof is required for manual entry.');
      return;
    }

    if (!skipConfirm) {
      const empData = employeeMap[manualData.employee_id];
      if (empData) {
        const isArrival = manualData.scan_type.includes('ARRIVAL');
        const hasArrival = empData.records['AM_ARRIVAL'] || empData.records['PM_ARRIVAL'];
        const hasDeparture = empData.records['AM_DEPARTURE'] || empData.records['PM_DEPARTURE'];
        
        if (isArrival && hasArrival) {
          setOverwriteConfirm("This person has already logged in today. Are you sure you want to overwrite their existing arrival record?");
          return;
        } else if (!isArrival && hasDeparture) {
          setOverwriteConfirm("This person has already logged out today. Are you sure you want to overwrite their existing departure record?");
          return;
        }
      }
    }

    setSubmittingManual(true);
    try {
      const fd = new FormData();
      fd.append('employee_id', manualData.employee_id);
      fd.append('scan_type', manualData.scan_type);
      if (manualData.time) fd.append('time', manualData.time);
      fd.append('location', manualData.location);
      fd.append('admin_notes', manualData.admin_notes);
      if (manualData.anomaly_id) fd.append('anomaly_id', manualData.anomaly_id);
      if (proofFile) fd.append('proof_image', proofFile);

      await submitManualAttendance(fd);
      showToast('success', 'Manual attendance entry created.');
      setShowManualForm(false);
      setManualData({ employee_id: '', scan_type: 'AM_ARRIVAL', time: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }), location: '', admin_notes: '', anomaly_id: null });
      setProofFile(null);
      refreshAnomalies();
    } catch {
      showToast('error', 'Failed to create manual entry.');
    }
    setSubmittingManual(false);
  };



  const inputStyle = {
    width: '100%', padding: '10px 12px', borderRadius: 6, border: '1px solid #cbd5e1',
    fontSize: 13, outline: 'none', boxSizing: 'border-box', color: '#1e293b', backgroundColor: '#fff',
  };

  if (!isSuperAdmin) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Access restricted to SuperAdmin.</div>;
  }

  return (
    <div style={{ maxWidth: '100%', margin: '0 auto', padding: '0 24px' }}>
      {toast.isOpen && <Toast type={toast.type} message={toast.message} onClose={() => setToast({ ...toast, isOpen: false })} />}
      <ConfirmModal
        isOpen={!!overwriteConfirm}
        title="Overwrite Existing Record?"
        message={overwriteConfirm}
        onConfirm={() => {
          setOverwriteConfirm(null);
          handleManualSubmit(null, true);
        }}
        onCancel={() => setOverwriteConfirm(null)}
      />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', margin: 0 }}>Live Attendance</h1>
          {serverTime && (
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Clock size={14} /> Server: {new Date(serverTime).toLocaleTimeString()}
              <span style={{ marginLeft: 8, width: 8, height: 8, borderRadius: '50%', background: '#22c55e', display: 'inline-block', animation: 'pulse 2s infinite' }} />
              Live
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setShowAnomalies(!showAnomalies)}
            style={{
              padding: '8px 16px', borderRadius: 8, border: '1px solid #e2e8f0', cursor: 'pointer',
              background: showAnomalies ? '#fef3c7' : '#fff', color: '#334155',
              fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <AlertTriangle size={16} color="#f59e0b" />
            Anomalies
            {unreviewedCount > 0 && (
              <span style={{
                background: '#ef4444', color: '#fff', borderRadius: 10, padding: '1px 7px',
                fontSize: 11, fontWeight: 700, marginLeft: 4,
              }}>{unreviewedCount}</span>
            )}
          </button>
          <button
            onClick={() => { setManualData({ employee_id: '', scan_type: 'AM_ARRIVAL', time: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }), location: '', admin_notes: '', anomaly_id: null }); setShowManualForm(true); }}
            style={{
              padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: '#1e293b', color: '#fff', fontSize: 13, fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <FileText size={16} /> Manual Entry
          </button>
        </div>
      </div>

      {/* Today's Attendance Table */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 20px', flexWrap: 'wrap' }}>
          <Activity size={18} color="#3b82f6" />
          <span style={{ fontWeight: 700, fontSize: 15 }}>Today's Attendance</span>
          <span style={{ fontSize: 14, color: '#64748b', marginLeft: 12, fontWeight: 500 }}>
            {localTime.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} • {localTime.toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila' })}
          </span>
          <button
            onClick={() => setShowNotLoggedInModal(true)}
            style={{
              marginLeft: 'auto', padding: '6px 12px', borderRadius: 8, border: '1px solid #e2e8f0',
              background: '#f8fafc', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6
            }}
          >
            Have not logged in yet ( {notLoggedInEmployees.length} )
          </button>
          <span style={{ fontSize: 13, color: '#94a3b8', marginLeft: 12 }}>
            {Object.keys(employeeMap).length} employee(s) logged in
          </span>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading...</div>
        ) : Object.keys(employeeMap).length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>No attendance recorded today yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, borderSpacing: 0 }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th rowSpan={2} style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 700, color: '#475569', borderRight: '1px solid #e2e8f0', borderBottom: '2px solid #e2e8f0', minWidth: 160 }}>Employee</th>
                  <th colSpan={6} style={{ textAlign: 'center', padding: '8px 12px', fontWeight: 700, color: '#047857', borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0', background: '#ecfdf5' }}>Arrivals (In)</th>
                  <th colSpan={6} style={{ textAlign: 'center', padding: '8px 12px', fontWeight: 700, color: '#b45309', borderBottom: '1px solid #e2e8f0', background: '#fffbeb' }}>Departures (Out)</th>
                </tr>
                <tr style={{ borderBottom: '2px solid #e2e8f0', background: '#f8fafc' }}>
                  <th style={{ textAlign: 'center', padding: '10px 12px', fontWeight: 600, color: '#64748b' }}>AM</th>
                  <th style={{ textAlign: 'center', padding: '10px 12px', fontWeight: 600, color: '#64748b' }}>PM</th>
                  <th style={{ textAlign: 'center', padding: '10px 12px', fontWeight: 600, color: '#64748b' }}>Time</th>
                  <th style={{ textAlign: 'center', padding: '10px 12px', fontWeight: 600, color: '#64748b' }}>Source</th>
                  <th style={{ textAlign: 'left', padding: '10px 16px', fontWeight: 600, color: '#64748b' }}>By</th>
                  <th style={{ textAlign: 'center', padding: '10px 12px', fontWeight: 600, color: '#64748b', borderRight: '1px solid #e2e8f0' }}>Role</th>
                  
                  <th style={{ textAlign: 'center', padding: '10px 12px', fontWeight: 600, color: '#64748b' }}>AM</th>
                  <th style={{ textAlign: 'center', padding: '10px 12px', fontWeight: 600, color: '#64748b' }}>PM</th>
                  <th style={{ textAlign: 'center', padding: '10px 12px', fontWeight: 600, color: '#64748b' }}>Time</th>
                  <th style={{ textAlign: 'center', padding: '10px 12px', fontWeight: 600, color: '#64748b' }}>Source</th>
                  <th style={{ textAlign: 'left', padding: '10px 16px', fontWeight: 600, color: '#64748b' }}>By</th>
                  <th style={{ textAlign: 'center', padding: '10px 12px', fontWeight: 600, color: '#64748b' }}>Role</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(employeeMap).map(([eid, { name, records: recs }]) => {
                  const allRecs = Object.values(recs);
                  const arrRecs = allRecs.filter(r => r.scan_type.includes('ARRIVAL')).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                  const latestArr = arrRecs[0];
                  const manualArr = arrRecs.find(r => r.source === 'MANUAL' && r.proof_image);

                  const depRecs = allRecs.filter(r => r.scan_type.includes('DEPARTURE')).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                  const latestDep = depRecs[0];
                  const manualDep = depRecs.find(r => r.source === 'MANUAL' && r.proof_image);

                  const renderMetadata = (latestRec, recList, manualRec, isArrival) => (
                    <>
                      <td style={{ textAlign: 'center', padding: '10px 12px', color: '#334155', fontWeight: 600 }}>
                        {latestRec ? new Date(latestRec.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : <span style={{ color: '#cbd5e1' }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'center', padding: '10px 12px' }}>
                        {recList.some(r => r.source === 'MANUAL') ? (
                          <button
                            onClick={() => manualRec ? setProofModal({ isOpen: true, imageUrl: manualRec.proof_image, adminNotes: manualRec.admin_notes }) : showToast('error', 'No proof image available.')}
                            style={{
                              fontSize: 11, padding: '2px 8px', borderRadius: 8, background: '#ede9fe', color: '#5b21b6',
                              fontWeight: 600, border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4
                            }}
                            title={manualRec ? "View Proof Image" : "Manual entry (No image)"}
                          >
                            <Eye size={12} /> Manual
                          </button>
                        ) : latestRec ? (
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 8, background: '#f1f5f9', color: '#64748b', fontWeight: 600 }}>QR</span>
                        ) : <span style={{ color: '#cbd5e1' }}>—</span>}
                      </td>
                      <td style={{ padding: '10px 16px', color: '#334155', fontWeight: 500 }}>
                        {latestRec?.scanned_by_display || <span style={{ color: '#cbd5e1' }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'center', padding: '10px 12px', color: '#64748b', borderRight: isArrival ? '1px solid #e2e8f0' : 'none' }}>
                        {latestRec?.scanned_by_role ? (
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, background: '#f1f5f9' }}>
                            {latestRec.scanned_by_role}
                          </span>
                        ) : <span style={{ color: '#cbd5e1' }}>—</span>}
                      </td>
                    </>
                  );

                  return (
                    <tr key={eid} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px 16px', fontWeight: 600, color: '#1e293b', borderRight: '1px solid #e2e8f0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span>{name}</span>
                          {(todayAnomalyMap[eid] || []).some(r => r.startsWith('LATE_ARRIVAL')) && (
                            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 8, background: '#fff7ed', color: '#c2410c', border: '1px solid #fdba74', letterSpacing: 0.3 }}>
                              LATE {(() => { const r = (todayAnomalyMap[eid] || []).find(r => r.startsWith('LATE_ARRIVAL')); const m = r?.match(/(\d+) min/); return m ? `+${m[1]}m` : ''; })()}
                            </span>
                          )}
                          {(todayAnomalyMap[eid] || []).some(r => r.startsWith('WRONG_SHIFT')) && (
                            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 8, background: '#fef2f2', color: '#b91c1c', border: '1px solid #fca5a5', letterSpacing: 0.3 }}>
                              WRONG SHIFT
                            </span>
                          )}
                        </div>
                      </td>
                      {['AM_ARRIVAL', 'PM_ARRIVAL'].map(type => {
                        const rec = recs[type];
                        const colors = SCAN_TYPE_COLORS[type];
                        return (
                          <td key={type} style={{ textAlign: 'center', padding: '10px 12px' }}>
                            {rec ? (
                              <span style={{
                                display: 'inline-block', padding: '3px 10px', borderRadius: 12,
                                fontSize: 12, fontWeight: 600, background: colors.bg, color: colors.color,
                              }}>
                                {new Date(rec.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            ) : (
                              <span style={{ color: '#cbd5e1' }}>—</span>
                            )}
                          </td>
                        );
                      })}
                      {renderMetadata(latestArr, arrRecs, manualArr, true)}
                      {['AM_DEPARTURE', 'PM_DEPARTURE'].map(type => {
                        const rec = recs[type];
                        const colors = SCAN_TYPE_COLORS[type];
                        return (
                          <td key={type} style={{ textAlign: 'center', padding: '10px 12px' }}>
                            {rec ? (
                              <span style={{
                                display: 'inline-block', padding: '3px 10px', borderRadius: 12,
                                fontSize: 12, fontWeight: 600, background: colors.bg, color: colors.color,
                              }}>
                                {new Date(rec.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            ) : (
                              <span style={{ color: '#cbd5e1' }}>—</span>
                            )}
                          </td>
                        );
                      })}
                      {renderMetadata(latestDep, depRecs, manualDep, false)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Period Toggle + History & Analytics ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#64748b' }}>View:</span>
        {['day', 'week', 'month', 'year'].map(p => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            style={{
              padding: '6px 16px', borderRadius: 8, border: '1px solid',
              borderColor: period === p ? '#6366f1' : '#e2e8f0',
              background: period === p ? '#6366f1' : '#fff',
              color: period === p ? '#fff' : '#64748b',
              fontWeight: 600, fontSize: 13, cursor: 'pointer', transition: 'all 0.15s',
            }}
          >{p.charAt(0).toUpperCase() + p.slice(1)}</button>
        ))}
        {period === 'day' && (
          <input
            type="date"
            value={selectedDate}
            max={todayPHT}
            onChange={e => setSelectedDate(e.target.value)}
            style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, color: '#334155', outline: 'none' }}
          />
        )}
      </div>

      <LiveAttendanceHistory period={period} selectedDate={selectedDate} />
      <LiveAttendanceAnalytics period={period} selectedDate={selectedDate} />

      {/* Not Logged In Modal */}
      {showNotLoggedInModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 12, width: 400, maxWidth: '90%', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 16, color: '#0f172a' }}>Not Logged In Yet</h3>
              <button onClick={() => setShowNotLoggedInModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                <X size={18} color="#64748b" />
              </button>
            </div>
            <div style={{ padding: 20, overflowY: 'auto' }}>
              {notLoggedInEmployees.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#94a3b8', padding: 20 }}>Everyone has logged in!</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {notLoggedInEmployees.map(emp => (
                    <div key={emp.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, background: '#f8fafc', borderRadius: 8 }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontWeight: 600 }}>
                        {emp.name.charAt(0)}
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{emp.name}</div>
                        <div style={{ fontSize: 12, color: '#64748b' }}>{emp.duty || 'AM'} Duty • {emp.office || 'No Office'}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Anomaly Panel */}
      {showAnomalies && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 20px' }}>
            <AlertTriangle size={18} color="#f59e0b" />
            <span style={{ fontWeight: 700, fontSize: 15 }}>Anomalies</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <select
                value={anomalyFilter}
                onChange={e => setAnomalyFilter(e.target.value)}
                style={{ ...inputStyle, width: 'auto', padding: '4px 8px', fontSize: 12 }}
              >
                <option value="false">Unreviewed</option>
                <option value="true">Reviewed</option>
                <option value="">All</option>
              </select>
            </div>
          </div>

          {anomalies.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
              No anomalies found.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {anomalies.map(a => (
                <div key={a.id} style={{
                  padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12,
                  borderBottom: '1px solid #f1f5f9', flexWrap: 'wrap',
                  background: a.reviewed ? '#f8fafc' : '#fff',
                }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontWeight: 600, color: '#1e293b', fontSize: 13 }}>
                      {a.employee_name || '[Unknown]'}
                    </div>
                    <div style={{ color: '#ef4444', fontSize: 12, fontWeight: 600 }}>{a.reason}</div>
                    <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>
                      {new Date(a.timestamp).toLocaleString()} — by {a.attempted_by_name}
                    </div>
                  </div>
                  {a.reviewed ? (
                    <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 12, background: '#dcfce7', color: '#166534', fontWeight: 600 }}>
                      <CheckCircle size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                      Reviewed
                    </span>
                  ) : (
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button
                        onClick={() => handleDismiss(a.id)}
                        style={{
                          padding: '5px 12px', borderRadius: 6, border: '1px solid #e2e8f0',
                          background: '#fff', color: '#64748b', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        }}
                      >
                        Dismiss
                      </button>
                      <button
                        onClick={() => handleCreateManualFromAnomaly(a)}
                        style={{
                          padding: '5px 12px', borderRadius: 6, border: 'none',
                          background: '#3b82f6', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        }}
                      >
                        Create Manual Entry
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Manual Override Modal */}
      {showManualForm && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', zIndex: 1500,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: '#fff', borderRadius: 12, padding: 28, width: '100%', maxWidth: 480,
            boxShadow: '0 20px 40px rgba(0,0,0,0.15)', maxHeight: '90vh', overflowY: 'auto',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#0f172a' }}>Manual Attendance Entry</h3>
              <button onClick={() => setShowManualForm(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
                <X size={20} />
              </button>
            </div>

            {manualData.anomaly_id && (
              <div style={{
                background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8,
                padding: '10px 14px', fontSize: 12, color: '#1e40af', marginBottom: 16,
              }}>
                Linked to Anomaly #{manualData.anomaly_id} — will be auto-resolved on submit.
              </div>
            )}

            <form onSubmit={handleManualSubmit}>
              {manualCollisionWarning && (
                <div style={{
                  background: '#fef2f2', border: '1px solid #f87171', borderRadius: 8,
                  padding: '10px 14px', fontSize: 13, color: '#b91c1c', marginBottom: 16,
                  display: 'flex', alignItems: 'center', gap: 8
                }}>
                  <AlertTriangle size={16} />
                  <div>
                    <strong>Warning:</strong> {manualCollisionWarning}<br/>
                    <span style={{fontSize: 11}}>Proceeding will overwrite their existing record.</span>
                  </div>
                </div>
              )}

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 6 }}>Employee</label>
                <select
                  value={manualData.employee_id}
                  onChange={e => setManualData({ ...manualData, employee_id: e.target.value })}
                  style={inputStyle}
                  required
                >
                  <option value="">Select employee…</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.name}</option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 6 }}>Scan Type</label>
                <select
                  value={manualData.scan_type}
                  onChange={e => setManualData({ ...manualData, scan_type: e.target.value })}
                  style={inputStyle}
                >
                  <option value="AM_ARRIVAL">AM Arrival</option>
                  <option value="AM_DEPARTURE">AM Departure</option>
                  <option value="PM_ARRIVAL">PM Arrival</option>
                  <option value="PM_DEPARTURE">PM Departure</option>
                </select>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 6 }}>Time</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input 
                    type="time" 
                    value={manualData.time || ''}
                    onChange={e => setManualData({ ...manualData, time: e.target.value })}
                    style={{ ...inputStyle, width: 'auto', fontSize: 16, fontFamily: 'monospace', padding: '8px 12px' }}
                    required
                  />
                  <span style={{ fontSize: 12, color: '#64748b' }}>Exact scan time</span>
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 6 }}>Location (optional)</label>
                <input type="text" value={manualData.location} onChange={e => setManualData({ ...manualData, location: e.target.value })} style={inputStyle} placeholder="e.g. Main Gate" />
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 6 }}>Admin Notes</label>
                <textarea
                  value={manualData.admin_notes}
                  onChange={e => setManualData({ ...manualData, admin_notes: e.target.value })}
                  style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }}
                  placeholder="Reason for manual entry…"
                  required
                />
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                  <Camera size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                  Photo Proof
                </label>
                <input type="file" accept="image/*" onChange={e => setProofFile(e.target.files[0])} style={{ fontSize: 13 }} required />
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="submit"
                  disabled={submittingManual}
                  style={{
                    flex: 1, padding: '10px 16px', borderRadius: 8, border: 'none',
                    background: '#1e293b', color: '#fff', fontSize: 14, fontWeight: 600,
                    cursor: submittingManual ? 'not-allowed' : 'pointer',
                  }}
                >
                  {submittingManual ? 'Creating...' : 'Create Entry'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowManualForm(false)}
                  style={{
                    padding: '10px 16px', borderRadius: 8, border: '1px solid #e2e8f0',
                    background: '#fff', color: '#64748b', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Proof Image Modal */}
      {proofModal.isOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 3000,
          backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center'
        }} onClick={() => setProofModal({ isOpen: false, imageUrl: null, adminNotes: null })}>
          <div style={{ position: 'relative', maxWidth: '90%', maxHeight: '90%', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setProofModal({ isOpen: false, imageUrl: null, adminNotes: null })}
              style={{
                position: 'absolute', top: -40, right: -40, background: 'none', border: 'none',
                color: '#fff', cursor: 'pointer', padding: 8
              }}
            >
              <X size={32} />
            </button>
            <div style={{ background: '#fff', borderRadius: 8, padding: 16, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <img
                src={proofModal.imageUrl}
                alt="Manual Entry Proof"
                style={{ maxWidth: '100%', maxHeight: '65vh', borderRadius: 4, objectFit: 'contain' }}
              />
              {proofModal.adminNotes && (
                <div style={{ padding: 12, background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0', color: '#334155', fontSize: 14 }}>
                  <strong style={{ color: '#0f172a' }}>Admin Notes:</strong><br />
                  <span style={{ whiteSpace: 'pre-wrap' }}>{proofModal.adminNotes}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
