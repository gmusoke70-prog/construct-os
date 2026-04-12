/**
 * takeoff.js — Digital takeoff REST API routes
 *
 * Base path: /api/qs/takeoff
 */

'use strict';

const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const multer  = require('multer');

const TakeoffService = require('../services/TakeoffService');
const { requireAuth, requireRole } = require('../../../../packages/shared/middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const QS_ROLES = ['QUANTITY_SURVEYOR', 'ADMIN', 'OWNER'];

router.use(requireAuth);

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
}

// ─── Documents ────────────────────────────────────────────────────────────────

// GET /api/qs/takeoff/documents?projectId=xxx
router.get('/documents', [
  query('projectId').notEmpty(),
], validate, async (req, res) => {
  try {
    const docs = await TakeoffService.getDocuments(req.query.projectId, req.user.companyId);
    res.json({ documents: docs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/qs/takeoff/documents
router.post('/documents', requireRole(QS_ROLES), [
  body('projectId').notEmpty(),
  body('name').notEmpty(),
  body('fileUrl').notEmpty(),
], validate, async (req, res) => {
  try {
    const doc = await TakeoffService.createDocument(
      req.body.projectId,
      req.user.companyId,
      { ...req.body, uploadedBy: req.user.id },
    );
    res.status(201).json({ document: doc });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/qs/takeoff/documents/:documentId
router.get('/documents/:documentId', async (req, res) => {
  try {
    const doc = await TakeoffService.getDocument(req.params.documentId, req.user.companyId);
    res.json({ document: doc });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// PATCH /api/qs/takeoff/documents/:documentId/scale
router.patch('/documents/:documentId/scale', requireRole(QS_ROLES), [
  body('scale').optional().isNumeric(),
], validate, async (req, res) => {
  try {
    const doc = await TakeoffService.updateDocumentScale(req.params.documentId, req.user.companyId, req.body);
    res.json({ document: doc });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/qs/takeoff/documents/:documentId
router.delete('/documents/:documentId', requireRole(QS_ROLES), async (req, res) => {
  try {
    await TakeoffService.archiveDocument(req.params.documentId, req.user.companyId);
    res.json({ message: 'Document archived' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/qs/takeoff/documents/:documentId/summary
router.get('/documents/:documentId/summary', async (req, res) => {
  try {
    const summary = await TakeoffService.getTakeoffSummary(req.params.documentId, req.user.companyId);
    res.json({ summary });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/qs/takeoff/documents/:documentId/export.csv
router.get('/documents/:documentId/export.csv', async (req, res) => {
  try {
    const measurements = await TakeoffService.getMeasurements(req.params.documentId, req.user.companyId);
    const csv          = TakeoffService.exportMeasurements(measurements);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="takeoff_${req.params.documentId}.csv"`);
    res.send(csv);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/qs/takeoff/documents/:documentId/import-csv
router.post('/documents/:documentId/import-csv',
  requireRole(QS_ROLES),
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const csvText = req.file.buffer.toString('utf-8');
      const result  = await TakeoffService.importFromCSV(req.params.documentId, req.user.companyId, csvText);
      res.json({ message: `Imported ${result.imported} measurements`, result });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// ─── Measurements ─────────────────────────────────────────────────────────────

// GET /api/qs/takeoff/documents/:documentId/measurements
router.get('/documents/:documentId/measurements', async (req, res) => {
  try {
    const measurements = await TakeoffService.getMeasurements(req.params.documentId, req.user.companyId, {
      page: req.query.page ? parseInt(req.query.page) : undefined,
      type: req.query.type,
    });
    res.json({ measurements });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/qs/takeoff/documents/:documentId/measurements
router.post('/documents/:documentId/measurements', requireRole(QS_ROLES), [
  body('type').isIn(['LINEAR', 'AREA', 'VOLUME', 'COUNT', 'PERIMETER']).withMessage('Invalid measurement type'),
  body('points').isArray(),
  body('label').optional().isString(),
], validate, async (req, res) => {
  try {
    const measurement = await TakeoffService.createMeasurement(
      req.params.documentId,
      req.user.companyId,
      req.body,
    );
    res.status(201).json({ measurement });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/qs/takeoff/measurements/:measurementId
router.patch('/measurements/:measurementId', requireRole(QS_ROLES), async (req, res) => {
  try {
    const measurement = await TakeoffService.updateMeasurement(
      req.params.measurementId,
      req.user.companyId,
      req.body,
    );
    res.json({ measurement });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/qs/takeoff/measurements/:measurementId
router.delete('/measurements/:measurementId', requireRole(QS_ROLES), async (req, res) => {
  try {
    await TakeoffService.deleteMeasurement(req.params.measurementId, req.user.companyId);
    res.json({ message: 'Measurement deleted' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/qs/takeoff/measurements/:measurementId/link
router.post('/measurements/:measurementId/link', requireRole(QS_ROLES), [
  body('boqItemId').notEmpty().withMessage('boqItemId required'),
], validate, async (req, res) => {
  try {
    const measurement = await TakeoffService.linkToBoqItem(
      req.params.measurementId,
      req.user.companyId,
      req.body.boqItemId,
      { autoUpdateQty: req.body.autoUpdateQty !== false },
    );
    res.json({ measurement });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Utility ──────────────────────────────────────────────────────────────────

// POST /api/qs/takeoff/compute — compute measurement without saving
router.post('/compute', [
  body('type').isIn(['LINEAR', 'AREA', 'VOLUME', 'COUNT', 'PERIMETER']),
  body('points').isArray(),
  body('scale').isNumeric(),
], validate, (req, res) => {
  try {
    const result = TakeoffService.computeMeasurement(
      req.body.type,
      req.body.points,
      Number(req.body.scale),
      Number(req.body.depth) || 1,
    );
    res.json({ result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/qs/takeoff/calibrate — compute scale from calibration line
router.post('/calibrate', [
  body('p1').isObject(),
  body('p2').isObject(),
  body('realLength').isNumeric(),
], validate, (req, res) => {
  try {
    const scale = TakeoffService.calibrateScale(req.body.p1, req.body.p2, Number(req.body.realLength));
    res.json({ scale });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
