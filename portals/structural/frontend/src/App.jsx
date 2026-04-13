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
  const r = await fetch(`${import.meta.env.VITE_API_URL || ""}/api${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
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
        <div style={{ fontSize:13, color:'#64748b', textAlign:'center', marginBottom:8 }}>Structural Engineer Portal</div>
        {err && <div style={{ background:'#fef2f2', borderRadius:8, padding:'10px 14px', color:'#dc2626', fontSize:13 }}>{err}</div>}
        <input type="email" placeholder="Email" required value={email} onChange={e=>setEmail(e.target.value)} autoFocus style={{ padding:'10px 14px', border:'1px solid #d1d5db', borderRadius:8, fontSize:14 }} />
        <input type="password" placeholder="Password" required value={pass} onChange={e=>setPass(e.target.value)} style={{ padding:'10px 14px', border:'1px solid #d1d5db', borderRadius:8, fontSize:14 }} />
        <button type="submit" disabled={busy} style={{ padding:12, background:'#2563eb', color:'#fff', border:'none', borderRadius:8, fontSize:15, fontWeight:600, cursor:'pointer' }}>{busy?'Signing in…':'Sign in'}</button>
      </form>
    </div>
  );
}

// ─── FEM Analysis Form ────────────────────────────────────────────────────────
function AnalysisTool() {
  const EXAMPLE = {
    nodes: [
      { id:1, x:0, y:0,    fixedDOF:[0,1,2] },
      { id:2, x:0, y:3000, fixedDOF:[] },
      { id:3, x:5000, y:3000, fixedDOF:[] },
      { id:4, x:5000, y:0,    fixedDOF:[0,1,2] },
    ],
    members: [
      { id:1, nodeI:1, nodeJ:2, E:200000, A:3000, I:50000000 },
      { id:2, nodeI:2, nodeJ:3, E:200000, A:3000, I:50000000 },
      { id:3, nodeI:4, nodeJ:3, E:200000, A:3000, I:50000000 },
    ],
    loads: [{ nodeId:2, Fx:10, Fy:-50, Mz:0 }, { nodeId:3, Fx:0, Fy:-50, Mz:0 }],
  };

  const [json,    setJson]    = useState(JSON.stringify(EXAMPLE, null, 2));
  const [result,  setResult]  = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  async function analyze(e) {
    e.preventDefault(); setError(''); setResult(null); setLoading(true);
    try {
      const body = JSON.parse(json);
      const data = await req('POST', '/structural/models/analyze-inline', body);
      setResult(data);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ padding:32 }}>
      <h1 style={{ fontSize:22, fontWeight:700, marginBottom:8 }}>FEM Structural Analysis</h1>
      <p style={{ fontSize:14, color:'#64748b', marginBottom:24 }}>Euler-Bernoulli beam-column finite element solver. Edit the JSON model and click Analyze.</p>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:24, alignItems:'start' }}>
        <form onSubmit={analyze}>
          <label style={{ fontSize:13, fontWeight:600, display:'block', marginBottom:6 }}>Model JSON</label>
          <textarea value={json} onChange={e=>setJson(e.target.value)} rows={28}
            style={{ width:'100%', fontFamily:'monospace', fontSize:12, padding:12, border:'1px solid #d1d5db', borderRadius:8, resize:'vertical' }} />
          {error && <div style={{ color:'#dc2626', fontSize:13, marginTop:8 }}>{error}</div>}
          <button type="submit" disabled={loading} style={{ marginTop:12, padding:'10px 24px', background:'#2563eb', color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontWeight:600, fontSize:14 }}>
            {loading ? 'Running FEM…' : 'Analyze'}
          </button>
        </form>

        <div>
          {result && (
            <>
              <div style={{ marginBottom:16 }}>
                <div style={{ fontWeight:600, marginBottom:8 }}>Results</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                  {[
                    { label:'Safety Factor', value: result.safetyFactor?.toFixed(2) || '—', ok: (result.safetyFactor||0)>=1.5 },
                    { label:'UCR',           value: result.ucr?.toFixed(3) || '—',           ok: (result.ucr||0)<=1 },
                  ].map(k => (
                    <div key={k.label} style={{ background:'#fff', borderRadius:10, padding:'14px 16px', boxShadow:'0 1px 4px rgba(0,0,0,.06)', borderTop:`3px solid ${k.ok?'#16a34a':'#dc2626'}` }}>
                      <div style={{ fontSize:22, fontWeight:700, color:k.ok?'#16a34a':'#dc2626' }}>{k.value}</div>
                      <div style={{ fontSize:12, fontWeight:600, color:'#374151', marginTop:2 }}>{k.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              {result.warnings?.length > 0 && (
                <div style={{ background:'#fefce8', border:'1px solid #fde047', borderRadius:8, padding:'12px 16px', marginBottom:16 }}>
                  <div style={{ fontWeight:600, fontSize:13, color:'#854d0e', marginBottom:4 }}>Warnings</div>
                  {result.warnings.map((w, i) => <div key={i} style={{ fontSize:13, color:'#78350f' }}>• {w}</div>)}
                </div>
              )}

              <div style={{ background:'#fff', borderRadius:10, boxShadow:'0 1px 4px rgba(0,0,0,.06)', overflow:'hidden' }}>
                <div style={{ padding:'12px 16px', borderBottom:'1px solid #f1f5f9', fontWeight:600, fontSize:14 }}>Member Forces</div>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                  <thead><tr style={{ background:'#f8fafc' }}>
                    {['Member','N (kN)','Vy (kN)','Mz (kNm)','Stress (MPa)'].map(h => <th key={h} style={{ padding:'8px 12px', textAlign:'right', fontWeight:600, color:'#374151' }}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {(result.memberForces||[]).map((m, i) => (
                      <tr key={i} style={{ borderTop:'1px solid #f1f5f9' }}>
                        <td style={{ padding:'8px 12px', fontWeight:500 }}>M{m.memberId}</td>
                        <td style={{ padding:'8px 12px', textAlign:'right' }}>{m.N?.toFixed(2)}</td>
                        <td style={{ padding:'8px 12px', textAlign:'right' }}>{m.Vy?.toFixed(2)}</td>
                        <td style={{ padding:'8px 12px', textAlign:'right' }}>{m.Mz?.toFixed(2)}</td>
                        <td style={{ padding:'8px 12px', textAlign:'right', color:(result.stresses?.[i]?.max||0)>250?'#dc2626':'#16a34a', fontWeight:600 }}>
                          {result.stresses?.[i]?.max?.toFixed(1) || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {!result && !loading && (
            <div style={{ background:'#f8fafc', borderRadius:12, padding:32, textAlign:'center', color:'#6b7280', fontSize:14 }}>
              Edit the model on the left and click <strong>Analyze</strong> to run the FEM solver.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Models() {
  const [models, setModels] = useState([]);
  useEffect(() => { req('GET', '/structural/models').then(d=>setModels(d.models||[])).catch(()=>{}); }, []);
  return (
    <div style={{ padding:32 }}>
      <h1 style={{ fontSize:22, fontWeight:700, marginBottom:24 }}>Structural Models</h1>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:16 }}>
        {models.map(m => (
          <div key={m.id} style={{ background:'#fff', borderRadius:12, padding:'18px 20px', boxShadow:'0 1px 4px rgba(0,0,0,.06)' }}>
            <div style={{ fontWeight:600, fontSize:15, marginBottom:4 }}>{m.name}</div>
            <div style={{ fontSize:13, color:'#6b7280' }}>{m.type} · {m.nodes?.length||0} nodes · {m.members?.length||0} members</div>
            <div style={{ fontSize:12, color:'#9ca3af', marginTop:8 }}>{new Date(m.updatedAt).toLocaleDateString()}</div>
          </div>
        ))}
        {models.length === 0 && <div style={{ gridColumn:'1/-1', textAlign:'center', color:'#6b7280', padding:40 }}>No saved models. Use the Analysis tool to run calculations.</div>}
      </div>
    </div>
  );
}

const NAV = [{ to:'/', label:'Analysis', icon:'🔩' }, { to:'/models', label:'Models', icon:'📐' }];

function Shell({ user, onLogout, children }) {
  const loc = useLocation();
  return (
    <div style={{ display:'flex', height:'100vh', overflow:'hidden' }}>
      <aside style={{ width:220, background:'#0f172a', color:'#e2e8f0', display:'flex', flexDirection:'column', padding:'0 0 16px', flexShrink:0 }}>
        <div style={{ padding:'20px 20px 16px', borderBottom:'1px solid #1e293b', marginBottom:8 }}><span style={{ fontSize:22, fontWeight:700 }}>🔩 Structural</span></div>
        <nav style={{ flex:1 }}>
          {NAV.map(n=>(
            <Link key={n.to} to={n.to} style={{ display:'flex', alignItems:'center', padding:'10px 20px', color:loc.pathname===n.to?'#fff':'#94a3b8', textDecoration:'none', fontSize:14, background:loc.pathname===n.to?'#1e293b':'transparent', borderLeft:loc.pathname===n.to?'3px solid #3b82f6':'3px solid transparent' }}>
              <span style={{ marginRight:8 }}>{n.icon}</span>{n.label}
            </Link>
          ))}
        </nav>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 20px', borderTop:'1px solid #1e293b', fontSize:13 }}>
          <div><div style={{ fontWeight:600 }}>{user?.name}</div><div style={{ fontSize:11, color:'#94a3b8' }}>{user?.role}</div></div>
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
        <Route path="/"       element={<AnalysisTool />} />
        <Route path="/models" element={<Models />} />
        <Route path="*"       element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
