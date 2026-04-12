/**
 * TakeoffService.js — Digital takeoff measurement service
 *
 * Features:
 *   - Create/manage TakeoffDocuments (PDF/image uploads)
 *   - Store polygon/polyline/point measurement annotations
 *   - Compute LINEAR, AREA, COUNT, VOLUME measurements from point arrays
 *   - Scale calibration: pixels → real-world units
 *   - Auto-link measurements to BOQ items
 *   - Generate takeoff summary report
 *   - Import measurements from CSV
 */

'use strict';

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// ─── Measurement computation ──────────────────────────────────────────────────

/**
 * Compute a measurement value from a point array + type + scale.
 *
 * @param {string} type   - 'LINEAR' | 'AREA' | 'COUNT' | 'VOLUME' | 'PERIMETER'
 * @param {Array}  points - [{ x, y }, ...] in pixel coordinates
 * @param {number} scale  - pixels per real-world unit (e.g. 50 px/m)
 * @param {number} depth  - for VOLUME measurements (m)
 * @returns {{ value: number, unit: string }}
 */
function computeMeasurement(type, points, scale, depth = 1) {
  if (!points || points.length === 0) return { value: 0, unit: getDefaultUnit(type) };

  switch (type.toUpperCase()) {
    case 'LINEAR': {
      // Sum of Euclidean distances between consecutive points
      let totalPx = 0;
      for (let i = 1; i < points.length; i++) {
        const dx = points[i].x - points[i - 1].x;
        const dy = points[i].y - points[i - 1].y;
        totalPx += Math.sqrt(dx * dx + dy * dy);
      }
      return { value: round3(totalPx / scale), unit: 'm' };
    }

    case 'PERIMETER': {
      // Closed polygon perimeter
      let totalPx = 0;
      for (let i = 0; i < points.length; i++) {
        const next = points[(i + 1) % points.length];
        const dx   = next.x - points[i].x;
        const dy   = next.y - points[i].y;
        totalPx += Math.sqrt(dx * dx + dy * dy);
      }
      return { value: round3(totalPx / scale), unit: 'm' };
    }

    case 'AREA': {
      // Shoelace formula for polygon area
      let area = 0;
      const n = points.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += points[i].x * points[j].y;
        area -= points[j].x * points[i].y;
      }
      const areaPx2 = Math.abs(area) / 2;
      const areaM2  = areaPx2 / (scale * scale);
      return { value: round3(areaM2), unit: 'm²' };
    }

    case 'VOLUME': {
      // Area × depth
      let area = 0;
      const n = points.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += points[i].x * points[j].y;
        area -= points[j].x * points[i].y;
      }
      const areaPx2 = Math.abs(area) / 2;
      const areaM2  = areaPx2 / (scale * scale);
      return { value: round3(areaM2 * depth), unit: 'm³' };
    }

    case 'COUNT': {
      return { value: points.length, unit: 'nr' };
    }

    default:
      return { value: 0, unit: getDefaultUnit(type) };
  }
}

function getDefaultUnit(type) {
  const map = { LINEAR: 'm', AREA: 'm²', VOLUME: 'm³', COUNT: 'nr', PERIMETER: 'm' };
  return map[type?.toUpperCase()] || 'nr';
}

function round3(v) { return Math.round(v * 1000) / 1000; }

// ─── Scale calibration ────────────────────────────────────────────────────────

/**
 * Compute pixels-per-metre scale from a reference line.
 *
 * @param {Object} p1          - { x, y } start of reference line in pixels
 * @param {Object} p2          - { x, y } end of reference line in pixels
 * @param {number} realLength  - real-world length of that line (metres)
 * @returns {number} scale (px/m)
 */
function calibrateScale(p1, p2, realLength) {
  const dx    = p2.x - p1.x;
  const dy    = p2.y - p1.y;
  const pxLen = Math.sqrt(dx * dx + dy * dy);
  if (realLength <= 0 || pxLen === 0) throw new Error('Invalid calibration data');
  return pxLen / realLength;
}

// ─── Takeoff Document CRUD ────────────────────────────────────────────────────

async function createDocument(projectId, companyId, { name, fileUrl, fileType = 'PDF', pages = 1, uploadedBy }) {
  return prisma.takeoffDocument.create({
    data: {
      projectId,
      companyId,
      name,
      fileUrl,
      fileType,
      pages,
      uploadedBy,
      scale: 100,    // default: 100 px/m (will be calibrated by user)
      status: 'ACTIVE',
    },
    include: { measurements: { orderBy: { createdAt: 'asc' } } },
  });
}

