/**
 * Construct-OS — Combined Server (Railway free-tier single service)
 *
 * Runs all backends in one Express app on $PORT (default 3000):
 *   /api/auth/*         → auth routes
 *   /api/qs/*           → QS portal routes
 *   /api/pm/*           → PM portal routes
 *   /api/architect/*    → Architect portal routes
 *   /api/structural/*   → Structural portal routes
 *   /api/procurement/*  → Procurement portal routes
 *   /api/hr/*           → HR portal routes
 *   /api/finance/*      → Finance portal routes
 *   /api/admin/*        → Admin portal routes
 *   /api/client/*       → Client portal routes
 *   /api/copilot        → AI copilot (shared)
 */

'use strict';

const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const morgan    = require('morgan');
const rateLimit = require('express-rate-limit');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*').split(',');
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      cb(null, true);
    } else {
      cb(new Error('CORS: origin not allowed'));
    }
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Authorization','Content-Type','X-Request-ID'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined'));

app.use(rateLimit({ windowMs: 60_000, max: 500, standardHeaders: true, legacyHeaders: false }));

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ service: 'construct-os-api', status: 'ok', ts: new Date() }));

// ─── Auth routes ──────────────────────────────────────────────────────────────
// Inline auth (avoids circular port issues)
const bcrypt     = require('bcryptjs');
const authLimit  = rateLimit({ windowMs: 15 * 60_000, max: 20, message: { error: 'Too many auth attempts' } });
const { PrismaClient } = require('@prisma/client');
const { issueToken, requireAuth } = require('./packages/shared/middleware/auth');
const prisma = new PrismaClient();

app.post('/api/auth/register', authLimit, async (req, res) => {
  try {
    const { companyName, industry, country, name, email, password } = req.body;
    if (!companyName || !name || !email || !password)
      return res.status(400).json({ error: 'companyName, name, email, password required' });
    if (password.length < 8)
      return res.status(400).json({ error: 'Password must be ≥ 8 characters' });

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: 'Email already in use' });

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await prisma.$transaction(async (tx) => {
      const slug = companyName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 60);
      const company = await tx.company.create({ data: { name: companyName, slug, country: country || 'UG', plan: 'PROFESSIONAL' } });
      const user = await tx.user.create({
        data: { companyId: company.id, name, email, passwordHash, role: 'ADMIN', isActive: true },
        select: { id: true, name: true, email: true, role: true, companyId: true },
      });
      return { company, user };
    });
    const token = issueToken({ ...result.user, roles: [result.user.role] });
    res.status(201).json({ token, user: result.user, company: { id: result.company.id, name: result.company.name } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/login', authLimit, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, email: true, role: true, companyId: true, passwordHash: true, isActive: true, avatarUrl: true },
    });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (!user.isActive) return res.status(403).json({ error: 'Account not activated' });
    const valid = await bcrypt.compare(password, user.passwordHash || '');
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const { passwordHash: _pw, ...safeUser } = user;
    const token = issueToken({ ...safeUser, roles: [safeUser.role] });
    res.json({ token, user: safeUser });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, name: true, email: true, role: true, companyId: true, avatarUrl: true, isActive: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/refresh', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, name: true, email: true, role: true, companyId: true },
    });
    if (!user) return res.status(401).json({ error: 'User not found' });
    const token = issueToken({ ...user, roles: [user.role] });
    res.json({ token, user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Portal routes (lazy-require to keep startup fast) ───────────────────────
function mountPortal(prefix, backendPath) {
  try {
    // Each portal backend exports its routes via a router or we extract routes
    // by requiring the file in "router extraction" mode
    const router = require(backendPath);
    if (router && typeof router === 'function') {
      app.use('/', router);
    }
  } catch (e) {
    console.warn(`[server] Could not mount ${prefix}:`, e.message);
  }
}

// ─── Load portal routers ──────────────────────────────────────────────────────
// Each portal's index.js is self-contained; we extract routes by monkey-patching
// the listen call so it doesn't bind a port, then grab its app.

function extractRouter(filePath) {
  // Temporarily suppress app.listen
  const origListen = require('express').application.listen;
  let capturedApp = null;

  const expModule = require('express');
  const origApp   = expModule;

  // We require the module; it calls app.listen() at the bottom.
  // We suppress listen by overriding it on the express.application prototype.
  require('express').application.listen = function (...args) {
    capturedApp = this;
    return { on: () => {}, close: () => {} }; // fake server
  };

  try {
    // Clear cache so each require is fresh
    delete require.cache[require.resolve(filePath)];
    require(filePath);
  } catch (e) {
    console.warn(`[server] Error loading ${filePath}:`, e.message);
  }

  require('express').application.listen = origListen;
  return capturedApp;
}

const portals = [
  { path: './portals/qs/backend/index.js' },
  { path: './portals/pm/backend/index.js' },
  { path: './portals/architect/backend/index.js' },
  { path: './portals/structural/backend/index.js' },
  { path: './portals/procurement/backend/index.js' },
  { path: './portals/hr/backend/index.js' },
  { path: './portals/finance/backend/index.js' },
  { path: './portals/admin/backend/index.js' },
  { path: './portals/client/backend/index.js' },
];

for (const { path: portalPath } of portals) {
  const portalApp = extractRouter(portalPath);
  if (portalApp) {
    // Mount the portal's router stack onto the main app
    app.use(portalApp);
    console.log(`[server] Mounted: ${portalPath}`);
  }
}

// ─── Shared copilot route ─────────────────────────────────────────────────────
try {
  const copilotRouter = require('./packages/shared/routes/copilot');
  app.use('/api/copilot', copilotRouter);
} catch (e) {
  console.warn('[server] copilot route not loaded:', e.message);
}

// ─── 404 / error handlers ─────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Not found', path: req.path }));
app.use((err, req, res, _next) => {
  console.error('[server] unhandled error:', err.message);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => console.log(`Construct-OS API listening on port ${PORT}`));
module.exports = app;
