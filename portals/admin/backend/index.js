/**
 * Admin Portal Backend  (port 3011)
 *
 * Routes:
 *   GET  /api/admin/company             - company profile
 *   PATCH /api/admin/company            - update company
 *   GET  /api/admin/users               - all users in company
 *   POST /api/admin/users/invite        - invite user
 *   PATCH /api/admin/users/:id/role     - change user role
 *   DELETE /api/admin/users/:id         - deactivate user
 *   GET  /api/admin/audit-log           - audit trail
 *   GET  /api/admin/system-events       - system events
 *   GET  /api/admin/notifications       - notifications (all users)
 *   GET  /api/admin/stats               - platform usage stats
 */

'use strict';

const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const crypto   = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../../../packages/shared/middleware/auth');

const prisma = new PrismaClient();
const app    = express();
const PORT   = process.env.ADMIN_PORT || 3011;

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json());
app.use(requireAuth);

const ADMIN_ROLES = ['ADMIN', 'OWNER'];

app.get('/health', (_, res) => res.json({ service: 'admin-portal', status: 'ok' }));

// ─── Company ──────────────────────────────────────────────────────────────────
app.get('/api/admin/company', requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const company = await prisma.company.findUnique({
      where:   { id: req.user.companyId },
      include: { _count: { select: { users: true, projects: true } } },
    });
    if (!company) return res.status(404).json({ error: 'Company not found' });
    res.json({ company });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/company', requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const { name, phone, email, address, website, logoUrl, country, currency } = req.body;
    const company = await prisma.company.update({
      where: { id: req.user.companyId },
      data:  { name, phone, email, address, website, logoUrl, country, currency, updatedAt: new Date() },
    });
    res.json({ company });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Users ────────────────────────────────────────────────────────────────────
app.get('/api/admin/users', requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where:   { companyId: req.user.companyId },
      select: {
        id: true, name: true, email: true, role: true,
        isActive: true, lastLoginAt: true, createdAt: true, avatarUrl: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ users });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/users/invite', requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const { email, role, name } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });

    // Check if user already exists
    const existing = await prisma.user.findFirst({ where: { email, companyId: req.user.companyId } });
    if (existing) return res.status(409).json({ error: 'User already exists in this company' });

    // Generate invite token
    const rawToken   = crypto.randomBytes(32).toString('hex');
    const tokenHash  = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt  = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);  // 7 days

    // Create pending user
    const user = await prisma.user.create({
      data: {
        companyId:  req.user.companyId,
        email,
        name:       name || email.split('@')[0],
        role:       role || 'VIEWER',
        isActive:   false,
        inviteToken: tokenHash,
        inviteExpiry:expiresAt,
      },
    });

    // TODO: send invite email via notification service
    // For now, return the raw token in the response (dev only)
    const isDev = process.env.NODE_ENV !== 'production';

    res.status(201).json({
      message:    'Invitation created',
      userId:     user.id,
      email,
      role,
      expiresAt,
      ...(isDev && { inviteToken: rawToken }),  // never expose in production
      inviteUrl:  `${process.env.FRONTEND_URL || 'http://localhost:3000'}/accept-invite?token=${rawToken}`,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/users/:id/role', requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot change your own role' });
    const user = await prisma.user.update({
      where:  { id: req.params.id, companyId: req.user.companyId },
      data:   { role: req.body.role, updatedAt: new Date() },
      select: { id: true, name: true, email: true, role: true },
    });
    await prisma.auditLog.create({
      data: {
        companyId:  req.user.companyId,
        userId:     req.user.id,
        action:     'USER_ROLE_CHANGED',
        resource:   'User',
        resourceId: req.params.id,
        changes:   { role: req.body.role },
        ipAddress: req.ip,
      },
    });
    res.json({ user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/users/:id', requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot deactivate yourself' });
    await prisma.user.update({
      where: { id: req.params.id, companyId: req.user.companyId },
      data:  { isActive: false, deactivatedAt: new Date(), deactivatedBy: req.user.id },
    });
    res.json({ message: 'User deactivated' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Audit Log ────────────────────────────────────────────────────────────────
app.get('/api/admin/audit-log', requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 50;
    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where:   { companyId: req.user.companyId, ...(req.query.userId && { userId: req.query.userId }) },
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip:    (page-1)*limit,
        take:    limit,
      }),
      prisma.auditLog.count({ where: { companyId: req.user.companyId } }),
    ]);
    res.json({ logs, total, page, pages: Math.ceil(total/limit) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── System Events ────────────────────────────────────────────────────────────
app.get('/api/admin/system-events', requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const events = await prisma.systemEvent.findMany({
      where:   { companyId: req.user.companyId },
      orderBy: { createdAt: 'desc' },
      take:    parseInt(req.query.limit) || 100,
    });
    res.json({ events });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Stats ────────────────────────────────────────────────────────────────────
app.get('/api/admin/stats', requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const [users, projects, boqVersions, floorPlans, structuralModels, invoices] = await Promise.all([
      prisma.user.count({ where: { companyId, isActive: true } }),
      prisma.project.count({ where: { companyId } }),
      prisma.bOQVersion.count({ where: { companyId } }),
      prisma.floorPlan.count({ where: { companyId } }),
      prisma.structuralModel.count({ where: { companyId } }),
      prisma.invoice.aggregate({ where: { companyId, status: 'PAID' }, _sum: { totalAmount: true } }),
    ]);
    res.json({
      activeUsers:    users,
      projects,
      boqVersions,
      floorPlans,
      structuralModels,
      totalRevenue:   invoices._sum.totalAmount || 0,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Accept invite (public) ───────────────────────────────────────────────────
app.post('/api/admin/accept-invite', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'token and password required' });

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const user = await prisma.user.findFirst({
      where: { inviteToken: tokenHash, isActive: false },
    });

    if (!user)                               return res.status(400).json({ error: 'Invalid invite token' });
    if (user.inviteExpiry && user.inviteExpiry < new Date()) return res.status(400).json({ error: 'Invite expired' });

    const bcrypt = require('bcryptjs');
    const passwordHash = await bcrypt.hash(password, 12);

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        isActive:     true,
        passwordHash: passwordHash,
        inviteToken:  null,
        inviteExpiry: null,
        lastLoginAt:  new Date(),
      },
      select: { id: true, name: true, email: true, role: true, companyId: true },
    });

    const { issueToken } = require('../../../packages/shared/middleware/auth');
    const jwt = issueToken(updated);
    res.json({ message: 'Account activated', token: jwt, user: updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const copilotRouter = require('../../../packages/shared/routes/copilot');
app.use('/api/copilot', copilotRouter);

app.listen(PORT, () => console.log(`Admin Portal listening on port ${PORT}`));
module.exports = app;
