/**
 * Procurement Portal Backend  (port 3008)
 *
 * Routes:
 *   GET  /api/procurement/suppliers              - list suppliers
 *   POST /api/procurement/suppliers              - create supplier
 *   PATCH /api/procurement/suppliers/:id         - update supplier
 *   GET  /api/procurement/purchase-orders        - list POs
 *   POST /api/procurement/purchase-orders        - create PO
 *   GET  /api/procurement/purchase-orders/:id    - PO detail
 *   PATCH /api/procurement/purchase-orders/:id   - update PO
 *   POST /api/procurement/purchase-orders/:id/approve
 *   POST /api/procurement/purchase-orders/:id/reject
 *   GET  /api/procurement/inventory              - inventory items
 *   PATCH /api/procurement/inventory/:id         - update stock
 *   GET  /api/procurement/quotations             - quotations
 *   POST /api/procurement/quotations             - request quotation
 */

'use strict';

const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../../../packages/shared/middleware/auth');

const prisma = new PrismaClient();
const app    = express();
const PORT   = process.env.PROCUREMENT_PORT || 3008;

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json());
app.use(requireAuth);

const PROC_ROLES = ['PROCUREMENT_OFFICER', 'ADMIN', 'OWNER', 'PROJECT_MANAGER'];

app.get('/health', (_, res) => res.json({ service: 'procurement-portal', status: 'ok' }));

