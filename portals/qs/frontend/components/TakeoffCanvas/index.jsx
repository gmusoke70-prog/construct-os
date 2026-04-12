/**
 * TakeoffCanvas — PDF overlay with digital measurement tools
 *
 * Features:
 *  - PDF rendering via iframe/embed (URL from file service)
 *  - Canvas overlay for drawing measurements
 *  - Tool modes: SELECT | LINEAR | AREA | COUNT | VOLUME | CALIBRATE
 *  - Click-to-place points; double-click to close polygon
 *  - Live measurement preview while drawing
 *  - Scale calibration tool (draw reference line → enter real length)
 *  - Measurement label placement
 *  - Link measurements to BOQ items
 *  - Undo last point (Backspace)
 *  - Zoom + pan canvas
 *  - Measurements panel with list, edit, delete
 */

'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// ─── Constants ────────────────────────────────────────────────────────────────
const TOOLS = {
  SELECT:    'SELECT',
  LINEAR:    'LINEAR',
  AREA:      'AREA',
  COUNT:     'COUNT',
  VOLUME:    'VOLUME',
  PERIMETER: 'PERIMETER',
  CALIBRATE: 'CALIBRATE',
};

const TOOL_ICONS = {
  SELECT:    '↖',
  LINEAR:    '─',
  AREA:      '□',
  COUNT:     '·',
  VOLUME:    '◈',
  PERIMETER: '⬡',
  CALIBRATE: '⟺',
};

