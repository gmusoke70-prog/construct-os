import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

export default function Dashboard({ user }) {
  const [kpis,    setKpis]    = useState(null);
  const [projects, setProjects]= useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.dashboard(), api.projects()])
      .then(([d, p]) => { setKpis(d.kpis); setProjects(p.projects || []); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const STATUS_COLOR = { PLANNING:'#6366f1', ACTIVE:'#2563eb', ON_HOLD:'#f59e0b', COMPLETED:'#16a34a', CANCELLED:'#dc2626' };

  return (
    <div style={{ padding: 32 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Project Dashboard</h1>
      <p style={{ color: '#64748b', fontSize: 14, marginBottom: 24 }}>Welcome back, {user?.name?.split(' ')[0]}.</p>

      {loading ? <div style={{ color:'#6b7280' }}>Loading…</div> : (
        <>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:16, marginBottom:32 }}>
            {[
              { label:'Active Projects', value: kpis?.activeProjects, color:'#2563eb' },
              { label:'Total Tasks',     value: kpis?.totalTasks,     color:'#6366f1' },
              { label:'Overdue Tasks',   value: kpis?.overdueTasks,   color:'#dc2626' },
              { label:'Open Risks',      value: kpis?.openRisks,      color:'#f59e0b' },
            ].map(k => (
              <div key={k.label} style={{ background:'#fff', borderRadius:12, padding:'20px 24px', boxShadow:'0 1px 4px rgba(0,0,0,.06)', borderTop:`3px solid ${k.color}` }}>
                <div style={{ fontSize:28, fontWeight:700, color:k.color }}>{k.value ?? '—'}</div>
                <div style={{ fontSize:14, fontWeight:600, marginTop:4 }}>{k.label}</div>
              </div>
            ))}
          </div>

          <div style={{ background:'#fff', borderRadius:12, boxShadow:'0 1px 4px rgba(0,0,0,.06)', overflow:'hidden' }}>
            <div style={{ padding:'16px 20px', borderBottom:'1px solid #f1f5f9', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontWeight:600 }}>Projects</span>
              <Link to="/projects" style={{ fontSize:13, color:'#2563eb', textDecoration:'none' }}>View all →</Link>
            </div>
            {projects.slice(0,8).map(p => (
              <div key={p.id} style={{ padding:'14px 20px', borderBottom:'1px solid #f8fafc', display:'flex', alignItems:'center', gap:12 }}>
                <div style={{ width:10, height:10, borderRadius:'50%', background: STATUS_COLOR[p.status]||'#9ca3af', flexShrink:0 }} />
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:500, fontSize:14 }}>{p.name}</div>
                  <div style={{ fontSize:12, color:'#6b7280' }}>{p.location || 'No location'} · {p._count?.tasks||0} tasks</div>
                </div>
                <Link to={`/projects/${p.id}/gantt`} style={{ fontSize:12, color:'#2563eb', textDecoration:'none', whiteSpace:'nowrap' }}>Gantt →</Link>
              </div>
            ))}
            {projects.length === 0 && (
              <div style={{ padding:'24px 20px', color:'#6b7280', fontSize:14 }}>
                No projects yet. <Link to="/projects">Create one →</Link>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
