/**
 * Architect Portal Backend  (port 3006)
 *
 * Routes:
 *   GET  /api/architect/floor-plans               - list floor plans
 *   POST /api/architect/floor-plans/generate      - AI floor plan generation
 *   GET  /api/architect/floor-plans/:id           - single plan
 *   PATCH /api/architect/floor-plans/:id          - update plan
 *   DELETE /api/architect/floor-plans/:id         - delete
 *   POST /api/architect/floor-plans/:id/export    - export SVG/PNG
 *   GET  /api/architect/design-files              - list design files
 *   POST /api/architect/design-files              - upload design file record
 *   DELETE /api/architect/design-files/:id        - delete
 */

'use strict';

const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../../../packages/shared/middleware/auth');

const prisma = new PrismaClient();
const app    = express();
const PORT   = process.env.ARCHITECT_PORT || 3006;

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json({ limit: '5mb' }));
app.use(requireAuth);

const ARCH_ROLES = ['ARCHITECT', 'ADMIN', 'OWNER'];

app.get('/health', (_, res) => res.json({ service: 'architect-portal', status: 'ok' }));

// ─── Floor Plans ──────────────────────────────────────────────────────────────
app.get('/api/architect/floor-plans', async (req, res) => {
  try {
    const plans = await prisma.floorPlan.findMany({
      where:   { companyId: req.user.companyId, ...(req.query.projectId && { projectId: req.query.projectId }) },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ plans });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/architect/floor-plans/generate', requireRole(ARCH_ROLES), async (req, res) => {
  try {
    const { projectId, landWidth, landLength, budget, floors, rooms, style, preferences } = req.body;
    if (!landWidth || !landLength) return res.status(400).json({ error: 'landWidth and landLength required' });

    // Call AI floor plan generator (same module as omni-construct-os)
    // For construct-os, we inline a simplified version
    const buildWidth  = landWidth  - 3;   // setback 1.5m each side
    const buildLength = landLength - 5;   // front 3m, rear 2m
    const buildArea   = buildWidth * buildLength * (floors || 1);

    // Generate basic room layout
    const generatedRooms = generateBasicLayout(buildWidth, buildLength, floors || 1, rooms || {});
    const svgData        = generateSVG(generatedRooms, buildWidth, buildLength);

    const plan = await prisma.floorPlan.create({
      data: {
        projectId:   projectId || null,
        companyId:   req.user.companyId,
        name:        `Auto-Generated ${new Date().toLocaleDateString()}`,
        type:        'GENERATED',
        landWidth,
        landLength,
        buildArea,
        floors:      floors || 1,
        style:       style  || 'CONTEMPORARY',
        jsonData:    { rooms: generatedRooms, preferences },
        svgData,
        generatedAt: new Date(),
        generatedBy: req.user.id,
      },
    });
    res.status(201).json({ plan });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

function generateBasicLayout(w, l, floors, reqRooms) {
  const rooms = [];
  const gridW = w / 2, gridH = l / 3;

  // Zone 1: Living + Dining (front public zone)
  rooms.push({ id: 'living',  name: 'Living Room',  x: 0,     y: 0,         w: gridW * 1.2, h: gridH,     fill: '#EFF6FF' });
  rooms.push({ id: 'dining',  name: 'Dining Room',  x: gridW * 1.2, y: 0,   w: gridW * 0.8, h: gridH,     fill: '#F0FDF4' });
  // Zone 2: Kitchen + Utility
  rooms.push({ id: 'kitchen', name: 'Kitchen',      x: 0,     y: gridH,     w: gridW,       h: gridH,     fill: '#FFF7ED' });
  rooms.push({ id: 'wc',      name: 'WC',           x: gridW, y: gridH,     w: gridW * 0.5, h: gridH * 0.6, fill: '#FAF5FF' });
  // Zone 3: Bedrooms (private)
  const bedrooms = reqRooms.bedrooms || 3;
  const bw = w / bedrooms;
  for (let i = 0; i < bedrooms; i++) {
    rooms.push({ id: `bed${i+1}`, name: `Bedroom ${i+1}`, x: i * bw, y: gridH * 2, w: bw, h: gridH, fill: '#FFF1F2' });
  }
  return rooms;
}

function generateSVG(rooms, totalW, totalH) {
  const scale = 30; // px/m
  const svgW  = totalW * scale + 40;
  const svgH  = totalH * scale + 40;
  const rects = rooms.map(r => `
    <rect x="${r.x*scale+20}" y="${r.y*scale+20}" width="${r.w*scale}" height="${r.h*scale}"
      fill="${r.fill}" stroke="#1e293b" stroke-width="2" rx="2"/>
    <text x="${(r.x+r.w/2)*scale+20}" y="${(r.y+r.h/2)*scale+20+5}" text-anchor="middle"
      font-size="10" font-family="Inter" fill="#374151">${r.name}</text>
    <text x="${(r.x+r.w/2)*scale+20}" y="${(r.y+r.h/2)*scale+20+18}" text-anchor="middle"
      font-size="8" fill="#9ca3af">${r.w.toFixed(1)}×${r.h.toFixed(1)}m</text>
  `).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}">${rects}</svg>`;
}

app.get('/api/architect/floor-plans/:id', async (req, res) => {
  try {
    const plan = await prisma.floorPlan.findFirst({ where: { id: req.params.id, companyId: req.user.companyId } });
    if (!plan) return res.status(404).json({ error: 'Floor plan not found' });
    res.json({ plan });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/architect/floor-plans/:id', requireRole(ARCH_ROLES), async (req, res) => {
  try {
    const plan = await prisma.floorPlan.update({
      where: { id: req.params.id, companyId: req.user.companyId },
      data:  { ...req.body, updatedAt: new Date() },
    });
    res.json({ plan });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/architect/floor-plans/:id', requireRole(ARCH_ROLES), async (req, res) => {
  try {
    await prisma.floorPlan.delete({ where: { id: req.params.id, companyId: req.user.companyId } });
    res.json({ message: 'Deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Export SVG
app.post('/api/architect/floor-plans/:id/export', async (req, res) => {
  try {
    const plan = await prisma.floorPlan.findFirst({ where: { id: req.params.id, companyId: req.user.companyId } });
    if (!plan?.svgData) return res.status(404).json({ error: 'No SVG data' });
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Content-Disposition', `attachment; filename="floor-plan-${plan.id}.svg"`);
    res.send(plan.svgData);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Design Files ─────────────────────────────────────────────────────────────
app.get('/api/architect/design-files', async (req, res) => {
  try {
    const files = await prisma.designFile.findMany({
      where:   { companyId: req.user.companyId, ...(req.query.projectId && { projectId: req.query.projectId }) },
      orderBy: { uploadedAt: 'desc' },
    });
    res.json({ files });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/architect/design-files', requireRole(ARCH_ROLES), async (req, res) => {
  try {
    const file = await prisma.designFile.create({
      data: {
        projectId:  req.body.projectId,
        companyId:  req.user.companyId,
        name:       req.body.name,
        type:       req.body.type        || 'ARCHITECTURAL',
        fileUrl:    req.body.fileUrl,
        version:    req.body.version     || 1,
        status:     req.body.status      || 'DRAFT',
        uploadedBy: req.user.id,
        uploadedAt: new Date(),
      },
    });
    res.status(201).json({ file });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/architect/design-files/:id', requireRole(ARCH_ROLES), async (req, res) => {
  try {
    await prisma.designFile.delete({ where: { id: req.params.id, companyId: req.user.companyId } });
    res.json({ message: 'Deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const copilotRouter = require('../../../packages/shared/routes/copilot');
app.use('/api/copilot', copilotRouter);

app.listen(PORT, () => console.log(`Architect Portal listening on port ${PORT}`));
module.exports = app;