const COLORS = ['#EF4444', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4'];

const apiFetch = (url, opts = {}) =>
  fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}`, ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }).then(r => r.json());

const fmtVal = (v, unit) => `${Math.round(v * 100) / 100} ${unit}`;

// ─── Measurement computation (mirrors server) ─────────────────────────────────
function computeMeasurementLocal(type, points, scale, depth = 1) {
  if (!points || points.length === 0) return { value: 0, unit: 'nr' };
  switch (type) {
    case 'LINEAR': {
      let d = 0;
      for (let i = 1; i < points.length; i++) {
        const dx = points[i].x - points[i-1].x, dy = points[i].y - points[i-1].y;
        d += Math.sqrt(dx*dx + dy*dy);
      }
      return { value: +(d / scale).toFixed(3), unit: 'm' };
    }
    case 'PERIMETER': {
      let d = 0;
      for (let i = 0; i < points.length; i++) {
        const n = points[(i+1) % points.length];
        const dx = n.x - points[i].x, dy = n.y - points[i].y;
        d += Math.sqrt(dx*dx + dy*dy);
      }
      return { value: +(d / scale).toFixed(3), unit: 'm' };
    }
    case 'AREA': {
      let area = 0;
      for (let i = 0; i < points.length; i++) {
        const j = (i+1) % points.length;
        area += points[i].x * points[j].y - points[j].x * points[i].y;
      }
      return { value: +(Math.abs(area) / 2 / (scale*scale)).toFixed(3), unit: 'm²' };
    }
    case 'VOLUME': {
      let area = 0;
      for (let i = 0; i < points.length; i++) {
        const j = (i+1) % points.length;
        area += points[i].x * points[j].y - points[j].x * points[i].y;
      }
      return { value: +(Math.abs(area) / 2 / (scale*scale) * depth).toFixed(3), unit: 'm³' };
    }
    case 'COUNT':  return { value: points.length, unit: 'nr' };
    default:       return { value: 0, unit: '' };
  }
}

// ─── Drawing canvas component ─────────────────────────────────────────────────
function DrawingCanvas({ tool, scale, zoom, pan, color, depth,
  measurements, activeMeasurement,
  onMeasurementClick, onComplete, onAddPoint,
  cursorPoints, setCursorPoints,
}) {
  const canvasRef = useRef(null);
  const [mousePos, setMousePos] = useState(null);

  // Redraw
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Draw saved measurements
    for (const m of measurements) {
      const isActive = activeMeasurement?.id === m.id;
      drawMeasurement(ctx, m, isActive, scale);
    }

    // Draw in-progress
    if (cursorPoints.length > 0) {
      drawInProgress(ctx, cursorPoints, tool, color, mousePos, scale, depth);
    }

    ctx.restore();
  }, [measurements, activeMeasurement, cursorPoints, tool, color, mousePos, scale, zoom, pan, depth]);

  useEffect(() => { draw(); }, [draw]);

  const toCanvas = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - pan.x) / zoom,
      y: (e.clientY - rect.top  - pan.y) / zoom,
    };
  };

  const handleClick = (e) => {
    if (tool === TOOLS.SELECT) {
      // Hit test measurements
      const pt = toCanvas(e);
      for (const m of measurements) {
        if (hitTest(m, pt)) { onMeasurementClick(m); return; }
      }
      onMeasurementClick(null);
      return;
    }

    const pt = toCanvas(e);

    if (tool === TOOLS.COUNT) {
      // Each click = one count point → immediately complete
      const points = [...cursorPoints, pt];
      onComplete({ type: tool, points, color, depth });
      setCursorPoints([]);
      return;
    }

    setCursorPoints(prev => [...prev, pt]);
    onAddPoint(pt);
  };

  const handleDblClick = (e) => {
    if (cursorPoints.length < 2) return;
    if ([TOOLS.LINEAR, TOOLS.CALIBRATE].includes(tool)) {
      onComplete({ type: tool, points: cursorPoints, color, depth });
      setCursorPoints([]);
    } else if ([TOOLS.AREA, TOOLS.VOLUME, TOOLS.PERIMETER].includes(tool)) {
      if (cursorPoints.length < 3) return;
      onComplete({ type: tool, points: cursorPoints, color, depth });
      setCursorPoints([]);
    }
  };

  const handleMouseMove = (e) => {
    setMousePos(toCanvas(e));
  };

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Backspace' || e.key === 'Delete') {
      setCursorPoints(prev => prev.slice(0, -1));
    }
    if (e.key === 'Escape') {
      setCursorPoints([]);
    }
    if (e.key === 'Enter' && cursorPoints.length >= 2) {
      onComplete({ type: tool, points: cursorPoints, color, depth });
      setCursorPoints([]);
    }
  }, [cursorPoints, tool, color, depth, onComplete, setCursorPoints]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const cursor = tool === TOOLS.SELECT ? 'default' : 'crosshair';

  return (
    <canvas
      ref={canvasRef}
      className="drawing-canvas"
      style={{ cursor }}
      width={800}
      height={600}
      onClick={handleClick}
      onDoubleClick={handleDblClick}
      onMouseMove={handleMouseMove}
    />
  );
}

function drawMeasurement(ctx, m, isActive, scale) {
  const pts = m.points || [];
  if (pts.length === 0) return;

  ctx.save();
  ctx.strokeStyle = isActive ? '#2563eb' : (m.color || '#EF4444');
  ctx.fillStyle   = (m.color || '#EF4444') + '22';
  ctx.lineWidth   = isActive ? 2.5 : 1.5;
  ctx.setLineDash(isActive ? [6,3] : []);

  const type = m.type?.toUpperCase();

  if (type === 'COUNT') {
    // Draw dots
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = m.color || '#EF4444';
      ctx.fill();
    }
  } else if (type === 'LINEAR' || type === 'PERIMETER') {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (type === 'PERIMETER') ctx.closePath();
    ctx.stroke();
    // Endpoint dots
    for (const p of pts) { ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI*2); ctx.fillStyle = m.color || '#EF4444'; ctx.fill(); }
  } else if (['AREA', 'VOLUME'].includes(type)) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // Label
  const centroid = getCentroid(pts);
  ctx.fillStyle = '#111827';
  ctx.font = 'bold 12px Inter, sans-serif';
  ctx.fillText(`${m.label || type} ${fmtVal(m.value, m.unit)}`, centroid.x + 6, centroid.y - 6);

  ctx.restore();
}

function drawInProgress(ctx, pts, tool, color, mousePos, scale, depth) {
  if (pts.length === 0) return;
  const preview = mousePos ? [...pts, mousePos] : pts;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle   = color + '22';
  ctx.lineWidth   = 2;
  ctx.setLineDash([5, 4]);

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < preview.length; i++) ctx.lineTo(preview[i].x, preview[i].y);

  if ([TOOLS.AREA, TOOLS.VOLUME, TOOLS.PERIMETER].includes(tool) && mousePos) {
    ctx.closePath();
    ctx.fill();
  }
  ctx.stroke();

  // Live measurement
  if (mousePos) {
    const { value, unit } = computeMeasurementLocal(tool, preview, scale, depth);
    ctx.setLineDash([]);
    ctx.font = 'bold 13px Inter, sans-serif';
    ctx.fillStyle = '#1e293b';
    ctx.fillText(`${fmtVal(value, unit)}`, mousePos.x + 10, mousePos.y - 10);
  }

  // Vertex dots
  for (const p of pts) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI*2);
    ctx.fillStyle = color;
    ctx.setLineDash([]);
    ctx.fill();
  }
  ctx.restore();
}

function getCentroid(pts) {
  const x = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const y = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  return { x, y };
}

function hitTest(m, pt, threshold = 10) {
  const pts = m.points || [];
  if (pts.length === 0) return false;
  const c = getCentroid(pts);
  return Math.sqrt((c.x - pt.x) ** 2 + (c.y - pt.y) ** 2) < threshold;
}

// ─── Main TakeoffCanvas ───────────────────────────────────────────────────────
export default function TakeoffCanvas({ documentId, projectId }) {
  const [doc,          setDoc]          = useState(null);
  const [measurements, setMeasurements] = useState([]);
  const [tool,         setTool]         = useState(TOOLS.SELECT);
  const [color,        setColor]        = useState(COLORS[0]);
  const [depth,        setDepth]        = useState(1);
  const [zoom,         setZoom]         = useState(1);
  const [pan,          setPan]          = useState({ x: 0, y: 0 });
  const [cursorPoints, setCursorPoints] = useState([]);
  const [activeM,      setActiveM]      = useState(null);
  const [page,         setPage]         = useState(1);
  const [loading,      setLoading]      = useState(true);
  const [saveLabel,    setSaveLabel]    = useState('');
  const [calibMode,    setCalibMode]    = useState(false);
  const [calibPoints,  setCalibPoints]  = useState([]);
  const [calibReal,    setCalibReal]    = useState('');
  const [panStart,     setPanStart]     = useState(null);
  const [boqItems,     setBoqItems]     = useState([]);
  const [linkingM,     setLinkingM]     = useState(null);
  const containerRef = useRef(null);

  // Load document
  const loadDoc = useCallback(async () => {
    setLoading(true);
    const data = await apiFetch(`/api/qs/takeoff/documents/${documentId}`);
    setDoc(data.document);
    setMeasurements(data.document.measurements || []);
    setLoading(false);
  }, [documentId]);

  useEffect(() => { loadDoc(); }, [loadDoc]);

  // Zoom handlers
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    setZoom(z => Math.max(0.3, Math.min(4, z * (e.deltaY < 0 ? 1.1 : 0.9))));
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (el) el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el?.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // Pan handlers
  const handleMouseDown = (e) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };
  const handleMouseMove = (e) => {
    if (panStart) setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
  };
  const handleMouseUp = () => setPanStart(null);

  // Complete a measurement
  const handleComplete = async ({ type, points, color, depth }) => {
    if (type === TOOLS.CALIBRATE) {
      setCalibPoints(points);
      setCalibMode(true);
      return;
    }

    const label = saveLabel || type;
    const data  = await apiFetch(`/api/qs/takeoff/documents/${documentId}/measurements`, {
      method: 'POST',
      body: {
        type,
        points,
        label,
        color,
        depth:  type === 'VOLUME' ? depth : 1,
        page,
        scale:  doc?.scale || 100,
      },
    });
    setMeasurements(prev => [...prev, data.measurement]);
    setActiveM(data.measurement);
    setSaveLabel('');
  };

  // Calibrate scale
  const handleCalibrate = async () => {
    if (calibPoints.length < 2 || !calibReal) return;
    const data = await apiFetch(`/api/qs/takeoff/documents/${documentId}/scale`, {
      method: 'PATCH',
      body: {
        calibrationP1: calibPoints[0],
        calibrationP2: calibPoints[1],
        realLength:    parseFloat(calibReal),
      },
    });
    setDoc(data.document);
    setMeasurements(data.document.measurements || []);
    setCalibMode(false);
    setCalibPoints([]);
    setCalibReal('');
    setTool(TOOLS.SELECT);
  };

  // Delete measurement
  const deleteMeasurement = async (id) => {
    await apiFetch(`/api/qs/takeoff/measurements/${id}`, { method: 'DELETE' });
    setMeasurements(prev => prev.filter(m => m.id !== id));
    if (activeM?.id === id) setActiveM(null);
  };

  // Link to BOQ
  const linkToBoq = async (measurementId, boqItemId) => {
    await apiFetch(`/api/qs/takeoff/measurements/${measurementId}/link`, {
      method: 'POST',
      body: { boqItemId, autoUpdateQty: true },
    });
    await loadDoc();
    setLinkingM(null);
  };

  // Summary
  const summary = useMemo(() => {
    const byType = {};
    for (const m of measurements.filter(m => m.page === page)) {
      if (!byType[m.type]) byType[m.type] = { count: 0, total: 0, unit: m.unit };
      byType[m.type].count++;
      byType[m.type].total = +(byType[m.type].total + m.value).toFixed(3);
    }
    return byType;
  }, [measurements, page]);

  if (loading) return <div className="tk-loading">Loading takeoff…</div>;

  return (
    <div className="takeoff-canvas-root">
      {/* Toolbar */}
      <div className="tk-toolbar">
        {/* Tool buttons */}
        <div className="tool-group">
          {Object.values(TOOLS).map(t => (
            <button
              key={t}
              className={`tool-btn ${tool === t ? 'active' : ''}`}
              onClick={() => { setTool(t); setCursorPoints([]); }}
              title={t}
            >
              <span className="tool-icon">{TOOL_ICONS[t]}</span>
              <span className="tool-label">{t}</span>
            </button>
          ))}
        </div>

        <div className="tk-toolbar-sep" />

        {/* Color picker */}
        <div className="color-row">
          {COLORS.map(c => (
            <div
              key={c}
              className={`color-dot ${color === c ? 'selected' : ''}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>

        {/* Depth (for VOLUME) */}
        {tool === TOOLS.VOLUME && (
          <label className="depth-input">
            Depth (m):
            <input
              type="number"
              value={depth}
              onChange={e => setDepth(Number(e.target.value))}
              min="0.01"
              step="0.01"
            />
          </label>
        )}

        {/* Label */}
        <input
          className="label-input"
          placeholder="Label (optional)"
          value={saveLabel}
          onChange={e => setSaveLabel(e.target.value)}
        />

        <div className="tk-toolbar-sep" />

        {/* Zoom */}
        <button className="icon-btn" onClick={() => setZoom(z => Math.min(z + 0.2, 4))}>⊕</button>
        <span className="zoom-label">{Math.round(zoom * 100)}%</span>
        <button className="icon-btn" onClick={() => setZoom(z => Math.max(z - 0.2, 0.3))}>⊖</button>
        <button className="icon-btn" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>⌂</button>
      </div>

      {/* Main content */}
      <div className="tk-main">
        {/* PDF viewer */}
        <div
          className="tk-canvas-wrapper"
          ref={containerRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {doc?.fileUrl && (
            <div
              className="tk-pdf-bg"
              style={{
                transform:       `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: '0 0',
              }}
            >
              <iframe
                src={doc.fileUrl + `#page=${page}`}
                className="pdf-frame"
                title="Drawing"
              />
            </div>
          )}

          {/* Measurement overlay */}
          <div
            className="tk-overlay"
            style={{
              transform:       `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
            }}
          >
            <DrawingCanvas
              tool={tool}
              scale={doc?.scale || 100}
              zoom={1}
              pan={{ x: 0, y: 0 }}
              color={color}
              depth={depth}
              measurements={measurements.filter(m => m.page === page)}
              activeMeasurement={activeM}
              onMeasurementClick={setActiveM}
              onComplete={handleComplete}
              onAddPoint={() => {}}
              cursorPoints={cursorPoints}
              setCursorPoints={setCursorPoints}
            />
          </div>
        </div>

        {/* Side panel */}
        <div className="tk-panel">
          {/* Page navigator */}
          {doc?.pages > 1 && (
            <div className="panel-section">
              <div className="panel-title">Pages</div>
              <div className="page-nav">
                {Array.from({ length: doc.pages }, (_, i) => i + 1).map(p => (
                  <button key={p} className={`page-btn ${page === p ? 'active' : ''}`} onClick={() => setPage(p)}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Scale info */}
          <div className="panel-section">
            <div className="panel-title">Scale</div>
            <div className="scale-info">
              <span>{doc?.scale?.toFixed(1)} px/m</span>
              <button className="text-btn" onClick={() => { setTool(TOOLS.CALIBRATE); setCursorPoints([]); }}>Calibrate</button>
            </div>
          </div>

          {/* Summary by type */}
          <div className="panel-section">
            <div className="panel-title">Totals (Page {page})</div>
            {Object.entries(summary).map(([type, s]) => (
              <div key={type} className="summary-row">
                <span className="summary-type">{type}</span>
                <span className="summary-val">{fmtVal(s.total, s.unit)} ({s.count})</span>
              </div>
            ))}
          </div>

          {/* Measurements list */}
          <div className="panel-section panel-list">
            <div className="panel-title">Measurements</div>
            {measurements.filter(m => m.page === page).map(m => (
              <div
                key={m.id}
                className={`meas-item ${activeM?.id === m.id ? 'active' : ''}`}
                onClick={() => setActiveM(activeM?.id === m.id ? null : m)}
              >
                <div
                  className="meas-color"
                  style={{ background: m.color }}
                />
                <div className="meas-info">
                  <div className="meas-label">{m.label || m.type}</div>
                  <div className="meas-val">{fmtVal(m.value, m.unit)}</div>
                </div>
                <div className="meas-actions">
                  <button
                    className="icon-btn-sm"
                    title="Link to BOQ"
                    onClick={e => { e.stopPropagation(); setLinkingM(m); }}
                  >🔗</button>
                  <button
                    className="icon-btn-sm danger"
                    title="Delete"
                    onClick={e => { e.stopPropagation(); deleteMeasurement(m.id); }}
                  >✕</button>
                </div>
                {m.linkedItemId && <span className="linked-badge" title="Linked to BOQ">✓</span>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Calibration dialog */}
      {calibMode && (
        <div className="calib-overlay">
          <div className="calib-dialog">
            <h3>Set Scale</h3>
            <p>You drew a reference line. Enter its real-world length:</p>
            <div className="calib-input-row">
              <input
                type="number"
                placeholder="Length in metres"
                value={calibReal}
                onChange={e => setCalibReal(e.target.value)}
                min="0.01"
                step="0.01"
                autoFocus
              />
              <span>m</span>
            </div>
            <div className="calib-actions">
              <button className="btn btn-primary" onClick={handleCalibrate} disabled={!calibReal}>Apply Scale</button>
              <button className="btn" onClick={() => { setCalibMode(false); setCalibPoints([]); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* BOQ link dialog */}
      {linkingM && (
        <BOQLinkDialog
          measurement={linkingM}
          projectId={projectId}
          onLink={(boqItemId) => linkToBoq(linkingM.id, boqItemId)}
          onClose={() => setLinkingM(null)}
        />
      )}

      {/* Instruction bar */}
      {tool !== TOOLS.SELECT && (
        <div className="tk-instruction">
          {tool === TOOLS.CALIBRATE
            ? 'Click 2 points on a known distance, then double-click to finish'
            : tool === TOOLS.COUNT
            ? 'Click each item to count'
            : [TOOLS.LINEAR].includes(tool)
            ? 'Click to add points. Double-click to finish. Backspace to undo last point. Enter to complete.'
            : 'Click to add polygon vertices. Double-click or Enter to close. Backspace to undo.'
          }
        </div>
      )}

      <style>{tkStyles}</style>
    </div>
  );
}

// ─── BOQ Link Dialog ──────────────────────────────────────────────────────────
function BOQLinkDialog({ measurement, projectId, onLink, onClose }) {
  const [versions, setVersions] = useState([]);
  const [versionId, setVersionId] = useState('');
  const [stages, setStages] = useState([]);
  const [itemId, setItemId] = useState('');

  useEffect(() => {
    apiFetch(`/api/qs/boq/versions?projectId=${projectId}`).then(d => setVersions(d.versions || []));
  }, [projectId]);

  useEffect(() => {
    if (!versionId) return;
    apiFetch(`/api/qs/boq/versions/${versionId}`).then(d => setStages(d.version?.stages || []));
  }, [versionId]);

  const allItems = stages.flatMap(s => (s.items || []).map(i => ({ ...i, stageName: s.name })));

  return (
    <div className="link-overlay" onClick={onClose}>
      <div className="link-dialog" onClick={e => e.stopPropagation()}>
        <h3>Link to BOQ Item</h3>
        <p className="link-meas-info">
          {measurement.label || measurement.type}: <strong>{fmtVal(measurement.value, measurement.unit)}</strong>
          {' '}will be applied as Qty to the selected BOQ item.
        </p>

        <label>BOQ Version</label>
        <select value={versionId} onChange={e => setVersionId(e.target.value)}>
          <option value="">— select version —</option>
          {versions.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>

        {versionId && (
          <>
            <label>BOQ Item</label>
            <select value={itemId} onChange={e => setItemId(e.target.value)}>
              <option value="">— select item —</option>
              {allItems.map(i => (
                <option key={i.id} value={i.id}>
                  [{i.stageName}] {i.code || ''} {i.description} ({i.unit})
                </option>
              ))}
            </select>
          </>
        )}

        <div className="link-actions">
          <button className="btn btn-primary" onClick={() => { if (itemId) onLink(itemId); }} disabled={!itemId}>
            Link & Update Qty
          </button>
          <button className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const tkStyles = `
.takeoff-canvas-root { display: flex; flex-direction: column; height: 100%; background: #0f172a; color: #f8fafc; font-family: 'Inter', sans-serif; font-size: 13px; }

.tk-toolbar { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: #1e293b; border-bottom: 1px solid #334155; flex-wrap: wrap; }
.tool-group { display: flex; gap: 4px; }
.tool-btn { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px 10px; border-radius: 6px; border: 1px solid #334155; background: #1e293b; color: #94a3b8; cursor: pointer; min-width: 56px; transition: all 0.15s; }
.tool-btn:hover { background: #334155; color: #f8fafc; }
.tool-btn.active { background: #2563eb; border-color: #2563eb; color: #fff; }
.tool-icon { font-size: 16px; }
.tool-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
.tk-toolbar-sep { width: 1px; height: 32px; background: #334155; }
.color-row { display: flex; gap: 6px; align-items: center; }
.color-dot { width: 20px; height: 20px; border-radius: 50%; cursor: pointer; border: 2px solid transparent; transition: transform 0.1s; }
.color-dot:hover { transform: scale(1.2); }
.color-dot.selected { border-color: #fff; transform: scale(1.1); }
.depth-input { display: flex; align-items: center; gap: 6px; color: #94a3b8; font-size: 12px; }
.depth-input input { width: 60px; padding: 4px 8px; border-radius: 4px; border: 1px solid #334155; background: #0f172a; color: #f8fafc; }
.label-input { padding: 5px 10px; border-radius: 4px; border: 1px solid #334155; background: #0f172a; color: #f8fafc; font-size: 12px; width: 140px; }
.label-input::placeholder { color: #64748b; }
.icon-btn { padding: 6px 10px; border-radius: 4px; border: 1px solid #334155; background: #1e293b; color: #94a3b8; cursor: pointer; font-size: 16px; }
.icon-btn:hover { background: #334155; color: #f8fafc; }
.zoom-label { min-width: 40px; text-align: center; color: #94a3b8; font-size: 12px; }

.tk-main { flex: 1; display: flex; overflow: hidden; }
.tk-canvas-wrapper { flex: 1; position: relative; overflow: hidden; background: #0f172a; user-select: none; }
.tk-pdf-bg { position: absolute; top: 0; left: 0; }
.pdf-frame { width: 800px; height: 600px; border: none; background: #fff; display: block; }
.tk-overlay { position: absolute; top: 0; left: 0; pointer-events: none; }
.drawing-canvas { display: block; pointer-events: all; }

.tk-panel { width: 260px; background: #1e293b; border-left: 1px solid #334155; display: flex; flex-direction: column; overflow: hidden; }
.panel-section { padding: 12px; border-bottom: 1px solid #334155; }
.panel-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; margin-bottom: 8px; }
.panel-list { flex: 1; overflow-y: auto; }
.page-nav { display: flex; flex-wrap: wrap; gap: 4px; }
.page-btn { padding: 4px 8px; border-radius: 4px; border: 1px solid #334155; background: #0f172a; color: #94a3b8; cursor: pointer; font-size: 12px; }
.page-btn.active { background: #2563eb; border-color: #2563eb; color: #fff; }
.scale-info { display: flex; justify-content: space-between; align-items: center; }
.text-btn { background: none; border: none; color: #2563eb; cursor: pointer; font-size: 12px; padding: 0; }
.text-btn:hover { text-decoration: underline; }
.summary-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.summary-type { color: #94a3b8; font-size: 12px; }
.summary-val { color: #f8fafc; font-weight: 500; font-size: 12px; }

.meas-item { display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: 6px; cursor: pointer; position: relative; margin-bottom: 4px; }
.meas-item:hover { background: #334155; }
.meas-item.active { background: #1e3a5f; }
.meas-color { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.meas-info { flex: 1; min-width: 0; }
.meas-label { font-size: 12px; font-weight: 500; color: #f8fafc; truncate; }
.meas-val { font-size: 11px; color: #94a3b8; }
.meas-actions { display: flex; gap: 4px; }
.icon-btn-sm { background: none; border: none; cursor: pointer; font-size: 13px; padding: 2px 4px; border-radius: 4px; color: #64748b; }
.icon-btn-sm:hover { background: #334155; color: #f8fafc; }
.icon-btn-sm.danger:hover { color: #f87171; }
.linked-badge { position: absolute; top: 4px; right: 4px; background: #166534; color: #bbf7d0; border-radius: 9999px; font-size: 9px; padding: 1px 4px; }

.tk-instruction { padding: 8px 16px; background: #2563eb; color: #fff; font-size: 12px; text-align: center; }

.calib-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 1000; display: flex; align-items: center; justify-content: center; }
.calib-dialog { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 24px; width: 360px; }
.calib-dialog h3 { margin: 0 0 8px; font-size: 18px; color: #f8fafc; }
.calib-dialog p { color: #94a3b8; margin-bottom: 16px; }
.calib-input-row { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
.calib-input-row input { flex: 1; padding: 8px 12px; border-radius: 6px; border: 1px solid #334155; background: #0f172a; color: #f8fafc; font-size: 14px; }
.calib-actions { display: flex; gap: 8px; }
.btn { padding: 8px 16px; border-radius: 6px; border: 1px solid #334155; background: #334155; color: #f8fafc; cursor: pointer; font-size: 13px; }
.btn:hover { background: #475569; }
.btn-primary { background: #2563eb; border-color: #2563eb; }
.btn-primary:hover { background: #1d4ed8; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }

.link-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 1000; display: flex; align-items: center; justify-content: center; }
.link-dialog { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 24px; width: 440px; display: flex; flex-direction: column; gap: 12px; }
.link-dialog h3 { margin: 0; color: #f8fafc; }
.link-meas-info { color: #94a3b8; font-size: 13px; margin: 0; }
.link-dialog label { color: #94a3b8; font-size: 12px; margin-bottom: 2px; display: block; }
.link-dialog select { width: 100%; padding: 8px 12px; border-radius: 6px; border: 1px solid #334155; background: #0f172a; color: #f8fafc; font-size: 13px; }
.link-actions { display: flex; gap: 8px; }

.tk-loading { display: flex; align-items: center; justify-content: center; height: 200px; color: #64748b; font-size: 16px; }
`;
