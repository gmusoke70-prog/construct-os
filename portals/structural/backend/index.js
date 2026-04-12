/**
 * Structural Engineer Portal Backend  (port 3007)
 *
 * Routes:
 *   GET  /api/structural/models                    - list structural models
 *   POST /api/structural/models                    - create model
 *   GET  /api/structural/models/:id                - get model
 *   PATCH /api/structural/models/:id               - update model
 *   POST /api/structural/models/:id/analyze        - run FEM analysis
 *   GET  /api/structural/models/:id/results        - get analysis results
 *   GET  /api/structural/materials                 - material library
 */

'use strict';

const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../../../packages/shared/middleware/auth');

const prisma = new PrismaClient();
const app    = express();
const PORT   = process.env.STRUCTURAL_PORT || 3007;

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(requireAuth);

const SE_ROLES = ['STRUCTURAL_ENGINEER', 'ADMIN', 'OWNER'];

app.get('/health', (_, res) => res.json({ service: 'structural-portal', status: 'ok' }));

// ─── FEM Solver (2D Euler-Bernoulli) ─────────────────────────────────────────
function runFEM({ nodes, elements, loads, constraints, materialDefs }) {
  const n = nodes.length;
  const NDOF = n * 3;  // ux, uy, theta per node
  const K = Array.from({ length: NDOF }, () => new Array(NDOF).fill(0));
  const F = new Array(NDOF).fill(0);

  const nodeIndex = new Map(nodes.map((nd, i) => [nd.id, i]));
  const PENALTY   = 1e15;

  const MATERIALS = {
    STEEL:    { E: 200e6, fy: 250 },
    CONCRETE: { E:  30e6, fy:  25 },
    TIMBER:   { E:  12e6, fy:  10 },
    ...materialDefs,
  };

  for (const el of elements) {
    const ni  = nodeIndex.get(el.nodeI);
    const nj  = nodeIndex.get(el.nodeJ);
    const xi  = nodes[ni].x, yi = nodes[ni].y;
    const xj  = nodes[nj].x, yj = nodes[nj].y;
    const L   = Math.sqrt((xj-xi)**2 + (yj-yi)**2);
    if (L < 1e-12) continue;

    const mat = MATERIALS[el.material] || MATERIALS.STEEL;
    const A   = (el.w || 0.3) * (el.h || 0.5);
    const Iz  = (el.w || 0.3) * (el.h || 0.5) ** 3 / 12;
    const E   = mat.E;
    const EA  = E * A / L;
    const EI  = E * Iz;

    const c = (xj - xi) / L, s = (yj - yi) / L;

    const kL = [
      [EA, 0,          0,          -EA, 0,          0         ],
      [0,  12*EI/L**3, 6*EI/L**2,  0, -12*EI/L**3, 6*EI/L**2],
      [0,  6*EI/L**2,  4*EI/L,     0,  -6*EI/L**2, 2*EI/L   ],
      [-EA,0,          0,          EA,  0,          0         ],
      [0, -12*EI/L**3,-6*EI/L**2,  0,  12*EI/L**3,-6*EI/L**2],
      [0,  6*EI/L**2,  2*EI/L,     0,  -6*EI/L**2, 4*EI/L   ],
    ];

    const T = [
      [ c, s, 0,  0, 0, 0],
      [-s, c, 0,  0, 0, 0],
      [ 0, 0, 1,  0, 0, 0],
      [ 0, 0, 0,  c, s, 0],
      [ 0, 0, 0, -s, c, 0],
      [ 0, 0, 0,  0, 0, 1],
    ];

    // kG = T^T * kL * T
    const dofs = [ni*3, ni*3+1, ni*3+2, nj*3, nj*3+1, nj*3+2];
    for (let a = 0; a < 6; a++) {
      for (let b = 0; b < 6; b++) {
        let val = 0;
        for (let c2 = 0; c2 < 6; c2++) {
          for (let d = 0; d < 6; d++) {
            val += T[c2][a] * kL[c2][d] * T[d][b];
          }
        }
        K[dofs[a]][dofs[b]] += val;
      }
    }
  }

  // Apply loads
  for (const ld of loads) {
    const idx = nodeIndex.get(ld.nodeId);
    if (idx == null) continue;
    if (ld.Fx != null) F[idx*3]   += ld.Fx;
    if (ld.Fy != null) F[idx*3+1] += ld.Fy;
    if (ld.Mz != null) F[idx*3+2] += ld.Mz;
  }

  // Apply BCs (penalty)
  for (const c of constraints) {
    const idx = nodeIndex.get(c.nodeId);
    if (idx == null) continue;
    for (const dof of c.dof) {
      const d = idx*3 + dof;
      K[d][d] = PENALTY;
      F[d]    = 0;
    }
  }

  // Gaussian elimination
  const u = gaussElim(K, F, NDOF);

  // Recover member forces
  const memberForces = elements.map(el => {
    const ni = nodeIndex.get(el.nodeI), nj = nodeIndex.get(el.nodeJ);
    const xi = nodes[ni].x, yi = nodes[ni].y;
    const xj = nodes[nj].x, yj = nodes[nj].y;
    const L  = Math.sqrt((xj-xi)**2 + (yj-yi)**2);
    const c  = (xj-xi)/L, s = (yj-yi)/L;

    const ue = [u[ni*3],u[ni*3+1],u[ni*3+2],u[nj*3],u[nj*3+1],u[nj*3+2]];
    const mat = MATERIALS[el.material] || MATERIALS.STEEL;
    const A   = (el.w||0.3)*(el.h||0.5);
    const Iz  = (el.w||0.3)*(el.h||0.5)**3/12;

    const axial   = mat.E*A/L * ((-c)*ue[0]+(-s)*ue[1]+c*ue[3]+s*ue[4]);
    const shear   = 12*mat.E*Iz/L**3 * (s*ue[0]-c*ue[1]+(-s)*ue[3]+c*ue[4]) + 6*mat.E*Iz/L**2*(ue[2]+ue[5]);
    const momentI = 6*mat.E*Iz/L**2*(s*ue[0]-c*ue[1]-s*ue[3]+c*ue[4]) + 4*mat.E*Iz/L*ue[2] + 2*mat.E*Iz/L*ue[5];
    const momentJ = 6*mat.E*Iz/L**2*(s*ue[0]-c*ue[1]-s*ue[3]+c*ue[4]) + 2*mat.E*Iz/L*ue[2] + 4*mat.E*Iz/L*ue[5];

    const yMax    = (el.h||0.5)/2;
    const sigmaA  = axial/A;
    const sigmaB  = Math.max(Math.abs(momentI),Math.abs(momentJ))*yMax/Iz;
    const sigmaMax= Math.abs(sigmaA)+sigmaB;
    const ucr     = sigmaMax/(mat.fy*1000);
    const defl    = Math.max(Math.abs(ue[1]),Math.abs(ue[4]))*1000; // mm

    return {
      elementId:  el.id,
      axial:      round3(axial/1000),    // kN
      shear:      round3(shear/1000),    // kN
      momentI:    round3(momentI/1000),  // kN·m
      momentJ:    round3(momentJ/1000),  // kN·m
      sigmaMax:   round3(sigmaMax/1000), // MPa
      ucr:        round3(ucr),
      deflection: round3(defl),
      limit_L300: round3(L*1000/300),
      warning:    ucr > 1.0 ? 'OVERSTRESSED' : defl > L*1000/300 ? 'EXCESSIVE_DEFLECTION' : null,
    };
  });

  const warnings = memberForces.filter(m => m.warning).map(m => `${m.elementId}: ${m.warning}`);
  const safetyFactor = memberForces.length > 0
    ? round3(1 / Math.max(...memberForces.map(m => m.ucr || 0.01)))
    : null;

  return {
    displacements: nodes.map((nd, i) => ({
      nodeId: nd.id,
      ux: round3(u[i*3]*1000), uy: round3(u[i*3+1]*1000), theta: round3(u[i*3+2]),
    })),
    memberForces,
    warnings,
    safetyFactor,
    status: warnings.length === 0 ? 'PASS' : 'FAIL',
  };
}

