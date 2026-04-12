import React, { useState } from 'react';
import { api } from '../api';

export default function Login({ onLogin }) {
  const [email, setEmail]   = useState('');
  const [pass,  setPass]    = useState('');
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { token, user } = await api.login(email, pass);
      onLogin(token, user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={S.wrap}>
      <form style={S.card} onSubmit={handleSubmit}>
        <div style={S.logo}>⚡ Construct-OS</div>
        <div style={S.subtitle}>Quantity Surveyor Portal</div>

        {error && <div style={S.error}>{error}</div>}

        <label style={S.label}>Email</label>
        <input
          style={S.input}
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@company.com"
          required
          autoFocus
        />

        <label style={S.label}>Password</label>
        <input
          style={S.input}
          type="password"
          value={pass}
          onChange={e => setPass(e.target.value)}
          placeholder="••••••••"
          required
        />

        <button style={S.btn} type="submit" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

const S = {
  wrap: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)',
  },
  card: {
    background: '#fff',
    borderRadius: 16,
    padding: '40px 36px',
    width: 360,
    boxShadow: '0 20px 60px rgba(0,0,0,.3)',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  logo: { fontSize: 22, fontWeight: 800, color: '#0f172a', textAlign: 'center' },
  subtitle: { fontSize: 13, color: '#64748b', textAlign: 'center', marginBottom: 8 },
  error: {
    background: '#fef2f2', border: '1px solid #fca5a5',
    borderRadius: 8, padding: '10px 14px', color: '#dc2626', fontSize: 13,
  },
  label: { fontSize: 13, fontWeight: 600, color: '#374151' },
  input: {
    padding: '10px 14px', border: '1px solid #d1d5db', borderRadius: 8,
    fontSize: 14, outline: 'none', width: '100%',
  },
  btn: {
    marginTop: 8, padding: '12px', background: '#2563eb', color: '#fff',
    border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer',
  },
};
