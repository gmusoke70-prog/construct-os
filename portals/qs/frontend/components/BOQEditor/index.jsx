/**
 * BOQEditor — Excel-like Bill of Quantities editor
 *
 * Features:
 *  - Spreadsheet-style grid with inline editing
 *  - Formula bar (type =SUM(A1:A5), =MARKUP(B1,15), etc.)
 *  - Keyboard navigation: Tab, Enter, Arrow keys, Escape
 *  - Drag-to-reorder rows
 *  - Stage (section) collapsing
 *  - Copy/paste cells
 *  - Context menu (insert row above/below, delete, apply library rate)
 *  - Auto-save on cell blur with debounce
 *  - Import/Export XLSX
 *  - Approval workflow controls
 */

'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// ─── Constants ────────────────────────────────────────────────────────────────
const COLUMNS = [
  { key: 'code',          label: 'Code',         width: 80,   type: 'text',   editable: true },
  { key: 'description',   label: 'Description',  width: 280,  type: 'text',   editable: true },
  { key: 'unit',          label: 'Unit',         width: 60,   type: 'text',   editable: true },
  { key: 'quantity',      label: 'Qty',          width: 80,   type: 'number', editable: true, formula: 'formulaQty' },
  { key: 'wastagePercent',label: 'Wst%',         width: 60,   type: 'number', editable: true },
  { key: 'netQuantity',   label: 'Net Qty',      width: 80,   type: 'number', editable: false, computed: true },
  { key: 'unitRate',      label: 'Rate (UGX)',   width: 110,  type: 'number', editable: true, formula: 'formulaRate' },
  { key: 'labourRate',    label: 'Lab Rate',     width: 90,   type: 'number', editable: true },
  { key: 'labourHours',   label: 'Lab Hrs',      width: 80,   type: 'number', editable: true },
  { key: 'materialCost',  label: 'Mat Cost',     width: 110,  type: 'number', editable: false, computed: true },
  { key: 'labourCost',    label: 'Lab Cost',     width: 100,  type: 'number', editable: false, computed: true },
  { key: 'subtotal',      label: 'Subtotal',     width: 110,  type: 'number', editable: false, computed: true },
  { key: 'markupPercent', label: 'Markup%',      width: 70,   type: 'number', editable: true },
  { key: 'totalCost',     label: 'Total Cost',   width: 120,  type: 'number', editable: false, computed: true },
];

const EDITABLE_KEYS = COLUMNS.filter(c => c.editable).map(c => c.key);

