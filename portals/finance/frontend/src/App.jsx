import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, Link, useNavigate, useLocation } from 'react-router-dom';

// ─── Auth helpers ─────────────────────────────────────────────────────────────
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

// ─── Login ───────────────────────────────────────────────────────────────────
function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [pass, setPass]   = useState('');
  const [err, setErr]     = useState('');
  const [busy, setBusy]   = useState(false);
  async function submit(e) {
    e.preventDefault(); setErr(''); setBusy(true);
    try { const { token, user } = await req('POST', '/auth/login', { email, password: pass }); onLogin(token, user); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'linear-gradient(135deg,#0f172a,#1e3a5f)' }}>
      <form onSubmit={submit} style={{ background:'#fff', borderRadius:16, padding:'40px 36px', width:360, boxShadow:'0 20px 60px rgba(0,0,0,.3)', display:'flex', flexDirection:'column', gap:12 }}>
        <div style={{ fontSize:22, fontWeight:800, textAlign:'center' }}>⚡ Construct-OS</div>
        <div style={{ fontSize:13, color:'#64748b', textAlign:'center', marginBottom:8 }}>Finance Portal</div>
        {err && <div style={{ background:'#fef2f2', border:'1px solid #fca5a5', borderRadius:8, padding:'10px 14px', color:'#dc2626', fontSize:13 }}>{err}</div>}
        <input type="email" placeholder="Email" required value={email} onChange={e=>setEmail(e.target.value)} autoFocus
          style={{ padding:'10px 14px', border:'1px solid #d1d5db', borderRadius:8, fontSize:14 }} />
        <input type="password" placeholder="Password" required value={pass} onChange={e=>setPass(e.target.value)}
          style={{ padding:'10px 14px', border:'1px solid #d1d5db', borderRadius:8, fontSize:14 }} />
        <button type="submit" disabled={busy}
          style={{ padding:12, background:'#2563eb', color:'#fff', border:'none', borderRadius:8, fontSize:15, fontWeight:600, cursor:'pointer' }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({ user }) {
  const [kpis,     setKpis]     = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [cashflow, setCashflow] = useState([]);

  useEffect(() => {
    req('GET', '/finance/dashboard').then(d => setKpis(d)).catch(()=>{});
    req('GET', '/finance/invoices').then(d => setInvoices((d.invoices||[]).slice(0,6))).catch(()=>{});
    req('GET', '/finance/cashflow').then(d => setCashflow(d.projection||[])).catch(()=>{});
  }, []);

  const fmt = n => n >= 1e9 ? `${(n/1e9).toFixed(1)}B` : n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `${(n/1e3).toFixed(0)}K` : String(n||0);
  const STATUS_C = { DRAFT:'#6b7280', SENT:'#2563eb', PAID:'#16a34a', OVERDUE:'#dc2626' };

  return (
    <div style={{ padding:32 }}>
      <h1 style={{ fontSize:24, fontWeight:700, marginBottom:24 }}>Finance Dashboard</h1>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:16, marginBottom:32 }}>
        {[
          { label:'Revenue (month)',  value:`UGX ${fmt(kpis?.monthlyRevenue)}`,  color:'#16a34a' },
          { label:'Expenses (month)', value:`UGX ${fmt(kpis?.monthlyExpenses)}`, color:'#dc2626' },
          { label:'Outstanding',      value:`UGX ${fmt(kpis?.outstandingAmount)}`,color:'#f59e0b' },
          { label:'Open Invoices',    value: kpis?.openInvoices ?? '—',           color:'#2563eb' },
        ].map(k => (
          <div key={k.label} style={{ background:'#fff', borderRadius:12, padding:'20px 24px', boxShadow:'0 1px 4px rgba(0,0,0,.06)', borderTop:`3px solid ${k.color}` }}>
            <div style={{ fontSize:22, fontWeight:700, color:k.color }}>{k.value}</div>
            <div style={{ fontSize:13, fontWeight:600, marginTop:4 }}>{k.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:24 }}>
        {/* Invoices */}
        <div style={{ background:'#fff', borderRadius:12, overflow:'hidden', boxShadow:'0 1px 4px rgba(0,0,0,.06)' }}>
          <div style={{ padding:'16px 20px', borderBottom:'1px solid #f1f5f9', fontWeight:600 }}>Recent Invoices</div>
          {invoices.map(inv => (
            <div key={inv.id} style={{ padding:'12px 20px', borderBottom:'1px solid #f8fafc', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div>
                <div style={{ fontWeight:500, fontSize:14 }}>{inv.invoiceNumber}</div>
                <div style={{ fontSize:12, color:'#6b7280' }}>{inv.client?.name || 'Client'} · Due {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : '—'}</div>
              </div>
              <div style={{ textAlign:'right' }}>
                <div style={{ fontWeight:600, fontSize:14 }}>UGX {fmt(inv.totalAmount)}</div>
                <span style={{ fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:99, background:STATUS_C[inv.status]+'22', color:STATUS_C[inv.status] }}>{inv.status}</span>
              </div>
            </div>
          ))}
          {invoices.length === 0 && <div style={{ padding:'20px', color:'#6b7280', fontSize:14 }}>No invoices yet.</div>}
        </div>

        {/* Cash flow sparkline */}
        <div style={{ background:'#fff', borderRadius:12, padding:'20px', boxShadow:'0 1px 4px rgba(0,0,0,.06)' }}>
          <div style={{ fontWeight:600, marginBottom:12 }}>6-Month Projection</div>
          {cashflow.map((m, i) => (
            <div key={i} style={{ marginBottom:10 }}>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:3 }}>
                <span style={{ color:'#374151' }}>{m.month}</span>
                <span style={{ color: m.netCashflow >= 0 ? '#16a34a' : '#dc2626', fontWeight:600 }}>
                  {m.netCashflow >= 0 ? '+' : ''}UGX {fmt(m.netCashflow)}
                </span>
              </div>
              <div style={{ height:6, background:'#f1f5f9', borderRadius:3, overflow:'hidden' }}>
                <div style={{ height:'100%', width:`${Math.min(100, Math.abs(m.netCashflow)/(Math.max(...cashflow.map(c=>Math.abs(c.netCashflow)))||1)*100)}%`,
                  background: m.netCashflow >= 0 ? '#16a34a' : '#dc2626', borderRadius:3 }} />
              </div>
            </div>
          ))}
          {cashflow.length === 0 && <div style={{ color:'#6b7280', fontSize:13 }}>No data yet.</div>}
        </div>
      </div>
    </div>
  );
}

// ─── Invoices page ────────────────────────────────────────────────────────────
function Invoices() {
  const [invoices, setInvoices] = useState([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ clientId:'', dueDate:'', items:'' });

  useEffect(() => { req('GET', '/finance/invoices').then(d => setInvoices(d.invoices||[])).catch(()=>{}); }, []);

  async function create(e) {
    e.preventDefault();
    try {
      const { invoice } = await req('POST', '/finance/invoices', {
        clientId: form.clientId, dueDate: form.dueDate,
        items: form.items.split('\n').filter(Boolean).map(line => {
          const [desc, qty, rate] = line.split(',').map(s=>s.trim());
          return { description: desc, quantity: Number(qty)||1, unitPrice: Number(rate)||0 };
        }),
      });
      setInvoices(prev => [invoice, ...prev]);
      setCreating(false);
      setForm({ clientId:'', dueDate:'', items:'' });
    } catch (e) { alert(e.message); }
  }

  async function markPaid(id) {
    try {
      await req('POST', `/finance/invoices/${id}/pay`);
      setInvoices(prev => prev.map(i => i.id === id ? { ...i, status:'PAID' } : i));
    } catch (e) { alert(e.message); }
  }

  const STATUS_C = { DRAFT:'#6b7280', SENT:'#2563eb', PAID:'#16a34a', OVERDUE:'#dc2626' };
  const fmt = n => n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : (n||0).toLocaleString();

  return (
    <div style={{ padding:32 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:24 }}>
        <h1 style={{ fontSize:22, fontWeight:700 }}>Invoices</h1>
        <button onClick={() => setCreating(true)} style={S.btn}>+ New Invoice</button>
      </div>

      {creating && (
        <form onSubmit={create} style={{ background:'#fff', borderRadius:12, padding:24, marginBottom:24, boxShadow:'0 4px 20px rgba(0,0,0,.08)' }}>
          <h3 style={{ marginBottom:16, fontSize:16, fontWeight:600 }}>New Invoice</h3>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
            <input placeholder="Client ID" required value={form.clientId} onChange={e=>setForm(p=>({...p,clientId:e.target.value}))}
              style={S.input} />
            <input type="date" required value={form.dueDate} onChange={e=>setForm(p=>({...p,dueDate:e.target.value}))}
              style={S.input} />
          </div>
          <textarea placeholder="Items (one per line): Description, Quantity, Unit Price" required rows={5}
            value={form.items} onChange={e=>setForm(p=>({...p,items:e.target.value}))} style={{ ...S.input, resize:'vertical' }} />
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:12 }}>
            <button type="button" onClick={()=>setCreating(false)} style={S.cancel}>Cancel</button>
            <button type="submit" style={S.btn}>Create Invoice</button>
          </div>
        </form>
      )}

      <div style={{ background:'#fff', borderRadius:12, overflow:'hidden', boxShadow:'0 1px 4px rgba(0,0,0,.06)' }}>
        {invoices.map(inv => (
          <div key={inv.id} style={{ padding:'14px 20px', borderBottom:'1px solid #f8fafc', display:'flex', alignItems:'center', gap:12 }}>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:600, fontSize:14 }}>{inv.invoiceNumber}</div>
              <div style={{ fontSize:12, color:'#6b7280' }}>Due {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : '—'}</div>
            </div>
            <div style={{ fontWeight:600 }}>UGX {fmt(inv.totalAmount)}</div>
            <span style={{ fontSize:11, fontWeight:600, padding:'3px 8px', borderRadius:99, background:STATUS_C[inv.status]+'22', color:STATUS_C[inv.status] }}>{inv.status}</span>
            {inv.status !== 'PAID' && (
              <button onClick={()=>markPaid(inv.id)} style={{ padding:'5px 12px', background:'#dcfce7', color:'#166534', border:'none', borderRadius:6, cursor:'pointer', fontSize:12 }}>Mark Paid</button>
            )}
          </div>
        ))}
        {invoices.length === 0 && <div style={{ padding:'24px 20px', color:'#6b7280', fontSize:14 }}>No invoices yet.</div>}
      </div>
    </div>
  );
}

