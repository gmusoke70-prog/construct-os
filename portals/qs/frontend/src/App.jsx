import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, Link, useNavigate, useLocation } from 'react-router-dom';
import { isLoggedIn, clearToken, setToken, api } from './api';

// ─── Lazy-import page components ─────────────────────────────────────────────
import Login      from './pages/Login';
import Dashboard  from './pages/Dashboard';
import BOQPage    from './pages/BOQPage';
import TakeoffPage from './pages/TakeoffPage';

// ─── Sidebar nav ──────────────────────────────────────────────────────────────
const NAV = [
  { to: '/',        label: 'Dashboard',  icon: '📊' },
  { to: '/boq',     label: 'BOQ',        icon: '📋' },
  { to: '/takeoff', label: 'Takeoff',    icon: '📐' },
];

function Sidebar({ user, onLogout }) {
  const loc = useLocation();
  return (
    <aside style={S.sidebar}>
      <div style={S.brand}>
        <span style={{ fontSize: 22, fontWeight: 700 }}>⚡ QS</span>
        <span style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>Quantity Surveyor</span>
      </div>
      <nav style={{ flex: 1 }}>
        {NAV.map(n => (
          <Link key={n.to} to={n.to} style={{ ...S.navLink, ...(loc.pathname === n.to ? S.navActive : {}) }}>
            <span style={{ marginRight: 8 }}>{n.icon}</span>{n.label}
          </Link>
        ))}
      </nav>
      <div style={S.userRow}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{user?.name || 'User'}</div>
          <div style={{ fontSize: 11, color: '#94a3b8' }}>{user?.role}</div>
        </div>
        <button onClick={onLogout} style={S.logoutBtn}>Out</button>
      </div>
    </aside>
  );
}

// ─── Main app ────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const raw = localStorage.getItem('cos_user');
    if (raw) setUser(JSON.parse(raw));
  }, []);

  function handleLogin(token, userData) {
    setToken(token);
    localStorage.setItem('cos_user', JSON.stringify(userData));
    setUser(userData);
    navigate('/');
  }

  function handleLogout() {
    clearToken();
    localStorage.removeItem('cos_user');
    setUser(null);
    navigate('/login');
  }

  if (!isLoggedIn()) {
    return (
      <Routes>
        <Route path="/login" element={<Login onLogin={handleLogin} />} />
        <Route path="*"      element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar user={user} onLogout={handleLogout} />
      <main style={{ flex: 1, overflow: 'auto' }}>
        <Routes>
          <Route path="/"        element={<Dashboard user={user} />} />
          <Route path="/boq"     element={<BOQPage user={user} />} />
          <Route path="/takeoff" element={<TakeoffPage user={user} />} />
          <Route path="/login"   element={<Navigate to="/" replace />} />
          <Route path="*"        element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = {
  sidebar: {
    width: 220,
    background: '#0f172a',
    color: '#e2e8f0',
    display: 'flex',
    flexDirection: 'column',
    padding: '0 0 16px',
    flexShrink: 0,
  },
  brand: {
    padding: '20px 20px 16px',
    display: 'flex',
    flexDirection: 'column',
    borderBottom: '1px solid #1e293b',
    marginBottom: 8,
  },
  navLink: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 20px',
    color: '#94a3b8',
    textDecoration: 'none',
    fontSize: 14,
    borderRadius: 0,
    transition: 'all .15s',
  },
  navActive: {
    color: '#fff',
    background: '#1e293b',
    borderLeft: '3px solid #3b82f6',
  },
  userRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 20px',
    borderTop: '1px solid #1e293b',
    marginTop: 'auto',
    fontSize: 13,
  },
  logoutBtn: {
    padding: '4px 10px',
    background: '#1e293b',
    color: '#94a3b8',
    border: '1px solid #334155',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 12,
  },
};
