import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

function KPI({ label, value, sub, color = '#2563eb' }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: '20px 24px', boxShadow: '0 1px 4px rgba(0,0,0,.06)', borderTop: `3px solid ${color}` }}>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value ?? '—'}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function Dashboard({ user }) {
  const [boqs, setBoqs]       = useState([]);
  const [docs, setDocs]       = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.listBOQs(), api.listDocuments()])
      .then(([b, d]) => {
        setBoqs(b.boqs || []);
        setDocs(d.documents || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const totalBudget  = boqs.reduce((s, b) => s + (b.totalCost || 0), 0);
  const approvedBOQs = boqs.filter(b => b.status === 'APPROVED').length;
  const pendingBOQs  = boqs.filter(b => b.status === 'PENDING_APPROVAL').length;

  return (
    <div style={{ padding: 32, maxWidth: 1100 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Good {getTimeOfDay()}, {user?.name?.split(' ')[0] || 'there'}</h1>
        <p style={{ color: '#64748b', fontSize: 14 }}>Here's your QS overview for today.</p>
      </div>

      {loading ? (
        <div style={{ color: '#64748b' }}>Loading…</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 }}>
            <KPI label="Total BOQs"       value={boqs.length}                     color="#2563eb" />
            <KPI label="Approved"         value={approvedBOQs}                    color="#16a34a" />
            <KPI label="Pending Approval" value={pendingBOQs}                     color="#f59e0b" />
            <KPI label="Total Budget"     value={`UGX ${fmtMoney(totalBudget)}`}  color="#7c3aed" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            {/* Recent BOQs */}
            <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,.06)', overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600 }}>Recent BOQs</span>
                <Link to="/boq" style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none' }}>View all →</Link>
              </div>
              {boqs.slice(0, 6).map(b => (
                <div key={b.id} style={{ padding: '12px 20px', borderBottom: '1px solid #f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 500, fontSize: 14 }}>{b.name}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>{b.project?.name || 'No project'}</div>
                  </div>
                  <span style={{ ...statusBadge(b.status) }}>{b.status}</span>
                </div>
              ))}
              {boqs.length === 0 && <div style={{ padding: '20px', color: '#6b7280', fontSize: 14 }}>No BOQs yet. <Link to="/boq">Create one →</Link></div>}
            </div>

            {/* Takeoff documents */}
            <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,.06)', overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600 }}>Takeoff Documents</span>
                <Link to="/takeoff" style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none' }}>View all →</Link>
              </div>
              {docs.slice(0, 6).map(d => (
                <div key={d.id} style={{ padding: '12px 20px', borderBottom: '1px solid #f8fafc', display: 'flex', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontWeight: 500, fontSize: 14 }}>{d.name}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>Scale: {d.scale ? `1:${(1/d.scale).toFixed(0)}` : 'Not calibrated'}</div>
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>{d._count?.measurements || 0} meas.</div>
                </div>
              ))}
              {docs.length === 0 && <div style={{ padding: '20px', color: '#6b7280', fontSize: 14 }}>No documents. <Link to="/takeoff">Upload one →</Link></div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function getTimeOfDay() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

function fmtMoney(n) {
  if (n >= 1_000_000_000) return `${(n/1e9).toFixed(1)}B`;
  if (n >= 1_000_000)     return `${(n/1e6).toFixed(1)}M`;
  if (n >= 1_000)         return `${(n/1e3).toFixed(0)}K`;
  return n.toLocaleString();
}

function statusBadge(status) {
  const map = {
    DRAFT:            { background: '#f1f5f9', color: '#475569' },
    PENDING_APPROVAL: { background: '#fef9c3', color: '#854d0e' },
    APPROVED:         { background: '#dcfce7', color: '#166534' },
    REJECTED:         { background: '#fee2e2', color: '#991b1b' },
  };
  return {
    fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 99,
    ...(map[status] || { background: '#f1f5f9', color: '#475569' }),
  };
}
