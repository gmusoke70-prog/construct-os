/**
 * Shared Auth + RBAC middleware
 *
 * Usage in any portal route:
 *   const { requireAuth, requireRole, requireOwn } = require('../../../packages/shared/middleware/auth');
 *   router.get('/projects', requireAuth, requireRole(['ADMIN', 'PROJECT_MANAGER']), handler);
 */

'use strict';

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_IN_PRODUCTION';

/**
 * requireAuth — verifies JWT and attaches req.user
 * Token accepted from:
 *   1. Authorization: Bearer <token>
 *   2. Cookie: token=<token>
 *   3. query ?token=<token>  (for file download links only — use sparingly)
 */
function requireAuth(req, res, next) {
  let token =
    (req.headers.authorization || '').replace(/^Bearer\s+/i, '') ||
    req.cookies?.token ||
    req.query?.token;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = {
      id:        payload.sub,
      email:     payload.email,
      role:      payload.role,       // primary role string e.g. 'ADMIN'
      roles:     payload.roles || [payload.role],  // array of all roles
      companyId: payload.companyId,
      name:      payload.name,
    };
    next();
  } catch (e) {
    if (e.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

/**
 * requireRole — ensures the authenticated user holds at least one of the allowed roles.
 *
 * @param {string[]} allowedRoles — e.g. ['ADMIN', 'QUANTITY_SURVEYOR']
 */
function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });

    const userRoles = req.user.roles || [req.user.role];
    const hasRole   = allowedRoles.some(r => userRoles.includes(r));

    if (!hasRole) {
      return res.status(403).json({
        error:    'Insufficient permissions',
        required: allowedRoles,
        actual:   userRoles,
      });
    }
    next();
  };
}

/**
 * requireOwn — ensures the user can only access their own resources,
 * unless they are ADMIN or OWNER.
 *
 * Usage:
 *   router.get('/employees/:userId', requireAuth, requireOwn('userId'), handler);
 */
function requireOwn(paramKey = 'userId') {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });

    const isAdmin = (req.user.roles || [req.user.role]).some(r => ['ADMIN', 'OWNER'].includes(r));
    if (isAdmin) return next();

    const targetId = req.params[paramKey] || req.body[paramKey];
    if (targetId && targetId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied: can only access your own resources' });
    }
    next();
  };
}

/**
 * requireSameCompany — enforces multi-tenant isolation.
 * Checks that a `companyId` field on the target resource matches the user's companyId.
 *
 * Usage with Prisma:
 *   Always pass companyId from req.user.companyId into all DB queries (never from req.body).
 *
 * This middleware is a belt-and-suspenders check for routes that accept a companyId param.
 */
function requireSameCompany(req, res, next) {
  const paramCompanyId = req.params.companyId || req.body.companyId || req.query.companyId;

  if (paramCompanyId && paramCompanyId !== req.user.companyId) {
    return res.status(403).json({ error: 'Cross-company access denied' });
  }
  next();
}

/**
 * issueToken — creates a signed JWT for a user.
 * Called from auth-service after login/register.
 */
function issueToken(user, expiresIn = '8h') {
  return jwt.sign(
    {
      sub:       user.id,
      email:     user.email,
      role:      user.role,
      roles:     user.roles || [user.role],
      companyId: user.companyId,
      name:      user.name,
    },
    JWT_SECRET,
    { expiresIn },
  );
}

/**
 * Rate limit headers helper — used by API gateway.
 */
function rateLimitHeaders(req, res, next) {
  res.setHeader('X-Company-ID', req.user?.companyId || '');
  next();
}

module.exports = { requireAuth, requireRole, requireOwn, requireSameCompany, issueToken, rateLimitHeaders };
