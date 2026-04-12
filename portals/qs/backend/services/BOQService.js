/**
 * BOQService.js — Bill of Quantities CRUD + auto-calculation pipeline
 *
 * Handles:
 *   - Version-controlled BOQ documents (BOQVersion)
 *   - Stage (section) management with position ordering
 *   - Item CRUD with Excel-like formula evaluation
 *   - Full recalculation cascade on any change
 *   - Approval workflow transitions
 *   - Excel import/export (XLSX)
 *   - Snapshot + PDF generation data
 */

'use strict';

const { PrismaClient, BOQItemStatus, ApprovalStatus } = require('@prisma/client');
const { FormulaEngine, computeBOQRow } = require('./FormulaEngine');
const { CostEngine } = require('./CostEngine');

const prisma = new PrismaClient();

// ─── BOQ Version ─────────────────────────────────────────────────────────────

async function createBOQVersion(projectId, companyId, { name, description, createdById } = {}) {
  // Get the next version number
  const count = await prisma.bOQVersion.count({ where: { projectId, companyId } });
  const versionNo = count + 1;

  return prisma.bOQVersion.create({
    data: {
      projectId,
      companyId,
      versionNo,
      createdById: createdById || projectId, // fallback, but caller should always pass this
      name:        name        || `Version ${versionNo}`,
      description: description || '',
      status:      ApprovalStatus.DRAFT,
    },
    include: { stages: { include: { items: true }, orderBy: { position: 'asc' } } },
  });
}

async function getBOQVersions(projectId, companyId) {
  return prisma.bOQVersion.findMany({
    where:   { projectId, companyId },
    include: {
      stages: {
        include:  { items: { orderBy: { rowIndex: 'asc' } } },
        orderBy:  { position: 'asc' },
      },
      _count: true,
    },
    orderBy: { versionNo: 'desc' },
  });
}

async function getBOQVersion(versionId, companyId) {
  const version = await prisma.bOQVersion.findFirst({
    where:   { id: versionId, companyId },
    include: {
      stages: {
        include:  { items: { orderBy: { rowIndex: 'asc' } } },
        orderBy:  { position: 'asc' },
      },
    },
  });
  if (!version) throw new Error('BOQ version not found');
  return version;
}

async function cloneBOQVersion(versionId, companyId, { name, createdById } = {}) {
  const source = await getBOQVersion(versionId, companyId);
  const count  = await prisma.bOQVersion.count({ where: { projectId: source.projectId, companyId } });

  return prisma.$transaction(async (tx) => {
    const newVersion = await tx.bOQVersion.create({
      data: {
        projectId:   source.projectId,
        companyId,
        createdById: createdById || source.createdById,
        versionNo:   count + 1,
        name:        name || `${source.name} (Copy)`,
        description: source.description,
        status:      ApprovalStatus.DRAFT,
      },
    });

    for (const stage of source.stages) {
      const newStage = await tx.bOQStage.create({
        data: {
          versionId: newVersion.id,
          companyId,
          name:      stage.name,
          position:  stage.position,
          color:     stage.color,
        },
      });

      if (stage.items.length > 0) {
        await tx.bOQItem.createMany({
          data: stage.items.map(item => ({
            stageId:       newStage.id,
            companyId,
            rowIndex:      item.rowIndex,
            code:          item.code,
            description:   item.description,
            unit:          item.unit,
            quantity:      item.quantity,
            wastagePercent:item.wastagePercent,
            netQuantity:   item.netQuantity,
            unitRate:      item.unitRate,
            labourRate:    item.labourRate,
            labourHours:   item.labourHours,
            materialCost:  item.materialCost,
            labourCost:    item.labourCost,
            subtotal:      item.subtotal,
            markupPercent: item.markupPercent,
            totalCost:     item.totalCost,
            formulaQty:    item.formulaQty,
            formulaRate:   item.formulaRate,
            status:        BOQItemStatus.DRAFT,
            costLibRef:    item.costLibRef,
          })),
        });
      }
    }

    return newVersion;
  });
}

