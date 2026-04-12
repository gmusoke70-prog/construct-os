/**
 * Auth Service — Port 3001
 *
 * Routes:
 *   POST /api/auth/register  - create company + owner account
 *   POST /api/auth/login     - authenticate user, returns JWT
 *   GET  /api/auth/me        - returns current user (requires auth header)
 *   POST /api/auth/refresh   - re-issue token (requires valid token)
 */

'use strict';

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const bcrypt     = require('bcryptjs');
const rateLimit  = require('express-rate-limit');
const { PrismaClient } = require('@prisma/client');
const { issueToken, requireAuth } = require('../../../packages/shared/middleware/auth');

const prisma = new PrismaClient();
const app    = express();
const PORT   = process.env.AUTH_PORT || 3001;

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json());
app.use(morgan('combined'));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Too many auth attempts' } });

app.get('/health', (_, res) => res.json({ service: 'auth', status: 'ok', ts: new Date() }));

// ─── Register (creates company + OWNER account) ───────────────────────────────
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const { companyName, industry, country, name, email, password } = req.body;
    if (!companyName || !name || !email || !password) {
      return res.status(400).json({ error: 'companyName, name, email, password required' });
    }
    if (password.length < 8) return res.status(400).json({ error: 'Password must be ≥ 8 characters' });

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: 'Email already in use' });

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await prisma.$transaction(async (tx) => {
      const slug = companyName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 60);

      const company = await tx.company.create({
        data: {
          name:    companyName,
          slug,
          country: country || 'UG',
          plan:    'PROFESSIONAL',
        },
      });

      const user = await tx.user.create({
        data: {
          companyId:    company.id,
          name,
          email,
          passwordHash,
          role:         'ADMIN',   // highest role available in schema
          isActive:     true,
        },
        select: { id: true, name: true, email: true, role: true, companyId: true },
      });

      return { company, user };
    });

    const token = issueToken({ ...result.user, roles: [result.user.role] });
    res.status(201).json({ token, user: result.user, company: { id: result.company.id, name: result.company.name } });
  } catch (e) {
    console.error('[auth] register error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Login ────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });

    const user = await prisma.user.findUnique({
      where:  { email },
      select: { id: true, name: true, email: true, role: true, companyId: true, passwordHash: true, isActive: true, avatar: true },
    });

    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (!user.isActive) return res.status(403).json({ error: 'Account not activated — check your email for the invite link' });

    const valid = await bcrypt.compare(password, user.passwordHash || '');
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const { passwordHash: _pw, ...safeUser } = user;
    const token = issueToken({ ...safeUser, roles: [safeUser.role] });

    res.json({ token, user: safeUser });
  } catch (e) {
    console.error('[auth] login error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Me ───────────────────────────────────────────────────────────────────────
app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where:  { id: req.user.id },
      select: { id: true, name: true, email: true, role: true, companyId: true, avatar: true, isActive: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Refresh ──────────────────────────────────────────────────────────────────
app.post('/api/auth/refresh', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where:  { id: req.user.id },
      select: { id: true, name: true, email: true, role: true, companyId: true },
    });
    if (!user) return res.status(401).json({ error: 'User not found' });
    const token = issueToken({ ...user, roles: [user.role] });
    res.json({ token, user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log(`Auth Service listening on port ${PORT}`));
module.exports = app;
