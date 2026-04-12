/**
 * boq.js — BOQ REST API routes
 *
 * Base path: /api/qs/boq
 *
 * All routes require auth (JWT) + QS/Admin role.
 * companyId is always pulled from req.user.companyId for multi-tenant isolation.
 */

'use strict';

const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const multer  = require('multer');

const BOQService  = require('../services/BOQService');
const CostEngine  = require('../services/CostEngine');
const { requireAuth, requireRole } = require('../../../../packages/shared/middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const QS_ROLES    = ['QUANTITY_SURVEYOR', 'ADMIN', 'OWNER'];
const MANAGE_ROLES= ['QUANTITY_SURVEYOR', 'ADMIN', 'OWNER'];

// ─── Middleware ───────────────────────────────────────────────────────────────

router.use(requireAuth);

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
}

// ─── BOQ Versions ─────────────────────────────────────────────────────────────

// GET /api/qs/boq/versions?projectId=xxx
router.get('/versions', [
  query('projectId').notEmpty().withMessage('projectId required'),
], validate, requireRole(QS_ROLES), async (req, res) => {
  try {
    const versions = await BOQService.getBOQVersions(req.query.projectId, req.user.companyId);
    res.json({ versions });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/qs/boq/versions
router.post('/versions', requireRole(MANAGE_ROLES), [
  body('projectId').notEmpty(),
  body('name').optional().isString(),
], validate, async (req, res) => {
  try {
    const version = await BOQService.createBOQVersion(req.body.projectId, req.user.companyId, { ...req.body, createdById: req.user.id });
    res.status(201).json({ version });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/qs/boq/versions/:versionId
router.get('/versions/:versionId', async (req, res) => {
  try {
    const version = await BOQService.getBOQVersion(req.params.versionId, req.user.companyId);
    res.json({ version });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// POST /api/qs/boq/versions/:versionId/clone
router.post('/versions/:versionId/clone', requireRole(MANAGE_ROLES), async (req, res) => {
  try {
    const version = await BOQService.cloneBOQVersion(req.params.versionId, req.user.companyId, { ...req.body, createdById: req.user.id });
    res.status(201).json({ version });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/qs/boq/versions/:versionId/submit
router.post('/versions/:versionId/submit', requireRole(MANAGE_ROLES), async (req, res) => {
  try {
    const version = await BOQService.submitBOQForApproval(req.params.versionId, req.user.companyId, req.user.id);
    res.json({ version });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/qs/boq/versions/:versionId/approve
router.post('/versions/:versionId/approve', requireRole(['ADMIN', 'OWNER', 'PROJECT_MANAGER']), async (req, res) => {
  try {
    const version = await BOQService.approveBOQVersion(req.params.versionId, req.user.companyId, req.user.id);
    res.json({ version });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/qs/boq/versions/:versionId/reject
router.post('/versions/:versionId/reject', requireRole(['ADMIN', 'OWNER', 'PROJECT_MANAGER']), [
  body('reason').notEmpty().withMessage('Rejection reason required'),
], validate, async (req, res) => {
  try {
    const version = await BOQService.rejectBOQVersion(req.params.versionId, req.user.companyId, req.user.id, req.body.reason);
    res.json({ version });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/qs/boq/versions/:versionId/summary
router.get('/versions/:versionId/summary', async (req, res) => {
  try {
    const summary = await BOQService.getBOQSummary(req.params.versionId, req.user.companyId);
    res.json({ summary });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/qs/boq/versions/:versionId/recalc
router.post('/versions/:versionId/recalc', requireRole(MANAGE_ROLES), async (req, res) => {
  try {
    const result = await BOQService.recalcVersion(req.params.versionId, req.user.companyId);
    res.json({ message: 'Recalculated', version: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/qs/boq/compare?v1=xxx&v2=yyy
router.get('/compare', [
  query('v1').notEmpty(),
  query('v2').notEmpty(),
], validate, async (req, res) => {
  try {
    const diff = await BOQService.compareBOQVersions(req.query.v1, req.query.v2, req.user.companyId);
    res.json({ diff });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Excel Import/Export ──────────────────────────────────────────────────────

// POST /api/qs/boq/versions/:versionId/import
router.post('/versions/:versionId/import',
  requireRole(MANAGE_ROLES),
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      if (!req.file.originalname.match(/\.(xlsx|xls)$/i)) {
        return res.status(400).json({ error: 'Only .xlsx/.xls files accepted' });
      }
      const result = await BOQService.importFromExcel(req.params.versionId, req.user.companyId, req.file.buffer);
      res.json({ message: 'Imported successfully', result });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// GET /api/qs/boq/versions/:versionId/export
router.get('/versions/:versionId/export', async (req, res) => {
  try {
    const buffer = await BOQService.exportToExcel(req.params.versionId, req.user.companyId);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="BOQ_${req.params.versionId}.xlsx"`);
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Stages ───────────────────────────────────────────────────────────────────

// POST /api/qs/boq/stages
router.post('/stages', requireRole(MANAGE_ROLES), [
  body('versionId').notEmpty(),
  body('name').notEmpty().withMessage('Stage name required'),
], validate, async (req, res) => {
  try {
    const stage = await BOQService.createStage(req.body.versionId, req.user.companyId, req.body);
    res.status(201).json({ stage });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/qs/boq/stages/:stageId
router.patch('/stages/:stageId', requireRole(MANAGE_ROLES), async (req, res) => {
  try {
    const stage = await BOQService.updateStage(req.params.stageId, req.user.companyId, req.body);
    res.json({ stage });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/qs/boq/stages/:stageId
router.delete('/stages/:stageId', requireRole(MANAGE_ROLES), async (req, res) => {
  try {
    await BOQService.deleteStage(req.params.stageId, req.user.companyId);
    res.json({ message: 'Stage deleted' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/qs/boq/stages/reorder
router.post('/stages/reorder', requireRole(MANAGE_ROLES), [
  body('versionId').notEmpty(),
  body('orderedIds').isArray(),
], validate, async (req, res) => {
  try {
    await BOQService.reorderStages(req.body.versionId, req.user.companyId, req.body.orderedIds);
    res.json({ message: 'Reordered' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/qs/boq/stages/:stageId/recalc
router.post('/stages/:stageId/recalc', requireRole(MANAGE_ROLES), async (req, res) => {
  try {
    const n = await BOQService.recalcStage(req.params.stageId, req.user.companyId);
    await BOQService.recalcStageTotals(req.params.stageId, req.user.companyId);
    res.json({ message: `Recalculated ${n} formula cells` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Items ────────────────────────────────────────────────────────────────────

// POST /api/qs/boq/items
router.post('/items', requireRole(MANAGE_ROLES), [
  body('stageId').notEmpty(),
  body('description').notEmpty().withMessage('Description required'),
  body('unit').notEmpty().withMessage('Unit required'),
], validate, async (req, res) => {
  try {
    const item = await BOQService.createItem(req.body.stageId, req.user.companyId, req.body);
    res.status(201).json({ item });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/qs/boq/items/:itemId
router.patch('/items/:itemId', requireRole(MANAGE_ROLES), async (req, res) => {
  try {
    const item = await BOQService.updateItem(req.params.itemId, req.user.companyId, req.body);
    res.json({ item });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/qs/boq/items/:itemId
router.delete('/items/:itemId', requireRole(MANAGE_ROLES), async (req, res) => {
  try {
    await BOQService.deleteItem(req.params.itemId, req.user.companyId);
    res.json({ message: 'Item deleted' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/qs/boq/items/reorder
router.post('/items/reorder', requireRole(MANAGE_ROLES), [
  body('stageId').notEmpty(),
  body('orderedIds').isArray(),
], validate, async (req, res) => {
  try {
    await BOQService.reorderItems(req.body.stageId, req.user.companyId, req.body.orderedIds);
    res.json({ message: 'Reordered' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/qs/boq/items/bulk
router.patch('/items/bulk', requireRole(MANAGE_ROLES), [
  body('updates').isArray().withMessage('updates must be an array'),
], validate, async (req, res) => {
  try {
    const items = await BOQService.bulkUpdateItems(req.user.companyId, req.body.updates);
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Cost Library ─────────────────────────────────────────────────────────────

// GET /api/qs/boq/library?q=concrete&category=Substructure
router.get('/library', async (req, res) => {
  try {
    const result = await CostEngine.searchLibrary(req.user.companyId, {
      q:        req.query.q,
      category: req.query.category,
      unit:     req.query.unit,
      page:     parseInt(req.query.page)  || 1,
      limit:    parseInt(req.query.limit) || 50,
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/qs/boq/library/categories
router.get('/library/categories', async (req, res) => {
  try {
    const categories = await CostEngine.getLibraryCategories(req.user.companyId);
    res.json({ categories });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/qs/boq/library
router.post('/library', requireRole(MANAGE_ROLES), [
  body('description').notEmpty(),
  body('unit').notEmpty(),
  body('baseRate').isNumeric(),
], validate, async (req, res) => {
  try {
    const item = await CostEngine.createLibraryItem(req.user.companyId, req.body);
    res.status(201).json({ item });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/qs/boq/library/:itemId
router.patch('/library/:itemId', requireRole(MANAGE_ROLES), async (req, res) => {
  try {
    const item = await CostEngine.updateLibraryItem(req.params.itemId, req.user.companyId, req.body);
    res.json({ item });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/qs/boq/library/:itemId
router.delete('/library/:itemId', requireRole(MANAGE_ROLES), async (req, res) => {
  try {
    await CostEngine.deleteLibraryItem(req.params.itemId, req.user.companyId);
    res.json({ message: 'Deleted' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/qs/boq/library/:itemId/rate?location=KAMPALA&quality=STANDARD
router.get('/library/:itemId/rate', async (req, res) => {
  try {
    const result = await CostEngine.getAdjustedRate(
      req.params.itemId, req.user.companyId,
      req.query.location || 'KAMPALA',
      req.query.quality  || 'STANDARD',
      req.query.asOfDate ? new Date(req.query.asOfDate) : new Date(),
    );
    res.json({ result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/qs/boq/items/:itemId/apply-library
router.post('/items/:itemId/apply-library', requireRole(MANAGE_ROLES), [
  body('libraryItemId').notEmpty(),
], validate, async (req, res) => {
  try {
    const item = await CostEngine.applyLibraryRateToBOQItem(
      req.params.itemId, req.user.companyId,
      req.body.libraryItemId,
      req.body.location || 'KAMPALA',
      req.body.quality  || 'STANDARD',
    );
    res.json({ item });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Material Rates ───────────────────────────────────────────────────────────

// GET /api/qs/boq/material-rates?location=KAMPALA
router.get('/material-rates', async (req, res) => {
  try {
    const rates = await CostEngine.getCurrentMaterialRates(req.user.companyId, { location: req.query.location });
    res.json({ rates });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/qs/boq/material-rates/:material/history
router.get('/material-rates/:material/history', async (req, res) => {
  try {
    const data = await CostEngine.getMaterialRateHistory(
      req.user.companyId,
      decodeURIComponent(req.params.material),
      { months: parseInt(req.query.months) || 12 },
    );
    res.json({ data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/qs/boq/material-rates
router.post('/material-rates', requireRole(MANAGE_ROLES), [
  body('material').notEmpty(),
  body('unit').notEmpty(),
  body('rate').isNumeric(),
], validate, async (req, res) => {
  try {
    const rate = await CostEngine.recordMaterialRate(req.user.companyId, req.body);
    res.status(201).json({ rate });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Cost estimation ──────────────────────────────────────────────────────────

// POST /api/qs/boq/estimate
router.post('/estimate', [
  body('floorArea').isNumeric().withMessage('floorArea required'),
], validate, async (req, res) => {
  try {
    const estimate = CostEngine.estimateFromFloorPlan(req.body);
    res.json({ estimate });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/qs/boq/variance?projectId=xxx&versionId=yyy
router.get('/variance', [
  query('projectId').notEmpty(),
  query('versionId').notEmpty(),
], validate, async (req, res) => {
  try {
    const variance = await CostEngine.varianceAnalysis(req.query.projectId, req.user.companyId, req.query.versionId);
    res.json({ variance });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
