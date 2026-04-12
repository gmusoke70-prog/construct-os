/**
 * PM Portal — Project Manager Backend  (port 3012)
 *
 * Routes:
 *   GET  /api/pm/dashboard            - project summary + KPIs
 *   GET  /api/pm/projects             - all projects for company
 *   POST /api/pm/projects             - create project
 *   GET  /api/pm/projects/:id         - project detail with phases + tasks
 *   PATCH /api/pm/projects/:id        - update project
 *   GET  /api/pm/projects/:id/gantt   - gantt-ready task data
 *   POST /api/pm/tasks                - create task
 *   PATCH /api/pm/tasks/:id           - update task (status, assignee, dates)
 *   DELETE /api/pm/tasks/:id          - delete task
 *   GET  /api/pm/risks                - project risks
 *   POST /api/pm/risks                - log risk
 *   PATCH /api/pm/risks/:id           - update risk
 *   GET  /api/pm/timeline/:projectId  - milestone timeline
 */

'use strict';

const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../../../packages/shared/middleware/auth');

const prisma = new PrismaClient();
const app    = express();
const PORT   = process.env.PM_PORT || 3012;

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json());
app.use(requireAuth);

const PM_ROLES = ['PROJECT_MANAGER', 'ADMIN', 'OWNER'];

app.get('/health', (_, res) => res.json({ service: 'pm-portal', status: 'ok' }));