async function submitBOQForApproval(versionId, companyId, submittedBy) {
  const version = await prisma.bOQVersion.findFirst({ where: { id: versionId, companyId } });
  if (!version) throw new Error('BOQ version not found');
  if (version.status !== ApprovalStatus.DRAFT) {
    throw new Error(`Cannot submit: version is ${version.status}`);
  }
  return prisma.bOQVersion.update({
    where: { id: versionId },
    data:  { status: ApprovalStatus.PENDING_APPROVAL, submittedAt: new Date(), submittedBy },
  });
}

async function approveBOQVersion(versionId, companyId, approvedBy) {
  return prisma.bOQVersion.update({
    where: { id: versionId },
    data:  { status: ApprovalStatus.APPROVED, approvedAt: new Date(), approvedBy },
  });
}

async function rejectBOQVersion(versionId, companyId, rejectedBy, reason) {
  return prisma.bOQVersion.update({
    where: { id: versionId },
    data:  { status: ApprovalStatus.REJECTED, rejectedAt: new Date(), rejectedBy, rejectionReason: reason },
  });
}

// ─── BOQ Stage ────────────────────────────────────────────────────────────────

async function createStage(versionId, companyId, { name, position, color }) {
  // Auto-assign position if not given
  if (position == null) {
    const max = await prisma.bOQStage.aggregate({
      where:   { versionId, companyId },
      _max:    { position: true },
    });
    position = (max._max.position ?? -1) + 1;
  }

  return prisma.bOQStage.create({
    data: { versionId, companyId, name, position, color: color || '#3B82F6' },
    include: { items: { orderBy: { rowIndex: 'asc' } } },
  });
}

async function updateStage(stageId, companyId, data) {
  return prisma.bOQStage.update({
    where:   { id: stageId, companyId },
    data:    { name: data.name, color: data.color, position: data.position },
    include: { items: { orderBy: { rowIndex: 'asc' } } },
  });
}

async function deleteStage(stageId, companyId) {
  return prisma.bOQStage.delete({ where: { id: stageId, companyId } });
}

async function reorderStages(versionId, companyId, orderedIds) {
  return prisma.$transaction(
    orderedIds.map((id, idx) =>
      prisma.bOQStage.update({ where: { id, companyId }, data: { position: idx } })
    )
  );
}

// ─── BOQ Item CRUD ────────────────────────────────────────────────────────────

async function createItem(stageId, companyId, data) {
  // Auto-assign rowIndex
  const max = await prisma.bOQItem.aggregate({
    where: { stageId, companyId },
    _max:  { rowIndex: true },
  });
  const rowIndex = (max._max.rowIndex ?? -1) + 1;

  // Compute derived fields
  const derived = computeBOQRow({ ...data, rowIndex });

  return prisma.bOQItem.create({
    data: {
      stageId,
      companyId,
      rowIndex,
      code:          data.code        || null,
      description:   data.description || '',
      unit:          data.unit        || 'm²',
      quantity:      Number(data.quantity)       || 0,
      wastagePercent:Number(data.wastagePercent) || 0,
      netQuantity:   derived.netQuantity,
      unitRate:      Number(data.unitRate)       || 0,
      labourRate:    Number(data.labourRate)     || 0,
      labourHours:   Number(data.labourHours)    || 0,
      materialCost:  derived.materialCost,
      labourCost:    derived.labourCost,
      subtotal:      derived.subtotal,
      markupPercent: Number(data.markupPercent)  || 0,
      totalCost:     derived.totalCost,
      formulaQty:    data.formulaQty  || null,
      formulaRate:   data.formulaRate || null,
      status:        BOQItemStatus.DRAFT,
      costLibRef:    data.costLibRef  || null,
      takeoffRef:    data.takeoffRef  || null,
    },
  });
}