// ─── Suppliers ────────────────────────────────────────────────────────────────
app.get('/api/procurement/suppliers', async (req, res) => {
  try {
    const { q, category } = req.query;
    const suppliers = await prisma.supplier.findMany({
      where: {
        companyId: req.user.companyId,
        ...(category && { category }),
        ...(q && { OR: [
          { name:  { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ] }),
      },
      include: { _count: { select: { purchaseOrders: true } } },
      orderBy: { name: 'asc' },
    });
    res.json({ suppliers });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/procurement/suppliers', requireRole(PROC_ROLES), async (req, res) => {
  try {
    const supplier = await prisma.supplier.create({
      data: {
        companyId:   req.user.companyId,
        name:        req.body.name,
        contactName: req.body.contactName || null,
        email:       req.body.email       || null,
        phone:       req.body.phone       || null,
        address:     req.body.address     || null,
        category:    req.body.category    || 'GENERAL',
        taxId:       req.body.taxId       || null,
        rating:      Number(req.body.rating) || null,
        isApproved:  false,
        notes:       req.body.notes       || null,
      },
    });
    res.status(201).json({ supplier });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/procurement/suppliers/:id', requireRole(PROC_ROLES), async (req, res) => {
  try {
    const supplier = await prisma.supplier.update({
      where: { id: req.params.id, companyId: req.user.companyId },
      data:  { ...req.body, updatedAt: new Date() },
    });
    res.json({ supplier });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Purchase Orders ──────────────────────────────────────────────────────────
app.get('/api/procurement/purchase-orders', async (req, res) => {
  try {
    const pos = await prisma.purchaseOrder.findMany({
      where: {
        companyId: req.user.companyId,
        ...(req.query.projectId  && { projectId:  req.query.projectId }),
        ...(req.query.supplierId && { supplierId: req.query.supplierId }),
        ...(req.query.status     && { status:     req.query.status }),
      },
      include: {
        supplier: { select: { id: true, name: true, email: true } },
        items:    true,
        _count:   { select: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ pos });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/procurement/purchase-orders', requireRole(PROC_ROLES), async (req, res) => {
  try {
    const { projectId, supplierId, deliveryDate, notes, items = [] } = req.body;

    const totalAmount = items.reduce((s, i) => s + (Number(i.quantity) * Number(i.unitPrice)), 0);
    const count = await prisma.purchaseOrder.count({ where: { companyId: req.user.companyId } });
    const poNumber = `PO-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;

    const po = await prisma.purchaseOrder.create({
      data: {
        companyId:    req.user.companyId,
        projectId:    projectId    || null,
        supplierId,
        poNumber,
        status:       'DRAFT',
        totalAmount,
        deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
        notes:        notes        || null,
        items: {
          create: items.map((item) => ({
            description: item.description,
            unit:        item.unit         || 'nr',
            quantity:    Number(item.quantity)  || 0,
            unitPrice:   Number(item.unitPrice) || 0,
            total:       Number(item.quantity)  * Number(item.unitPrice),
          })),
        },
      },
      include: { supplier: true, items: true },
    });
    res.status(201).json({ po });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/procurement/purchase-orders/:id', async (req, res) => {
  try {
    const po = await prisma.purchaseOrder.findFirst({
      where:   { id: req.params.id, companyId: req.user.companyId },
      include: { supplier: true, items: true },
    });
    if (!po) return res.status(404).json({ error: 'PO not found' });
    res.json({ po });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/procurement/purchase-orders/:id', requireRole(PROC_ROLES), async (req, res) => {
  try {
    const po = await prisma.purchaseOrder.update({
      where: { id: req.params.id, companyId: req.user.companyId },
      data:  { ...req.body, updatedAt: new Date() },
      include: { supplier: true, items: true },
    });
    res.json({ po });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/procurement/purchase-orders/:id/approve', requireRole(['ADMIN', 'OWNER', 'PROJECT_MANAGER']), async (req, res) => {
  try {
    const po = await prisma.purchaseOrder.update({
      where: { id: req.params.id, companyId: req.user.companyId },
      data:  { status: 'APPROVED', approvedBy: req.user.id, approvedAt: new Date() },
    });
    res.json({ po });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/procurement/purchase-orders/:id/reject', requireRole(['ADMIN', 'OWNER', 'PROJECT_MANAGER']), async (req, res) => {
  try {
    const po = await prisma.purchaseOrder.update({
      where: { id: req.params.id, companyId: req.user.companyId },
      data:  { status: 'REJECTED', rejectionReason: req.body.reason || null },
    });
    res.json({ po });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Inventory ────────────────────────────────────────────────────────────────
app.get('/api/procurement/inventory', async (req, res) => {
  try {
    const items = await prisma.inventoryItem.findMany({
      where:   { companyId: req.user.companyId, ...(req.query.projectId && { projectId: req.query.projectId }) },
      orderBy: { material: 'asc' },
    });
    // Flag low stock
    const enriched = items.map(i => ({
      ...i,
      lowStock: i.reorderLevel != null && i.currentQty <= i.reorderLevel,
    }));
    res.json({ items: enriched });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/procurement/inventory/:id', requireRole(PROC_ROLES), async (req, res) => {
  try {
    const item = await prisma.inventoryItem.update({
      where: { id: req.params.id, companyId: req.user.companyId },
      data:  { ...req.body, updatedAt: new Date() },
    });
    res.json({ item });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Quotations ───────────────────────────────────────────────────────────────
app.get('/api/procurement/quotations', async (req, res) => {
  try {
    const quotations = await prisma.quotation.findMany({
      where:   { companyId: req.user.companyId, ...(req.query.projectId && { projectId: req.query.projectId }) },
      include: { supplier: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ quotations });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/procurement/quotations', requireRole(PROC_ROLES), async (req, res) => {
  try {
    const quotation = await prisma.quotation.create({
      data: {
        companyId:   req.user.companyId,
        projectId:   req.body.projectId || null,
        supplierId:  req.body.supplierId,
        description: req.body.description,
        amount:      Number(req.body.amount) || 0,
        validUntil:  req.body.validUntil ? new Date(req.body.validUntil) : null,
        status:      'PENDING',
        requestedBy: req.user.id,
        fileUrl:     req.body.fileUrl || null,
      },
    });
    res.status(201).json({ quotation });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Dashboard summary ────────────────────────────────────────────────────────
app.get('/api/procurement/dashboard', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const [pos, inventory, suppliers] = await Promise.all([
      prisma.purchaseOrder.findMany({ where: { companyId }, select: { status: true, totalAmount: true } }),
      prisma.inventoryItem.findMany({ where: { companyId }, select: { currentQty: true, reorderLevel: true, unitCost: true } }),
      prisma.supplier.count({ where: { companyId } }),
    ]);

    res.json({
      totalPOs:        pos.length,
      pendingApproval: pos.filter(p => p.status === 'PENDING_APPROVAL').length,
      totalSpend:      pos.filter(p => ['APPROVED','RECEIVED'].includes(p.status)).reduce((s, p) => s + (p.totalAmount||0), 0),
      lowStockItems:   inventory.filter(i => i.reorderLevel != null && i.currentQty <= i.reorderLevel).length,
      inventoryValue:  inventory.reduce((s, i) => s + (i.currentQty||0) * (i.unitCost||0), 0),
      supplierCount:   suppliers,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const copilotRouter = require('../../../packages/shared/routes/copilot');
app.use('/api/copilot', copilotRouter);

app.listen(PORT, () => console.log(`Procurement Portal listening on port ${PORT}`));
module.exports = app;
