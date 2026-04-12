import React, { useState } from 'react';
import { api } from '../api';

export default function Login({ onLogin }) {
  const [email,   setEmail]   = useState('');
  const [pass,    setPass]    = useState('');
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault(); setError(''); setLoading(true);
    try { const { token, user } = await api.login(email, pass); onLogin(token, user); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'linear-gradient(135deg,#0f172a,#1e3a5f)' }}>
      <form style={{ background:'#fff', borderRadius:16, padding:'40px 36px', width:360, boxShadow:'0 20px 60px rgba(0,0,0,.3)', display:'flex', flexDirection:'column', gap:12 }} onSubmit={submit}>
        <div style={{ fontSize:22, fontWeight:800, color:'#0f172a', textAlign:'center' }}>⚡ Construct-OS</div>
        <div style={{ fontSize:13, color:'#64748b', textAlign:'center', marginBottom:8 }}>Project Manager Portal</div>
        {error && <div style={{ background:'#fef2f2', border:'1px solid #fca5a5', borderRadius:8, padding:'10px 14px', color:'#dc2626', fontSize:13 }}>{error}</div>}
        <label style={{ fontSize:13, fontWeight:600 }}>Email</label>
        <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@company.com" required autoFocus
          style={{ padding:'10px 14px', border:'1px solid #d1d5db', borderRadius:8, fontSize:14 }} />
        <label style={{ fontSize:13, fontWeight:600 }}>Password</label>
        <input type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="••••••••" required
          style={{ padding:'10px 14px', border:'1px solid #d1d5db', borderRadius:8, fontSize:14 }} />
        <button type="submit" disabled={loading}
          style={{ marginTop:8, padding:12, background:'#2563eb', color:'#fff', border:'none', borderRadius:8, fontSize:15, fontWeight:600, cursor:'pointer' }}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