async function updateItem(itemId, companyId, data) {
  const existing = await prisma.bOQItem.findFirst({ where: { id: itemId, companyId } });
  if (!existing) throw new Error('BOQ item not found');

  const merged  = { ...existing, ...data };
  const derived = computeBOQRow(merged);

  return prisma.bOQItem.update({
    where: { id: itemId },
    data:  {
      ...(data.code          !== undefined && { code:          data.code }),
      ...(data.description   !== undefined && { description:   data.description }),
      ...(data.unit          !== undefined && { unit:          data.unit }),
      ...(data.quantity      !== undefined && { quantity:      Number(data.quantity) }),
      ...(data.wastagePercent!== undefined && { wastagePercent:Number(data.wastagePercent) }),
      ...(data.unitRate      !== undefined && { unitRate:      Number(data.unitRate) }),
      ...(data.labourRate    !== undefined && { labourRate:    Number(data.labourRate) }),
      ...(data.labourHours   !== undefined && { labourHours:   Number(data.labourHours) }),
      ...(data.markupPercent !== undefined && { markupPercent: Number(data.markupPercent) }),
      ...(data.formulaQty    !== undefined && { formulaQty:    data.formulaQty }),
      ...(data.formulaRate   !== undefined && { formulaRate:   data.formulaRate }),
      ...(data.costLibRef    !== undefined && { costLibRef:    data.costLibRef }),
      ...(data.takeoffRef    !== undefined && { takeoffRef:    data.takeoffRef }),
      ...(data.status        !== undefined && { status:        data.status }),
      netQuantity:  derived.netQuantity,
      materialCost: derived.materialCost,
      labourCost:   derived.labourCost,
      subtotal:     derived.subtotal,
      totalCost:    derived.totalCost,
      updatedAt:    new Date(),
    },
  });
}

async function deleteItem(itemId, companyId) {
  return prisma.bOQItem.delete({ where: { id: itemId, companyId } });
}

async function reorderItems(stageId, companyId, orderedIds) {
  return prisma.$transaction(
    orderedIds.map((id, idx) =>
      prisma.bOQItem.update({ where: { id, companyId }, data: { rowIndex: idx } })
    )
  );
}

/**
 * Bulk update multiple items in a single transaction.
 * Accepts array of { id, ...fields } objects.
 */
async function bulkUpdateItems(companyId, updates) {
  return prisma.$transaction(
    updates.map(({ id, ...data }) => {
      const derived = computeBOQRow(data);
      return prisma.bOQItem.update({
        where: { id, companyId },
        data:  { ...data, ...derived, updatedAt: new Date() },
      });
    })
  );
}

// ─── Formula re-evaluation ────────────────────────────────────────────────────

/**
 * Re-evaluate all formula cells in a stage and update DB.
 * Called after any cell change to cascade dependencies.
 *
 * @param {string} stageId
 * @param {string} companyId
 */
async function recalcStage(stageId, companyId) {
  const stage = await prisma.bOQStage.findFirst({
    where:   { id: stageId, companyId },
    include: { items: { orderBy: { rowIndex: 'asc' } } },
  });
  if (!stage) throw new Error('Stage not found');

  const engine = new FormulaEngine();

  // Build a cell map: "A{rowIndex}" = qty, "B{rowIndex}" = unitRate, etc.
  // Column mapping: A=quantity, B=unitRate, C=labourRate, D=labourHours, E=wastagePercent, F=markupPercent
  const COLUMNS = { A: 'quantity', B: 'unitRate', C: 'labourRate', D: 'labourHours', E: 'wastagePercent', F: 'markupPercent' };
  const cellMap = {};

  for (const item of stage.items) {
    const r = item.rowIndex + 1;  // 1-indexed
    cellMap[`A${r}`] = item.quantity;
    cellMap[`B${r}`] = item.unitRate;
    cellMap[`C${r}`] = item.labourRate;
    cellMap[`D${r}`] = item.labourHours;
    cellMap[`E${r}`] = item.wastagePercent;
    cellMap[`F${r}`] = item.markupPercent;
  }

  const updates = [];
  for (const item of stage.items) {
    let needsUpdate = false;
    const patch = {};

    if (item.formulaQty && item.formulaQty.startsWith('=')) {
      const r = engine.evaluate(item.formulaQty, cellMap);
      if (typeof r === 'number' && r !== item.quantity) {
        patch.quantity = r;
        needsUpdate    = true;
      }
    }
    if (item.formulaRate && item.formulaRate.startsWith('=')) {
      const r = engine.evaluate(item.formulaRate, cellMap);
      if (typeof r === 'number' && r !== item.unitRate) {
        patch.unitRate = r;
        needsUpdate    = true;
      }
    }

    if (needsUpdate) {
      const merged  = { ...item, ...patch };
      const derived = computeBOQRow(merged);
      updates.push(prisma.bOQItem.update({
        where: { id: item.id },
        data:  { ...patch, ...derived },
      }));
    }
  }

  if (updates.length > 0) await prisma.$transaction(updates);
  return updates.length;
}

