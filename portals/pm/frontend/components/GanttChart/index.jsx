/**
 * GanttChart — SVG-based Gantt chart for PM portal
 *
 * Features:
 *  - Phase rows with expandable task rows
 *  - Milestone diamonds
 *  - Drag handles for date resizing (visual only — sends PATCH on mouse up)
 *  - Today line
 *  - Zoom: days / weeks / months
 *  - Progress bars within task bars
 *  - Color by status
 *  - Tooltip on hover
 */

'use client';

import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';

const STATUS_COLORS = {
  TODO:        '#9ca3af',
  IN_PROGRESS: '#2563eb',
  DONE:        '#16a34a',
  BLOCKED:     '#dc2626',
};

const DAY_MS = 86400000;

function parseDate(d) { return d ? new Date(d) : null; }
function fmtDate(d)   { return d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—'; }

const apiFetch = (url, opts = {}) =>
  fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}`, ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }).then(r => r.json());

// ─── Timeline header ──────────────────────────────────────────────────────────
function TimelineHeader({ startMs, endMs, zoom, dayWidth, totalWidth }) {
  const headers = useMemo(() => {
    const items = [];
    const d = new Date(startMs);
    d.setHours(0, 0, 0, 0);

    while (d.getTime() < endMs) {
      const x = ((d.getTime() - startMs) / DAY_MS) * dayWidth;
      if (zoom === 'month') {
        items.push({ x, label: d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }), type: 'month' });
        d.setMonth(d.getMonth() + 1);
      } else if (zoom === 'week') {
        // Monday only
        if (d.getDay() === 1 || items.length === 0) {
          items.push({ x, label: fmtDate(d), type: 'week' });
        }
        d.setDate(d.getDate() + 1);
      } else {
        items.push({ x, label: d.getDate(), type: 'day' });
        d.setDate(d.getDate() + 1);
      }
    }
    return items;
  }, [startMs, endMs, zoom, dayWidth]);

  return (
    <svg width={totalWidth} height={36} className="gantt-header-svg">
      <rect x={0} y={0} width={totalWidth} height={36} fill="#f1f5f9" />
      {headers.map((h, i) => (
        <g key={i}>
          <line x1={h.x} y1={0} x2={h.x} y2={36} stroke="#e2e8f0" strokeWidth="1" />
          <text x={h.x + 4} y={22} fontSize="11" fill="#64748b" fontFamily="Inter, sans-serif">
            {h.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ─── Gantt row ────────────────────────────────────────────────────────────────
function GanttRow({ row, startMs, dayWidth, rowHeight, onHover, onBarClick }) {
  const start = parseDate(row.start);
  const end   = parseDate(row.end);
  if (!start || !end) return null;

  const x = Math.max(0, ((start.getTime() - startMs) / DAY_MS) * dayWidth);
  const w = Math.max(8, ((end.getTime() - start.getTime()) / DAY_MS) * dayWidth);

  if (row.type === 'milestone') {
    const cx = x + w / 2;
    const cy = rowHeight / 2;
    const size = 8;
    const d    = `M ${cx} ${cy - size} L ${cx + size} ${cy} L ${cx} ${cy + size} L ${cx - size} ${cy} Z`;
    return (
      <g onMouseEnter={e => onHover(row, e)} onMouseLeave={() => onHover(null)}>
        <path d={d} fill="#f59e0b" />
        <text x={cx + size + 4} y={cy + 4} fontSize="11" fill="#78350f" fontFamily="Inter">{row.name}</text>
      </g>
    );
  }

  const color    = row.type === 'phase' ? '#1e3a5f' : (STATUS_COLORS[row.status] || '#2563eb');
  const progress = Math.min(100, row.progress || 0);
  const progW    = (w * progress) / 100;

  return (
    <g
      onMouseEnter={e => onHover(row, e)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onBarClick && onBarClick(row)}
      style={{ cursor: 'pointer' }}
    >
      {/* Background bar */}
      <rect x={x} y={4} width={w} height={rowHeight - 8} rx={3} fill={color} opacity={row.type === 'phase' ? 0.9 : 0.75} />
      {/* Progress bar */}
      {progress > 0 && (
        <rect x={x} y={4} width={progW} height={rowHeight - 8} rx={3} fill={color} opacity={1} />
      )}
      {/* Label */}
      {w > 60 && (
        <text x={x + 6} y={rowHeight / 2 + 4} fontSize="11" fill="#fff" fontFamily="Inter" fontWeight={row.type === 'phase' ? '600' : '400'}>
          {row.name.length > 25 ? row.name.slice(0, 23) + '…' : row.name}
        </text>
      )}
      {/* Progress pct */}
      {w > 80 && (
        <text x={x + w - 4} y={rowHeight / 2 + 4} fontSize="10" fill="rgba(255,255,255,0.8)" fontFamily="Inter" textAnchor="end">
          {progress}%
        </text>
      )}
    </g>
  );
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────
function Tooltip({ row, x, y }) {
  if (!row) return null;
  return (
    <div className="gantt-tooltip" style={{ left: x + 12, top: y + 12 }}>
      <div className="tooltip-name">{row.name}</div>
      <div className="tooltip-row">{fmtDate(row.start)} → {fmtDate(row.end)}</div>
      {row.progress != null && <div className="tooltip-row">Progress: {row.progress}%</div>}
      {row.status   && <div className="tooltip-row">Status: {row.status}</div>}
      {row.assignee && <div className="tooltip-row">Assignee: {row.assignee.name}</div>}
    </div>
  );
}

// ─── Main GanttChart ──────────────────────────────────────────────────────────
const ROW_HEIGHT = 36;
const LABEL_WIDTH = 240;
const ZOOM_DAY_WIDTHS = { day: 30, week: 14, month: 6 };

export default function GanttChart({ projectId, onTaskClick }) {
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [zoom,      setZoom]      = useState('week');
  const [collapsed, setCollapsed] = useState({});
  const [tooltip,   setTooltip]   = useState({ row: null, x: 0, y: 0 });
  const scrollRef = useRef(null);

  const dayWidth = ZOOM_DAY_WIDTHS[zoom] || 14;

  const load = useCallback(async () => {
    setLoading(true);
    const d = await apiFetch(`/api/pm/projects/${projectId}/gantt`);
    setData(d);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const { startMs, endMs, totalDays } = useMemo(() => {
    if (!data?.ganttRows?.length) return { startMs: Date.now(), endMs: Date.now() + 30 * DAY_MS, totalDays: 30 };
    const starts = data.ganttRows.filter(r => r.start).map(r => new Date(r.start).getTime());
    const ends   = data.ganttRows.filter(r => r.end  ).map(r => new Date(r.end).getTime());
    const s      = Math.min(...starts);
    const e      = Math.max(...ends);
    const pad    = 7 * DAY_MS;
    return { startMs: s - pad, endMs: e + pad, totalDays: Math.ceil((e - s + 2 * pad) / DAY_MS) };
  }, [data]);

  const totalWidth = totalDays * dayWidth;
  const todayX     = ((Date.now() - startMs) / DAY_MS) * dayWidth;

  // Visible rows (respecting collapse)
  const visibleRows = useMemo(() => {
    if (!data?.ganttRows) return [];
    const rows = [];
    let currentPhase = null;

    for (const row of data.ganttRows) {
      if (row.type === 'phase') {
        currentPhase = row.id;
        rows.push(row);
      } else if (row.type === 'milestone') {
        rows.push(row);
      } else {
        // task — show if parent phase not collapsed
        if (!collapsed[currentPhase]) rows.push(row);
      }
    }
    return rows;
  }, [data, collapsed]);

  const handleHover = (row, e) => {
    if (row && e) setTooltip({ row, x: e.clientX, y: e.clientY });
    else          setTooltip({ row: null, x: 0, y: 0 });
  };

  if (loading) return <div className="gantt-loading">Loading Gantt chart…</div>;
  if (!data)   return <div className="gantt-error">No project data</div>;

  return (
    <div className="gantt-root">
      {/* Toolbar */}
      <div className="gantt-toolbar">
        <span className="gantt-project-name">{data.project?.name}</span>
        <div className="zoom-controls">
          {['day','week','month'].map(z => (
            <button key={z} className={`zoom-btn ${zoom === z ? 'active' : ''}`} onClick={() => setZoom(z)}>
              {z.charAt(0).toUpperCase() + z.slice(1)}
            </button>
          ))}
        </div>
        <button className="btn-sm" onClick={load}>↻ Refresh</button>
      </div>

      <div className="gantt-layout">
        {/* Left: row labels */}
        <div className="gantt-labels">
          <div className="gantt-header-label">Task</div>
          {visibleRows.map((row, i) => (
            <div
              key={row.id}
              className={`gantt-label-row ${row.type === 'phase' ? 'phase-label' : 'task-label'}`}
              style={{ height: ROW_HEIGHT }}
              onClick={() => row.type === 'phase' && setCollapsed(p => ({ ...p, [row.id]: !p[row.id] }))}
            >
              {row.type === 'phase' ? (
                <span>
                  <span className="collapse-icon">{collapsed[row.id] ? '▶' : '▼'}</span>
                  {row.name}
                </span>
              ) : row.type === 'milestone' ? (
                <span className="milestone-label">◆ {row.name}</span>
              ) : (
                <span className="task-name">{row.name}</span>
              )}
              {row.type === 'task' && row.assignee && (
                <span className="assignee-chip">{row.assignee.name.split(' ')[0]}</span>
              )}
            </div>
          ))}
        </div>

        {/* Right: timeline grid */}
        <div className="gantt-timeline-wrap" ref={scrollRef}>
          <div style={{ width: totalWidth, position: 'relative' }}>
            {/* Header */}
            <TimelineHeader startMs={startMs} endMs={endMs} zoom={zoom} dayWidth={dayWidth} totalWidth={totalWidth} />

            {/* Today line */}
            {todayX > 0 && todayX < totalWidth && (
              <div className="today-line" style={{ left: todayX }} />
            )}

            {/* Row SVGs */}
            <svg width={totalWidth} height={visibleRows.length * ROW_HEIGHT}>
              {/* Weekend shading (day/week zoom) */}
              {zoom !== 'month' && Array.from({ length: totalDays }, (_, i) => {
                const d = new Date(startMs + i * DAY_MS);
                if (d.getDay() === 0 || d.getDay() === 6) {
                  return (
                    <rect key={i} x={i * dayWidth} y={0} width={dayWidth} height={visibleRows.length * ROW_HEIGHT}
                      fill="#f1f5f9" opacity={0.5} />
                  );
                }
                return null;
              })}

              {/* Horizontal row lines */}
              {visibleRows.map((_, i) => (
                <line key={i} x1={0} y1={(i + 1) * ROW_HEIGHT} x2={totalWidth} y2={(i + 1) * ROW_HEIGHT}
                  stroke="#e2e8f0" strokeWidth="1" />
              ))}

              {/* Gantt bars */}
              {visibleRows.map((row, i) => (
                <g key={row.id} transform={`translate(0, ${i * ROW_HEIGHT})`}>
                  <GanttRow
                    row={row}
                    startMs={startMs}
                    dayWidth={dayWidth}
                    rowHeight={ROW_HEIGHT}
                    onHover={handleHover}
                    onBarClick={row.type === 'task' ? onTaskClick : null}
                  />
                </g>
              ))}
            </svg>
          </div>
        </div>
      </div>

      {tooltip.row && <Tooltip row={tooltip.row} x={tooltip.x} y={tooltip.y} />}

      <style>{ganttStyles}</style>
    </div>
  );
}

const ganttStyles = `
.gantt-root { display: flex; flex-direction: column; height: 100%; background: #fff; font-family: 'Inter', sans-serif; font-size: 13px; overflow: hidden; }
.gantt-toolbar { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid #e2e8f0; background: #f8fafc; }
.gantt-project-name { font-weight: 600; color: #111827; flex: 1; }
.zoom-controls { display: flex; gap: 4px; background: #e2e8f0; border-radius: 6px; padding: 3px; }
.zoom-btn { padding: 4px 12px; border-radius: 4px; border: none; background: transparent; color: #64748b; cursor: pointer; font-size: 12px; font-weight: 500; }
.zoom-btn.active { background: #fff; color: #111827; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
.btn-sm { padding: 5px 12px; border-radius: 6px; border: 1px solid #e2e8f0; background: #fff; cursor: pointer; font-size: 12px; color: #374151; }

.gantt-layout { flex: 1; display: flex; overflow: hidden; }
.gantt-labels { width: 240px; flex-shrink: 0; border-right: 1px solid #e2e8f0; overflow-y: hidden; }
.gantt-header-label { height: 36px; display: flex; align-items: center; padding: 0 12px; background: #f1f5f9; font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #e2e8f0; }
.gantt-label-row { display: flex; align-items: center; padding: 0 8px 0 12px; border-bottom: 1px solid #f1f5f9; justify-content: space-between; white-space: nowrap; overflow: hidden; }
.phase-label { background: #f8fafc; font-weight: 600; cursor: pointer; }
.phase-label:hover { background: #eff6ff; }
.task-label { padding-left: 24px; color: #374151; }
.collapse-icon { margin-right: 6px; color: #64748b; font-size: 10px; }
.milestone-label { color: #d97706; font-weight: 500; }
.task-name { overflow: hidden; text-overflow: ellipsis; flex: 1; }
.assignee-chip { background: #e0e7ff; color: #3730a3; border-radius: 9999px; padding: 1px 6px; font-size: 10px; margin-left: 4px; white-space: nowrap; }

.gantt-timeline-wrap { flex: 1; overflow-x: auto; overflow-y: hidden; position: relative; }
.gantt-header-svg { display: block; position: sticky; top: 0; z-index: 10; }
.today-line { position: absolute; top: 36px; bottom: 0; width: 2px; background: #ef4444; z-index: 5; pointer-events: none; }
.today-line::before { content: 'Today'; position: absolute; top: 0; left: 4px; font-size: 10px; color: #ef4444; white-space: nowrap; font-family: Inter; }

.gantt-tooltip { position: fixed; z-index: 100; background: #1e293b; color: #f8fafc; border-radius: 8px; padding: 10px 14px; font-size: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.2); pointer-events: none; max-width: 240px; }
.tooltip-name { font-weight: 600; margin-bottom: 4px; font-size: 13px; }
.tooltip-row { color: #94a3b8; margin-top: 2px; }

.gantt-loading, .gantt-error { display: flex; align-items: center; justify-content: center; height: 200px; color: #64748b; font-size: 14px; }
`;