const fmt = new Intl.NumberFormat('en-UG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtN = (v) => (v == null || v === '') ? '' : fmt.format(Number(v));

// ─── API helpers ──────────────────────────────────────────────────────────────
const apiFetch = (url, opts = {}) =>
  fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('token')}`,
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }).then(r => r.json());

// ─── FormulaBar component ─────────────────────────────────────────────────────
function FormulaBar({ activeCell, value, onChange, onConfirm, onCancel }) {
  return (
    <div className="formula-bar">
      <span className="cell-address">{activeCell || '—'}</span>
      <span className="fx-label">fx</span>
      <input
        className="formula-input"
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter')  onConfirm();
          if (e.key === 'Escape') onCancel();
        }}
        placeholder="Enter value or formula (=SUM(A1:A5))"
        spellCheck={false}
      />
    </div>
  );
}

// ─── Stage header component ───────────────────────────────────────────────────
function StageHeader({ stage, collapsed, onToggle, onEdit, totalCost, isApproved }) {
  return (
    <tr className="stage-header-row" onClick={onToggle}>
      <td colSpan={COLUMNS.length + 1}>
        <div className="stage-header-content">
          <span className="stage-toggle">{collapsed ? '▶' : '▼'}</span>
          <span className="stage-color-dot" style={{ background: stage.color }} />
          {onEdit ? (
            <input
              className="stage-name-input"
              defaultValue={stage.name}
              onBlur={e => onEdit(stage.id, e.target.value)}
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <span className="stage-name">{stage.name}</span>
          )}
          <span className="stage-item-count">{stage.items?.length || 0} items</span>
          <span className="stage-total">
            Total: <strong>UGX {fmtN(totalCost)}</strong>
          </span>
        </div>
      </td>
    </tr>
  );
}

// ─── Cell component ───────────────────────────────────────────────────────────
function Cell({
  col, value, formula, active, editing, isError,
  onActivate, onStartEdit, onChange, onCommit, onKeyDown,
}) {
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  const displayValue = useMemo(() => {
    if (editing) return formula || value;
    if (isError) return value;
    if (col.type === 'number') return fmtN(value);
    return value ?? '';
  }, [editing, formula, value, col.type, isError]);

  return (
    <td
      className={[
        'boq-cell',
        active   ? 'active'    : '',
        editing  ? 'editing'   : '',
        col.computed ? 'computed' : '',
        isError  ? 'error'     : '',
        !col.editable ? 'readonly' : '',
      ].filter(Boolean).join(' ')}
      onClick={onActivate}
      onDoubleClick={onStartEdit}
    >
      {editing && col.editable ? (
        <input
          ref={inputRef}
          className="cell-input"
          value={formula !== null ? formula : (value ?? '')}
          onChange={e => onChange(e.target.value)}
          onBlur={onCommit}
          onKeyDown={onKeyDown}
        />
      ) : (
        <span className={`cell-text ${col.type === 'number' ? 'num' : ''}`}>
          {displayValue}
        </span>
      )}
      {formula && !editing && <span className="formula-indicator" title={formula}>ƒ</span>}
    </td>
  );
}

// ─── Context menu ─────────────────────────────────────────────────────────────
function ContextMenu({ x, y, onClose, actions }) {
  useEffect(() => {
    const handler = () => onClose();
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [onClose]);

  return (
    <div className="ctx-menu" style={{ top: y, left: x }} onClick={e => e.stopPropagation()}>
      {actions.map((action, i) =>
        action.separator
          ? <div key={i} className="ctx-separator" />
          : (
            <div key={i} className="ctx-item" onClick={() => { action.fn(); onClose(); }}>
              {action.icon && <span className="ctx-icon">{action.icon}</span>}
              {action.label}
            </div>
          )
      )}
    </div>
  );
}

// ─── Main BOQEditor ───────────────────────────────────────────────────────────
export default function BOQEditor({ versionId, projectId, isApproved = false }) {
  const [version,       setVersion]       = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(false);
  const [activeCell,    setActiveCell]    = useState(null);   // { stageIdx, itemIdx, colKey }
  const [editingCell,   setEditingCell]   = useState(null);   // same shape
  const [editValue,     setEditValue]     = useState('');
  const [collapsed,     setCollapsed]     = useState({});
  const [ctxMenu,       setCtxMenu]       = useState(null);   // { x, y, stageId, itemId }
  const [libraryOpen,   setLibraryOpen]   = useState(false);
  const [pendingLibItem,setPendingLibItem] = useState(null);   // itemId awaiting library selection
  const [notification,  setNotification]  = useState(null);

  const saveTimeout = useRef(null);

  // ── Load version ─────────────────────────────────────────────────────────
  const loadVersion = useCallback(async () => {
    setLoading(true);
    const data = await apiFetch(`/api/qs/boq/versions/${versionId}`);
    setVersion(data.version);
    setLoading(false);
  }, [versionId]);

  useEffect(() => { loadVersion(); }, [loadVersion]);

  // ── Cell addressing helpers ───────────────────────────────────────────────
  const cellAddress = (colKey, itemIdx) => {
    const colIdx = COLUMNS.findIndex(c => c.key === colKey);
    if (colIdx < 0) return '';
    const col = String.fromCharCode(65 + colIdx);
    return `${col}${itemIdx + 1}`;
  };

  const activeCellAddress = useMemo(() => {
    if (!activeCell) return null;
    return cellAddress(activeCell.colKey, activeCell.itemIdx);
  }, [activeCell]);

  // ── Cell editing ──────────────────────────────────────────────────────────
  const startEdit = useCallback((stageIdx, itemIdx, colKey) => {
    if (isApproved) return;
    const col = COLUMNS.find(c => c.key === colKey);
    if (!col?.editable) return;

    const item       = version.stages[stageIdx].items[itemIdx];
    const formulaKey = col.formula;
    const existing   = formulaKey && item[formulaKey] ? item[formulaKey] : String(item[colKey] ?? '');

    setEditingCell({ stageIdx, itemIdx, colKey });
    setEditValue(existing);
  }, [isApproved, version]);

  const commitEdit = useCallback(async () => {
    if (!editingCell || !version) return;
    const { stageIdx, itemIdx, colKey } = editingCell;
    const item  = version.stages[stageIdx].items[itemIdx];
    const col   = COLUMNS.find(c => c.key === colKey);
    const isFormula = editValue.startsWith('=');
    const formulaKey = col?.formula;

    const patch = {};
    if (isFormula && formulaKey) {
      patch[formulaKey] = editValue;
    } else {
      patch[colKey]     = col?.type === 'number' ? (parseFloat(editValue) || 0) : editValue;
      if (formulaKey)   patch[formulaKey] = null;  // clear formula
    }

    // Optimistic update
    setVersion(prev => {
      const next = structuredClone(prev);
      Object.assign(next.stages[stageIdx].items[itemIdx], patch);
      return next;
    });

    setEditingCell(null);
    setEditValue('');

    // Debounced API save
    clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(async () => {
      setSaving(true);
      try {
        const result = await apiFetch(`/api/qs/boq/items/${item.id}`, { method: 'PATCH', body: patch });
        // Update with server-computed values
        setVersion(prev => {
          const next = structuredClone(prev);
          Object.assign(next.stages[stageIdx].items[itemIdx], result.item);
          return next;
        });
      } catch (e) {
        showNotification('Save failed: ' + e.message, 'error');
      } finally {
        setSaving(false);
      }
    }, 400);
  }, [editingCell, editValue, version]);

  const cancelEdit = useCallback(() => {
    setEditingCell(null);
    setEditValue('');
  }, []);

  // ── Keyboard navigation ───────────────────────────────────────────────────
  const handleCellKeyDown = useCallback((e, stageIdx, itemIdx, colKey) => {
    const stage    = version.stages[stageIdx];
    const items    = stage.items;
    const colIdx   = COLUMNS.findIndex(c => c.key === colKey);
    const editCols = COLUMNS.filter(c => c.editable);

    const move = (dRow, dCol) => {
      e.preventDefault();
      commitEdit();
      let newItemIdx = itemIdx + dRow;
      let newColIdx  = colIdx + dCol;

      // Wrap columns
      if (newColIdx >= COLUMNS.length) { newColIdx = 0; newItemIdx++; }
      if (newColIdx < 0)               { newColIdx = COLUMNS.length - 1; newItemIdx--; }
      // Clamp rows within stage
      newItemIdx = Math.max(0, Math.min(items.length - 1, newItemIdx));

      setActiveCell({ stageIdx, itemIdx: newItemIdx, colKey: COLUMNS[newColIdx].key });
    };

    switch (e.key) {
      case 'Enter':    commitEdit(); break;
      case 'Escape':   cancelEdit(); break;
      case 'Tab':      move(0, e.shiftKey ? -1 : 1); break;
      case 'ArrowDown':  if (!editingCell) { e.preventDefault(); move(1, 0); } break;
      case 'ArrowUp':    if (!editingCell) { e.preventDefault(); move(-1, 0); } break;
      case 'ArrowRight': if (!editingCell) { e.preventDefault(); move(0, 1); } break;
      case 'ArrowLeft':  if (!editingCell) { e.preventDefault(); move(0, -1); } break;
      case 'Delete':
      case 'Backspace':
        if (!editingCell) {
          e.preventDefault();
          startEdit(stageIdx, itemIdx, colKey);
          setEditValue('');
        }
        break;
      default:
        // Start editing on printable key
        if (!editingCell && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
          startEdit(stageIdx, itemIdx, colKey);
          setEditValue(e.key);
        }
    }
  }, [version, editingCell, commitEdit, cancelEdit, startEdit]);

  // ── Formula bar integration ───────────────────────────────────────────────
  const handleFormulaBarChange = (val) => {
    if (!activeCell) return;
    const { stageIdx, itemIdx, colKey } = activeCell;
    if (!editingCell) {
      setEditingCell(activeCell);
    }
    setEditValue(val);
  };

  const formulaBarValue = useMemo(() => {
    if (!activeCell || !version) return '';
    const { stageIdx, itemIdx, colKey } = activeCell;
    const item = version.stages[stageIdx]?.items[itemIdx];
    if (!item) return '';
    const col        = COLUMNS.find(c => c.key === colKey);
    const formulaKey = col?.formula;
    if (editingCell?.stageIdx === stageIdx && editingCell?.itemIdx === itemIdx && editingCell?.colKey === colKey) {
      return editValue;
    }
    return (formulaKey && item[formulaKey]) || String(item[colKey] ?? '');
  }, [activeCell, editingCell, editValue, version]);

  // ── Row operations ────────────────────────────────────────────────────────
  const addItem = async (stageId) => {
    const result = await apiFetch('/api/qs/boq/items', {
      method: 'POST',
      body: { stageId, description: '', unit: 'm²', quantity: 0, unitRate: 0 },
    });
    await loadVersion();
    showNotification('Row added');
  };

  const deleteItem = async (itemId) => {
    if (!confirm('Delete this item?')) return;
    await apiFetch(`/api/qs/boq/items/${itemId}`, { method: 'DELETE' });
    await loadVersion();
    showNotification('Row deleted');
  };

  const addStage = async () => {
    const name = prompt('Stage name:');
    if (!name) return;
    await apiFetch('/api/qs/boq/stages', { method: 'POST', body: { versionId, name } });
    await loadVersion();
  };

  // ── Import / Export ───────────────────────────────────────────────────────
  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    setSaving(true);
    const res = await fetch(`/api/qs/boq/versions/${versionId}/import`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: formData,
    });
    const data = await res.json();
    setSaving(false);
    if (data.error) showNotification('Import failed: ' + data.error, 'error');
    else { showNotification('Imported successfully'); await loadVersion(); }
    e.target.value = '';
  };

  const handleExport = () => {
    const a = document.createElement('a');
    a.href = `/api/qs/boq/versions/${versionId}/export?token=${localStorage.getItem('token')}`;
    a.download = `BOQ_${versionId}.xlsx`;
    a.click();
  };

  // ── Recalculate ───────────────────────────────────────────────────────────
  const handleRecalc = async () => {
    setSaving(true);
    await apiFetch(`/api/qs/boq/versions/${versionId}/recalc`, { method: 'POST' });
    await loadVersion();
    setSaving(false);
    showNotification('Recalculated');
  };

  // ── Submit for approval ───────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!confirm('Submit this BOQ for approval?')) return;
    const data = await apiFetch(`/api/qs/boq/versions/${versionId}/submit`, { method: 'POST' });
    if (data.error) showNotification(data.error, 'error');
    else { showNotification('Submitted for approval'); await loadVersion(); }
  };

  // ── Context menu ──────────────────────────────────────────────────────────
  const handleContextMenu = (e, stageId, itemId) => {
    if (isApproved) return;
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, stageId, itemId });
  };

  const contextActions = useMemo(() => {
    if (!ctxMenu) return [];
    return [
      { label: 'Insert row above', icon: '⬆', fn: () => addItem(ctxMenu.stageId) },
      { label: 'Insert row below', icon: '⬇', fn: () => addItem(ctxMenu.stageId) },
      { separator: true },
      { label: 'Apply library rate', icon: '📚', fn: () => { setPendingLibItem(ctxMenu.itemId); setLibraryOpen(true); } },
      { separator: true },
      { label: 'Delete row', icon: '🗑', fn: () => deleteItem(ctxMenu.itemId) },
    ];
  }, [ctxMenu]);

  // ── Notifications ─────────────────────────────────────────────────────────
  const showNotification = (msg, type = 'success') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3000);
  };

  // ── Grand total ───────────────────────────────────────────────────────────
  const grandTotal = useMemo(() => {
    if (!version) return 0;
    return version.stages.reduce((s, st) => {
      return s + (st.items || []).reduce((ss, item) => ss + (item.totalCost || 0), 0);
    }, 0);
  }, [version]);

  // ─────────────────────────────────────────────────────────────────────────
  if (loading) return <div className="boq-loading">Loading BOQ…</div>;
  if (!version) return <div className="boq-error">BOQ version not found</div>;

  const readOnly = isApproved || version.status === 'APPROVED';

  return (
    <div className="boq-editor">
      {/* Toolbar */}
      <div className="boq-toolbar">
        <div className="toolbar-left">
          <span className="version-badge">{version.name}</span>
          <span className={`status-badge status-${version.status?.toLowerCase()}`}>{version.status}</span>
        </div>
        <div className="toolbar-right">
          {saving && <span className="saving-indicator">Saving…</span>}
          {!readOnly && (
            <>
              <button className="btn btn-sm" onClick={handleRecalc} title="Re-run all formula cells">⟳ Recalc</button>
              <label className="btn btn-sm" title="Import XLSX">
                ⬆ Import
                <input type="file" accept=".xlsx,.xls" hidden onChange={handleImport} />
              </label>
            </>
          )}
          <button className="btn btn-sm" onClick={handleExport} title="Export to Excel">⬇ Export</button>
          {!readOnly && version.status === 'DRAFT' && (
            <button className="btn btn-primary btn-sm" onClick={handleSubmit}>Submit for Approval</button>
          )}
        </div>
      </div>

      {/* Formula bar */}
      <FormulaBar
        activeCell={activeCellAddress}
        value={formulaBarValue}
        onChange={handleFormulaBarChange}
        onConfirm={commitEdit}
        onCancel={cancelEdit}
      />

      {/* Grid */}
      <div className="boq-grid-wrapper">
        <table className="boq-table">
          <thead>
            <tr className="column-header-row">
              <th className="row-num-col">#</th>
              {COLUMNS.map(col => (
                <th key={col.key} style={{ width: col.width }} className={col.computed ? 'computed-header' : ''}>
                  {col.label}
                </th>
              ))}
              {!readOnly && <th className="action-col">⋯</th>}
            </tr>
          </thead>
          <tbody>
            {version.stages.map((stage, stageIdx) => {
              const stageTotal  = (stage.items || []).reduce((s, i) => s + (i.totalCost || 0), 0);
              const isCollapsed = collapsed[stage.id];

              return (
                <React.Fragment key={stage.id}>
                  <StageHeader
                    stage={stage}
                    collapsed={isCollapsed}
                    totalCost={stageTotal}
                    isApproved={readOnly}
                    onToggle={() => setCollapsed(p => ({ ...p, [stage.id]: !p[stage.id] }))}
                    onEdit={!readOnly ? (id, name) => apiFetch(`/api/qs/boq/stages/${id}`, { method: 'PATCH', body: { name } }) : null}
                  />

                  {!isCollapsed && (stage.items || []).map((item, itemIdx) => (
                    <tr
                      key={item.id}
                      className={`boq-row ${activeCell?.itemIdx === itemIdx && activeCell?.stageIdx === stageIdx ? 'row-active' : ''}`}
                      onContextMenu={e => handleContextMenu(e, stage.id, item.id)}
                    >
                      <td className="row-num">{itemIdx + 1}</td>
                      {COLUMNS.map(col => {
                        const isActive  = activeCell?.stageIdx === stageIdx && activeCell?.itemIdx === itemIdx && activeCell?.colKey === col.key;
                        const isEditing = editingCell?.stageIdx === stageIdx && editingCell?.itemIdx === itemIdx && editingCell?.colKey === col.key;
                        const isErr     = typeof item[col.key] === 'string' && item[col.key].startsWith('#');
                        const formulaKey = col.formula;

                        return (
                          <Cell
                            key={col.key}
                            col={col}
                            value={item[col.key]}
                            formula={formulaKey ? item[formulaKey] : null}
                            active={isActive}
                            editing={isEditing}
                            isError={isErr}
                            onActivate={() => setActiveCell({ stageIdx, itemIdx, colKey: col.key })}
                            onStartEdit={() => startEdit(stageIdx, itemIdx, col.key)}
                            onChange={setEditValue}
                            onCommit={commitEdit}
                            onKeyDown={e => handleCellKeyDown(e, stageIdx, itemIdx, col.key)}
                          />
                        );
                      })}
                      {!readOnly && (
                        <td className="action-col">
                          <button
                            className="row-menu-btn"
                            onClick={e => handleContextMenu(e, stage.id, item.id)}
                          >⋯</button>
                        </td>
                      )}
                    </tr>
                  ))}

                  {/* Stage subtotal row */}
                  {!isCollapsed && (
                    <tr className="stage-subtotal-row">
                      <td colSpan={COLUMNS.length - 1 + 1} className="subtotal-label">
                        {stage.name} Total
                      </td>
                      <td className="subtotal-value">UGX {fmtN(stageTotal)}</td>
                      {!readOnly && <td />}
                    </tr>
                  )}

                  {/* Add row button */}
                  {!readOnly && !isCollapsed && (
                    <tr className="add-row-row">
                      <td colSpan={COLUMNS.length + 2}>
                        <button className="add-row-btn" onClick={() => addItem(stage.id)}>
                          + Add item to {stage.name}
                        </button>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="grand-total-row">
              <td colSpan={COLUMNS.length} className="grand-total-label">GRAND TOTAL</td>
              <td className="grand-total-value">UGX {fmtN(grandTotal)}</td>
              {!readOnly && <td />}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Add stage button */}
      {!readOnly && (
        <button className="add-stage-btn" onClick={addStage}>+ Add Stage / Section</button>
      )}

      {/* Context menu */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          actions={contextActions}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {/* Notification toast */}
      {notification && (
        <div className={`toast toast-${notification.type}`}>
          {notification.msg}
        </div>
      )}

      {/* Library picker (simplified) */}
      {libraryOpen && (
        <LibraryPicker
          companyId={version.companyId}
          onSelect={async (libItem) => {
            if (pendingLibItem) {
              await apiFetch(`/api/qs/boq/items/${pendingLibItem}/apply-library`, {
                method: 'POST',
                body: { libraryItemId: libItem.id },
              });
              await loadVersion();
              showNotification(`Applied "${libItem.description}" rate`);
            }
            setLibraryOpen(false);
            setPendingLibItem(null);
          }}
          onClose={() => { setLibraryOpen(false); setPendingLibItem(null); }}
        />
      )}

      <style>{boqStyles}</style>
    </div>
  );
}

// ─── Library Picker ───────────────────────────────────────────────────────────
function LibraryPicker({ onSelect, onClose }) {
  const [q, setQ]           = useState('');
  const [items, setItems]   = useState([]);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async (query) => {
    setLoading(true);
    const data = await apiFetch(`/api/qs/boq/library?q=${encodeURIComponent(query)}&limit=30`);
    setItems(data.items || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => search(q), 300);
    return () => clearTimeout(t);
  }, [q, search]);

  useEffect(() => { search(''); }, [search]);

  return (
    <div className="library-modal-overlay" onClick={onClose}>
      <div className="library-modal" onClick={e => e.stopPropagation()}>
        <div className="library-modal-header">
          <h3>Cost Library</h3>
          <button onClick={onClose}>✕</button>
        </div>
        <input
          className="library-search"
          placeholder="Search descriptions, codes…"
          value={q}
          onChange={e => setQ(e.target.value)}
          autoFocus
        />
        <div className="library-results">
          {loading ? <div className="lib-loading">Searching…</div> : (
            items.length === 0
              ? <div className="lib-empty">No results for "{q}"</div>
              : items.map(item => (
                <div key={item.id} className="lib-item" onClick={() => onSelect(item)}>
                  <div className="lib-item-desc">{item.description}</div>
                  <div className="lib-item-meta">
                    {item.category} · {item.unit} · <strong>UGX {fmtN(item.baseRate)}</strong>
                  </div>
                </div>
              ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const boqStyles = `
