/**
 * API Gateway — construct-os
 * Port: 3000
 *
 * Routes:
 *   /api/auth/*         → auth-service  :3001
 *   /api/projects/*     → project-service :3002
 *   /api/qs/*           → qs-portal     :3005
 *   /api/architect/*    → architect-portal :3006
 *   /api/structural/*   → structural-portal :3007
 *   /api/procurement/*  → procurement-portal :3008
 *   /api/hr/*           → hr-portal     :3009
 *   /api/finance/*      → finance-portal :3010
 *   /api/admin/*        → admin-portal  :3011
 *   /api/pm/*           → pm-portal     :3012
 *   /api/client/*       → client-portal :3013
 */

'use strict';

const express       = require('express');
const cors          = require('cors');
const helmet        = require('helmet');
const rateLimit     = require('express-rate-limit');
const { createProxyMiddleware } = require('http-proxy-middleware');

const { requireAuth } = require('../../../packages/shared/middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Security headers ─────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,   // handled by Nginx
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin:      (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(','),
  credentials: true,
  methods:     ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Authorization','Content-Type','X-Request-ID'],
}));

// ─── Rate limiting ────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,     // 1 minute
  max:      300,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests — please try again later' },
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      20,
  message: { error: 'AI rate limit exceeded (20 req/min)' },
});

app.use(globalLimiter);

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({
  service: 'api-gateway',
  status:  'ok',
  portals: [
    'auth','project','qs','architect','structural','procurement','hr','finance','admin','pm','client',
  ],
  ts: new Date(),
}));

// ─── Request ID ───────────────────────────────────────────────────────────────
app.use((req, _res, next) => {
  req.requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  next();
});

// ─── Service proxy factory ────────────────────────────────────────────────────
const SERVICE_URLS = {
  auth:         process.env.AUTH_SERVICE_URL         || 'http://localhost:3001',
  project:      process.env.PROJECT_SERVICE_URL      || 'http://localhost:3002',
  qs:           process.env.QS_SERVICE_URL           || 'http://localhost:3005',
  architect:    process.env.ARCHITECT_SERVICE_URL    || 'http://localhost:3006',
  structural:   process.env.STRUCTURAL_SERVICE_URL   || 'http://localhost:3007',
  procurement:  process.env.PROCUREMENT_SERVICE_URL  || 'http://localhost:3008',
  hr:           process.env.HR_SERVICE_URL           || 'http://localhost:3009',
  finance:      process.env.FINANCE_SERVICE_URL      || 'http://localhost:3010',
  admin:        process.env.ADMIN_SERVICE_URL        || 'http://localhost:3011',
  pm:           process.env.PM_SERVICE_URL           || 'http://localhost:3012',
  client:       process.env.CLIENT_SERVICE_URL       || 'http://localhost:3013',
};

function proxy(targetKey, pathRewrite = {}) {
  return createProxyMiddleware({
    target:      SERVICE_URLS[targetKey],
    changeOrigin: true,
    pathRewrite,
    on: {
      error: (err, req, res) => {
        console.error(`[gateway] proxy error → ${targetKey}: ${err.message}`);
        if (!res.headersSent) {
          res.status(502).json({ error: `Service unavailable: ${targetKey}` });
        }
      },
      proxyReq: (proxyReq, req) => {
        // Forward authenticated user identity to downstream services
        if (req.user) {
          proxyReq.setHeader('X-User-ID',      req.user.id);
          proxyReq.setHeader('X-User-Role',    req.user.role);
          proxyReq.setHeader('X-Company-ID',   req.user.companyId);
          proxyReq.setHeader('X-Request-ID',   req.requestId);
        }
      },
    },
  });
}

// ─── Public routes (no auth) ──────────────────────────────────────────────────
// Auth routes: login, register, accept-invite, refresh
app.use('/api/auth', proxy('auth'));

// ─── Protected routes ─────────────────────────────────────────────────────────
// Apply JWT auth to all remaining /api/* routes
app.use('/api', requireAuth);

// Project service
app.use('/api/projects', proxy('project'));

// QS portal
app.use('/api/qs', proxy('qs'));

// Architect portal
app.use('/api/architect', proxy('architect'));

// Structural engineer portal
app.use('/api/structural', proxy('structural'));

// Procurement portal
app.use('/api/procurement', proxy('procurement'));

// HR portal
app.use('/api/hr', proxy('hr'));

// Finance portal
app.use('/api/finance', proxy('finance'));

// Admin portal
app.use('/api/admin', proxy('admin'));

// PM portal
app.use('/api/pm', proxy('pm'));

// Client portal
app.use('/api/client', proxy('client'));

// AI copilot (stricter rate limit)
app.use('/api/ai', aiLimiter, proxy('project'));   // AI endpoints live in project-service for now

// ─── 404 ─────────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` }));

// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[gateway]', err.message);
  res.status(500).json({ error: 'Internal gateway error' });
});

app.listen(PORT, () => {
  console.log(`API Gateway listening on port ${PORT}`);
  console.log('Service URLs:', SERVICE_URLS);
});

module.exports = app;
