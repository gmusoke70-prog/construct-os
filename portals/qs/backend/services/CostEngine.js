/**
 * CostEngine.js — Cost estimation from cost library + live material rates
 *
 * Features:
 *   - Search cost library items by description/code with fuzzy matching
 *   - Apply regional location factors (Uganda regions)
 *   - Apply quality tier multipliers (Economy → Luxury)
 *   - Escalation: apply date-based cost escalation rates
 *   - Link library items to BOQ items
 *   - Analyse cost vs budget variance
 *   - Historical rate trends (MaterialRate time series)
 */

'use strict';

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// ─── Location factors (Uganda regions) ───────────────────────────────────────
const LOCATION_FACTORS = {
  KAMPALA:       1.00,    // base reference
  WAKISO:        1.02,
  MUKONO:        1.05,
  ENTEBBE:       1.08,
  JINJA:         1.10,
  GULU:          1.20,
  MBARARA:       1.15,
  FORT_PORTAL:   1.22,
  MBALE:         1.18,
  ARUA:          1.28,
  MASAKA:        1.12,
  LIRA:          1.25,
  NAIROBI:       1.35,    // Kenya
  DAR_ES_SALAAM: 1.28,    // Tanzania
  KIGALI:        1.32,    // Rwanda
};

// ─── Quality tier multipliers ─────────────────────────────────────────────────
const QUALITY_FACTORS = {
  ECONOMY:   0.75,
  STANDARD:  1.00,
  PREMIUM:   1.35,
  LUXURY:    2.10,
};

// ─── Annual escalation rates (inflation + market) ─────────────────────────────
const ANNUAL_ESCALATION = 0.085;  // 8.5% p.a. — Uganda construction sector

// ─── Unit conversion for rates ────────────────────────────────────────────────
const UNIT_CONVERSIONS = {
  'm²_to_ft²': 10.764,
  'm³_to_yd³': 1.308,
  'kg_to_lb':  2.205,
  'nr_to_nr':  1.0,
};

// ─── Cost Library CRUD ────────────────────────────────────────────────────────

async function createLibraryItem(companyId, data) {
  return prisma.costLibraryItem.create({
    data: {
      companyId,
      code:         data.code        || null,
      category:     data.category    || 'General',
      subcategory:  data.subcategory || null,
      description:  data.description,
      unit:         data.unit,
      baseRate:     Number(data.baseRate)     || 0,
      labourRate:   Number(data.labourRate)   || 0,
      plantRate:    Number(data.plantRate)    || 0,
      materialRate: Number(data.materialRate) || 0,
      wastageAllowance: Number(data.wastageAllowance) || 0,
      productivityFactor: Number(data.productivityFactor) || 1.0,
      source:       data.source      || 'INTERNAL',
      effectiveDate:data.effectiveDate ? new Date(data.effectiveDate) : new Date(),
      tags:         data.tags        || [],
      specifications: data.specifications || null,
    },
  });
}

async function updateLibraryItem(itemId, companyId, data) {
  return prisma.costLibraryItem.update({
    where: { id: itemId, companyId },
    data:  {
      ...data,
      updatedAt: new Date(),
    },
  });
}

async function deleteLibraryItem(itemId, companyId) {
  return prisma.costLibraryItem.delete({ where: { id: itemId, companyId } });
}

/**
 * Search cost library with fuzzy text matching.
 * @param {string} companyId
 * @param {Object} opts - { q, category, unit, page, limit }
 */
async function searchLibrary(companyId, { q = '', category, unit, page = 1, limit = 50 } = {}) {
  const where = {
    companyId,
    ...(category && { category }),
    ...(unit     && { unit }),
    ...(q && {
      OR: [
        { description: { contains: q, mode: 'insensitive' } },
        { code:        { contains: q, mode: 'insensitive' } },
        { category:    { contains: q, mode: 'insensitive' } },
        { tags:        { has: q.toLowerCase() } },
      ],
    }),
  };

  const [items, total] = await Promise.all([
    prisma.costLibraryItem.findMany({
      where,
      orderBy: [{ category: 'asc' }, { description: 'asc' }],
      skip:   (page - 1) * limit,
      take:   limit,
    }),
    prisma.costLibraryItem.count({ where }),
  ]);

  return { items, total, page, pages: Math.ceil(total / limit) };
}

/**
 * Get all distinct categories in the library.
 */
async function getLibraryCategories(companyId) {
  const items = await prisma.costLibraryItem.findMany({
    where:   { companyId },
    select:  { category: true, subcategory: true },
    distinct: ['category', 'subcategory'],
    orderBy: { category: 'asc' },
  });

  // Group into category → [subcategories]
  const map = {};
  for (const item of items) {
    if (!map[item.category]) map[item.category] = new Set();
    if (item.subcategory)    map[item.category].add(item.subcategory);
  }

  return Object.entries(map).map(([cat, subs]) => ({
    name: cat,
    subcategories: [...subs].sort(),
  }));
}

// ─── Rate Application ─────────────────────────────────────────────────────────

