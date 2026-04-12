/**
 * Finance Portal Backend  (port 3010)
 *
 * Routes:
 *   GET  /api/finance/dashboard         - KPI summary
 *   GET  /api/finance/budgets           - budgets
 *   POST /api/finance/budgets           - create budget
 *   PATCH /api/finance/budgets/:id      - update budget
 *   GET  /api/finance/transactions      - transactions (with filters)
 *   POST /api/finance/transactions      - record transaction
 *   GET  /api/finance/invoices          - invoices
 *   POST /api/finance/invoices          - create invoice
 *   PATCH /api/finance/invoices/:id     - update invoice
 *   POST /api/finance/invoices/:id/send - mark as sent
 *   POST /api/finance/invoices/:id/pay  - mark as paid
 *   GET  /api/finance/cashflow          - cashflow projection
 *   GET  /api/finance/reports/pl        - P&L report
 */

'use strict';

const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../../../packages/shared/middleware/auth');

const prisma = new PrismaClient();
const app    = express();
const PORT   = process.env.FINANCE_PORT || 3010;

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json());
app.use(requireAuth);

const FIN_ROLES = ['FINANCE_MANAGER', 'ADMIN', 'OWNER'];

app.get('/health', (_, res) => res.json({ service: 'finance-portal', status: 'ok' }));