// ─── Shell ────────────────────────────────────────────────────────────────────
const NAV = [
  { to:'/',        label:'Dashboard', icon:'📊' },
  { to:'/invoices',label:'Invoices',  icon:'🧾' },
];

function Shell({ user, onLogout, children }) {
  const loc = useLocation();
  return (
    <div style={{ display:'flex', height:'100vh', overflow:'hidden' }}>
      <aside style={{ width:220, background:'#0f172a', color:'#e2e8f0', display:'flex', flexDirection:'column', padding:'0 0 16px', flexShrink:0 }}>
        <div style={{ padding:'20px 20px 16px', borderBottom:'1px solid #1e293b', marginBottom:8 }}>
          <span style={{ fontSize:22, fontWeight:700 }}>💰 Finance</span>
        </div>
        <nav style={{ flex:1 }}>
          {NAV.map(n => (
            <Link key={n.to} to={n.to} style={{ display:'flex', alignItems:'center', padding:'10px 20px', color: loc.pathname===n.to ? '#fff' : '#94a3b8',
              textDecoration:'none', fontSize:14, background: loc.pathname===n.to ? '#1e293b':'transparent',
              borderLeft: loc.pathname===n.to ? '3px solid #3b82f6':'3px solid transparent' }}>
              <span style={{ marginRight:8 }}>{n.icon}</span>{n.label}
            </Link>
          ))}
        </nav>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 20px', borderTop:'1px solid #1e293b', fontSize:13 }}>
          <div>
            <div style={{ fontWeight:600 }}>{user?.name}</div>
            <div style={{ fontSize:11, color:'#94a3b8' }}>{user?.role}</div>
          </div>
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
  function handleLogin(token, userData) { setToken(token); localStorage.setItem('cos_user', JSON.stringify(userData)); setUser(userData); navigate('/'); }
  function handleLogout() { clearToken(); localStorage.removeItem('cos_user'); setUser(null); navigate('/login'); }
  if (!isLoggedIn()) return (
    <Routes>
      <Route path="/login" element={<Login onLogin={handleLogin} />} />
      <Route path="*"      element={<Navigate to="/login" replace />} />
    </Routes>
  );
  return (
    <Shell user={user} onLogout={handleLogout}>
      <Routes>
        <Route path="/"        element={<Dashboard user={user} />} />
        <Route path="/invoices" element={<Invoices />} />
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
