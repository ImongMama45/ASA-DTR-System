import { useState, useRef, useEffect, useCallback } from 'react';
import { Camera, X, LogIn, LogOut, AlertTriangle, CheckCircle, Loader, Clock } from 'lucide-react';
import jsQR from 'jsqr';
import { scanAttendance, checkScanStatus } from '../hooks/useSync';

/**
 * CameraModal — scan-then-choose flow.
 *
 * 1. Modal opens straight to the camera (no intent picker up front).
 * 2. On QR detect: pause camera, call /attendance/scan-status/ (read-only).
 * 3. Show employee name + Logged In / Logged Out buttons, dynamically
 *    enabled/disabled based on can_login / can_logout / seconds_remaining
 *    returned by the backend — never inferred client-side.
 * 4. Submit on button press via the existing /attendance/scan/ endpoint,
 *    which independently re-checks and enforces the same rule server-side.
 */
export default function CameraModal({ isOpen, onClose, currentEmployeeId }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const animFrameRef = useRef(null);
  const countdownRef = useRef(null);

  const [scanning, setScanning] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [status, setStatus] = useState(null); // scan-status response
  const [decodedPayload, setDecodedPayload] = useState(null);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // { type, message, details, anomaly }

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setScanning(true);
      setResult(null);
      setStatus(null);
      setDecodedPayload(null);
    } catch (err) {
      setResult({ type: 'error', message: 'Camera access denied. Please allow camera permissions.' });
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
  }, []);

  // QR scanning loop
  useEffect(() => {
    if (!scanning || !videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const scan = () => {
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });

        if (code && code.data) {
          handleQRDetected(code.data);
          return;
        }
      }
      animFrameRef.current = requestAnimationFrame(scan);
    };

    animFrameRef.current = requestAnimationFrame(scan);
    return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); };
  }, [scanning]);

  // Local countdown ticker (cosmetic only — backend re-verifies on submit)
  useEffect(() => {
    clearInterval(countdownRef.current);
    if (secondsRemaining > 0) {
      countdownRef.current = setInterval(() => {
        setSecondsRemaining(s => (s > 1 ? s - 1 : 0));
      }, 1000);
    }
    return () => clearInterval(countdownRef.current);
  }, [secondsRemaining > 0]);

  const handleQRDetected = async (data) => {
    stopCamera();

    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      setResult({ type: 'error', message: 'Invalid QR code — not a valid attendance ID.' });
      return;
    }

    if (!parsed.eid || !parsed.sig) {
      setResult({ type: 'error', message: 'Invalid QR code — missing required fields.' });
      return;
    }

    if (currentEmployeeId && parsed.eid === currentEmployeeId) {
      setResult({ type: 'blocked', message: 'You cannot scan your own ID.' });
      return;
    }

    setDecodedPayload(data);
    setCheckingStatus(true);
    try {
      const s = await checkScanStatus(data);
      setStatus(s);
      setSecondsRemaining(s.seconds_remaining || 0);
    } catch (err) {
      const message = (err && (err.error || err.message)) || 'Could not verify this employee. Please try again.';
      setResult({ type: 'error', message });
      setDecodedPayload(null);
    }
    setCheckingStatus(false);
  };

  const handleChoice = async (intent) => {
    if (!decodedPayload || submitting) return;
    setSubmitting(true);
    setResult(null);
    try {
      const response = await scanAttendance(decodedPayload, intent);
      if (response.blocked) {
        setResult({ type: 'blocked', message: response.error });
      } else {
        const record = response.record;
        const scanLabel = {
          AM_ARRIVAL: 'AM — Logged In',
          AM_DEPARTURE: 'AM — Logged Out',
          PM_ARRIVAL: 'PM — Logged In',
          PM_DEPARTURE: 'PM — Logged Out',
        }[record.scan_type] || record.scan_type;

        setResult({
          type: 'success',
          message: record.employee_name,
          details: scanLabel,
          anomaly: response.anomaly ? response.anomaly.reason : null,
        });
      }
    } catch (err) {
      if (err && err.blocked) {
        setResult({ type: 'blocked', message: err.error });
      } else if (err && err.error) {
        setResult({ type: 'error', message: err.error });
      } else {
        setResult({ type: 'error', message: 'Scan failed. Please try again.' });
      }
    }
    setSubmitting(false);
    setStatus(null);
    setDecodedPayload(null);
  };

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setStatus(null);
      setResult(null);
      setDecodedPayload(null);
      setSecondsRemaining(0);
    }
  }, [isOpen, stopCamera]);

  if (!isOpen) return null;

  const fmtRemaining = (secs) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return `${h}h ${m}m`;
  };

  const showActionPhase = status && !submitting && !result;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.95)', zIndex: 2000,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    }}>
      <button onClick={onClose} style={{
        position: 'absolute', top: 20, right: 20, background: 'none', border: 'none',
        color: '#fff', cursor: 'pointer', padding: 8, zIndex: 2001,
      }}>
        <X size={28} />
      </button>

      <div style={{ color: '#fff', fontSize: 20, fontWeight: 700, marginBottom: 16 }}>
        Attendance Scanner
      </div>

      {/* Camera viewport */}
      <div style={{
        width: '100%', maxWidth: 400, aspectRatio: '4/3', borderRadius: 12,
        overflow: 'hidden', position: 'relative', background: '#000',
        border: scanning ? '3px solid #22c55e' : '3px solid #334155',
      }}>
        <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} playsInline muted />
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {scanning && (
          <div style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            width: 200, height: 200, border: '2px solid rgba(34, 197, 94, 0.6)',
            borderRadius: 12,
          }} />
        )}

        {!scanning && !status && !result && !checkingStatus && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
          }}>
            <Camera size={48} color="#64748b" />
            <span style={{ color: '#94a3b8', fontSize: 14 }}>Tap below to start scanning</span>
          </div>
        )}

        {checkingStatus && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
            background: 'rgba(0,0,0,0.6)',
          }}>
            <Loader size={32} color="#94a3b8" className="spin" />
            <span style={{ color: '#94a3b8', fontSize: 13 }}>Verifying employee…</span>
          </div>
        )}
      </div>

      {/* Start / Scan Again */}
      {!scanning && !checkingStatus && !showActionPhase && (
        <button
          onClick={() => { setResult(null); startCamera(); }}
          style={{
            marginTop: 16, padding: '12px 32px', borderRadius: 8, border: 'none',
            background: '#3b82f6', color: '#fff',
            fontSize: 15, fontWeight: 600, cursor: 'pointer',
          }}
        >
          {result ? 'Scan Another' : 'Start Scanning'}
        </button>
      )}

      {/* Action Phase — employee identified, choose intent */}
      {showActionPhase && (
        <div style={{ marginTop: 20, width: '100%', maxWidth: 400, textAlign: 'center' }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%', background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 28, fontWeight: 700, margin: '0 auto 12px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)', border: '2px solid #334155'
          }}>
            {status.employee_name ? status.employee_name.split(' ').map(w => w[0]).join('').slice(0, 2) : '?'}
          </div>
          <div style={{ color: '#fff', fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
            {status.employee_name}
          </div>
          <div style={{ color: '#64748b', fontSize: 12, marginBottom: 16 }}>
            {status.scans_today} scan{status.scans_today === 1 ? '' : 's'} today
            {status.last_scan_time && ` · last: ${new Date(status.last_scan_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
          </div>

          {status.completed ? (
            <div style={{ color: '#f59e0b', fontSize: 14, marginBottom: 12 }}>
              This employee already has 4 scans today. Use Manual Entry if a correction is needed.
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 12 }}>
              <button
                onClick={() => handleChoice('IN')}
                disabled={!status.can_login}
                style={{
                  padding: '12px 28px', borderRadius: 8, border: 'none',
                  fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8,
                  background: status.can_login ? '#22c55e' : '#1e293b',
                  color: status.can_login ? '#fff' : '#475569',
                  cursor: status.can_login ? 'pointer' : 'not-allowed',
                }}
              >
                <LogIn size={18} /> Logged In
              </button>
              <button
                onClick={() => handleChoice('OUT')}
                disabled={!status.can_logout}
                style={{
                  padding: '12px 28px', borderRadius: 8, border: 'none',
                  fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8,
                  background: status.can_logout ? '#ef4444' : '#1e293b',
                  color: status.can_logout ? '#fff' : '#475569',
                  cursor: status.can_logout ? 'pointer' : 'not-allowed',
                }}
              >
                <LogOut size={18} /> Logged Out
              </button>
            </div>
          )}

          {!status.can_logout && !status.can_login && !status.completed && secondsRemaining > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              color: '#f59e0b', fontSize: 13,
            }}>
              <Clock size={14} />
              Last scanned: {status.last_scan_time ? new Date(status.last_scan_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
              {' · '}4h duration not met. Remaining: {fmtRemaining(secondsRemaining)}
            </div>
          )}

          <button
            onClick={() => { setStatus(null); setDecodedPayload(null); setResult(null); startCamera(); }}
            style={{
              marginTop: 12, padding: '8px 20px', borderRadius: 8, border: '1px solid #334155',
              background: 'none', color: '#94a3b8', fontSize: 13, cursor: 'pointer',
            }}
          >
            Scan Different Employee
          </button>
        </div>
      )}

      {/* Submitting */}
      {submitting && (
        <div style={{ marginTop: 20, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Loader size={18} className="spin" /> Processing scan...
        </div>
      )}

      {/* Result display */}
      {result && !submitting && (
        <div style={{
          marginTop: 20, padding: '16px 24px', borderRadius: 12, maxWidth: 400, width: '100%',
          textAlign: 'center',
          background: result.type === 'success' ? 'rgba(34, 197, 94, 0.15)'
            : result.type === 'blocked' ? 'rgba(239, 68, 68, 0.15)'
              : 'rgba(239, 68, 68, 0.15)',
          border: `1px solid ${result.type === 'success' ? '#22c55e40' : '#ef444440'}`,
        }}>
          {status?.employee_name && (
            <div style={{
              width: 64, height: 64, borderRadius: '50%', background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 24, fontWeight: 700, margin: '0 auto 12px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.2)', border: '2px solid #334155'
            }}>
              {status.employee_name.split(' ').map(w => w[0]).join('').slice(0, 2)}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 4 }}>
            {result.type === 'success' ? <CheckCircle size={20} color="#22c55e" /> : <AlertTriangle size={20} color="#ef4444" />}
            <span style={{
              color: result.type === 'success' ? '#22c55e' : '#ef4444',
              fontSize: 16, fontWeight: 700,
            }}>
              {result.message}
            </span>
          </div>
          {result.details && (
            <div style={{ color: '#94a3b8', fontSize: 14, marginTop: 4 }}>{result.details}</div>
          )}
          {result.anomaly && (
            <div style={{ color: '#f59e0b', fontSize: 12, marginTop: 8 }}>⚠ Note: {result.anomaly}</div>
          )}
        </div>
      )}
    </div>
  );
}