/**
 * Recalculate stage totals and persist on BOQStage.
 */
async function recalcStageTotals(stageId, companyId) {
  const agg = await prisma.bOQItem.aggregate({
    where: { stageId, companyId },
    _sum:  { materialCost: true, labourCost: true, subtotal: true, totalCost: true, quantity: true },
  });

  return prisma.bOQStage.update({
    where: { id: stageId },
    data:  {
      totalMaterial: agg._sum.materialCost || 0,
      totalLabour:   agg._sum.labourCost   || 0,
      totalCost:     agg._sum.totalCost    || 0,
    },
  });
}

/**
 * Full version recalc: re-evaluate all formula cells then update stage/version totals.
 */
async function recalcVersion(versionId, companyId) {
  const stages = await prisma.bOQStage.findMany({ where: { versionId, companyId } });

  for (const stage of stages) {
    await recalcStage(stage.id, companyId);
    await recalcStageTotals(stage.id, companyId);
  }

  // Update version-level summary
  const stageTotals = await prisma.bOQStage.aggregate({
    where: { versionId, companyId },
    _sum:  { totalMaterial: true, totalLabour: true, totalCost: true },
  });

  return prisma.bOQVersion.update({
    where: { id: versionId },
    data:  {
      totalAmount: stageTotals._sum.totalCost || 0,
      calculatedAt: new Date(),
    },
  });
}

// ─── Excel Import/Export ──────────────────────────────────────────────────────

/**
 * Import BOQ from XLSX buffer.
 * Expected sheet format:
 *   Row 1: headers (Code | Description | Unit | Qty | Wastage% | Rate | Labour Rate | Labour Hours | Markup%)
 *   Row 2+: data rows
 *   Blank row = stage separator (the row before blank is the stage name)
 */
