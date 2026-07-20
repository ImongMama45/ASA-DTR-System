import React from 'react';

export default function ConfirmModal({ isOpen, title, message, onConfirm, onCancel }) {
  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200
    }}>
      <div style={{
        background: '#fff', padding: 32, borderRadius: 12, width: 400, maxWidth: '90%',
        boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)'
      }}>
        <h3 style={{ marginTop: 0, color: '#1e293b', fontSize: 18 }}>{title}</h3>
        <p style={{ color: '#475569', marginBottom: 24, fontSize: 14 }}>{message}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <button 
            onClick={onCancel} 
            style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #cbd5e1', background: 'transparent', cursor: 'pointer', fontWeight: 600, color: '#475569' }}>
            Cancel
          </button>
          <button 
            onClick={onConfirm} 
            style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#1e293b', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
