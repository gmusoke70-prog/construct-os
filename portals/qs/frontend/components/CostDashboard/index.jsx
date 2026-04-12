/**
 * CostDashboard — QS cost analytics dashboard
 *
 * Panels:
 *  - Budget vs Actual variance bar
 *  - Stage cost breakdown donut chart (SVG)
 *  - Material cost trend sparklines
 *  - Cost-per-m² KPI cards
 *  - BOQ version comparison table
 *  - Cost estimation from floor plan
 */

'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';

const apiFetch = (url) =>
  fetch(url, {
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
  }).then(r => r.json());

const fmtUGX = (v) =>
  new Intl.NumberFormat('en-UG', { style: 'currency', currency: 'UGX', maximumFractionDigits: 0 }).format(v || 0);

const fmtPct = (v) => `${Math.round((v || 0) * 10) / 10}%`;

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KPICard({ label, value, sub, trend, color = '#2563eb' }) {
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ color }}>{value}</div>
      {sub   && <div className="kpi-sub">{sub}</div>}
      {trend && (
        <div className={`kpi-trend ${trend.dir === 'up' ? 'up' : 'down'}`}>
          {trend.dir === 'up' ? '▲' : '▼'} {trend.val}
        </div>
      )}
    </div>
  );
}

// ─── Donut Chart (SVG) ────────────────────────────────────────────────────────
function DonutChart({ segments, size = 180 }) {
  const cx = size / 2, cy = size / 2, r = size * 0.38, inner = size * 0.22;
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return <div className="chart-empty">No data</div>;

  let angle = -Math.PI / 2;
  const arcs = segments.map(seg => {
    const sweep = (seg.value / total) * Math.PI * 2;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    angle += sweep;
    const x2 = cx + r * Math.cos(angle);
    const y2 = cy + r * Math.sin(angle);
    const xI1 = cx + inner * Math.cos(angle);
    const yI1 = cy + inner * Math.sin(angle);
    const xI2 = cx + inner * Math.cos(angle - sweep);
    const yI2 = cy + inner * Math.sin(angle - sweep);
    const large = sweep > Math.PI ? 1 : 0;
    return {
      ...seg,
      d: `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${xI1} ${yI1} A ${inner} ${inner} 0 ${large} 0 ${xI2} ${yI2} Z`,
    };
  });

  return (
    <div className="donut-chart">
      <svg width={size} height={size}>
        {arcs.map((arc, i) => (
          <path key={i} d={arc.d} fill={arc.color} opacity={0.9}>
            <title>{arc.label}: {fmtUGX(arc.value)} ({fmtPct((arc.value / total) * 100)})</title>
          </path>
        ))}
        <circle cx={cx} cy={cy} r={inner} fill="var(--bg-card, #fff)" />
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize="12" fill="#374151" fontWeight="600">Total</text>
        <text x={cx} y={cy + 10} textAnchor="middle" fontSize="10" fill="#6b7280">{fmtUGX(total)}</text>
      </svg>
      <div className="donut-legend">
        {segments.map((seg, i) => (
          <div key={i} className="legend-item">
            <div className="legend-dot" style={{ background: seg.color }} />
            <span className="legend-label">{seg.label}</span>
            <span className="legend-pct">{fmtPct((seg.value / total) * 100)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Sparkline (SVG) ──────────────────────────────────────────────────────────
function Sparkline({ data, color = '#2563eb', width = 120, height = 36 }) {
  if (!data || data.length < 2) return <span className="sparkline-empty">—</span>;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => ({
    x: (i / (data.length - 1)) * width,
    y: height - ((v - min) / range) * height,
  }));
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  return (
    <svg width={width} height={height}>
      <path d={d} fill="none" stroke={color} strokeWidth="2" />
      <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="3" fill={color} />
    </svg>
  );
}

// ─── Budget vs Actual bar ─────────────────────────────────────────────────────
function VarianceBar({ budget, actual }) {
  if (!budget) return null;
  const pct    = Math.min(200, Math.round((actual / budget) * 100));
  const over   = actual > budget;
  const within = actual <= budget;

  return (
    <div className="variance-bar-wrap">
      <div className="variance-labels">
        <span>Budget: {fmtUGX(budget)}</span>
        <span className={over ? 'over' : 'under'}>Actual: {fmtUGX(actual)}</span>
      </div>
      <div className="variance-track">
        <div
          className={`variance-fill ${over ? 'over' : 'ok'}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
        {over && (
          <div
            className="variance-over"
            style={{ width: `${Math.min(100, pct - 100)}%` }}
          />
        )}
        <div className="variance-target-line" style={{ left: `${Math.min(100, (budget / (budget * 1.5)) * 100)}%` }} />
      </div>
      <div className="variance-footer">
        <span>{pct}% of budget consumed</span>
        <span className={over ? 'text-red' : 'text-green'}>
          {over ? `Over by ${fmtUGX(actual - budget)}` : `Under by ${fmtUGX(budget - actual)}`}
        </span>
      </div>
    </div>
  );
}

// ─── Version comparison table ─────────────────────────────────────────────────
function VersionCompare({ projectId }) {
  const [versions, setVersions] = useState([]);
  const [v1, setV1] = useState('');
  const [v2, setV2] = useState('');
  const [diff, setDiff] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch(`/api/qs/boq/versions?projectId=${projectId}`).then(d => {
      const vv = d.versions || [];
      setVersions(vv);
      if (vv.length >= 2) { setV1(vv[1].id); setV2(vv[0].id); }
    });
  }, [projectId]);

  const compare = async () => {
    if (!v1 || !v2) return;
    setLoading(true);
    const data = await apiFetch(`/api/qs/boq/compare?v1=${v1}&v2=${v2}`);
    setDiff(data.diff);
    setLoading(false);
  };

  return (
    <div className="version-compare">
      <div className="compare-controls">
        <select value={v1} onChange={e => setV1(e.target.value)}>
          {versions.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <span className="compare-vs">vs</span>
        <select value={v2} onChange={e => setV2(e.target.value)}>
          {versions.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <button className="btn" onClick={compare} disabled={loading || !v1 || !v2}>
          {loading ? '…' : 'Compare'}
        </button>
      </div>

      {diff && (
        <>
          <div className="compare-header">
            <span>{diff.v1.name}: {fmtUGX(diff.v1.total)}</span>
            <span className={diff.totalDelta > 0 ? 'text-red' : 'text-green'}>
              {diff.totalDelta > 0 ? '+' : ''}{fmtUGX(diff.totalDelta)}
            </span>
            <span>{diff.v2.name}: {fmtUGX(diff.v2.total)}</span>
          </div>
          <table className="compare-table">
            <thead>
              <tr>
                <th>Stage</th>
                <th className="num">{diff.v1.name}</th>
                <th className="num">{diff.v2.name}</th>
                <th className="num">Δ Amount</th>
                <th className="num">Δ %</th>
              </tr>
            </thead>
            <tbody>
              {diff.stageDiff.map((row, i) => (
                <tr key={i} className={row.delta > 0 ? 'row-over' : row.delta < 0 ? 'row-under' : ''}>
                  <td>{row.stageName}</td>
                  <td className="num">{fmtUGX(row.v1Total)}</td>
                  <td className="num">{fmtUGX(row.v2Total)}</td>
                  <td className="num delta">{row.delta > 0 ? '+' : ''}{fmtUGX(row.delta)}</td>
                  <td className="num">{row.deltaPercent != null ? `${row.deltaPercent > 0 ? '+' : ''}${row.deltaPercent}%` : 'N/A'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

// ─── Estimation from floor plan ───────────────────────────────────────────────
function EstimationTool() {
  const [form, setForm]     = useState({ floorArea: '', floors: 1, location: 'KAMPALA', quality: 'STANDARD', buildingType: 'RESIDENTIAL' });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const estimate = async () => {
    setLoading(true);
    const data = await fetch('/api/qs/boq/estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: JSON.stringify({ ...form, floorArea: Number(form.floorArea), floors: Number(form.floors) }),
    }).then(r => r.json());
    setResult(data.estimate);
    setLoading(false);
  };

  return (
    <div className="estimation-tool">
      <div className="est-form">
        <div className="form-row">
          <label>Floor Area (m²)<input type="number" value={form.floorArea} onChange={e => setForm(p => ({ ...p, floorArea: e.target.value }))} placeholder="e.g. 250" /></label>
          <label>Floors<input type="number" value={form.floors} min="1" onChange={e => setForm(p => ({ ...p, floors: e.target.value }))} /></label>
        </div>
        <div className="form-row">
          <label>Location
            <select value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))}>
              {['KAMPALA','WAKISO','ENTEBBE','JINJA','GULU','MBARARA','ARUA','NAIROBI','KIGALI'].map(l => <option key={l}>{l}</option>)}
            </select>
          </label>
          <label>Quality
            <select value={form.quality} onChange={e => setForm(p => ({ ...p, quality: e.target.value }))}>
              {['ECONOMY','STANDARD','PREMIUM','LUXURY'].map(q => <option key={q}>{q}</option>)}
            </select>
          </label>
          <label>Building Type
            <select value={form.buildingType} onChange={e => setForm(p => ({ ...p, buildingType: e.target.value }))}>
              {['RESIDENTIAL','COMMERCIAL','INDUSTRIAL'].map(t => <option key={t}>{t}</option>)}
            </select>
          </label>
        </div>
        <button className="btn btn-primary" onClick={estimate} disabled={!form.floorArea || loading}>
          {loading ? 'Estimating…' : 'Generate Estimate'}
        </button>
      </div>

      {result && (
        <div className="est-result">
          <div className="est-total">
            <div className="est-total-label">Total Estimate</div>
            <div className="est-total-value">{fmtUGX(result.totalEstimate)}</div>
            <div className="est-total-sub">{fmtUGX(result.ratePerM2)}/m² · {result.gfa} m² GFA · ±30%</div>
          </div>
          <table className="est-table">
            <thead>
              <tr><th>Stage</th><th className="num">Rate/m²</th><th className="num">Amount</th><th className="num">%</th></tr>
            </thead>
            <tbody>
              {result.stages.map((s, i) => (
                <tr key={i}>
                  <td>{s.name}</td>
                  <td className="num">{fmtUGX(s.ratePerM2)}</td>
                  <td className="num">{fmtUGX(s.amount)}</td>
                  <td className="num">{s.pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="est-note">{result.notes}</div>
        </div>
      )}
    </div>
  );
}

// ─── Main CostDashboard ───────────────────────────────────────────────────────
const STAGE_COLORS = ['#2563eb','#7c3aed','#0891b2','#059669','#d97706','#dc2626','#db2777','#65a30d'];

export default function CostDashboard({ projectId, versionId }) {
  const [summary,     setSummary]     = useState(null);
  const [variance,    setVariance]    = useState(null);
  const [matRates,    setMatRates]    = useState([]);
  const [activeTab,   setActiveTab]   = useState('overview');
  const [loading,     setLoading]     = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [sumData, varData, rateData] = await Promise.all([
      versionId ? apiFetch(`/api/qs/boq/versions/${versionId}/summary`) : Promise.resolve({}),
      versionId ? apiFetch(`/api/qs/boq/variance?projectId=${projectId}&versionId=${versionId}`) : Promise.resolve({}),
      apiFetch(`/api/qs/boq/material-rates`),
    ]);
    setSummary(sumData.summary);
    setVariance(varData.variance);
    setMatRates(rateData.rates || []);
    setLoading(false);
  }, [projectId, versionId]);

  useEffect(() => { load(); }, [load]);

  const donutSegments = useMemo(() => {
    if (!summary?.stageBreakdown) return [];
    return summary.stageBreakdown.map((s, i) => ({
      label: s.stageName,
      value: s.totalCost,
      color: STAGE_COLORS[i % STAGE_COLORS.length],
    }));
  }, [summary]);

  const tabs = [
    { key: 'overview',  label: 'Overview' },
    { key: 'compare',   label: 'Version Compare' },
    { key: 'estimate',  label: 'Quick Estimate' },
    { key: 'rates',     label: 'Material Rates' },
  ];

  if (loading) return <div className="cd-loading">Loading dashboard…</div>;

  return (
    <div className="cost-dashboard">
      <div className="cd-header">
        <h2 className="cd-title">Cost Dashboard</h2>
        <div className="cd-tabs">
          {tabs.map(t => (
            <button
              key={t.key}
              className={`cd-tab ${activeTab === t.key ? 'active' : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'overview' && (
        <div className="cd-overview">
          {/* KPI row */}
          <div className="kpi-row">
            <KPICard
              label="Total BOQ Value"
              value={fmtUGX(summary?.totalAmount)}
              sub={`v${summary?.versionNumber} · ${summary?.status}`}
              color="#2563eb"
            />
            <KPICard
              label="Material Cost"
              value={fmtUGX(summary?.totalMaterial)}
              sub={summary?.stageBreakdown?.length + ' stages'}
              color="#7c3aed"
            />
            <KPICard
              label="Labour Cost"
              value={fmtUGX(summary?.totalLabour)}
              sub={`Labour:Material = ${summary?.labourToMaterial}`}
              color="#0891b2"
            />
            <KPICard
              label="Budget Consumed"
              value={fmtPct(variance?.completionPct)}
              sub={variance?.status?.replace('_', ' ')}
              color={variance?.status === 'OVER_BUDGET' ? '#dc2626' : '#059669'}
              trend={variance ? {
                dir: variance.variance > 0 ? 'up' : 'down',
                val: fmtUGX(Math.abs(variance.variance)),
              } : null}
            />
          </div>

          {/* Budget variance */}
          {variance && (
            <div className="cd-section">
              <h3 className="section-title">Budget vs Actual</h3>
              <VarianceBar budget={variance.budgetTotal} actual={variance.actualTotal} />
            </div>
          )}

          {/* Stage breakdown */}
          <div className="cd-two-col">
            <div className="cd-section">
              <h3 className="section-title">Stage Breakdown</h3>
              <DonutChart segments={donutSegments} size={200} />
            </div>

            <div className="cd-section">
              <h3 className="section-title">Stage Detail</h3>
              <table className="breakdown-table">
                <thead>
                  <tr>
                    <th>Stage</th>
                    <th className="num">Total Cost</th>
                    <th className="num">% of Project</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary?.stageBreakdown || []).map((s, i) => (
                    <tr key={i}>
                      <td>
                        <div className="stage-name-cell">
                          <div className="stage-dot" style={{ background: STAGE_COLORS[i % STAGE_COLORS.length] }} />
                          {s.stageName}
                        </div>
                      </td>
                      <td className="num">{fmtUGX(s.totalCost)}</td>
                      <td className="num">
                        <div className="pct-bar-wrap">
                          <div className="pct-bar" style={{ width: `${s.pct}%`, background: STAGE_COLORS[i % STAGE_COLORS.length] }} />
                          <span>{s.pct}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'compare' && (
        <div className="cd-section">
          <h3 className="section-title">Version Comparison</h3>
          <VersionCompare projectId={projectId} />
        </div>
      )}

      {activeTab === 'estimate' && (
        <div className="cd-section">
          <h3 className="section-title">Quick Conceptual Estimate</h3>
          <EstimationTool />
        </div>
      )}

      {activeTab === 'rates' && (
        <div className="cd-section">
          <h3 className="section-title">Current Material Rates (Kampala)</h3>
          <table className="rates-table">
            <thead>
              <tr><th>Material</th><th className="num">Rate (UGX)</th><th>Unit</th><th>Date</th><th>Supplier</th></tr>
            </thead>
            <tbody>
              {matRates.map((r, i) => (
                <tr key={i}>
                  <td>{r.material}</td>
                  <td className="num">{fmtUGX(r.rate)}</td>
                  <td>{r.unit}</td>
                  <td>{new Date(r.date).toLocaleDateString()}</td>
                  <td className="text-gray">{r.supplier || '—'}</td>
                </tr>
              ))}
              {matRates.length === 0 && (
                <tr><td colSpan="5" className="empty-row">No material rates recorded yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <style>{cdStyles}</style>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const cdStyles = `
.cost-dashboard { padding: 24px; background: #f8fafc; min-height: 100%; font-family: 'Inter', sans-serif; }
.cd-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; gap: 16px; flex-wrap: wrap; }
.cd-title { margin: 0; font-size: 22px; font-weight: 700; color: #111827; }
.cd-tabs { display: flex; gap: 4px; background: #e5e7eb; border-radius: 8px; padding: 4px; }
.cd-tab { padding: 6px 16px; border-radius: 6px; border: none; background: transparent; color: #6b7280; cursor: pointer; font-size: 13px; font-weight: 500; }
.cd-tab:hover { color: #111827; }
.cd-tab.active { background: #fff; color: #111827; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }

.kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
.kpi-card { background: #fff; border-radius: 12px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); border: 1px solid #e5e7eb; }
.kpi-label { font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
.kpi-value { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
.kpi-sub { font-size: 12px; color: #9ca3af; }
.kpi-trend { font-size: 12px; font-weight: 500; margin-top: 4px; }
.kpi-trend.up { color: #dc2626; }
.kpi-trend.down { color: #16a34a; }

.cd-section { background: #fff; border-radius: 12px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); border: 1px solid #e5e7eb; margin-bottom: 20px; }
.section-title { margin: 0 0 16px; font-size: 15px; font-weight: 600; color: #111827; }
.cd-two-col { display: grid; grid-template-columns: auto 1fr; gap: 20px; }
.cd-overview {}

.variance-bar-wrap { width: 100%; }
.variance-labels { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 8px; }
.variance-labels .over { color: #dc2626; font-weight: 600; }
.variance-labels .under { color: #16a34a; font-weight: 600; }
.variance-track { height: 20px; background: #f1f5f9; border-radius: 4px; position: relative; overflow: hidden; }
.variance-fill { height: 100%; background: #2563eb; border-radius: 4px; transition: width 0.5s ease; }
.variance-fill.over { background: #dc2626; }
.variance-fill.ok { background: #2563eb; }
.variance-over { position: absolute; top: 0; height: 100%; background: #fca5a5; }
.variance-footer { display: flex; justify-content: space-between; font-size: 12px; color: #6b7280; margin-top: 6px; }
.text-red { color: #dc2626; font-weight: 600; }
.text-green { color: #16a34a; font-weight: 600; }
.text-gray { color: #9ca3af; }

.donut-chart { display: flex; align-items: center; gap: 24px; flex-wrap: wrap; }
.donut-legend { display: flex; flex-direction: column; gap: 6px; }
.legend-item { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #374151; }
.legend-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.legend-label { flex: 1; }
.legend-pct { font-weight: 600; color: #111827; min-width: 36px; text-align: right; }
.chart-empty { color: #9ca3af; font-size: 13px; text-align: center; padding: 40px; }

.breakdown-table, .compare-table, .est-table, .rates-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.breakdown-table th, .compare-table th, .est-table th, .rates-table th { padding: 8px 12px; text-align: left; font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #e5e7eb; }
.breakdown-table td, .compare-table td, .est-table td, .rates-table td { padding: 8px 12px; border-bottom: 1px solid #f1f5f9; color: #374151; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.stage-name-cell { display: flex; align-items: center; gap: 8px; }
.stage-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.pct-bar-wrap { display: flex; align-items: center; gap: 8px; }
.pct-bar { height: 6px; border-radius: 3px; min-width: 2px; }
.row-over td { background: #fff5f5; }
.row-under td { background: #f0fdf4; }
.delta { font-weight: 600; }
.compare-header { display: flex; justify-content: space-between; font-size: 13px; font-weight: 600; margin-bottom: 12px; }
.compare-controls { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
.compare-controls select { padding: 6px 10px; border-radius: 6px; border: 1px solid #d1d5db; font-size: 13px; }
.compare-vs { color: #6b7280; font-size: 13px; font-weight: 500; }
.btn { padding: 7px 16px; border-radius: 6px; border: 1px solid #d1d5db; background: #fff; cursor: pointer; font-size: 13px; }
.btn:hover { background: #f3f4f6; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary { background: #2563eb; border-color: #2563eb; color: #fff; }
.btn-primary:hover { background: #1d4ed8; }

.estimation-tool {}
.est-form { display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px; }
.form-row { display: flex; gap: 16px; flex-wrap: wrap; }
.form-row label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #6b7280; min-width: 140px; }
.form-row input, .form-row select { padding: 7px 10px; border-radius: 6px; border: 1px solid #d1d5db; font-size: 13px; }
.est-result { border-top: 1px solid #e5e7eb; padding-top: 16px; }
.est-total { text-align: center; margin-bottom: 20px; }
.est-total-label { font-size: 13px; color: #6b7280; }
.est-total-value { font-size: 32px; font-weight: 700; color: #111827; }
.est-total-sub { font-size: 12px; color: #9ca3af; margin-top: 4px; }
.est-note { font-size: 12px; color: #9ca3af; margin-top: 12px; text-align: center; font-style: italic; }
.empty-row { text-align: center; color: #9ca3af; padding: 20px !important; }
.cd-loading { display: flex; align-items: center; justify-content: center; height: 200px; color: #6b7280; font-size: 16px; }
.sparkline-empty { color: #9ca3af; }
`;