/**
 * Apply location and quality factors to a base rate.
 *
 * @param {number} baseRate
 * @param {string} location - key from LOCATION_FACTORS
 * @param {string} quality  - key from QUALITY_FACTORS
 * @param {Date}   asOfDate - apply escalation from today if future date
 * @returns {Object} { adjustedRate, breakdown }
 */
function applyFactors(baseRate, location = 'KAMPALA', quality = 'STANDARD', asOfDate = new Date()) {
  const locFactor  = LOCATION_FACTORS[location?.toUpperCase()]  || 1.0;
  const qualFactor = QUALITY_FACTORS[quality?.toUpperCase()]    || 1.0;

  // Escalation: compound from today to asOfDate
  const today       = new Date();
  const daysDelta   = Math.max(0, (new Date(asOfDate) - today) / 86400000);
  const yearsDelta  = daysDelta / 365;
  const escalFactor = Math.pow(1 + ANNUAL_ESCALATION, yearsDelta);

  const adjustedRate = baseRate * locFactor * qualFactor * escalFactor;

  return {
    adjustedRate: Math.round(adjustedRate * 100) / 100,
    breakdown: {
      baseRate:       Math.round(baseRate * 100) / 100,
      locationFactor: locFactor,
      qualityFactor:  qualFactor,
      escalationFactor: Math.round(escalFactor * 10000) / 10000,
      location,
      quality,
    },
  };
}

/**
 * Get a library item with adjusted rate applied.
 */
async function getAdjustedRate(libraryItemId, companyId, location = 'KAMPALA', quality = 'STANDARD', asOfDate = new Date()) {
  const item = await prisma.costLibraryItem.findFirst({ where: { id: libraryItemId, companyId } });
  if (!item) throw new Error('Library item not found');

  const { adjustedRate, breakdown } = applyFactors(item.baseRate, location, quality, asOfDate);

  return {
    ...item,
    adjustedRate,
    adjustedLabourRate: applyFactors(item.labourRate, location, quality, asOfDate).adjustedRate,
    breakdown,
  };
}

// ─── Link library item to BOQ item ───────────────────────────────────────────

/**
 * Apply a cost library item's rates to a BOQ item.
 * Updates the BOQ item's unitRate, labourRate, and derived costs.
 */
async function applyLibraryRateToBOQItem(boqItemId, companyId, libraryItemId, location = 'KAMPALA', quality = 'STANDARD') {
  const [boqItem, libItem] = await Promise.all([
    prisma.bOQItem.findFirst({ where: { id: boqItemId, companyId } }),
    prisma.costLibraryItem.findFirst({ where: { id: libraryItemId, companyId } }),
  ]);

  if (!boqItem) throw new Error('BOQ item not found');
  if (!libItem) throw new Error('Library item not found');

  const { adjustedRate }       = applyFactors(libItem.baseRate,    location, quality);
  const { adjustedRate: lRate} = applyFactors(libItem.labourRate,  location, quality);

  const { computeBOQRow } = require('./FormulaEngine');
  const derived = computeBOQRow({ ...boqItem, unitRate: adjustedRate, labourRate: lRate });

  return prisma.bOQItem.update({
    where: { id: boqItemId },
    data:  {
      unitRate:    adjustedRate,
      labourRate:  lRate,
      costLibRef:  libraryItemId,
      unit:        libItem.unit || boqItem.unit,
      wastagePercent: boqItem.wastagePercent || libItem.wastageAllowance,
      ...derived,
      updatedAt:   new Date(),
    },
  });
}

// ─── Material Rate Tracking ───────────────────────────────────────────────────

async function recordMaterialRate(companyId, { material, unit, rate, supplier, source, location, date }) {
  return prisma.materialRate.create({
    data: {
      companyId,
      material,
      unit,
      rate:      Number(rate),
      supplier:  supplier || null,
      source:    source   || 'MANUAL',
      location:  location || 'KAMPALA',
      date:      date ? new Date(date) : new Date(),
    },
  });
}

async function getMaterialRateHistory(companyId, material, { months = 12 } = {}) {
  const since = new Date();
  since.setMonth(since.getMonth() - months);

  const rates = await prisma.materialRate.findMany({
    where:   { companyId, material: { contains: material, mode: 'insensitive' }, date: { gte: since } },
    orderBy: { date: 'asc' },
  });

  if (rates.length === 0) return { material, rates: [], trend: null };

  // Compute trend: simple linear regression on (dayIndex, rate)
  const first = rates[0].date.getTime();
  const xs    = rates.map(r => (r.date.getTime() - first) / 86400000);
  const ys    = rates.map(r => r.rate);
  const n     = xs.length;
  const sumX  = xs.reduce((a, b) => a + b, 0);
  const sumY  = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
  const sumXX = xs.reduce((s, x) => s + x * x, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX) || 0;

  const latestRate = ys[ys.length - 1];
  const avgRate    = sumY / n;

  return {
    material,
    unit:       rates[0].unit,
    rates:      rates.map(r => ({ date: r.date, rate: r.rate, supplier: r.supplier })),
    trend: {
      slope:       Math.round(slope * 10000) / 10000,  // UGX per day
      direction:   slope > 0.5 ? 'RISING' : slope < -0.5 ? 'FALLING' : 'STABLE',
      avgRate:     Math.round(avgRate * 100) / 100,
      latestRate,
      projectedNext30Days: Math.round((latestRate + slope * 30) * 100) / 100,
    },
  };
}

