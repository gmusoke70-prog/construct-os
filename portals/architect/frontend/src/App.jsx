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
        <div style={{ fontSize:13, color:'#64748b', textAlign:'center', marginBottom:8 }}>Architect Portal</div>
        {err && <div style={{ background:'#fef2f2', borderRadius:8, padding:'10px 14px', color:'#dc2626', fontSize:13 }}>{err}</div>}
        <input type="email" placeholder="Email" required value={email} onChange={e=>setEmail(e.target.value)} autoFocus style={{ padding:'10px 14px', border:'1px solid #d1d5db', borderRadius:8, fontSize:14 }} />
        <input type="password" placeholder="Password" required value={pass} onChange={e=>setPass(e.target.value)} style={{ padding:'10px 14px', border:'1px solid #d1d5db', borderRadius:8, fontSize:14 }} />
        <button type="submit" disabled={busy} style={{ padding:12, background:'#2563eb', color:'#fff', border:'none', borderRadius:8, fontSize:15, fontWeight:600, cursor:'pointer' }}>{busy?'Signing in…':'Sign in'}</button>
      </form>
    </div>
  );
}

// ─── Floor Plan Generator ─────────────────────────────────────────────────────
function FloorPlans() {
  const [plans,    setPlans]    = useState([]);
  const [selected, setSelected] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [form,     setForm]     = useState({ landWidth:15, landLength:20, floors:1, rooms:{ bedrooms:3 }, style:'CONTEMPORARY' });
  const [loading,  setLoading]  = useState(true);

  useEffect(() => { req('GET', '/architect/floor-plans').then(d=>setPlans(d.plans||[])).finally(()=>setLoading(false)); }, []);

  async function generate(e) {
    e.preventDefault(); setGenerating(true);
    try {
      const { plan } = await req('POST', '/architect/floor-plans/generate', form);
      setPlans(p=>[plan,...p]);
      setSelected(plan);
    } catch (e) { alert(e.message); }
    finally { setGenerating(false); }
  }

  async function exportSVG(id) {
    const res = await fetch(`/api/architect/floor-plans/${id}/export`, { headers:{ Authorization:`Bearer ${getToken()}` } });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=`floor-plan-${id}.svg`; a.click();
    URL.revokeObjectURL(url);
  }

  if (selected) {
    return (
      <div style={{ padding:32 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:24 }}>
          <button onClick={()=>setSelected(null)} style={{ padding:'6px 14px', background:'#f1f5f9', border:'none', borderRadius:6, cursor:'pointer', fontSize:13 }}>← Back</button>
          <h2 style={{ fontSize:18, fontWeight:700 }}>{selected.name}</h2>
          <button onClick={()=>exportSVG(selected.id)} style={{ marginLeft:'auto', padding:'7px 16px', background:'#0f172a', color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:13 }}>Export SVG</button>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:24 }}>
          <div style={{ background:'#fff', borderRadius:12, padding:24, boxShadow:'0 1px 4px rgba(0,0,0,.06)', overflow:'auto' }}>
            {selected.svgData
              ? <div dangerouslySetInnerHTML={{ __html: selected.svgData }} />
              : <div style={{ color:'#6b7280', textAlign:'center', padding:40 }}>No SVG data</div>}
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {[
              { label:'Land Size',   value:`${selected.landWidth}m × ${selected.landLength}m` },
              { label:'Build Area',  value:`${(selected.buildArea||0).toFixed(0)} m²` },
              { label:'Floors',      value: selected.floors },
              { label:'Style',       value: selected.style },
            ].map(k => (
              <div key={k.label} style={{ background:'#fff', borderRadius:10, padding:'14px 16px', boxShadow:'0 1px 4px rgba(0,0,0,.06)' }}>
                <div style={{ fontSize:12, color:'#6b7280', marginBottom:2 }}>{k.label}</div>
                <div style={{ fontWeight:600, fontSize:15 }}>{k.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding:32 }}>
      <h1 style={{ fontSize:22, fontWeight:700, marginBottom:24 }}>Floor Plans</h1>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 2fr', gap:24, alignItems:'start' }}>
        {/* Generator form */}
        <form onSubmit={generate} style={{ background:'#fff', borderRadius:12, padding:24, boxShadow:'0 1px 4px rgba(0,0,0,.06)' }}>
          <h3 style={{ fontSize:15, fontWeight:600, marginBottom:16 }}>Generate Floor Plan</h3>
          {[
            { label:'Land Width (m)', key:'landWidth', type:'number' },
            { label:'Land Length (m)', key:'landLength', type:'number' },
            { label:'Floors', key:'floors', type:'number' },
          ].map(f=>(
            <label key={f.key} style={{ display:'block', marginBottom:12 }}>
              <span style={{ fontSize:12, fontWeight:600, color:'#374151', display:'block', marginBottom:4 }}>{f.label}</span>
              <input type={f.type} value={form[f.key]} min={1}
                onChange={e=>setForm(p=>({...p,[f.key]:Number(e.target.value)}))}
                style={{ padding:'9px 12px', border:'1px solid #d1d5db', borderRadius:8, fontSize:14, width:'100%' }} />
            </label>
          ))}
          <label style={{ display:'block', marginBottom:12 }}>
            <span style={{ fontSize:12, fontWeight:600, color:'#374151', display:'block', marginBottom:4 }}>Bedrooms</span>
            <input type="number" min={1} max={10} value={form.rooms.bedrooms}
              onChange={e=>setForm(p=>({...p,rooms:{...p.rooms,bedrooms:Number(e.target.value)}}))}
              style={{ padding:'9px 12px', border:'1px solid #d1d5db', borderRadius:8, fontSize:14, width:'100%' }} />
          </label>
          <label style={{ display:'block', marginBottom:16 }}>
            <span style={{ fontSize:12, fontWeight:600, color:'#374151', display:'block', marginBottom:4 }}>Style</span>
            <select value={form.style} onChange={e=>setForm(p=>({...p,style:e.target.value}))}
              style={{ padding:'9px 12px', border:'1px solid #d1d5db', borderRadius:8, fontSize:14, width:'100%' }}>
              {['CONTEMPORARY','MODERN','TRADITIONAL','COLONIAL','MEDITERRANEAN'].map(s=><option key={s}>{s}</option>)}
            </select>
          </label>
          <button type="submit" disabled={generating}
            style={{ width:'100%', padding:'10px', background:'#2563eb', color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontWeight:600, fontSize:14 }}>
            {generating ? 'Generating…' : 'Generate Plan'}
          </button>
        </form>

        {/* Plan list */}
        <div>
          {loading ? <div style={{ color:'#6b7280' }}>Loading…</div> : (
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              {plans.map(p => (
                <div key={p.id} onClick={()=>setSelected(p)}
                  style={{ background:'#fff', borderRadius:12, padding:'16px 20px', boxShadow:'0 1px 4px rgba(0,0,0,.06)', cursor:'pointer', display:'flex', alignItems:'center', gap:16 }}>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:600, fontSize:14 }}>{p.name}</div>
                    <div style={{ fontSize:13, color:'#6b7280' }}>{p.landWidth}×{p.landLength}m · {p.floors} floor(s) · {p.buildArea?.toFixed(0)} m²</div>
                  </div>
                  <span style={{ fontSize:12, color:'#2563eb' }}>View →</span>
                </div>
              ))}
              {plans.length === 0 && <div style={{ textAlign:'center', color:'#6b7280', padding:40, background:'#fff', borderRadius:12 }}>No floor plans yet. Use the generator on the left.</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const NAV = [{ to:'/', label:'Floor Plans', icon:'🏠' }];

function Shell({ user, onLogout, children }) {
  const loc = useLocation();
  return (
    <div style={{ display:'flex', height:'100vh', overflow:'hidden' }}>
      <aside style={{ width:220, background:'#0f172a', color:'#e2e8f0', display:'flex', flexDirection:'column', padding:'0 0 16px', flexShrink:0 }}>
        <div style={{ padding:'20px 20px 16px', borderBottom:'1px solid #1e293b', marginBottom:8 }}><span style={{ fontSize:22, fontWeight:700 }}>🏠 Architect</span></div>
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
        <Route path="/"  element={<FloorPlans />} />
        <Route path="*"  element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
