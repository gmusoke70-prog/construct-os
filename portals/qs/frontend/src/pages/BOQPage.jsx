import React, { useState, useEffect } from 'react';
import { api } from '../api';
import BOQEditor from '../../components/BOQEditor/index.jsx';

export default function BOQPage({ user }) {
  const [boqs,      setBoqs]      = useState([]);
  const [selected,  setSelected]  = useState(null);
  const [creating,  setCreating]  = useState(false);
  const [form,      setForm]      = useState({ name: '', description: '' });
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');

  useEffect(() => { loadBOQs(); }, []);

  async function loadBOQs() {
    setLoading(true);
    try {
      const { boqs } = await api.listBOQs();
      setBoqs(boqs || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function createBOQ(e) {
    e.preventDefault();
    try {
      const { boq } = await api.createBOQ(form);
      setBoqs(prev => [boq, ...prev]);
      setSelected(boq);
      setCreating(false);
      setForm({ name: '', description: '' });
    } catch (e) { setError(e.message); }
  }

  async function handleExport(boqId) {
    const res = await api.exportBOQ(boqId);
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `BOQ-${boqId}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // If a BOQ is selected, show the editor
  if (selected) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px 24px', background: '#fff', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => { setSelected(null); loadBOQs(); }} style={S.backBtn}>← Back</button>
          <span style={{ fontWeight: 700, fontSize: 16 }}>{selected.name}</span>
          <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 4 }}>{selected.status}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {selected.status !== 'APPROVED' && (
              <button style={S.approveBtn} onClick={async () => {
                await api.approveBOQ(selected.id);
                setSelected(prev => ({ ...prev, status: 'APPROVED' }));
              }}>
                Approve
              </button>
            )}
            <button style={S.exportBtn} onClick={() => handleExport(selected.id)}>Export Excel</button>
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          <BOQEditor boqId={selected.id} user={user} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 32 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Bill of Quantities</h1>
        <button style={S.createBtn} onClick={() => setCreating(true)}>+ New BOQ</button>
      </div>

      {error && <div style={S.errBox}>{error}</div>}

      {creating && (
        <form style={S.createForm} onSubmit={createBOQ}>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>New BOQ</h3>
          <input
            style={S.input} placeholder="BOQ Name *" required
            value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
          />
          <textarea
            style={{ ...S.input, height: 80, resize: 'vertical' }} placeholder="Description (optional)"
            value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="button" onClick={() => setCreating(false)} style={S.cancelBtn}>Cancel</button>
            <button type="submit" style={S.createBtn}>Create</button>
          </div>
        </form>
      )}

      {loading ? (
        <div style={{ color: '#6b7280' }}>Loading…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {boqs.map(b => (
            <div key={b.id} style={S.card} onClick={() => setSelected(b)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{b.name}</div>
                <span style={statusBadge(b.status)}>{b.status}</span>
              </div>
              {b.description && <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>{b.description}</div>}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontSize: 12, color: '#6b7280' }}>
                <span>{b._count?.stages || 0} stages</span>
                <span>v{b.versionNumber}</span>
                <span>{new Date(b.updatedAt).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
          {boqs.length === 0 && (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', color: '#6b7280', padding: 40 }}>
              No BOQs yet. Click "+ New BOQ" to start.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function statusBadge(status) {
  const map = {
    DRAFT:            { background: '#f1f5f9', color: '#475569' },
    PENDING_APPROVAL: { background: '#fef9c3', color: '#854d0e' },
    APPROVED:         { background: '#dcfce7', color: '#166534' },
    REJECTED:         { background: '#fee2e2', color: '#991b1b' },
  };
  return {
    fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 99, whiteSpace: 'nowrap',
    ...(map[status] || { background: '#f1f5f9', color: '#475569' }),
  };
}

const S = {
  createBtn:  { padding: '9px 18px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14 },
  cancelBtn:  { padding: '9px 18px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14 },
  approveBtn: { padding: '7px 14px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 },
  exportBtn:  { padding: '7px 14px', background: '#0f172a', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 },
  backBtn:    { padding: '6px 12px', background: '#f1f5f9', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  card: {
    background: '#fff', borderRadius: 12, padding: '18px 20px',
    boxShadow: '0 1px 4px rgba(0,0,0,.06)', cursor: 'pointer',
    border: '1px solid transparent', transition: 'border-color .15s',
  },
  createForm: {
    background: '#fff', borderRadius: 12, padding: 24,
    boxShadow: '0 4px 20px rgba(0,0,0,.1)', marginBottom: 24,
    display: 'flex', flexDirection: 'column', gap: 12,
  },
  input: {
    padding: '10px 14px', border: '1px solid #d1d5db', borderRadius: 8,
    fontSize: 14, width: '100%',
  },
  errBox: {
    background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8,
    padding: '10px 14px', color: '#dc2626', fontSize: 13, marginBottom: 16,
  },
};
