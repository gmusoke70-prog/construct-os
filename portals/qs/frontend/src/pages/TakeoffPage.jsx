import React, { useState, useEffect } from 'react';
import { api } from '../api';
import TakeoffCanvas from '../../components/TakeoffCanvas/index.jsx';

export default function TakeoffPage({ user }) {
  const [docs,     setDocs]     = useState([]);
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form,     setForm]     = useState({ name: '', description: '' });
  const [loading,  setLoading]  = useState(true);

  useEffect(() => { loadDocs(); }, []);

  async function loadDocs() {
    setLoading(true);
    try {
      const { documents } = await api.listDocuments();
      setDocs(documents || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function createDoc(e) {
    e.preventDefault();
    try {
      const { document } = await api.createDocument(form);
      setDocs(prev => [document, ...prev]);
      setSelected(document);
      setCreating(false);
      setForm({ name: '', description: '' });
    } catch (e) { console.error(e); }
  }

  if (selected) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '10px 20px', background: '#fff', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => { setSelected(null); loadDocs(); }} style={S.backBtn}>← Back</button>
          <span style={{ fontWeight: 700, fontSize: 15 }}>{selected.name}</span>
          <span style={{ fontSize: 12, color: '#6b7280' }}>
            {selected.scale ? `Scale calibrated` : 'Scale not calibrated — right-click canvas to calibrate'}
          </span>
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <TakeoffCanvas documentId={selected.id} user={user} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 32 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Digital Takeoff</h1>
        <button style={S.createBtn} onClick={() => setCreating(true)}>+ New Document</button>
      </div>

      {creating && (
        <form style={S.createForm} onSubmit={createDoc}>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>New Takeoff Document</h3>
          <input
            style={S.input} placeholder="Document Name *" required
            value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
          />
          <textarea
            style={{ ...S.input, height: 70, resize: 'vertical' }} placeholder="Description (optional)"
            value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setCreating(false)} style={S.cancelBtn}>Cancel</button>
            <button type="submit" style={S.createBtn}>Create</button>
          </div>
        </form>
      )}

      {loading ? (
        <div style={{ color: '#6b7280' }}>Loading…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {docs.map(d => (
            <div key={d.id} style={S.card} onClick={() => setSelected(d)}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{d.name}</div>
              {d.description && <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>{d.description}</div>}
              <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12, color: '#6b7280' }}>
                <span>📐 {d._count?.measurements || 0} measurements</span>
                <span>{d.scale ? '✓ Calibrated' : '⚠ Not calibrated'}</span>
              </div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 8 }}>
                {new Date(d.updatedAt).toLocaleDateString()}
              </div>
            </div>
          ))}
          {docs.length === 0 && (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', color: '#6b7280', padding: 40 }}>
              No documents yet. Click "+ New Document" to start your first takeoff.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const S = {
  createBtn: { padding: '9px 18px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14 },
  cancelBtn: { padding: '9px 18px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14 },
  backBtn:   { padding: '6px 12px', background: '#f1f5f9', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  card: {
    background: '#fff', borderRadius: 12, padding: '18px 20px', cursor: 'pointer',
    boxShadow: '0 1px 4px rgba(0,0,0,.06)', border: '1px solid #f1f5f9',
    transition: 'border-color .15s, box-shadow .15s',
  },
  createForm: {
    background: '#fff', borderRadius: 12, padding: 24, marginBottom: 24,
    boxShadow: '0 4px 20px rgba(0,0,0,.08)', display: 'flex', flexDirection: 'column', gap: 12,
  },
  input: {
    padding: '10px 14px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, width: '100%',
  },
};
