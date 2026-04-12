import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import GanttChart from '../../components/GanttChart/index.jsx';

export default function GanttPage({ user }) {
  const { id }    = useParams();
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    api.gantt(id)
      .then(d => setData(d))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <div style={{ height:'100vh', display:'flex', flexDirection:'column' }}>
      <div style={{ padding:'12px 24px', background:'#fff', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', gap:12 }}>
        <Link to="/projects" style={{ fontSize:13, color:'#2563eb', textDecoration:'none' }}>← Projects</Link>
        <span style={{ fontWeight:700, fontSize:16 }}>{data?.project?.name || 'Gantt Chart'}</span>
      </div>
      <div style={{ flex:1, overflow:'auto' }}>
        {loading ? (
          <div style={{ padding:32, color:'#6b7280' }}>Loading…</div>
        ) : error ? (
          <div style={{ padding:32, color:'#dc2626' }}>{error}</div>
        ) : (
          <GanttChart
            ganttRows={data?.ganttRows || []}
            project={data?.project}
          />
        )}
      </div>
    </div>
  );
}