// ─── Dashboard KPIs ───────────────────────────────────────────────────────────
app.get('/api/pm/dashboard', async (req, res) => {
  try {
    const { companyId } = req.user;

    const [projects, tasks, risks] = await Promise.all([
      prisma.project.findMany({ where: { companyId }, select: { id: true, status: true, estimatedBudget: true } }),
      prisma.task.findMany({
        where: { project: { companyId } },
        select: { id: true, status: true, dueDate: true },
      }),
      prisma.risk.findMany({ where: { project: { companyId } }, select: { level: true, status: true } }),
    ]);

    const now      = new Date();
    const overdue  = tasks.filter(t => t.dueDate && t.dueDate < now && t.status !== 'DONE');
    const openRisks= risks.filter(r => r.status !== 'CLOSED');

    res.json({
      kpis: {
        totalProjects:   projects.length,
        activeProjects:  projects.filter(p => p.status === 'ACTIVE').length,
        totalTasks:      tasks.length,
        overdueTasks:    overdue.length,
        openRisks:       openRisks.length,
        criticalRisks:   openRisks.filter(r => r.level === 'CRITICAL').length,
        totalBudget:     projects.reduce((s, p) => s + (p.estimatedBudget || 0), 0),
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Projects ─────────────────────────────────────────────────────────────────
app.get('/api/pm/projects', async (req, res) => {
  try {
    const projects = await prisma.project.findMany({
      where:   { companyId: req.user.companyId },
      include: {
        phases:    { include: { tasks: true } },
        members:   { include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } } },
        milestones: true,
        _count:    { select: { tasks: true, documents: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ projects });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/pm/projects', requireRole(PM_ROLES), async (req, res) => {
  try {
    const project = await prisma.project.create({
      data: {
        companyId:       req.user.companyId,
        name:            req.body.name,
        description:     req.body.description || '',
        status:          'PLANNING',
        startDate:       req.body.startDate ? new Date(req.body.startDate) : null,
        endDate:         req.body.endDate   ? new Date(req.body.endDate)   : null,
        estimatedBudget: Number(req.body.estimatedBudget) || 0,
        location:        req.body.location  || null,
        createdById:     req.user.id,
        slug:            req.body.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
      },
    });
    res.status(201).json({ project });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/pm/projects/:id', async (req, res) => {
  try {
    const project = await prisma.project.findFirst({
      where:   { id: req.params.id, companyId: req.user.companyId },
      include: {
        phases:     { include: { tasks: { include: { assignee: { select: { id: true, name: true, avatarUrl: true } } }, orderBy: { createdAt: 'asc' } } }, orderBy: { order: 'asc' } },
        members:    { include: { user: { select: { id: true, name: true, email: true, role: true, avatarUrl: true } } } },
        milestones: { orderBy: { dueDate: 'asc' } },
        risks:      { orderBy: { createdAt: 'desc' } },
        _count:     { select: { tasks: true, documents: true } },
      },
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json({ project });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/pm/projects/:id', requireRole(PM_ROLES), async (req, res) => {
  try {
    const { name, description, status, startDate, endDate, estimatedBudget, location } = req.body;
    const project = await prisma.project.update({
      where: { id: req.params.id, companyId: req.user.companyId },
      data: {
        ...(name            !== undefined && { name }),
        ...(description     !== undefined && { description }),
        ...(status          !== undefined && { status }),
        ...(startDate       !== undefined && { startDate: new Date(startDate) }),
        ...(endDate         !== undefined && { endDate:   new Date(endDate) }),
        ...(estimatedBudget !== undefined && { estimatedBudget: Number(estimatedBudget) }),
        ...(location        !== undefined && { location }),
        updatedAt: new Date(),
      },
    });
    res.json({ project });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Gantt data ───────────────────────────────────────────────────────────────
app.get('/api/pm/projects/:id/gantt', async (req, res) => {
  try {
    const project = await prisma.project.findFirst({
      where:   { id: req.params.id, companyId: req.user.companyId },
      include: {
        phases: {
          include: { tasks: { include: { assignee: { select: { id: true, name: true } } } } },
          orderBy: { order: 'asc' },
        },
        milestones: { orderBy: { dueDate: 'asc' } },
      },
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Build gantt-compatible format
    const ganttRows = [];
    for (const phase of project.phases) {
      ganttRows.push({
        id:       `phase-${phase.id}`,
        type:     'phase',
        name:     phase.name,
        start:    phase.startDate,
        end:      phase.endDate,
        progress: phase.progress || 0,
        color:    '#2563eb',
      });
      for (const task of phase.tasks) {
        ganttRows.push({
          id:         `task-${task.id}`,
          type:       'task',
          name:       task.title,
          start:      task.startDate,
          end:        task.dueDate,
          progress:   task.progress || 0,
          parentId:   `phase-${phase.id}`,
          assignee:   task.assignee,
          status:     task.status,
          priority:   task.priority,
          color:      task.status === 'DONE' ? '#16a34a' : task.status === 'IN_PROGRESS' ? '#2563eb' : '#9ca3af',
        });
      }
    }

    for (const m of project.milestones) {
      ganttRows.push({
        id:    `milestone-${m.id}`,
        type:  'milestone',
        name:  m.name,
        start: m.dueDate,
        end:   m.dueDate,
        color: '#f59e0b',
      });
    }

    res.json({ ganttRows, project: { name: project.name, startDate: project.startDate, endDate: project.endDate } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Tasks ────────────────────────────────────────────────────────────────────
app.post('/api/pm/tasks', requireRole(PM_ROLES), async (req, res) => {
  try {
    const max = await prisma.task.aggregate({ where: { phaseId: req.body.phaseId }, _max: { position: true } });
    const task = await prisma.task.create({
      data: {
        projectId:   req.body.projectId,
        phaseId:     req.body.phaseId,
        title:       req.body.title,
        description: req.body.description || '',
        status:      req.body.status     || 'TODO',
        priority:    req.body.priority   || 'MEDIUM',
        dueDate:     req.body.dueDate    ? new Date(req.body.dueDate)   : null,
        assigneeId:  req.body.assigneeId || null,
        position:    (max._max.position ?? -1) + 1,
      },
      include: { assignee: { select: { id: true, name: true, avatarUrl: true } } },
    });
    res.status(201).json({ task });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/pm/tasks/:id', requireRole(PM_ROLES), async (req, res) => {
  try {
    const task = await prisma.task.update({
      where: { id: req.params.id },
      data:  {
        ...(req.body.title       !== undefined && { title:      req.body.title }),
        ...(req.body.description !== undefined && { description:req.body.description }),
        ...(req.body.status      !== undefined && { status:     req.body.status }),
        ...(req.body.priority    !== undefined && { priority:   req.body.priority }),
        ...(req.body.progress    !== undefined && { progress:   Number(req.body.progress) }),
        ...(req.body.dueDate     !== undefined && { dueDate:    new Date(req.body.dueDate) }),
        ...(req.body.assigneeId  !== undefined && { assigneeId: req.body.assigneeId }),
        updatedAt: new Date(),
      },
      include: { assignee: { select: { id: true, name: true, avatarUrl: true } } },
    });
    res.json({ task });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/pm/tasks/:id', requireRole(PM_ROLES), async (req, res) => {
  try {
    await prisma.task.delete({ where: { id: req.params.id } });
    res.json({ message: 'Task deleted' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Risks ────────────────────────────────────────────────────────────────────
app.get('/api/pm/risks', async (req, res) => {
  try {
    const risks = await prisma.risk.findMany({
      where: {
        project: { companyId: req.user.companyId },
        ...(req.query.projectId && { projectId: req.query.projectId }),
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ risks });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/pm/risks', requireRole(PM_ROLES), async (req, res) => {
  try {
    const risk = await prisma.risk.create({
      data: {
        projectId:   req.body.projectId,
        title:       req.body.title,
        description: req.body.description || '',
        level:       req.body.level       || 'MEDIUM',
        category:    req.body.category    || 'SCHEDULE',
        probability: Number(req.body.probability) || 3,
        impact:      Number(req.body.impact)      || 3,
        mitigation:  req.body.mitigation  || '',
        status:      'OPEN',
        raisedBy:    req.user.id,
      },
    });
    res.status(201).json({ risk });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/pm/risks/:id', requireRole(PM_ROLES), async (req, res) => {
  try {
    const risk = await prisma.risk.update({
      where: { id: req.params.id },
      data:  { ...req.body, updatedAt: new Date() },
    });
    res.json({ risk });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const copilotRouter = require('../../../packages/shared/routes/copilot');
app.use('/api/copilot', copilotRouter);

app.listen(PORT, () => console.log(`PM Portal listening on port ${PORT}`));
module.exports = app;
