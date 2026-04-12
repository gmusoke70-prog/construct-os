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
        <div style={{ fontSize:13, color:'#64748b', textAlign:'center', marginBottom:8 }}>Admin Portal</div>
        {err && <div style={{ background:'#fef2f2', borderRadius:8, padding:'10px 14px', color:'#dc2626', fontSize:13 }}>{err}</div>}
        <input type="email" placeholder="Email" required value={email} onChange={e=>setEmail(e.target.value)} autoFocus style={{ padding:'10px 14px', border:'1px solid #d1d5db', borderRadius:8, fontSize:14 }} />
        <input type="password" placeholder="Password" required value={pass} onChange={e=>setPass(e.target.value)} style={{ padding:'10px 14px', border:'1px solid #d1d5db', borderRadius:8, fontSize:14 }} />
        <button type="submit" disabled={busy} style={{ padding:12, background:'#2563eb', color:'#fff', border:'none', borderRadius:8, fontSize:15, fontWeight:600, cursor:'pointer' }}>{busy?'Signing in…':'Sign in'}</button>
      </form>
    </div>
  );
}

function Users() {
  const [users,    setUsers]    = useState([]);
  const [inviting, setInviting] = useState(false);
  const [form,     setForm]     = useState({ name:'', email:'', role:'QUANTITY_SURVEYOR' });
  const [inviteLink, setInviteLink] = useState('');

  useEffect(() => { req('GET', '/admin/users').then(d=>setUsers(d.users||[])).catch(()=>{}); }, []);

  async function invite(e) {
    e.preventDefault();
    try {
      const { inviteUrl } = await req('POST', '/admin/invite', form);
      setInviteLink(inviteUrl || '(Link sent by email)');
      setInviting(false); setForm({ name:'', email:'', role:'QUANTITY_SURVEYOR' });
      req('GET', '/admin/users').then(d=>setUsers(d.users||[]));
    } catch (e) { alert(e.message); }
  }

  const ROLES = ['ADMIN','OWNER','QUANTITY_SURVEYOR','PROJECT_MANAGER','ARCHITECT','STRUCTURAL_ENGINEER','PROCUREMENT_OFFICER','HR_MANAGER','FINANCE_MANAGER','CLIENT'];
  const ROLE_COLORS = { ADMIN:'#dc2626', OWNER:'#7c3aed', QUANTITY_SURVEYOR:'#2563eb', PROJECT_MANAGER:'#0891b2', ARCHITECT:'#d97706', CLIENT:'#6b7280' };

  return (
    <div style={{ padding:32 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:24 }}>
        <h1 style={{ fontSize:22, fontWeight:700 }}>Users</h1>
        <button onClick={()=>setInviting(true)} style={S.btn}>+ Invite User</button>
      </div>

      {inviteLink && (
        <div style={{ background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:8, padding:'12px 16px', marginBottom:20, fontSize:13, color:'#166534' }}>
          <strong>Invite link:</strong> <code style={{ wordBreak:'break-all' }}>{inviteLink}</code>
          <button onClick={()=>setInviteLink('')} style={{ marginLeft:12, padding:'2px 8px', border:'none', borderRadius:4, cursor:'pointer', fontSize:11 }}>Dismiss</button>
        </div>
      )}

      {inviting && (
        <form onSubmit={invite} style={{ background:'#fff', borderRadius:12, padding:24, marginBottom:24, boxShadow:'0 4px 20px rgba(0,0,0,.08)' }}>
          <h3 style={{ fontSize:16, fontWeight:600, marginBottom:16 }}>Invite New User</h3>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:12 }}>
            <label style={{ display:'flex', flexDirection:'column', gap:4 }}>
              <span style={{ fontSize:12, fontWeight:600 }}>Full Name *</span>
              <input required value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} style={S.input} />
            </label>
            <label style={{ display:'flex', flexDirection:'column', gap:4 }}>
              <span style={{ fontSize:12, fontWeight:600 }}>Email *</span>
              <input type="email" required value={form.email} onChange={e=>setForm(p=>({...p,email:e.target.value}))} style={S.input} />
            </label>
            <label style={{ display:'flex', flexDirection:'column', gap:4 }}>
              <span style={{ fontSize:12, fontWeight:600 }}>Role *</span>
              <select value={form.role} onChange={e=>setForm(p=>({...p,role:e.target.value}))} style={{ ...S.input, background:'#fff' }}>
                {ROLES.map(r=><option key={r}>{r}</option>)}
              </select>
            </label>
          </div>
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
            <button type="button" onClick={()=>setInviting(false)} style={S.cancel}>Cancel</button>
            <button type="submit" style={S.btn}>Send Invite</button>
          </div>
        </form>
      )}

      <div style={{ background:'#fff', borderRadius:12, overflow:'hidden', boxShadow:'0 1px 4px rgba(0,0,0,.06)' }}>
        <div style={{ padding:'12px 20px', borderBottom:'1px solid #f1f5f9', display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', fontSize:12, fontWeight:700, color:'#6b7280', textTransform:'uppercase', letterSpacing:'.5px' }}>
          <span>Name</span><span>Email</span><span>Role</span><span>Status</span>
        </div>
        {users.map(u => (
          <div key={u.id} style={{ padding:'12px 20px', borderBottom:'1px solid #f8fafc', display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', alignItems:'center' }}>
            <div style={{ fontWeight:500, fontSize:14 }}>{u.name}</div>
            <div style={{ fontSize:13, color:'#6b7280' }}>{u.email}</div>
            <span style={{ fontSize:11, fontWeight:600, padding:'3px 8px', borderRadius:99, background:(ROLE_COLORS[u.role]||'#6b7280')+'22', color:(ROLE_COLORS[u.role]||'#6b7280'), width:'fit-content' }}>{u.role}</span>
            <span style={{ fontSize:11, fontWeight:600, padding:'3px 8px', borderRadius:99, background:u.isActive?'#dcfce7':'#fef9c3', color:u.isActive?'#166534':'#854d0e', width:'fit-content' }}>
              {u.isActive?'Active':'Pending'}
            </span>
          </div>
        ))}
        {users.length === 0 && <div style={{ padding:'24px 20px', color:'#6b7280', fontSize:14 }}>No users found.</div>}
      </div>
    </div>
  );
}

function Company() {
  const [company, setCompany] = useState(null);
  useEffect(() => { req('GET', '/admin/company').then(d=>setCompany(d.company)).catch(()=>{}); }, []);
  if (!company) return <div style={{ padding:32, color:'#6b7280' }}>Loading…</div>;
  return (
    <div style={{ padding:32, maxWidth:600 }}>
      <h1 style={{ fontSize:22, fontWeight:700, marginBottom:24 }}>Company Settings</h1>
      <div style={{ background:'#fff', borderRadius:12, padding:24, boxShadow:'0 1px 4px rgba(0,0,0,.06)' }}>
        {[
          { label:'Company Name', value:company.name },
          { label:'Industry',     value:company.industry || '—' },
          { label:'Country',      value:company.country  || '—' },
          { label:'Plan',         value:company.plan     || 'FREE' },
          { label:'Created',      value:new Date(company.createdAt).toLocaleDateString() },
        ].map(f => (
          <div key={f.label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px 0', borderBottom:'1px solid #f1f5f9' }}>
            <span style={{ fontSize:13, color:'#6b7280' }}>{f.label}</span>
            <span style={{ fontWeight:600, fontSize:14 }}>{f.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const NAV = [{ to:'/', label:'Users', icon:'👥' }, { to:'/company', label:'Company', icon:'🏢' }];

function Shell({ user, onLogout, children }) {
  const loc = useLocation();
  return (
    <div style={{ display:'flex', height:'100vh', overflow:'hidden' }}>
      <aside style={{ width:220, background:'#0f172a', color:'#e2e8f0', display:'flex', flexDirection:'column', padding:'0 0 16px', flexShrink:0 }}>
        <div style={{ padding:'20px 20px 16px', borderBottom:'1px solid #1e293b', marginBottom:8 }}><span style={{ fontSize:22, fontWeight:700 }}>🛡️ Admin</span></div>
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
        <Route path="/"        element={<Users />} />
        <Route path="/company" element={<Company />} />
        <Route path="*"        element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}

const S = {
  btn:    { padding:'9px 18px', background:'#2563eb', color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontWeight:600, fontSize:14 },
  cancel: { padding:'9px 18px', background:'#f1f5f9', color:'#374151', border:'none', borderRadius:8, cursor:'pointer', fontSize:14 },
  input:  { padding:'10px 14px', border:'1px solid #d1d5db', borderRadius:8, fontSize:14, width:'100%' },
};
