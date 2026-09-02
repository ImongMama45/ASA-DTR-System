import React, { useState, useEffect } from 'react';
import { Calendar, Search, Filter, Eye, X } from 'lucide-react';

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

const SCAN_TYPE_COLORS = {
  AM_ARRIVAL: { bg: '#dcfce7', color: '#166534' },
  AM_DEPARTURE: { bg: '#fef3c7', color: '#92400e' },
  PM_ARRIVAL: { bg: '#dbeafe', color: '#1e40af' },
  PM_DEPARTURE: { bg: '#fce7f3', color: '#9d174d' },
};

function getAuthHeaders() {
  const token = localStorage.getItem('access_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function HistoricalAttendanceTable() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [proofModal, setProofModal] = useState({ isOpen: false, imageUrl: null, adminNotes: null });
  
  // Default to today
  const today = new Date();
  
  const formatDate = (d) => {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const [startDate, setStartDate] = useState(formatDate(today));
  const [endDate, setEndDate] = useState(formatDate(today));
  const [showFilter, setShowFilter] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [dutyFilter, setDutyFilter] = useState('all');
  const [activeFilter, setActiveFilter] = useState('active');
  const [sortOrder, setSortOrder] = useState('a-z');
  const [officersOnly, setOfficersOnly] = useState(false);

  const fetchHistory = () => {
    setLoading(true);
    const query = new URLSearchParams({ start_date: startDate, end_date: endDate });
    fetch(`${API_BASE}/attendance/history/?${query.toString()}`, { headers: getAuthHeaders() })
      .then(res => res.json())
      .then(data => {
        setRecords(data.records || []);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch history', err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchHistory();
    // eslint-disable-next-line
  }, []);

  // Filter records
  const filteredRecords = records.filter(r => {
    if (searchQuery && !r.employee_name?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (dutyFilter !== 'all' && (r.employee_duty || 'AM') !== dutyFilter) return false;
    if (activeFilter === 'active' && r.employee_is_active === false) return false;
    if (activeFilter === 'archived' && r.employee_is_active !== false) return false;
    if (officersOnly && (r.employee_role || 'Member') === 'Member') return false;
    return true;
  });

  // Group by date, then by employee
  const groupedData = {};
  filteredRecords.forEach(r => {
    const d = new Date(r.timestamp).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
    });
    if (!groupedData[d]) groupedData[d] = {};
    if (!groupedData[d][r.employee_name]) groupedData[d][r.employee_name] = {};
    
    // Only set if not already set, to keep the newest record (since records are sorted by -timestamp)
    if (!groupedData[d][r.employee_name][r.scan_type]) {
      groupedData[d][r.employee_name][r.scan_type] = r;
    }
  });

  const dates = Object.keys(groupedData);

  const renderMetadata = (latestRec, recList, manualRec, isArrival) => (
    <>
      <td style={{ textAlign: 'center', padding: '10px 12px', color: '#334155', fontWeight: 600 }}>
        {latestRec ? new Date(latestRec.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : <span style={{ color: '#cbd5e1' }}>—</span>}
      </td>
      <td style={{ textAlign: 'center', padding: '10px 12px' }}>
        {latestRec?.source === 'MANUAL' ? (
          <button
            onClick={() => {
              if (manualRec) {
                setProofModal({ isOpen: true, imageUrl: manualRec.proof_image, adminNotes: manualRec.admin_notes });
              } else {
                alert("No proof image available for this manual entry.");
              }
            }}
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
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Calendar size={18} color="#0f766e" style={{ flexShrink: 0 }} />
          <span style={{ fontWeight: 700, fontSize: 15, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            Attendance Log History
          </span>
        </div>
        
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#64748b' }} />
            <input type="text" className="form-input" placeholder="Search SAs…"
              value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              style={{ width: 200, padding: '6px 12px 6px 28px' }} />
          </div>
          <div style={{ position: 'relative' }}>
          <button 
            onClick={() => setShowFilter(!showFilter)} 
            className="btn btn-primary" 
            style={{ padding: '6px 12px', fontSize: 13, gap: 6, display: 'flex', alignItems: 'center' }}
          >
            <Filter size={14} /> <span className="hide-mobile">Filter</span>
          </button>
          
          {showFilter && (
            <div 
              style={{ 
                position: 'absolute', top: '100%', right: 0, marginTop: 8, zIndex: 50,
                background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
                padding: 16, boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
                display: 'flex', flexDirection: 'column', gap: 12, minWidth: 200
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Filter by Date</div>
              <input 
                type="date" 
                value={startDate} 
                onChange={e => setStartDate(e.target.value)}
                style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 13 }}
              />
              <input 
                type="date" 
                value={endDate} 
                onChange={e => setEndDate(e.target.value)}
                style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 13 }}
              />

              <div style={{ height: 1, background: '#e2e8f0', margin: '4px 0' }} />

              <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Filters</div>

              <select className="form-select" value={dutyFilter} onChange={e => setDutyFilter(e.target.value)} style={{ padding: '8px 12px' }}>
                <option value="all">All Duties</option>
                <option value="AM">AM Duty</option>
                <option value="PM">PM Duty</option>
              </select>

              <select className="form-select" value={activeFilter} onChange={e => setActiveFilter(e.target.value)} style={{ padding: '8px 12px' }}>
                <option value="active">Active Only</option>
                <option value="archived">Archived</option>
                <option value="all">All Status</option>
              </select>

              <select className="form-select" value={sortOrder} onChange={e => setSortOrder(e.target.value)} style={{ padding: '8px 12px' }}>
                <option value="a-z">Alphabetical (A-Z)</option>
                <option value="z-a">Alphabetical (Z-A)</option>
              </select>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#475569', cursor: 'pointer' }}>
                <input type="checkbox" checked={officersOnly} onChange={e => setOfficersOnly(e.target.checked)} style={{ margin: 0 }} />
                Officers Only
              </label>

              <div style={{ height: 1, background: '#e2e8f0', margin: '4px 0' }} />
              <button 
                onClick={() => { fetchHistory(); setShowFilter(false); }} 
                className="btn btn-primary" 
                style={{ width: '100%', justifyContent: 'center' }}
              >
                Apply
              </button>
            </div>
          )}
        </div>
        </div>
      </div>

      <div style={{ padding: 20 }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: '#64748b', padding: 20 }}>Loading records...</div>
        ) : dates.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#64748b', padding: 20 }}>No records found for this date range.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {dates.map(dateKey => (
              <div key={dateKey} style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ background: '#f8fafc', padding: '12px 16px', fontWeight: 600, color: '#334155', borderBottom: '1px solid #e2e8f0' }}>
                  {dateKey}
                </div>
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
                      {Object.keys(groupedData[dateKey])
                        .sort((a, b) => {
                          if (sortOrder === 'a-z') return a.localeCompare(b);
                          if (sortOrder === 'z-a') return b.localeCompare(a);
                          return a.localeCompare(b);
                        })
                        .map(empName => {
                        const recs = groupedData[dateKey][empName];
                        const allRecs = Object.values(recs);
                        const arrRecs = allRecs.filter(r => r.scan_type.includes('ARRIVAL')).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                        const latestArr = arrRecs[0];
                        const manualArr = arrRecs.find(r => r.source === 'MANUAL' && r.proof_image);

                        const depRecs = allRecs.filter(r => r.scan_type.includes('DEPARTURE')).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                        const latestDep = depRecs[0];
                        const manualDep = depRecs.find(r => r.source === 'MANUAL' && r.proof_image);

                        return (
                          <tr key={empName} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '10px 16px', fontWeight: 600, color: '#1e293b', borderRight: '1px solid #e2e8f0' }}>{empName}</td>
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
              </div>
            ))}
          </div>
        )}
      </div>

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
