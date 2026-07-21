import React, { useState, useEffect } from 'react';

export default function Toast({ type, message, onClose, onUndo }) {
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    const timer = setInterval(() => {
      setProgress(p => Math.max(p - 2, 0));
    }, 100);
    const closeTimer = setTimeout(onClose, 5000);
    return () => { clearInterval(timer); clearTimeout(closeTimer); };
  }, [onClose]);

  const bgColor = type === 'success' ? '#22c55e' : (type === 'error' || type === 'warning') ? '#ef4444' : '#fff';
  const textColor = (type === 'success' || type === 'error' || type === 'warning') ? '#fff' : '#0f172a';
  
  return (
    <div style={{
      position: 'fixed', top: 24, right: 24, zIndex: 9999,
      background: bgColor, color: textColor,
      padding: '16px 24px', borderRadius: 8,
      boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)',
      minWidth: 300, overflow: 'hidden'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
        <span style={{ fontWeight: 600 }}>{message}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {onUndo && (
            <button 
              onClick={() => { onUndo(); onClose(); }} 
              style={{ background: 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.5)', color: textColor, padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
            >
              UNDO
            </button>
          )}
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: textColor, cursor: 'pointer', padding: 0, display: 'flex' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"></path></svg>
          </button>
        </div>
      </div>
      <div style={{ position: 'absolute', bottom: 0, left: 0, height: 4, background: 'rgba(0,0,0,0.2)', width: `${progress}%`, transition: 'width 0.1s linear' }} />
    </div>
  );
}