async function getCurrentMaterialRates(companyId, { location = 'KAMPALA' } = {}) {
  // Get most recent rate for each material
  const allRates = await prisma.materialRate.findMany({
    where:   { companyId, location },
    orderBy: { date: 'desc' },
  });

  const latestMap = new Map();
  for (const r of allRates) {
    if (!latestMap.has(r.material)) latestMap.set(r.material, r);
  }

  return [...latestMap.values()].sort((a, b) => a.material.localeCompare(b.material));
}

// ─── Cost Estimation ──────────────────────────────────────────────────────────

/**
 * Estimate total project cost from floor plan data.
 * Uses standard Uganda construction rates indexed to floor area.
 *
 * @param {Object} params
 *   - floorArea:  number (m²)
 *   - floors:     number
 *   - location:   string
 *   - quality:    string
 *   - buildingType: 'RESIDENTIAL' | 'COMMERCIAL' | 'INDUSTRIAL'
 */
function estimateFromFloorPlan({ floorArea, floors = 1, location = 'KAMPALA', quality = 'STANDARD', buildingType = 'RESIDENTIAL' }) {
  // Base rates per m² (Uganda 2024, Kampala Standard)
  const BASE_RATES_PER_M2 = {
    RESIDENTIAL: {
      substructure:   250000,   // UGX/m²
      superstructure: 650000,
      roofing:        120000,
      finishes:       280000,
      mep:            180000,
      external:        80000,
      preliminaries:   90000,
    },
    COMMERCIAL: {
      substructure:   350000,
      superstructure: 850000,
      roofing:        150000,
      finishes:       420000,
      mep:            320000,
      external:       120000,
      preliminaries:  130000,
    },
    INDUSTRIAL: {
      substructure:   280000,
      superstructure: 480000,
      roofing:        200000,
      finishes:       120000,
      mep:            180000,
      external:       150000,
      preliminaries:   90000,
    },
  };

  const rates    = BASE_RATES_PER_M2[buildingType] || BASE_RATES_PER_M2.RESIDENTIAL;
  const { adjustedRate: locQualFactor } = applyFactors(1, location, quality);
  const totalGFA = floorArea * floors;

  const stages = Object.entries(rates).map(([key, rate]) => {
    const adjustedRate = rate * locQualFactor;
    const amount       = adjustedRate * totalGFA;
    return {
      name:         key.charAt(0).toUpperCase() + key.slice(1),
      ratePerM2:    Math.round(adjustedRate),
      amount:       Math.round(amount),
      pct:          0,  // computed after total
    };
  });

  const total = stages.reduce((s, st) => s + st.amount, 0);
  for (const st of stages) {
    st.pct = Math.round((st.amount / total) * 10000) / 100;
  }

  return {
    buildingType,
    floorArea,
    floors,
    gfa:          totalGFA,
    location,
    quality,
    locationFactor: locQualFactor,
    stages,
    totalEstimate:  total,
    ratePerM2:      Math.round(total / totalGFA),
    confidence:    0.70,    // ±30% — conceptual estimate
    notes:         'Conceptual estimate ±30%. Detailed BOQ required for tender.',
  };
}

/**
 * Variance analysis: compare BOQ cost vs actual transactions.
 */
async function varianceAnalysis(projectId, companyId, versionId) {
  const [version, transactions] = await Promise.all([
    prisma.bOQVersion.findFirst({
      where: { id: versionId, companyId },
      include: { stages: { include: { items: true } } },
    }),
    prisma.transaction.findMany({
      where: { projectId, companyId, type: 'EXPENSE' },
    }),
  ]);

  if (!version) throw new Error('BOQ version not found');

  const budgetTotal  = version.totalAmount || 0;
  const actualTotal  = transactions.reduce((s, t) => s + (t.amount || 0), 0);
  const variance     = actualTotal - budgetTotal;
  const variancePct  = budgetTotal > 0 ? Math.round((variance / budgetTotal) * 10000) / 100 : null;

  return {
    projectId,
    versionId,
    budgetTotal,
    actualTotal,
    variance,
    variancePct,
    status: variance > 0 ? 'OVER_BUDGET' : variance < 0 ? 'UNDER_BUDGET' : 'ON_BUDGET',
    completionPct: budgetTotal > 0 ? Math.min(100, Math.round((actualTotal / budgetTotal) * 100)) : 0,
  };
}

module.exports = {
  // Library
  createLibraryItem,
  updateLibraryItem,
  deleteLibraryItem,
  searchLibrary,
  getLibraryCategories,
  // Rate application
  applyFactors,
  getAdjustedRate,
  applyLibraryRateToBOQItem,
  // Material rates
  recordMaterialRate,
  getMaterialRateHistory,
  getCurrentMaterialRates,
  // Estimation
  estimateFromFloorPlan,
  varianceAnalysis,
  // Constants
  LOCATION_FACTORS,
  QUALITY_FACTORS,
};
