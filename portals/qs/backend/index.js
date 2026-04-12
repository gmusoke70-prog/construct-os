/**
 * QS Portal — Backend Service Entry Point
 * Port: 3005
 */

'use strict';

const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const morgan   = require('morgan');

const boqRoutes     = require('./routes/boq');
const takeoffRoutes = require('./routes/takeoff');

const app  = express();
const PORT = process.env.QS_PORT || 3005;

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(morgan('combined'));

app.get('/health', (_, res) => res.json({ service: 'qs-portal', status: 'ok', ts: new Date() }));

app.use('/api/qs/boq',     boqRoutes);
app.use('/api/qs/takeoff', takeoffRoutes);

const copilotRouter = require('../../../packages/shared/routes/copilot');
app.use('/api/copilot', copilotRouter);

app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => console.log(`QS Portal service listening on port ${PORT}`));

module.exports = app;
