import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

export default function FileUpload({ employeeId, dtrBatchId, fundPaymentId, onUploaded }) {
  const { authFetch } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  async function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    setError('');
    const formData = new FormData();
    formData.append('file', file);
    if (employeeId) formData.append('employee_id', employeeId);
    if (dtrBatchId) formData.append('dtr_batch_id', dtrBatchId);
    if (fundPaymentId) formData.append('fund_payment_id', fundPaymentId);

    try {
      const res = await authFetch(`${API_BASE}/attachments/upload/`, {
        method: 'POST',
        body: formData, // do NOT set Content-Type -- browser sets multipart boundary
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed.');
      onUploaded && onUploaded(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <input type="file" accept=".pdf,image/*" onChange={handleFileChange} disabled={uploading} />
      {uploading && <span>Uploading...</span>}
      {error && <div className="alert alert-danger">{error}</div>}
    </div>
  );
}