// ─── Dashboard ────────────────────────────────────────────────────────────────
app.get('/api/finance/dashboard', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const now       = new Date();
    const monthStart= new Date(now.getFullYear(), now.getMonth(), 1);

    const [budgets, transactions, invoices] = await Promise.all([
      prisma.budget.findMany({ where: { companyId }, select: { totalAmount: true, spentAmount: true, status: true } }),
      prisma.transaction.findMany({ where: { companyId, createdAt: { gte: monthStart } }, select: { type: true, amount: true } }),
      prisma.invoice.findMany({ where: { companyId }, select: { status: true, totalAmount: true, dueDate: true } }),
    ]);

    const totalBudget   = budgets.reduce((s, b) => s + (b.totalAmount || 0), 0);
    const totalSpent    = budgets.reduce((s, b) => s + (b.spentAmount  || 0), 0);
    const monthIncome   = transactions.filter(t => t.type === 'INCOME').reduce((s, t) => s + (t.amount||0), 0);
    const monthExpense  = transactions.filter(t => t.type === 'EXPENSE').reduce((s, t) => s + (t.amount||0), 0);
    const overdueInv    = invoices.filter(i => i.status !== 'PAID' && i.dueDate && new Date(i.dueDate) < now);
    const overdueAmount = overdueInv.reduce((s, i) => s + (i.totalAmount||0), 0);
    const receivables   = invoices.filter(i => ['SENT','OVERDUE'].includes(i.status)).reduce((s, i) => s + (i.totalAmount||0), 0);

    res.json({
      totalBudget,
      totalSpent,
      budgetUtilisation: totalBudget > 0 ? Math.round((totalSpent/totalBudget)*100) : 0,
      monthIncome,
      monthExpense,
      monthNet:          monthIncome - monthExpense,
      overdueInvoices:   overdueInv.length,
      overdueAmount,
      receivables,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Budgets ──────────────────────────────────────────────────────────────────
app.get('/api/finance/budgets', async (req, res) => {
  try {
    const budgets = await prisma.budget.findMany({
      where:   { companyId: req.user.companyId, ...(req.query.projectId && { projectId: req.query.projectId }) },
      include: { project: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ budgets });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/finance/budgets', requireRole(FIN_ROLES), async (req, res) => {
  try {
    const budget = await prisma.budget.create({
      data: {
        companyId:   req.user.companyId,
        projectId:   req.body.projectId || null,
        name:        req.body.name,
        description: req.body.description || '',
        totalAmount: Number(req.body.totalAmount) || 0,
        spentAmount: 0,
        startDate:   req.body.startDate ? new Date(req.body.startDate) : null,
        endDate:     req.body.endDate   ? new Date(req.body.endDate)   : null,
        status:      'ACTIVE',
        createdBy:   req.user.id,
        breakdown:   req.body.breakdown || {},
      },
    });
    res.status(201).json({ budget });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/finance/budgets/:id', requireRole(FIN_ROLES), async (req, res) => {
  try {
    const budget = await prisma.budget.update({
      where: { id: req.params.id, companyId: req.user.companyId },
      data:  { ...req.body, updatedAt: new Date() },
    });
    res.json({ budget });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Transactions ─────────────────────────────────────────────────────────────
app.get('/api/finance/transactions', async (req, res) => {
  try {
    const { projectId, type, from, to, page = 1, limit = 50 } = req.query;
    const where = {
      companyId: req.user.companyId,
      ...(projectId && { projectId }),
      ...(type      && { type }),
      ...(from      && { createdAt: { gte: new Date(from) } }),
      ...(to        && { createdAt: { lte: new Date(to)   } }),
    };
    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip:    (Number(page)-1) * Number(limit),
        take:    Number(limit),
      }),
      prisma.transaction.count({ where }),
    ]);
    res.json({ transactions, total, page: Number(page), pages: Math.ceil(total/Number(limit)) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/finance/transactions', requireRole(FIN_ROLES), async (req, res) => {
  try {
    const tx = await prisma.transaction.create({
      data: {
        companyId:   req.user.companyId,
        projectId:   req.body.projectId   || null,
        budgetId:    req.body.budgetId    || null,
        type:        req.body.type,       // 'INCOME' | 'EXPENSE' | 'TRANSFER'
        amount:      Number(req.body.amount),
        description: req.body.description,
        category:    req.body.category    || null,
        method:      req.body.method      || 'BANK',
        reference:   req.body.reference   || null,
        date:        req.body.date ? new Date(req.body.date) : new Date(),
        createdBy:   req.user.id,
        attachments: req.body.attachmentUrl ? [req.body.attachmentUrl] : [],
      },
    });

    // Update budget spent amount if linked
    if (tx.budgetId && tx.type === 'EXPENSE') {
      await prisma.budget.update({
        where: { id: tx.budgetId },
        data:  { spentAmount: { increment: tx.amount } },
      });
    }

    res.status(201).json({ transaction: tx });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Invoices ─────────────────────────────────────────────────────────────────
app.get('/api/finance/invoices', async (req, res) => {
  try {
    const invoices = await prisma.invoice.findMany({
      where: {
        companyId: req.user.companyId,
        ...(req.query.projectId && { projectId: req.query.projectId }),
        ...(req.query.status    && { status:    req.query.status }),
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ invoices });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/finance/invoices', requireRole(FIN_ROLES), async (req, res) => {
  try {
    const { projectId, clientName, clientEmail, lineItems = [], dueDate, notes, taxRate = 18 } = req.body;
    const subtotal = lineItems.reduce((s, i) => s + (Number(i.quantity) * Number(i.unitPrice)), 0);
    const tax      = subtotal * (taxRate / 100);
    const total    = subtotal + tax;

    const invoice = await prisma.invoice.create({
      data: {
        companyId:    req.user.companyId,
        projectId:    projectId || null,
        clientName,
        clientEmail:  clientEmail || null,
        items:        lineItems,
        subtotal:     Math.round(subtotal),
        taxRate,
        taxAmount:    Math.round(tax),
        totalAmount:  Math.round(total),
        balance:      Math.round(total),
        amountPaid:   0,
        dueDate:      dueDate ? new Date(dueDate) : null,
        notes:        notes  || null,
        status:       'DRAFT',
        invoiceNumber: await generateInvoiceNumber(req.user.companyId),
      },
    });
    res.status(201).json({ invoice });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function generateInvoiceNumber(companyId) {
  const count = await prisma.invoice.count({ where: { companyId } });
  return `INV-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;
}

app.patch('/api/finance/invoices/:id', requireRole(FIN_ROLES), async (req, res) => {
  try {
    const invoice = await prisma.invoice.update({
      where: { id: req.params.id, companyId: req.user.companyId },
      data:  { ...req.body, updatedAt: new Date() },
    });
    res.json({ invoice });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/finance/invoices/:id/send', requireRole(FIN_ROLES), async (req, res) => {
  try {
    const invoice = await prisma.invoice.update({
      where: { id: req.params.id, companyId: req.user.companyId },
      data:  { status: 'SENT' },
    });
    res.json({ invoice });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/finance/invoices/:id/pay', requireRole(FIN_ROLES), async (req, res) => {
  try {
    const invoice = await prisma.invoice.update({
      where: { id: req.params.id, companyId: req.user.companyId },
      data:  { status: 'PAID', paidAt: new Date(), amountPaid: req.body.amount || undefined },
    });
    // Record income transaction
    await prisma.transaction.create({
      data: {
        companyId:   req.user.companyId,
        projectId:   invoice.projectId || null,
        type:        'INCOME',
        amount:      invoice.totalAmount,
        description: `Payment for invoice ${invoice.invoiceNumber}`,
        method:      req.body.method || 'BANK',
        reference:   invoice.invoiceNumber,
        date:        new Date(),
        createdBy:   req.user.id,
      },
    });
    res.json({ invoice });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Cash flow projection ─────────────────────────────────────────────────────
app.get('/api/finance/cashflow', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const months    = parseInt(req.query.months) || 6;
    const now       = new Date();
    const result    = [];

    for (let m = 0; m < months; m++) {
      const start = new Date(now.getFullYear(), now.getMonth() + m, 1);
      const end   = new Date(now.getFullYear(), now.getMonth() + m + 1, 0);

      const [income, expense] = await Promise.all([
        prisma.transaction.aggregate({ where: { companyId, type: 'INCOME',  date: { gte: start, lte: end } }, _sum: { amount: true } }),
        prisma.transaction.aggregate({ where: { companyId, type: 'EXPENSE', date: { gte: start, lte: end } }, _sum: { amount: true } }),
      ]);

      // Projected from pending invoices
      const pendingInvoices = await prisma.invoice.aggregate({
        where: { companyId, status: { in: ['SENT'] }, dueDate: { gte: start, lte: end } },
        _sum: { totalAmount: true },
      });

      const inc  = income.  _sum.amount       || 0;
      const exp  = expense. _sum.amount       || 0;
      const proj = pendingInvoices._sum.totalAmount || 0;

      result.push({
        month:        start.toISOString().slice(0, 7),
        income:       inc,
        expense:      exp,
        net:          inc - exp,
        projectedIn:  proj,
        projectedNet: inc + proj - exp,
      });
    }

    res.json({ cashflow: result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── P&L Report ───────────────────────────────────────────────────────────────
app.get('/api/finance/reports/pl', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const from      = req.query.from ? new Date(req.query.from) : new Date(new Date().getFullYear(), 0, 1);
    const to        = req.query.to   ? new Date(req.query.to)   : new Date();

    const [income, expense] = await Promise.all([
      prisma.transaction.groupBy({
        by:    ['category'],
        where: { companyId, type: 'INCOME',  date: { gte: from, lte: to } },
        _sum:  { amount: true },
      }),
      prisma.transaction.groupBy({
        by:    ['category'],
        where: { companyId, type: 'EXPENSE', date: { gte: from, lte: to } },
        _sum:  { amount: true },
      }),
    ]);

    const totalIncome  = income. reduce((s, r) => s + (r._sum.amount||0), 0);
    const totalExpense = expense.reduce((s, r) => s + (r._sum.amount||0), 0);

    res.json({
      period:   { from: from.toISOString().slice(0,10), to: to.toISOString().slice(0,10) },
      income:   income. map(r => ({ category: r.category || 'Other', amount: r._sum.amount || 0 })),
      expense:  expense.map(r => ({ category: r.category || 'Other', amount: r._sum.amount || 0 })),
      totalIncome,
      totalExpense,
      grossProfit:  totalIncome - totalExpense,
      profitMargin: totalIncome > 0 ? Math.round(((totalIncome - totalExpense)/totalIncome)*10000)/100 : 0,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const copilotRouter = require('../../../packages/shared/routes/copilot');
app.use('/api/copilot', copilotRouter);

app.listen(PORT, () => console.log(`Finance Portal listening on port ${PORT}`));
module.exports = app;
