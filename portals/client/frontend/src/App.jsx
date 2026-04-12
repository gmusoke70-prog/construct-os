import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, Link, useNavigate, useLocation } from 'react-router-dom';

const getToken  = () => localStorage.getItem('cos_token');
const setToken  = t  => localStorage.setItem('cos_token', t);
const clearToken= () => localStorage.removeItem('cos_token');
const isLoggedIn= () => Boolean(getToken());

async function req(method, path, body) {
  const h = { 'Content-Type': 'application/json' };
  const t = getToken();
  if (t) h['Authorization'] = `Bearer ${t}`;
  const r = await fetch(`/api${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { clearToken(); window.location.href = '/login'; return; }
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Failed');
  return d;
}

function Login({ onLogin }) {
  const [email, setEmail] = useState(''); const [pass, setPass] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setErr(''); setBusy(true);
    try { const { token, user } = await req('POST', '/auth/login', { email, password: pass }); onLogin(token, user); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'linear-gradient(135deg,#0f172a,#1e3a5f)' }}>
      <form onSubmit={submit} style={{ background:'#fff', borderRadius:16, padding:'40px 36px', width:360, boxShadow:'0 20px 60px rgba(0,0,0,.3)', display:'flex', flexDirection:'column', gap:12 }}>
        <div style={{ fontSize:22, fontWeight:800, textAlign:'center' }}>⚡ Construct-OS</div>
        <div style={{ fontSize:13, color:'#64748b', textAlign:'center', marginBottom:8 }}>Client Portal</div>
        {err && <div style={{ background:'#fef2f2', borderRadius:8, padding:'10px 14px', color:'#dc2626', fontSize:13 }}>{err}</div>}
        <input type="email" placeholder="Email" required value={email} onChange={e=>setEmail(e.target.value)} autoFocus style={{ padding:'10px 14px', border:'1px solid #d1d5db', borderRadius:8, fontSize:14 }} />
        <input type="password" placeholder="Password" required value={pass} onChange={e=>setPass(e.target.value)} style={{ padding:'10px 14px', border:'1px solid #d1d5db', borderRadius:8, fontSize:14 }} />
        <button type="submit" disabled={busy} style={{ padding:12, background:'#2563eb', color:'#fff', border:'none', borderRadius:8, fontSize:15, fontWeight:600, cursor:'pointer' }}>{busy?'Signing in…':'Sign in'}</button>
      </form>
    </div>
  );
}

// ─── Progress bar ─────────────────────────────────────────────────────────────
function ProgressBar({ value, color = '#2563eb' }) {
  return (
    <div style={{ height:8, background:'#f1f5f9', borderRadius:4, overflow:'hidden' }}>
      <div style={{ height:'100%', width:`${Math.min(100, value||0)}%`, background:color, borderRadius:4, transition:'width .4s ease' }} />
    </div>
  );
}

function Projects() {
  const [projects, setProjects] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail,   setDetail]   = useState(null);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => { req('GET', '/client/projects').then(d=>setProjects(d.projects||[])).finally(()=>setLoading(false)); }, []);

  async function viewProject(p) {
    setSelected(p);
    const [boq, photos, docs] = await Promise.all([
      req('GET', `/client/projects/${p.id}/boq`).catch(()=>({})),
      req('GET', `/client/projects/${p.id}/photos`).catch(()=>({ photos:[] })),
      req('GET', `/client/projects/${p.id}/documents`).catch(()=>({ documents:[] })),
    ]);
    setDetail({ boq, photos: photos.photos||[], documents: docs.documents||[] });
  }

  const STATUS_C = { PLANNING:'#6366f1', ACTIVE:'#2563eb', ON_HOLD:'#f59e0b', COMPLETED:'#16a34a' };

  if (selected && detail) {
    return (
      <div style={{ padding:32 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:24 }}>
          <button onClick={()=>{ setSelected(null); setDetail(null); }} style={{ padding:'6px 14px', background:'#f1f5f9', border:'none', borderRadius:6, cursor:'pointer', fontSize:13 }}>← Projects</button>
          <h2 style={{ fontSize:20, fontWeight:700 }}>{selected.name}</h2>
          <span style={{ fontSize:12, fontWeight:600, padding:'3px 10px', borderRadius:99, background:STATUS_C[selected.status]+'22', color:STATUS_C[selected.status] }}>{selected.status}</span>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:24, alignItems:'start' }}>
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
            {/* Progress */}
            <div style={{ background:'#fff', borderRadius:12, padding:24, boxShadow:'0 1px 4px rgba(0,0,0,.06)' }}>
              <div style={{ fontWeight:600, marginBottom:16 }}>Project Progress</div>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:13, marginBottom:8 }}>
                <span style={{ color:'#6b7280' }}>Overall</span>
                <span style={{ fontWeight:700, color:'#2563eb' }}>{selected.progress||0}%</span>
              </div>
              <ProgressBar value={selected.progress||0} />
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginTop:16 }}>
                {[
                  { label:'Start Date', value: selected.startDate ? new Date(selected.startDate).toLocaleDateString() : '—' },
                  { label:'End Date',   value: selected.endDate   ? new Date(selected.endDate).toLocaleDateString()   : '—' },
                  { label:'Location',   value: selected.location  || '—' },
                  { label:'Manager',    value: selected.projectManager?.name || '—' },
                ].map(f => (
                  <div key={f.label} style={{ padding:'10px 12px', background:'#f8fafc', borderRadius:8 }}>
                    <div style={{ fontSize:11, color:'#6b7280', marginBottom:2 }}>{f.label}</div>
                    <div style={{ fontWeight:600, fontSize:13 }}>{f.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* BOQ summary */}
            {detail.boq?.boq && (
              <div style={{ background:'#fff', borderRadius:12, padding:24, boxShadow:'0 1px 4px rgba(0,0,0,.06)' }}>
                <div style={{ fontWeight:600, marginBottom:12 }}>Approved BOQ</div>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8, fontSize:13 }}>
                  <span style={{ color:'#6b7280' }}>Version</span>
                  <span style={{ fontWeight:600 }}>v{detail.boq.boq.versionNumber}</span>
                </div>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:14 }}>
                  <span style={{ color:'#6b7280' }}>Total Cost</span>
                  <span style={{ fontWeight:700, color:'#16a34a', fontSize:16 }}>
                    UGX {(detail.boq.boq.totalCost||0)>=1e6 ? `${((detail.boq.boq.totalCost||0)/1e6).toFixed(1)}M` : (detail.boq.boq.totalCost||0).toLocaleString()}
                  </span>
                </div>
              </div>
            )}

            {/* Documents */}
            {detail.documents.length > 0 && (
              <div style={{ background:'#fff', borderRadius:12, overflow:'hidden', boxShadow:'0 1px 4px rgba(0,0,0,.06)' }}>
                <div style={{ padding:'14px 20px', borderBottom:'1px solid #f1f5f9', fontWeight:600 }}>Documents</div>
                {detail.documents.map(d => (
                  <div key={d.id} style={{ padding:'12px 20px', borderBottom:'1px solid #f8fafc', display:'flex', alignItems:'center', gap:12 }}>
                    <span style={{ fontSize:20 }}>📄</span>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:500, fontSize:14 }}>{d.name}</div>
                      <div style={{ fontSize:12, color:'#6b7280' }}>{d.type}</div>
                    </div>
                    {d.fileUrl && <a href={d.fileUrl} target="_blank" rel="noreferrer" style={{ fontSize:13, color:'#2563eb', textDecoration:'none' }}>Download</a>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Photos */}
          <div style={{ background:'#fff', borderRadius:12, padding:20, boxShadow:'0 1px 4px rgba(0,0,0,.06)' }}>
            <div style={{ fontWeight:600, marginBottom:12 }}>Site Photos</div>
            {detail.photos.length > 0 ? (
              detail.photos.map(p => (
                <div key={p.id} style={{ marginBottom:12 }}>
                  <img src={p.url} alt={p.caption||''} style={{ width:'100%', borderRadius:8, objectFit:'cover', maxHeight:180 }} />
                  {p.caption && <div style={{ fontSize:12, color:'#6b7280', marginTop:4 }}>{p.caption}</div>}
                </div>
              ))
            ) : (
              <div style={{ color:'#6b7280', fontSize:13, textAlign:'center', padding:24 }}>No photos shared yet.</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding:32 }}>
      <h1 style={{ fontSize:22, fontWeight:700, marginBottom:24 }}>Your Projects</h1>
      {loading ? <div style={{ color:'#6b7280' }}>Loading…</div> : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))', gap:16 }}>
          {projects.map(p => (
            <div key={p.id} onClick={()=>viewProject(p)} style={{ background:'#fff', borderRadius:12, padding:'20px', boxShadow:'0 1px 4px rgba(0,0,0,.06)', cursor:'pointer', border:'1px solid #f1f5f9' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>
                <div style={{ fontWeight:600, fontSize:15 }}>{p.name}</div>
                <span style={{ fontSize:11, fontWeight:600, padding:'3px 8px', borderRadius:99, background:STATUS_C[p.status]+'22', color:STATUS_C[p.status] }}>{p.status}</span>
              </div>
              {p.location && <div style={{ fontSize:13, color:'#6b7280', marginBottom:10 }}>📍 {p.location}</div>}
              <ProgressBar value={p.progress||0} />
              <div style={{ fontSize:12, color:'#6b7280', marginTop:6 }}>{p.progress||0}% complete</div>
            </div>
          ))}
          {projects.length === 0 && (
            <div style={{ gridColumn:'1/-1', textAlign:'center', color:'#6b7280', padding:48 }}>
              No projects shared with you yet. Contact your project manager for access.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const NAV = [{ to:'/', label:'My Projects', icon:'🏗️' }];

function Shell({ user, onLogout, children }) {
  const loc = useLocation();
  return (
    <div style={{ display:'flex', height:'100vh', overflow:'hidden' }}>
      <aside style={{ width:220, background:'#0f172a', color:'#e2e8f0', display:'flex', flexDirection:'column', padding:'0 0 16px', flexShrink:0 }}>
        <div style={{ padding:'20px 20px 16px', borderBottom:'1px solid #1e293b', marginBottom:8 }}><span style={{ fontSize:22, fontWeight:700 }}>🏗️ Client</span></div>
        <nav style={{ flex:1 }}>
          {NAV.map(n=>(
            <Link key={n.to} to={n.to} style={{ display:'flex', alignItems:'center', padding:'10px 20px', color:loc.pathname===n.to?'#fff':'#94a3b8', textDecoration:'none', fontSize:14, background:loc.pathname===n.to?'#1e293b':'transparent', borderLeft:loc.pathname===n.to?'3px solid #3b82f6':'3px solid transparent' }}>
              <span style={{ marginRight:8 }}>{n.icon}</span>{n.label}
            </Link>
          ))}
        </nav>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 20px', borderTop:'1px solid #1e293b', fontSize:13 }}>
          <div><div style={{ fontWeight:600 }}>{user?.name}</div><div style={{ fontSize:11, color:'#94a3b8' }}>Client</div></div>
          <button onClick={onLogout} style={{ padding:'4px 10px', background:'#1e293b', color:'#94a3b8', border:'1px solid #334155', borderRadius:6, cursor:'pointer', fontSize:12 }}>Out</button>
        </div>
      </aside>
      <main style={{ flex:1, overflow:'auto' }}>{children}</main>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const navigate = useNavigate();
  useEffect(() => { const r = localStorage.getItem('cos_user'); if (r) setUser(JSON.parse(r)); }, []);
  function handleLogin(token, u) { setToken(token); localStorage.setItem('cos_user', JSON.stringify(u)); setUser(u); navigate('/'); }
  function handleLogout() { clearToken(); localStorage.removeItem('cos_user'); setUser(null); navigate('/login'); }
  if (!isLoggedIn()) return (<Routes><Route path="/login" element={<Login onLogin={handleLogin} />} /><Route path="*" element={<Navigate to="/login" replace />} /></Routes>);
  return (
    <Shell user={user} onLogout={handleLogout}>
      <Routes>
        <Route path="/"  element={<Projects />} />
        <Route path="*"  element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
