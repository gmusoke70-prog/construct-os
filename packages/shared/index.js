'use strict';

/**
 * @construct-os/shared — barrel export
 *
 * Portals import from this package, e.g.:
 *   const { requireAuth } = require('@construct-os/shared');
 *   const { AICopilot }  = require('@construct-os/shared');
 *   const copilotRouter   = require('@construct-os/shared/routes/copilot');
 */

// Middleware
const auth = require('./middleware/auth');

// Services
const { AICopilot } = require('./services/AICopilot');

module.exports = {
  // auth middleware helpers
  ...auth,
  AICopilot,
};
