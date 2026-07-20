import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Camera, Key, Activity, Users, Save, Check, Eye, EyeOff } from 'lucide-react';
import Toast from '../components/Toast';
import ConfirmModal from '../components/ConfirmModal';

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

function getAuthHeaders() {
  const token = localStorage.getItem('access_token');
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

async function apiFetch(endpoint, options = {}) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      ...getAuthHeaders(),
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || error.detail || 'API Request failed');
  }
}
export default function UserSettings() {
  const { user, fetchMe } = useAuth();
  const [activeTab, setActiveTab] = useState('profile');
  const [toast, setToast] = useState({ isOpen: false, type: 'success', message: '' });

  const showToast = (type, message) => setToast({ isOpen: true, type, message });

  // Profile Picture state
  const [profilePic, setProfilePic] = useState(user?.profile_pic || null);
  const [savingPic, setSavingPic] = useState(false);
  const [pendingPic, setPendingPic] = useState(null);
  const [isPhotoViewerOpen, setIsPhotoViewerOpen] = useState(false);
  const fileInputRef = useRef(null);

  // Password state
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdStatus, setPwdStatus] = useState({ type: '', msg: '' });
  const [savingPwd, setSavingPwd] = useState(false);
  const [showOldPwd, setShowOldPwd] = useState(false);
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = useState(false);

  // Profile Edit state
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileStatus, setProfileStatus] = useState({ type: '', msg: '' });

  // Confirmation modal state
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, type: '', title: '', message: '' });

  // Activity logs state
  const [logs, setLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Colleagues state
  const [colleagues, setColleagues] = useState([]);
  const [loadingColleagues, setLoadingColleagues] = useState(false);

  useEffect(() => {
    if (activeTab === 'activity' && logs?.length === 0) {
      fetchLogs();
    }
    if (activeTab === 'colleagues' && colleagues?.length === 0) {
      fetchColleagues();
    }
  }, [activeTab]);

  const fetchLogs = async () => {
    setLoadingLogs(true);
    try {
      const data = await apiFetch('/settings/activity-logs/');
      setLogs(data || []);
    } catch (e) {
      console.error(e);
      setLogs([]);
    }
    setLoadingLogs(false);
  };

  const fetchColleagues = async () => {
    setLoadingColleagues(true);
    try {
      const data = await apiFetch('/settings/colleagues/');
      setColleagues(data || []);
    } catch (e) {
      console.error(e);
      setColleagues([]);
    }
    setLoadingColleagues(false);
  };

  const handlePicChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64Str = event.target.result;
      setPendingPic(base64Str);
      setIsPhotoViewerOpen(false); // Explicitly ensure the photo viewer is closed
      setConfirmModal({
        isOpen: true,
        type: 'photo',
        title: 'Confirm Photo Upload',
        message: 'Are you sure you want to upload this image as your new profile picture?'
      });
      // Clear file input so the same file can be selected again if canceled
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsDataURL(file);
  };

  const executePhotoSubmit = async () => {
    setConfirmModal({ ...confirmModal, isOpen: false });
    setSavingPic(true);
    try {
      await apiFetch('/settings/profile-pic/', {
        method: 'POST',
        body: JSON.stringify({ profile_pic: pendingPic })
      });
      setProfilePic(pendingPic);
      setPendingPic(null);
      showToast('success', 'Successfully uploaded profile picture');
      fetchLogs(); // refresh logs silently
    } catch (err) {
      showToast('error', err.message || 'Failed to save profile picture.');
    }
    setSavingPic(false);
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setPwdStatus({ type: '', msg: '' });

    if (!oldPassword.trim() || !newPassword.trim() || !confirmPassword.trim()) {
      setPwdStatus({ type: 'error', msg: 'Please fill out all password fields.' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPwdStatus({ type: 'error', msg: 'New passwords do not match.' });
      return;
    }
    if (newPassword.length < 8) {
      setPwdStatus({ type: 'error', msg: 'Password must be at least 8 characters.' });
      return;
    }

    setConfirmModal({
      isOpen: true,
      type: 'password',
      title: 'Confirm Password Update',
      message: 'Are you sure you want to change your password?'
    });
  };

  const executePasswordSubmit = async () => {
    setConfirmModal({ ...confirmModal, isOpen: false });
    setSavingPwd(true);
    try {
      await apiFetch('/auth/change-password/', {
        method: 'PATCH',
        body: JSON.stringify({
          old_password: oldPassword,
          new_password: newPassword
        })
      });
      showToast('success', 'Successfully changed password');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setActiveTab('profile'); // Return to profile after success
      fetchLogs();
    } catch (err) {
      showToast('error', err.message || 'Failed to change password.');
    }
    setSavingPwd(false);
  };

  const inputStyle = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 6,
    border: '1px solid #cbd5e1',
    fontSize: 13,
    outline: 'none',
    boxSizing: 'border-box',
    color: '#1e293b',
    backgroundColor: '#fff',
    transition: 'border-color 0.2s'
  };

  const alertStyle = (type) => ({
    marginBottom: 16,
    padding: '12px 16px',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 500,
    backgroundColor: type === 'success' ? '#dcfce7' : '#fee2e2',
    color: type === 'success' ? '#166534' : '#991b1b',
    border: `1px solid ${type === 'success' ? '#bbf7d0' : '#fecaca'}`
  });

  // Try to use explicit first/last name if set, otherwise fallback to parsing employee_name or username
  let initialLastName = user?.last_name || '';
  let initialFirstName = user?.first_name || '';

  if (!initialLastName && !initialFirstName) {
    const nameParts = (user?.employee_name || user?.username || '').split(',').map(s => s.trim());
    initialLastName = nameParts.length > 1 ? nameParts[0] : '';
    initialFirstName = nameParts.length > 1 ? nameParts[1] : nameParts[0];
  }

  const lastName = initialLastName;
  const firstName = initialFirstName;

  useEffect(() => {
    if (isEditingProfile) {
      setEditFirstName(firstName);
      setEditLastName(lastName);
      setEditEmail(user?.email || '');
      setEditUsername(user?.username || '');
    }
  }, [isEditingProfile, firstName, lastName, user?.email, user?.username]);

  const handleProfileSubmit = async (e) => {
    e.preventDefault();
    setProfileStatus({ type: '', msg: '' });

    if (!editFirstName.trim() || !editLastName.trim() || !editUsername.trim()) {
      setProfileStatus({ type: 'error', msg: 'First Name, Last Name, and Username are required fields.' });
      return;
    }

    setConfirmModal({
      isOpen: true,
      type: 'profile',
      title: 'Confirm Profile Update',
      message: 'Are you sure you want to save these changes to your profile?'
    });
  };

  const executeProfileSubmit = async () => {
    setConfirmModal({ ...confirmModal, isOpen: false });
    setSavingProfile(true);
    try {
      await apiFetch('/settings/update-profile-info/', {
        method: 'POST',
        body: JSON.stringify({
          first_name: editFirstName,
          last_name: editLastName,
          email: editEmail,
          username: editUsername
        })
      });
      await fetchMe(); // Silently update context and ui
      fetchLogs();     // Silently fetch new logs
      showToast('success', 'Successfully updated profile info');
      setIsEditingProfile(false);
    } catch (err) {
      showToast('error', err.message || 'Failed to update profile.');
    }
    setSavingProfile(false);
  };

  const dutyText = user?.duty === 'AM' ? 'AM : 8:00 - 12:00' : user?.duty === 'PM' ? 'PM : 1:00 - 5:00' : 'Not Set';
  const startDateStr = user?.start_date ? new Date(user.start_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'Not Set';

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 40px', fontFamily: '"Inter", sans-serif', position: 'relative' }}>

      {/* Toast Notification */}
      {toast.isOpen && <Toast type={toast.type} message={toast.message} onClose={() => setToast({ ...toast, isOpen: false })} />}

      {/* Confirmation Modal */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        onCancel={() => setConfirmModal({ ...confirmModal, isOpen: false })}
        onConfirm={confirmModal.type === 'profile' ? executeProfileSubmit : confirmModal.type === 'photo' ? executePhotoSubmit : executePasswordSubmit}
      />

      {/* Photo Viewer Modal */}
      {isPhotoViewerOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100,
          flexDirection: 'column', gap: 32
        }}>
          <button onClick={() => setIsPhotoViewerOpen(false)} style={{ position: 'absolute', top: 32, right: 32, background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 12 }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"></path></svg>
          </button>

          <div style={{ width: 320, height: 320, borderRadius: '50%', overflow: 'hidden', background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' }}>
            {profilePic ? (
              <img src={profilePic} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <Camera size={80} color="#64748b" />
            )}
          </div>

          <button
            onClick={() => {
              setIsPhotoViewerOpen(false);
              fileInputRef.current.click();
            }}
            style={{
              background: '#fff', color: '#0f172a', border: 'none', padding: '14px 32px',
              borderRadius: 30, fontSize: 16, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
              boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)'
            }}>
            <Camera size={20} /> Update Photo
          </button>
        </div>
      )}

      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', marginBottom: 20 }}>User Settings</h1>

      {/* Top Banner */}
      <div style={{
        background: '#e2e8f0', borderRadius: 12, padding: 24,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 40
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          {/* Avatar */}
          <div style={{
            width: 70, height: 70, borderRadius: '50%', background: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
            boxShadow: '0 2px 4px rgba(0,0,0,0.05)', flexShrink: 0, cursor: 'pointer'
          }} onClick={() => setIsPhotoViewerOpen(true)}>
            {profilePic ? (
              <img src={profilePic} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <Camera size={32} color="#94a3b8" />
            )}
            <input type="file" accept="image/*" style={{ display: 'none' }} ref={fileInputRef} onChange={handlePicChange} />
          </div>
          {/* User Info */}
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 600, color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              {firstName} {lastName}
              {user?.local_id && <span style={{ fontSize: 13, background: '#cbd5e1', color: '#334155', padding: '2px 8px', borderRadius: 12 }}>{user.local_id}</span>}
            </h2>
            <div style={{ fontSize: 14, color: '#475569', marginTop: 4 }}>{user?.username}</div>
            <div style={{ fontSize: 14, color: '#94a3b8', marginTop: 2 }}>{user?.email || 'No email provided'}</div>
          </div>
        </div>
        <button
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569' }}
          title="Edit Profile"
          onClick={() => setIsEditingProfile(!isEditingProfile)}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
          </svg>
        </button>
      </div>

      {/* Main Grid Content */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 60, marginBottom: 60 }}>

        {/* Left Column: Personal Information */}
        <div>
          {isEditingProfile ? (
            <form onSubmit={handleProfileSubmit} noValidate>
              {profileStatus.msg && (
                <div style={alertStyle(profileStatus.type)}>
                  {profileStatus.msg}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 6 }}>First Name</label>
                  <input type="text" style={inputStyle} value={editFirstName} onChange={e => setEditFirstName(e.target.value)} required />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 6 }}>Last Name</label>
                  <input type="text" style={inputStyle} value={editLastName} onChange={e => setEditLastName(e.target.value)} required />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 6 }}>Email</label>
                  <input type="email" style={inputStyle} value={editEmail} onChange={e => setEditEmail(e.target.value)} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 6 }}>Username</label>
                  <input type="text" style={inputStyle} value={editUsername} onChange={e => setEditUsername(e.target.value)} required />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, marginBottom: 32 }}>
                <button type="submit" className="btn btn-primary" disabled={savingProfile}>
                  {savingProfile ? 'Saving...' : 'Save Profile'}
                </button>
                <button type="button" className="btn btn-outline" onClick={() => setIsEditingProfile(false)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 32 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#334155', marginBottom: 4 }}>First Name</div>
                  <div style={{ fontSize: 13, color: '#64748b' }}>{firstName}</div>
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#334155', marginBottom: 4 }}>Last Name</div>
                  <div style={{ fontSize: 13, color: '#64748b' }}>{lastName}</div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 32 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#334155', marginBottom: 4 }}>Email</div>
                  <div style={{ fontSize: 13, color: '#64748b' }}>{user?.email || 'Not set'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#334155', marginBottom: 4 }}>Username</div>
                  <div style={{ fontSize: 13, color: '#64748b' }}>{user?.username}</div>
                </div>
              </div>
            </>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 24 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#334155', marginBottom: 4 }}>Office</div>
              <div style={{ fontSize: 13, color: '#64748b' }}>{user?.office || 'Not Assigned'}</div>
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#334155', marginBottom: 4 }}>Scheduled Duty</div>
              <div style={{ fontSize: 13, color: '#64748b' }}>{dutyText}</div>
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#334155', marginBottom: 4 }}>Date Started</div>
              <div style={{ fontSize: 13, color: '#64748b' }}>{startDateStr}</div>
            </div>
          </div>
        </div>

        {/* Right Column: Office Colleagues & Password */}
        <div>
          <div style={{ marginBottom: 40 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#334155', marginBottom: 16 }}>Office Colleagues</h3>
            <div style={{ background: '#f8fafc', borderRadius: 8, padding: 24, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
              {loadingColleagues ? 'Loading...' : colleagues?.length === 0 ? 'No other colleagues found in your office.' : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left' }}>
                  {colleagues?.map(c => (
                    <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: 600, color: '#334155' }}>{c.name}</span>
                      <span style={{ color: '#94a3b8' }}>{c.duty} Duty</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#334155', marginBottom: 16 }}>Change Password</h3>
            <button
              style={{
                width: '100%', background: '#1e293b', color: '#fff', border: 'none',
                borderRadius: 6, padding: '10px 16px', fontSize: 13, fontWeight: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer'
              }}
              onClick={() => setActiveTab('security')} // You can implement a modal or simple swap here
            >
              <Key size={16} /> Update Password
            </button>

            {/* Inline Password Form (conditionally shown if they click Update Password) */}
            {activeTab === 'security' && (
              <form onSubmit={handlePasswordSubmit} style={{ marginTop: 16, background: '#f8fafc', padding: 16, borderRadius: 8 }} noValidate>
                {pwdStatus.msg && (
                  <div style={alertStyle(pwdStatus.type)}>
                    {pwdStatus.msg}
                  </div>
                )}

                <div style={{ position: 'relative', marginBottom: 12 }}>
                  <input type={showOldPwd ? "text" : "password"} placeholder="Current Password" required value={oldPassword} onChange={e => setOldPassword(e.target.value)} style={{ ...inputStyle, paddingRight: 40 }} />
                  <button type="button" onClick={() => setShowOldPwd(!showOldPwd)} style={{ position: 'absolute', right: 12, top: 10, background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
                    {showOldPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <div style={{ position: 'relative', marginBottom: 12 }}>
                  <input type={showNewPwd ? "text" : "password"} placeholder="New Password" required minLength={8} value={newPassword} onChange={e => setNewPassword(e.target.value)} style={{ ...inputStyle, paddingRight: 40 }} />
                  <button type="button" onClick={() => setShowNewPwd(!showNewPwd)} style={{ position: 'absolute', right: 12, top: 10, background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
                    {showNewPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <div style={{ position: 'relative', marginBottom: 12 }}>
                  <input type={showConfirmPwd ? "text" : "password"} placeholder="Confirm New Password" required minLength={8} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} style={{ ...inputStyle, paddingRight: 40 }} />
                  <button type="button" onClick={() => setShowConfirmPwd(!showConfirmPwd)} style={{ position: 'absolute', right: 12, top: 10, background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
                    {showConfirmPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={savingPwd} style={{ background: '#1e293b', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>Save</button>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => { setActiveTab('profile'); setPwdStatus({ type: '', msg: '' }); }} style={{ background: 'transparent', color: '#64748b', border: '1px solid #cbd5e1', padding: '6px 12px', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>Cancel</button>
                </div>
              </form>
            )}
          </div>
        </div>

      </div>

      {/* Activity Logs Section */}
      <div>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', marginBottom: 16 }}>Activity Logs</h3>
        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <button style={{
            background: activeTab !== 'attendance' ? '#e2e8f0' : 'transparent', color: activeTab !== 'attendance' ? '#475569' : '#94a3b8',
            border: 'none', padding: '6px 16px', borderRadius: 16, fontSize: 13, fontWeight: 600, cursor: 'pointer'
          }} onClick={() => setActiveTab('activity')}>Activity</button>

          <button style={{
            background: activeTab === 'attendance' ? '#e2e8f0' : 'transparent', color: activeTab === 'attendance' ? '#475569' : '#94a3b8',
            border: 'none', padding: '6px 16px', borderRadius: 16, fontSize: 13, fontWeight: 600, cursor: 'pointer'
          }} onClick={() => setActiveTab('attendance')}>Attendance</button>
        </div>

        <div style={{ background: '#f8fafc', borderRadius: 8, padding: 32, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
          {activeTab === 'attendance' ? (
            "No attendance recorded yet."
          ) : (
            loadingLogs ? 'Loading...' : logs?.length === 0 ? 'No activity recorded yet.' : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'left' }}>
                {logs?.map(log => (
                  <div key={log.id} style={{ padding: '8px 0', borderBottom: '1px solid #e2e8f0' }}>
                    <div style={{ fontWeight: 600, color: '#334155' }}>{log.action}</div>
                    <div style={{ color: '#94a3b8', fontSize: 12 }}>{new Date(log.created_at).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}


