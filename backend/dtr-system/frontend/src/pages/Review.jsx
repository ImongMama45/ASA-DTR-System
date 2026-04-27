import { useState, useEffect } from 'react';
import { getAllBatches, updateBatch } from '../db';
import DTRStrip from '../components/DTRStrip';
import { exportToDocx } from '../utils/exportDocx';

export default function Review() {
  const [batches, setBatches] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [batch, setBatch] = useState(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    const all = await getAllBatches();
    const sorted = all.sort((a, b) => b.createdAt - a.createdAt);
    setBatches(sorted);
    if (sorted.length > 0 && !selectedId) {
      setSelectedId(String(sorted[0].id));
      setBatch(sorted[0]);
    }
  }

  function selectBatch(id) {
    setSelectedId(id);
    const b = batches.find(x => String(x.id) === id);
    setBatch(b || null);
  }

  function handleEmpChange(ei, newEmpData) {
    setBatch(prev => {
      const employees = [...prev.employees];
      employees[ei] = newEmpData;
      return { ...prev, employees };
    });
  }

  async function saveEdits() {
    if (!batch) return;
    await updateBatch(batch);
    alert('Changes saved!');
  }

  async function doExport() {
    if (!batch) return;
    setExporting(true);
    try {
      await exportToDocx(batch);
    } catch (e) {
      console.error(e);
      alert('Export failed: ' + e.message);
    }
    setExporting(false);
  }

  return (
    <div>
      <div className="card">
        <div className="card-title">🖨 Review & Export DTRs</div>
        <div className="form-group">
          <label className="form-label">Select DTR Batch</label>
          <select className="form-select" value={selectedId} onChange={e => selectBatch(e.target.value)}>
            <option value="">-- Select a batch --</option>
            {batches.map(b => (
              <option key={b.id} value={b.id}>{b.label} ({(b.employees||[]).length} emp)</option>
            ))}
          </select>
        </div>

        {batch && (
          <div className="btn-row">
            <button className="btn btn-success" onClick={doExport} disabled={exporting}>
              {exporting ? '⏳ Generating .docx…' : '⬇ Export to Word (.docx)'}
            </button>
            <button className="btn btn-primary" onClick={saveEdits}>💾 Save Edits</button>
          </div>
        )}
      </div>

      {batch && (
        <div>
          <div className="alert alert-info" style={{ marginBottom: 12 }}>
            ✏ Time values are editable — click any cell in the preview strips below.
            Each employee is shown as <strong>3 side-by-side strips</strong> (matching the template exactly).
          </div>

          {(batch.employees || []).map((empData, ei) => (
            <div className="review-emp-block" key={ei}>
              <div className="review-emp-header">
                {empData.emp.name}
                <span className={`badge badge-${empData.emp.duty.toLowerCase()}`} style={{ marginLeft: 8 }}>{empData.emp.duty}</span>
              </div>
              <div className="dtr-page-preview">
                {/* THREE strips side by side */}
                <DTRStrip empData={empData} batch={batch} editable onChange={d => handleEmpChange(ei, d)} />
                <DTRStrip empData={empData} batch={batch} editable onChange={d => handleEmpChange(ei, d)} />
                <DTRStrip empData={empData} batch={batch} editable onChange={d => handleEmpChange(ei, d)} />
              </div>
            </div>
          ))}

          <div className="btn-row">
            <button className="btn btn-success" onClick={doExport} disabled={exporting}>
              {exporting ? '⏳ Generating .docx…' : '⬇ Export All to Word (.docx)'}
            </button>
          </div>
        </div>
      )}

      {!batch && batches.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">📄</div>
          <div className="empty-msg">No DTR batches found. Generate a DTR first.</div>
        </div>
      )}
    </div>
  );
}