function gaussElim(K, F, n) {
  const A = K.map((r, i) => [...r, F[i]]);
  for (let c = 0; c < n; c++) {
    let maxR = c;
    for (let r = c+1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[maxR][c])) maxR = r;
    [A[c], A[maxR]] = [A[maxR], A[c]];
    if (Math.abs(A[c][c]) < 1e-12) throw new Error('Singular matrix — check supports');
    for (let r = c+1; r < n; r++) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k];
    }
  }
  const u = new Array(n).fill(0);
  for (let r = n-1; r >= 0; r--) {
    u[r] = A[r][n];
    for (let c = r+1; c < n; c++) u[r] -= A[r][c] * u[c];
    u[r] /= A[r][r];
  }
  return u;
}

function round3(v) { return Math.round(v * 1000) / 1000; }

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get('/api/structural/models', async (req, res) => {
  try {
    const models = await prisma.structuralModel.findMany({
      where:   { companyId: req.user.companyId, ...(req.query.projectId && { projectId: req.query.projectId }) },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ models });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/structural/models', requireRole(SE_ROLES), async (req, res) => {
  try {
    const model = await prisma.structuralModel.create({
      data: {
        projectId:  req.body.projectId || null,
        companyId:  req.user.companyId,
        name:       req.body.name || 'New Model',
        type:       req.body.type || '2D_FRAME',
        inputData:  req.body.inputData || {},
        createdBy:  req.user.id,
        status:     'DRAFT',
      },
    });
    res.status(201).json({ model });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/structural/models/:id', async (req, res) => {
  try {
    const model = await prisma.structuralModel.findFirst({
      where:   { id: req.params.id, companyId: req.user.companyId },
      include: { results: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!model) return res.status(404).json({ error: 'Model not found' });
    res.json({ model });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/structural/models/:id', requireRole(SE_ROLES), async (req, res) => {
  try {
    const model = await prisma.structuralModel.update({
      where: { id: req.params.id, companyId: req.user.companyId },
      data:  { ...req.body, updatedAt: new Date() },
    });
    res.json({ model });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/structural/models/:id/analyze', requireRole(SE_ROLES), async (req, res) => {
  try {
    const model = await prisma.structuralModel.findFirst({ where: { id: req.params.id, companyId: req.user.companyId } });
    if (!model) return res.status(404).json({ error: 'Model not found' });

    const input = { ...model.inputData, ...req.body };
    if (!input.nodes?.length || !input.elements?.length) {
      return res.status(400).json({ error: 'nodes and elements required in model data' });
    }

    const results = runFEM(input);

    const saved = await prisma.simulationResult.create({
      data: {
        modelId:     model.id,
        companyId:   req.user.companyId,
        inputData:   input,
        outputData:  results,
        status:      results.status,
        safetyFactor: results.safetyFactor,
        runAt:       new Date(),
        runBy:       req.user.id,
      },
    });

    await prisma.structuralModel.update({
      where: { id: model.id },
      data:  { status: results.status === 'PASS' ? 'ANALYZED' : 'FAILED', lastAnalyzedAt: new Date() },
    });

    res.json({ results, resultId: saved.id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/structural/models/:id/results', async (req, res) => {
  try {
    const results = await prisma.simulationResult.findMany({
      where:   { modelId: req.params.id, companyId: req.user.companyId },
      orderBy: { createdAt: 'desc' },
      take:    10,
    });
    res.json({ results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Inline analysis (no saved model required) ────────────────────────────────
// Body: { nodes, members, loads } — same shape as the JSON editor in the UI
app.post('/api/structural/models/analyze-inline', requireRole(SE_ROLES), (req, res) => {
  try {
    const { nodes, members, loads } = req.body;
    if (!nodes?.length || !members?.length) {
      return res.status(400).json({ error: 'nodes and members required' });
    }
    // Map "members" field used in UI to "elements" field used by runFEM
    const results = runFEM({ nodes, elements: members, loads: loads || [] });
    res.json(results);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Material library
app.get('/api/structural/materials', (_, res) => {
  res.json({
    materials: [
      { code: 'STEEL',    name: 'Structural Steel',    E: 200000, fy: 250,  density: 7850, unit: 'MPa' },
      { code: 'CONCRETE', name: 'C25 Concrete',        E:  30000, fy:  25,  density: 2400, unit: 'MPa' },
      { code: 'C30',      name: 'C30 Concrete',        E:  33000, fy:  30,  density: 2400, unit: 'MPa' },
      { code: 'TIMBER',   name: 'Structural Timber',   E:  12000, fy:  10,  density:  600, unit: 'MPa' },
      { code: 'SS400',    name: 'SS400 Steel',         E: 200000, fy: 245,  density: 7850, unit: 'MPa' },
    ],
  });
});

const copilotRouter = require('../../../packages/shared/routes/copilot');
app.use('/api/copilot', copilotRouter);

app.listen(PORT, () => console.log(`Structural Portal listening on port ${PORT}`));
module.exports = app;
