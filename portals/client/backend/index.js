/**
 * Client Portal Backend  (port 3013)
 *
 * Read-only project view for external clients.
 * All routes require a valid JWT with role CLIENT.
 *
 * Routes:
 *   GET  /api/client/projects           - projects the client has access to
 *   GET  /api/client/projects/:id       - project overview (filtered)
 *   GET  /api/client/projects/:id/boq   - approved BOQ only
 *   GET  /api/client/projects/:id/photos - field photos
 *   GET  /api/client/projects/:id/invoices - client invoices
 *   GET  /api/client/projects/:id/progress - schedule progress
 *   GET  /api/client/projects/:id/documents - shared documents
 */

'use strict';

const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../../../packages/shared/middleware/auth');

const prisma = new PrismaClient();
const app    = express();
const PORT   = process.env.CLIENT_PORT || 3013;

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json());
app.use(requireAuth);

app.get('/health', (_, res) => res.json({ service: 'client-portal', status: 'ok' }));

// ─── Project access guard ─────────────────────────────────────────────────────
async function guardClientAccess(req, res, next) {
  const { id } = req.params;
  const user   = req.user;

  // Admin/Owner/PM bypass
  const privileged = ['ADMIN', 'OWNER', 'PROJECT_MANAGER'].includes(user.role);
  if (privileged) return next();

  // CLIENT must have an active ProjectAccess record
  const access = await prisma.projectAccess.findFirst({
    where: {
      userId:    user.id,
      projectId: id,
      isActive:  true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });

  if (!access) return res.status(403).json({ error: 'You do not have access to this project' });
  req.projectAccess = access;
  next();
}

// ─── Projects list ────────────────────────────────────────────────────────────
app.get('/api/client/projects', async (req, res) => {
  try {
    const user = req.user;
    const privileged = ['ADMIN', 'OWNER', 'PROJECT_MANAGER'].includes(user.role);

    let projects;
    if (privileged) {
      projects = await prisma.project.findMany({
        where:   { companyId: user.companyId },
        select:  projectSummarySelect(),
        orderBy: { createdAt: 'desc' },
      });
    } else {
      // Find projects the client has access to
      const accesses = await prisma.projectAccess.findMany({
        where: { userId: user.id, isActive: true, expiresAt: { gt: new Date() } },
        select: { projectId: true },
      });
      const ids = accesses.map(a => a.projectId);
      if (ids.length === 0) return res.json({ projects: [] });

      projects = await prisma.project.findMany({
        where:   { id: { in: ids } },
        select:  projectSummarySelect(),
        orderBy: { createdAt: 'desc' },
      });
    }

    res.json({ projects });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

function projectSummarySelect() {
  return {
    id: true, name: true, description: true, status: true,
    startDate: true, endDate: true, location: true,
    estimatedBudget: true,
    _count: { select: { tasks: true, documents: true } },
  };
}

// ─── Project overview ─────────────────────────────────────────────────────────
app.get('/api/client/projects/:id', guardClientAccess, async (req, res) => {
  try {
    const project = await prisma.project.findFirst({
      where:   { id: req.params.id },
      select: {
        id: true, name: true, description: true, status: true,
        startDate: true, endDate: true, location: true, estimatedBudget: true,
        phases: {
          select: {
            id: true, name: true, status: true, progress: true,
            startDate: true, endDate: true,
            tasks: {
              select: { id: true, title: true, status: true, progress: true, dueDate: true },
              where:  { status: { not: 'CANCELLED' } },
              take:   20,
            },
          },
          orderBy: { order: 'asc' },
        },
        milestones: { select: { id: true, name: true, dueDate: true, achieved: true }, orderBy: { dueDate: 'asc' } },
        members:    { select: { user: { select: { name: true, role: true, avatarUrl: true } } }, take: 10 },
      },
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Compute overall progress
    const allTasks    = project.phases.flatMap(p => p.tasks);
    const doneTasks   = allTasks.filter(t => t.status === 'DONE').length;
    const overallProg = allTasks.length > 0 ? Math.round((doneTasks / allTasks.length) * 100) : 0;

    res.json({ project: { ...project, overallProgress: overallProg } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Approved BOQ ─────────────────────────────────────────────────────────────
app.get('/api/client/projects/:id/boq', guardClientAccess, async (req, res) => {
  try {
    const version = await prisma.bOQVersion.findFirst({
      where:   { projectId: req.params.id, status: 'APPROVED' },
      include: {
        stages: {
          include: { items: { orderBy: { rowIndex: 'asc' } } },
          orderBy: { position: 'asc' },
        },
      },
      orderBy: { versionNo: 'desc' },
    });
    if (!version) return res.json({ version: null, message: 'No approved BOQ yet' });
    res.json({ version });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Field photos ─────────────────────────────────────────────────────────────
app.get('/api/client/projects/:id/photos', guardClientAccess, async (req, res) => {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 24;
    const [photos, total] = await Promise.all([
      prisma.document.findMany({
        where:   { projectId: req.params.id, type: 'PHOTO', isSharedWithClient: true },
        select:  { id: true, name: true, fileUrl: true, createdAt: true, uploadedBy: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        skip:    (page-1)*limit,
        take:    limit,
      }),
      prisma.document.count({ where: { projectId: req.params.id, type: 'PHOTO', isSharedWithClient: true } }),
    ]);
    res.json({ photos, total, page, pages: Math.ceil(total/limit) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Invoices ─────────────────────────────────────────────────────────────────
app.get('/api/client/projects/:id/invoices', guardClientAccess, async (req, res) => {
  try {
    const invoices = await prisma.invoice.findMany({
      where:   { projectId: req.params.id, status: { in: ['SENT', 'PAID', 'OVERDUE'] } },
      select:  { id: true, invoiceNumber: true, totalAmount: true, status: true, dueDate: true, createdAt: true, paidAt: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ invoices });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Progress timeline ────────────────────────────────────────────────────────
app.get('/api/client/projects/:id/progress', guardClientAccess, async (req, res) => {
  try {
    const project = await prisma.project.findFirst({
      where:   { id: req.params.id },
      include: {
        phases:     { orderBy: { order: 'asc' }, include: { tasks: { select: { status: true } } } },
        milestones: { orderBy: { dueDate: 'asc' } },
      },
    });
    if (!project) return res.status(404).json({ error: 'Not found' });

    const phases = project.phases.map(p => ({
      id:       p.id,
      name:     p.name,
      status:   p.status,
      progress: p.progress || 0,
      start:    p.startDate,
      end:      p.endDate,
      tasksDone:p.tasks.filter(t => t.status === 'DONE').length,
      tasksTotal:p.tasks.length,
    }));

    const overall = phases.length > 0
      ? Math.round(phases.reduce((s, p) => s + p.progress, 0) / phases.length)
      : 0;

    res.json({
      overall,
      phases,
      milestones: project.milestones,
      startDate:  project.startDate,
      endDate:    project.endDate,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Shared documents ─────────────────────────────────────────────────────────
app.get('/api/client/projects/:id/documents', guardClientAccess, async (req, res) => {
  try {
    const docs = await prisma.document.findMany({
      where:   { projectId: req.params.id, isSharedWithClient: true },
      select:  { id: true, name: true, type: true, fileUrl: true, createdAt: true, size: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ documents: docs });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const copilotRouter = require('../../../packages/shared/routes/copilot');
app.use('/api/copilot', copilotRouter);

app.listen(PORT, () => console.log(`Client Portal listening on port ${PORT}`));
module.exports = app;
