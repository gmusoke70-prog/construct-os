import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

const STATUS_COLORS = {
  PLANNING: '#6366f1', ACTIVE: '#2563eb', ON_HOLD: '#f59e0b', COMPLETED: '#16a34a', CANCELLED: '#dc2626',
};

export default function ProjectsPage({ user }) {
  const [projects, setProjects] = useState([]);
  const [creating, setCreating] = useState(false);
  const [form,     setForm]     = useState({ name:'', location:'', startDate:'', endDate:'', estimatedBudget:'' });
  const [loading,  setLoading]  = useState(true);

  useEffect(() => { api.projects().then(d => setProjects(d.projects||[])).finally(() => setLoading(false)); }, []);

  async function create(e) {
    e.preventDefault();
    try {
      const { project } = await api.createProject({ ...form, estimatedBudget: Number(form.estimatedBudget)||0 });
      setProjects(prev => [project, ...prev]);
      setCreating(false);
      setForm({ name:'', location:'', startDate:'', endDate:'', estimatedBudget:'' });
    } catch (e) { alert(e.message); }
  }

  return (
    <div style={{ padding: 32 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Projects</h1>
        <button style={S.btn} onClick={() => setCreating(true)}>+ New Project</button>
      </div>

      {creating && (
        <form style={S.form} onSubmit={create}>
          <h3 style={{ fontSize:16, fontWeight:600, marginBottom:12 }}>New Project</h3>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            {[
              { key:'name',            label:'Project Name *', type:'text',   required:true },
              { key:'location',        label:'Location',       type:'text',   required:false },
              { key:'startDate',       label:'Start Date',     type:'date',   required:false },
              { key:'endDate',         label:'End Date',       type:'date',   required:false },
              { key:'estimatedBudget', label:'Budget (UGX)',   type:'number', required:false },
            ].map(f => (
              <label key={f.key} style={{ display:'flex', flexDirection:'column', gap:4 }}>
                <span style={{ fontSize:12, fontWeight:600, color:'#374151' }}>{f.label}</span>
                <input type={f.type} required={f.required} value={form[f.key]}
                  onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                  style={{ padding:'9px 12px', border:'1px solid #d1d5db', borderRadius:8, fontSize:14 }} />
              </label>
            ))}
          </div>
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:12 }}>
            <button type="button" onClick={() => setCreating(false)} style={S.cancelBtn}>Cancel</button>
            <button type="submit" style={S.btn}>Create Project</button>
          </div>
        </form>
      )}

      {loading ? <div style={{ color:'#6b7280' }}>Loading…</div> : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(320px, 1fr))', gap:16 }}>
          {projects.map(p => (
            <div key={p.id} style={S.card}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 }}>
                <div style={{ fontWeight:600, fontSize:15 }}>{p.name}</div>
                <span style={{ fontSize:11, fontWeight:600, padding:'3px 8px', borderRadius:99, background: STATUS_COLORS[p.status]+'22', color: STATUS_COLORS[p.status] }}>
                  {p.status}
                </span>
              </div>
              {p.location && <div style={{ fontSize:13, color:'#6b7280', marginBottom:8 }}>📍 {p.location}</div>}
              <div style={{ display:'flex', gap:16, fontSize:12, color:'#6b7280', marginBottom:12 }}>
                <span>{p._count?.tasks||0} tasks</span>
                <span>{p.phases?.length||0} phases</span>
                {p.estimatedBudget > 0 && <span>UGX {(p.estimatedBudget/1e6).toFixed(1)}M</span>}
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <Link to={`/projects/${p.id}/gantt`} style={S.linkBtn}>Gantt Chart</Link>
              </div>
            </div>
          ))}
          {projects.length === 0 && (
            <div style={{ gridColumn:'1/-1', textAlign:'center', color:'#6b7280', padding:40 }}>
              No projects. Click "+ New Project" to create one.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const S = {
  btn:       { padding:'9px 18px', background:'#2563eb', color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontWeight:600, fontSize:14 },
  cancelBtn: { padding:'9px 18px', background:'#f1f5f9', color:'#374151', border:'none', borderRadius:8, cursor:'pointer', fontSize:14 },
  form:      { background:'#fff', borderRadius:12, padding:24, marginBottom:24, boxShadow:'0 4px 20px rgba(0,0,0,.08)' },
  card:      { background:'#fff', borderRadius:12, padding:'18px 20px', boxShadow:'0 1px 4px rgba(0,0,0,.06)' },
  linkBtn:   { padding:'6px 14px', background:'#eff6ff', color:'#2563eb', borderRadius:6, fontSize:13, fontWeight:500, textDecoration:'none' },
};