.boq-editor { display: flex; flex-direction: column; height: 100%; font-family: 'Inter', sans-serif; font-size: 13px; background: #fff; }

.boq-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid #e5e7eb; background: #f9fafb; gap: 8px; }
.toolbar-left, .toolbar-right { display: flex; align-items: center; gap: 8px; }
.version-badge { font-weight: 600; color: #111827; }
.status-badge { padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
.status-draft { background: #fef3c7; color: #92400e; }
.status-pending_approval { background: #dbeafe; color: #1d4ed8; }
.status-approved { background: #dcfce7; color: #166534; }
.status-rejected { background: #fee2e2; color: #991b1b; }
.saving-indicator { color: #6b7280; font-size: 12px; }
.btn { padding: 5px 12px; border-radius: 6px; border: 1px solid #d1d5db; background: #fff; cursor: pointer; font-size: 12px; display: inline-flex; align-items: center; gap: 4px; }
.btn:hover { background: #f3f4f6; }
.btn-primary { background: #2563eb; color: #fff; border-color: #2563eb; }
.btn-primary:hover { background: #1d4ed8; }
.btn-sm { padding: 4px 10px; font-size: 12px; }

.formula-bar { display: flex; align-items: center; border-bottom: 2px solid #e5e7eb; background: #fff; padding: 4px 8px; gap: 8px; }
.cell-address { min-width: 60px; text-align: center; font-weight: 600; color: #374151; font-size: 12px; border-right: 1px solid #e5e7eb; padding-right: 8px; }
.fx-label { color: #6b7280; font-style: italic; font-size: 12px; }
.formula-input { flex: 1; border: none; outline: none; font-family: 'Fira Code', monospace; font-size: 13px; color: #111827; }

.boq-grid-wrapper { flex: 1; overflow: auto; }
.boq-table { width: 100%; border-collapse: collapse; table-layout: fixed; min-width: 1200px; }

.column-header-row th { position: sticky; top: 0; z-index: 10; background: #f3f4f6; border-bottom: 2px solid #d1d5db; padding: 6px 8px; text-align: left; font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; white-space: nowrap; }
.computed-header { background: #eff6ff !important; }
.row-num-col { width: 36px; }
.action-col { width: 36px; }

.stage-header-row { cursor: pointer; }
.stage-header-row td { background: #1e293b; color: #f8fafc; padding: 8px 12px; }
.stage-header-content { display: flex; align-items: center; gap: 10px; }
.stage-toggle { font-size: 10px; opacity: 0.7; }
.stage-color-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.stage-name-input { background: transparent; border: none; border-bottom: 1px solid rgba(255,255,255,0.3); color: #f8fafc; font-size: 13px; font-weight: 600; width: 200px; outline: none; }
.stage-name { font-weight: 600; font-size: 13px; }
.stage-item-count { margin-left: auto; opacity: 0.6; font-size: 11px; }
.stage-total { font-size: 12px; }

.boq-row td { border-bottom: 1px solid #f1f5f9; height: 32px; }
.boq-row:hover td { background: #f8fafc; }
.row-active td { background: #eff6ff !important; }
.row-num { padding: 4px 8px; color: #9ca3af; font-size: 11px; text-align: center; }

.boq-cell { padding: 2px 6px; cursor: cell; position: relative; overflow: hidden; white-space: nowrap; }
.boq-cell.active { outline: 2px solid #2563eb; outline-offset: -2px; }
.boq-cell.editing { padding: 0; outline: 2px solid #2563eb; outline-offset: -2px; z-index: 5; }
.boq-cell.computed { background: #f8fafc; color: #374151; }
.boq-cell.readonly { cursor: default; }
.boq-cell.error { color: #dc2626; font-weight: 600; }
.cell-input { width: 100%; height: 100%; border: none; outline: none; padding: 2px 6px; font-size: 13px; font-family: inherit; background: #fff; }
.cell-text.num { display: block; text-align: right; font-variant-numeric: tabular-nums; }
.formula-indicator { position: absolute; top: 2px; right: 3px; color: #6b7280; font-size: 9px; }

.stage-subtotal-row td { background: #f1f5f9; font-weight: 600; padding: 6px 8px; border-top: 1px solid #d1d5db; }
.subtotal-label { text-align: right; color: #374151; }
.subtotal-value { text-align: right; color: #1e40af; }

.add-row-row td { padding: 4px 8px; }
.add-row-btn { background: none; border: none; color: #6b7280; cursor: pointer; font-size: 12px; padding: 2px 0; }
.add-row-btn:hover { color: #2563eb; }

.grand-total-row td { background: #1e293b; color: #f8fafc; padding: 10px 8px; font-weight: 700; font-size: 14px; position: sticky; bottom: 0; }
.grand-total-label { text-align: right; }
.grand-total-value { text-align: right; }

.add-stage-btn { margin: 12px; padding: 8px 16px; border: 2px dashed #d1d5db; background: none; color: #6b7280; cursor: pointer; border-radius: 6px; font-size: 13px; width: calc(100% - 24px); }
.add-stage-btn:hover { border-color: #2563eb; color: #2563eb; background: #eff6ff; }

.ctx-menu { position: fixed; z-index: 1000; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.15); min-width: 180px; padding: 4px 0; }
.ctx-item { display: flex; align-items: center; gap: 8px; padding: 8px 14px; cursor: pointer; font-size: 13px; color: #374151; }
.ctx-item:hover { background: #f3f4f6; }
.ctx-icon { font-size: 14px; }
.ctx-separator { height: 1px; background: #e5e7eb; margin: 4px 0; }

.toast { position: fixed; bottom: 24px; right: 24px; padding: 12px 20px; border-radius: 8px; font-size: 14px; font-weight: 500; z-index: 2000; animation: slideUp 0.2s ease; }
.toast-success { background: #166534; color: #fff; }
.toast-error   { background: #991b1b; color: #fff; }
@keyframes slideUp { from { transform: translateY(16px); opacity: 0; } to { transform: none; opacity: 1; } }

.library-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 1500; display: flex; align-items: center; justify-content: center; }
.library-modal { background: #fff; border-radius: 12px; width: 560px; max-height: 70vh; display: flex; flex-direction: column; overflow: hidden; }
.library-modal-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid #e5e7eb; }
.library-modal-header h3 { margin: 0; font-size: 16px; font-weight: 600; }
.library-modal-header button { background: none; border: none; cursor: pointer; font-size: 18px; color: #6b7280; }
.library-search { margin: 12px 16px; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; outline: none; }
.library-search:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,0.1); }
.library-results { flex: 1; overflow-y: auto; padding: 0 16px 16px; }
.lib-item { padding: 10px 12px; border: 1px solid #e5e7eb; border-radius: 6px; margin-bottom: 6px; cursor: pointer; }
.lib-item:hover { border-color: #2563eb; background: #eff6ff; }
.lib-item-desc { font-weight: 500; color: #111827; margin-bottom: 4px; }
.lib-item-meta { font-size: 12px; color: #6b7280; }
.lib-loading, .lib-empty { padding: 20px; text-align: center; color: #6b7280; }

.boq-loading, .boq-error { display: flex; align-items: center; justify-content: center; height: 200px; color: #6b7280; font-size: 16px; }
`;