async function getDocuments(projectId, companyId) {
  return prisma.takeoffDocument.findMany({
    where:   { projectId, companyId, status: 'ACTIVE' },
    include: {
      measurements: { orderBy: { createdAt: 'asc' } },
      _count:        { select: { measurements: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

async function getDocument(documentId, companyId) {
  const doc = await prisma.takeoffDocument.findFirst({
    where:   { id: documentId, companyId },
    include: { measurements: { orderBy: { createdAt: 'asc' } } },
  });
  if (!doc) throw new Error('Takeoff document not found');
  return doc;
}

async function updateDocumentScale(documentId, companyId, { scale, calibrationP1, calibrationP2, realLength }) {
  let computedScale = scale;

  if (calibrationP1 && calibrationP2 && realLength) {
    computedScale = calibrateScale(calibrationP1, calibrationP2, realLength);
  }

  if (!computedScale || computedScale <= 0) throw new Error('Invalid scale');

  // Re-compute all measurements for this document with new scale
  const doc = await prisma.takeoffDocument.findFirst({
    where:   { id: documentId, companyId },
    include: { measurements: true },
  });

  await prisma.$transaction([
    prisma.takeoffDocument.update({
      where: { id: documentId },
      data:  { scale: computedScale, calibrationData: { calibrationP1, calibrationP2, realLength } },
    }),
    ...doc.measurements.map(m => {
      const { value } = computeMeasurement(m.type, m.points, computedScale, m.depth || 1);
      return prisma.takeoffMeasurement.update({ where: { id: m.id }, data: { value, scale: computedScale } });
    }),
  ]);

  return prisma.takeoffDocument.findFirst({
    where:   { id: documentId, companyId },
    include: { measurements: { orderBy: { createdAt: 'asc' } } },
  });
}

async function archiveDocument(documentId, companyId) {
  return prisma.takeoffDocument.update({
    where: { id: documentId, companyId },
    data:  { status: 'ARCHIVED' },
  });
}

// ─── Measurement CRUD ─────────────────────────────────────────────────────────

async function createMeasurement(documentId, companyId, data) {
  const doc = await prisma.takeoffDocument.findFirst({ where: { id: documentId, companyId } });
  if (!doc) throw new Error('Takeoff document not found');

  const scale  = data.scale || doc.scale || 100;
  const depth  = Number(data.depth) || 1;
  const points = data.points || [];

  const { value, unit } = computeMeasurement(data.type, points, scale, depth);

  return prisma.takeoffMeasurement.create({
    data: {
      documentId,
      companyId,
      page:           Number(data.page)   || 1,
      type:           data.type.toUpperCase(),
      label:          data.label          || '',
      points:         points,
      depth,
      value,
      unit:           data.unit           || unit,
      scale,
      color:          data.color          || '#EF4444',
      linkedItemId:   data.linkedItemId   || null,
      notes:          data.notes          || null,
    },
  });
}

async function updateMeasurement(measurementId, companyId, data) {
  const m   = await prisma.takeoffMeasurement.findFirst({ where: { id: measurementId, companyId } });
  if (!m) throw new Error('Measurement not found');

  const scale  = data.scale || m.scale;
  const depth  = data.depth != null ? Number(data.depth) : m.depth;
  const points = data.points || m.points;
  const type   = data.type  || m.type;

  const { value, unit } = computeMeasurement(type, points, scale, depth);

  return prisma.takeoffMeasurement.update({
    where: { id: measurementId },
    data:  {
      ...(data.label        !== undefined && { label:        data.label }),
      ...(data.color        !== undefined && { color:        data.color }),
      ...(data.notes        !== undefined && { notes:        data.notes }),
      ...(data.linkedItemId !== undefined && { linkedItemId: data.linkedItemId }),
      ...(data.page         !== undefined && { page:         Number(data.page) }),
      type,
      points,
      depth,
      scale,
      value,
      unit: data.unit || unit,
    },
  });
}

async function deleteMeasurement(measurementId, companyId) {
  return prisma.takeoffMeasurement.delete({ where: { id: measurementId, companyId } });
}

async function getMeasurements(documentId, companyId, { page, type } = {}) {
  return prisma.takeoffMeasurement.findMany({
    where: {
      documentId,
      companyId,
      ...(page && { page }),
      ...(type && { type: type.toUpperCase() }),
    },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Link a measurement to a BOQ item and optionally update the BOQ item's quantity.
 */
async function linkToBoqItem(measurementId, companyId, boqItemId, { autoUpdateQty = true } = {}) {
  const measurement = await prisma.takeoffMeasurement.findFirst({ where: { id: measurementId, companyId } });
  if (!measurement) throw new Error('Measurement not found');

  await prisma.takeoffMeasurement.update({ where: { id: measurementId }, data: { linkedItemId: boqItemId } });

  if (autoUpdateQty) {
    const { computeBOQRow } = require('./FormulaEngine');
    const boqItem = await prisma.bOQItem.findFirst({ where: { id: boqItemId, companyId } });
    if (boqItem) {
      const merged  = { ...boqItem, quantity: measurement.value };
      const derived = computeBOQRow(merged);
      await prisma.bOQItem.update({
        where: { id: boqItemId },
        data:  { quantity: measurement.value, takeoffRef: measurementId, ...derived },
      });
    }
  }

  return measurement;
}

// ─── Takeoff Summary ──────────────────────────────────────────────────────────

async function getTakeoffSummary(documentId, companyId) {
  const doc = await getDocument(documentId, companyId);

  const byType = {};
  for (const m of doc.measurements) {
    if (!byType[m.type]) byType[m.type] = { count: 0, totalValue: 0, unit: m.unit, items: [] };
    byType[m.type].count++;
    byType[m.type].totalValue = round3(byType[m.type].totalValue + m.value);
    byType[m.type].items.push({ id: m.id, label: m.label, value: m.value, unit: m.unit, linkedItemId: m.linkedItemId });
  }

  const linkedCount   = doc.measurements.filter(m => m.linkedItemId).length;
  const unlinkedCount = doc.measurements.length - linkedCount;

  return {
    documentId:    doc.id,
    documentName:  doc.name,
    pages:         doc.pages,
    scale:         doc.scale,
    totalMeasurements: doc.measurements.length,
    linkedCount,
    unlinkedCount,
    byType,
  };
}

/**
 * Generate CSV export of all measurements in a document.
 */
function exportMeasurements(measurements) {
  const header = ['ID', 'Label', 'Type', 'Page', 'Value', 'Unit', 'Scale', 'Linked BOQ Item', 'Notes'];
  const rows   = measurements.map(m => [
    m.id,
    m.label,
    m.type,
    m.page,
    m.value,
    m.unit,
    m.scale,
    m.linkedItemId || '',
    m.notes        || '',
  ]);

  return [header, ...rows].map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
}

/**
 * Import measurements from CSV.
 * Expected columns: Label, Type, Value, Unit, Page, Notes
 */
async function importFromCSV(documentId, companyId, csvText) {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) throw new Error('CSV has no data rows');

  const header = lines[0].split(',').map(h => h.replace(/"/g, '').trim().toLowerCase());
  const doc    = await prisma.takeoffDocument.findFirst({ where: { id: documentId, companyId } });
  if (!doc) throw new Error('Document not found');

  const created = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.replace(/^"|"$/g, '').trim());
    const row    = Object.fromEntries(header.map((h, idx) => [h, values[idx] || '']));

    if (!row.type || !row.value) continue;

    const value = parseFloat(row.value) || 0;
    const unit  = row.unit || getDefaultUnit(row.type);

    const m = await prisma.takeoffMeasurement.create({
      data: {
        documentId,
        companyId,
        page:   parseInt(row.page)  || 1,
        type:   row.type.toUpperCase(),
        label:  row.label           || '',
        points: [],   // no pixel points from CSV import
        value,
        unit,
        scale:  doc.scale,
        color:  '#3B82F6',
        notes:  row.notes           || null,
      },
    });
    created.push(m);
  }

  return { imported: created.length, measurements: created };
}

module.exports = {
  // Computation
  computeMeasurement,
  calibrateScale,
  // Documents
  createDocument,
  getDocuments,
  getDocument,
  updateDocumentScale,
  archiveDocument,
  // Measurements
  createMeasurement,
  updateMeasurement,
  deleteMeasurement,
  getMeasurements,
  linkToBoqItem,
  // Reports
  getTakeoffSummary,
  exportMeasurements,
  importFromCSV,
};