async function importFromExcel(versionId, companyId, xlsxBuffer) {
  let XLSX;
  try { XLSX = require('xlsx'); }
  catch { throw new Error('xlsx package not installed — run: npm install xlsx'); }

  const workbook  = XLSX.read(xlsxBuffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet     = workbook.Sheets[sheetName];
  const rows      = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  const HEADER_MAP = {
    'code':         'code',
    'item':         'code',
    'description':  'description',
    'item description': 'description',
    'unit':         'unit',
    'qty':          'quantity',
    'quantity':     'quantity',
    'wastage':      'wastagePercent',
    'wastage%':     'wastagePercent',
    'rate':         'unitRate',
    'unit rate':    'unitRate',
    'labour rate':  'labourRate',
    'labour hours': 'labourHours',
    'markup':       'markupPercent',
    'markup%':      'markupPercent',
  };

  // Find header row
  let headerRow = 0;
  let headerMap = {};
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const row = rows[i];
    const mapped = {};
    row.forEach((cell, colIdx) => {
      const key = String(cell).toLowerCase().trim();
      if (HEADER_MAP[key]) mapped[HEADER_MAP[key]] = colIdx;
    });
    if (Object.keys(mapped).length >= 3) {
      headerRow = i;
      headerMap = mapped;
      break;
    }
  }

  // Parse rows into stages and items
  const stages = [];
  let currentStage = { name: 'General', items: [] };

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i];
    const isEmpty = row.every(c => c === '' || c == null);

    if (isEmpty) {
      if (currentStage.items.length > 0) stages.push(currentStage);
      // Next non-empty row might be a stage header
      const nextRow = rows[i + 1];
      if (nextRow && nextRow.length > 0 && nextRow[0] !== '' && !nextRow[headerMap.quantity ?? 3]) {
        currentStage = { name: String(nextRow[0]).trim(), items: [] };
        i++;  // skip the stage header row
      } else {
        currentStage = { name: `Stage ${stages.length + 2}`, items: [] };
      }
      continue;
    }

    const item = {
      code:          String(row[headerMap.code          ?? 0] ?? '').trim(),
      description:   String(row[headerMap.description   ?? 1] ?? '').trim(),
      unit:          String(row[headerMap.unit           ?? 2] ?? 'm²').trim(),
      quantity:      parseFloat(row[headerMap.quantity   ?? 3]) || 0,
      wastagePercent:parseFloat(row[headerMap.wastagePercent ?? 4]) || 0,
      unitRate:      parseFloat(row[headerMap.unitRate   ?? 5]) || 0,
      labourRate:    parseFloat(row[headerMap.labourRate ?? 6]) || 0,
      labourHours:   parseFloat(row[headerMap.labourHours?? 7]) || 0,
      markupPercent: parseFloat(row[headerMap.markupPercent?? 8]) || 0,
    };

    if (item.description || item.code) currentStage.items.push(item);
  }
  if (currentStage.items.length > 0) stages.push(currentStage);

  // Persist to DB
  return prisma.$transaction(async (tx) => {
    for (let s = 0; s < stages.length; s++) {
      const stageData = stages[s];
      const stage = await tx.bOQStage.create({
        data: { versionId, companyId, name: stageData.name, position: s },
      });

      for (let r = 0; r < stageData.items.length; r++) {
        const item    = stageData.items[r];
        const derived = computeBOQRow(item);
        await tx.bOQItem.create({
          data: {
            stageId:    stage.id,
            companyId,
            rowIndex:   r,
            ...item,
            ...derived,
            status:     BOQItemStatus.DRAFT,
          },
        });
      }
    }

    // Update version totals
    const allItems = await tx.bOQItem.findMany({ where: { stage: { versionId }, companyId } });
    const total    = allItems.reduce((sum, i) => sum + i.totalCost, 0);
    return tx.bOQVersion.update({ where: { id: versionId }, data: { totalAmount: total } });
  });
}

/**
 * Export BOQ version to XLSX buffer.
 */
async function exportToExcel(versionId, companyId) {
  let XLSX;
  try { XLSX = require('xlsx'); }
  catch { throw new Error('xlsx package not installed — run: npm install xlsx'); }

  const version = await getBOQVersion(versionId, companyId);

  const wb = XLSX.utils.book_new();

  // Summary sheet
  const summaryRows = [
    ['BILL OF QUANTITIES', '', '', '', '', '', '', '', '', ''],
    [`Project: ${version.name}`, '', '', '', '', '', '', '', '', ''],
    [`Status: ${version.status}`, '', '', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', ''],
    ['Stage', 'Material Cost', 'Labour Cost', 'Subtotal', 'Total Cost'],
    ...version.stages.map(s => [
      s.name,
      s.totalMaterial || 0,
      s.totalLabour   || 0,
      (s.totalMaterial || 0) + (s.totalLabour || 0),
      s.totalCost     || 0,
    ]),
    ['', '', '', '', ''],
    ['GRAND TOTAL', '', '', '', version.totalAmount || 0],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');

  // Detailed BOQ sheet
  const detailRows = [
    ['Code', 'Description', 'Unit', 'Qty', 'Wastage%', 'Net Qty', 'Rate (UGX)', 'Labour Rate', 'Labour Hrs',
     'Material Cost', 'Labour Cost', 'Subtotal', 'Markup%', 'Total Cost'],
  ];

  for (const stage of version.stages) {
    // Stage header row
    detailRows.push([stage.name.toUpperCase(), '', '', '', '', '', '', '', '', '', '', '', '', '']);

    for (const item of stage.items) {
      detailRows.push([
        item.code          || '',
        item.description   || '',
        item.unit          || '',
        item.quantity,
        item.wastagePercent,
        item.netQuantity,
        item.unitRate,
        item.labourRate,
        item.labourHours,
        item.materialCost,
        item.labourCost,
        item.subtotal,
        item.markupPercent,
        item.totalCost,
      ]);
    }

    // Stage total row
    detailRows.push(['', `STAGE TOTAL: ${stage.name}`, '', '', '', '', '', '', '', '', '', '', '', stage.totalCost || 0]);
    detailRows.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  }

  detailRows.push(['', '', '', '', '', '', '', '', '', '', '', '', 'GRAND TOTAL', version.totalAmount || 0]);

  const detailSheet = XLSX.utils.aoa_to_sheet(detailRows);

  // Column widths
  detailSheet['!cols'] = [
    { wch: 10 }, { wch: 45 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
    { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 16 },
  ];

  XLSX.utils.book_append_sheet(wb, detailSheet, 'BOQ Detail');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// ─── Analytics ────────────────────────────────────────────────────────────────

async function getBOQSummary(versionId, companyId) {
  const version = await getBOQVersion(versionId, companyId);

  const stageBreakdown = version.stages.map(s => ({
    stageId:      s.id,
    stageName:    s.name,
    itemCount:    s.items.length,
    totalMaterial:s.totalMaterial || 0,
    totalLabour:  s.totalLabour   || 0,
    totalCost:    s.totalCost     || 0,
    pct:          version.totalAmount > 0
      ? Math.round((s.totalCost / version.totalAmount) * 10000) / 100
      : 0,
  }));

  const grandTotal      = stageBreakdown.reduce((s, st) => s + st.totalCost, 0);
  const totalMaterial   = stageBreakdown.reduce((s, st) => s + st.totalMaterial, 0);
  const totalLabour     = stageBreakdown.reduce((s, st) => s + st.totalLabour, 0);
  const labourToMaterial= totalMaterial > 0 ? Math.round((totalLabour / totalMaterial) * 100) : 0;

  return {
    versionId:      version.id,
    versionNo:  version.versionNo,
    name:           version.name,
    status:         version.status,
    totalAmount:    grandTotal,
    totalMaterial,
    totalLabour,
    labourToMaterial:`${labourToMaterial}%`,
    stageBreakdown,
    calculatedAt:   version.calculatedAt,
  };
}

async function compareBOQVersions(versionId1, versionId2, companyId) {
  const [v1, v2] = await Promise.all([
    getBOQVersion(versionId1, companyId),
    getBOQVersion(versionId2, companyId),
  ]);

  const getStageMap = (v) => new Map(v.stages.map(s => [s.name, s]));
  const s1Map = getStageMap(v1);
  const s2Map = getStageMap(v2);

  const allStageNames = new Set([...s1Map.keys(), ...s2Map.keys()]);
  const diff = [];

  for (const name of allStageNames) {
    const s1 = s1Map.get(name);
    const s2 = s2Map.get(name);
    diff.push({
      stageName:   name,
      v1Total:     s1?.totalCost || 0,
      v2Total:     s2?.totalCost || 0,
      delta:       (s2?.totalCost || 0) - (s1?.totalCost || 0),
      deltaPercent:s1?.totalCost
        ? Math.round(((s2?.totalCost || 0) - s1.totalCost) / s1.totalCost * 10000) / 100
        : null,
    });
  }

  return {
    v1: { id: v1.id, name: v1.name, total: v1.totalAmount || 0 },
    v2: { id: v2.id, name: v2.name, total: v2.totalAmount || 0 },
    totalDelta: (v2.totalAmount || 0) - (v1.totalAmount || 0),
    stageDiff:  diff,
  };
}

module.exports = {
  // Version
  createBOQVersion,
  getBOQVersions,
  getBOQVersion,
  cloneBOQVersion,
  submitBOQForApproval,
  approveBOQVersion,
  rejectBOQVersion,
  // Stage
  createStage,
  updateStage,
  deleteStage,
  reorderStages,
  // Item
  createItem,
  updateItem,
  deleteItem,
  reorderItems,
  bulkUpdateItems,
  // Recalc
  recalcStage,
  recalcStageTotals,
  recalcVersion,
  // Excel
  importFromExcel,
  exportToExcel,
  // Analytics
  getBOQSummary,
  compareBOQVersions,
};
