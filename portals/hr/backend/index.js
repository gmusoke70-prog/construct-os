/**
 * HR Portal Backend  (port 3009)
 *
 * Routes:
 *   GET  /api/hr/employees              - list employees
 *   POST /api/hr/employees              - onboard employee
 *   GET  /api/hr/employees/:id          - employee profile
 *   PATCH /api/hr/employees/:id         - update employee
 *   GET  /api/hr/attendance             - attendance records
 *   POST /api/hr/attendance             - log attendance
 *   GET  /api/hr/timesheets             - timesheets
 *   POST /api/hr/timesheets             - submit timesheet
 *   PATCH /api/hr/timesheets/:id/approve
 *   GET  /api/hr/leave-requests         - leave requests
 *   POST /api/hr/leave-requests         - submit leave
 *   PATCH /api/hr/leave-requests/:id    - approve/reject leave
 *   GET  /api/hr/payroll                - payroll records
 *   POST /api/hr/payroll/run            - run payroll for period
 *   GET  /api/hr/dashboard              - HR KPIs
 */

'use strict';

const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../../../packages/shared/middleware/auth');

const prisma = new PrismaClient();
const app    = express();
const PORT   = process.env.HR_PORT || 3009;

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json());
app.use(requireAuth);

const HR_ROLES    = ['HR_MANAGER', 'ADMIN', 'OWNER'];
const FINANCE_ROLES = ['FINANCE_MANAGER', 'ADMIN', 'OWNER'];

app.get('/health', (_, res) => res.json({ service: 'hr-portal', status: 'ok' }));

// ─── Employees ────────────────────────────────────────────────────────────────
app.get('/api/hr/employees', async (req, res) => {
  try {
    const { q, department, status } = req.query;
    const employees = await prisma.employee.findMany({
      where: {
        companyId: req.user.companyId,
        ...(department && { department }),
        ...(status     && { status }),
        ...(q && { OR: [
          { firstName: { contains: q, mode: 'insensitive' } },
          { lastName:  { contains: q, mode: 'insensitive' } },
          { email:     { contains: q, mode: 'insensitive' } },
          { role:      { contains: q, mode: 'insensitive' } },
        ] }),
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    res.json({ employees });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/hr/employees', requireRole(HR_ROLES), async (req, res) => {
  try {
    const emp = await prisma.employee.create({
      data: {
        companyId:    req.user.companyId,
        firstName:    req.body.firstName,
        lastName:     req.body.lastName,
        email:        req.body.email       || null,
        phone:        req.body.phone       || null,
        role:         req.body.role        || 'WORKER',
        department:   req.body.department  || 'SITE',
        hireDate:     req.body.hireDate    ? new Date(req.body.hireDate) : new Date(),
        baseSalary:   Number(req.body.baseSalary)   || 0,
        dailyRate:    Number(req.body.dailyRate)    || 0,
        nationalId:   req.body.nationalId  || null,
        contractType: req.body.contractType|| 'PERMANENT',
        status:       'ACTIVE',
      },
    });
    res.status(201).json({ employee: emp });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/hr/employees/:id', async (req, res) => {
  try {
    const emp = await prisma.employee.findFirst({
      where:   { id: req.params.id, companyId: req.user.companyId },
      include: {
        attendanceRecords: { orderBy: { date: 'desc' }, take: 30 },
        timesheets:        { orderBy: { weekStart: 'desc' }, take: 10 },
        leaveRequests:     { orderBy: { createdAt: 'desc' }, take: 10 },
        payrollRecords:    { orderBy: { id: 'desc' }, take: 6 },
      },
    });
    if (!emp) return res.status(404).json({ error: 'Employee not found' });
    res.json({ employee: emp });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/hr/employees/:id', requireRole(HR_ROLES), async (req, res) => {
  try {
    const emp = await prisma.employee.update({
      where: { id: req.params.id, companyId: req.user.companyId },
      data:  { ...req.body, updatedAt: new Date() },
    });
    res.json({ employee: emp });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Attendance ───────────────────────────────────────────────────────────────
app.get('/api/hr/attendance', async (req, res) => {
  try {
    const { employeeId, from, to, projectId } = req.query;
    const records = await prisma.attendance.findMany({
      where: {
        employee: { companyId: req.user.companyId },
        ...(employeeId && { employeeId }),
        ...(projectId  && { projectId }),
        ...(from       && { date: { gte: new Date(from) } }),
        ...(to         && { date: { lte: new Date(to)   } }),
      },
      include: { employee: { select: { id: true, firstName: true, lastName: true, role: true } } },
      orderBy: { date: 'desc' },
    });
    res.json({ records });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/hr/attendance', requireRole([...HR_ROLES, 'SITE_MANAGER']), async (req, res) => {
  try {
    const records = Array.isArray(req.body) ? req.body : [req.body];
    const created = await prisma.$transaction(
      records.map(r => prisma.attendance.upsert({
        where:  { employeeId_date: { employeeId: r.employeeId, date: new Date(r.date) } },
        create: {
          employeeId: r.employeeId,
          projectId:  r.projectId || null,
          date:       new Date(r.date),
          type:       r.type        || 'PRESENT',
          checkIn:    r.checkIn    || null,
          checkOut:   r.checkOut   || null,
          hoursWorked:Number(r.hoursWorked) || 8,
          notes:      r.notes      || null,
          userId:     req.user.id,
        },
        update: {
          type:        r.type        || 'PRESENT',
          hoursWorked: Number(r.hoursWorked) || 8,
          checkIn:     r.checkIn    || null,
          checkOut:    r.checkOut   || null,
          notes:       r.notes      || null,
        },
      }))
    );
    res.status(201).json({ records: created });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Timesheets ───────────────────────────────────────────────────────────────
app.get('/api/hr/timesheets', async (req, res) => {
  try {
    const sheets = await prisma.timesheet.findMany({
      where: {
        employee: { companyId: req.user.companyId },
        ...(req.query.employeeId && { employeeId: req.query.employeeId }),
        ...(req.query.status     && { status:     req.query.status }),
      },
      include: { employee: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { weekStart: 'desc' },
    });
    res.json({ sheets });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/hr/timesheets', async (req, res) => {
  try {
    const sheet = await prisma.timesheet.create({
      data: {
        employeeId:   req.body.employeeId,
        projectId:    req.body.projectId || null,
        weekStart:    new Date(req.body.weekStart),
        weekEnd:      new Date(req.body.weekEnd),
        regularHours: Number(req.body.regularHours) || 0,
        overtimeHours:Number(req.body.overtimeHours)|| 0,
        dailyEntries: req.body.dailyEntries          || {},
        status:       'PENDING',
        submittedAt:  new Date(),
      },
    });
    res.status(201).json({ sheet });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/hr/timesheets/:id/approve', requireRole(HR_ROLES), async (req, res) => {
  try {
    const sheet = await prisma.timesheet.update({
      where: { id: req.params.id },
      data:  { status: req.body.approved ? 'APPROVED' : 'REJECTED', approvedBy: req.user.id, approvedAt: new Date(), rejectionReason: req.body.reason || null },
    });
    res.json({ sheet });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Leave Requests ───────────────────────────────────────────────────────────
app.get('/api/hr/leave-requests', async (req, res) => {
  try {
    const requests = await prisma.leaveRequest.findMany({
      where: {
        employee: { companyId: req.user.companyId },
        ...(req.query.status     && { status:     req.query.status }),
        ...(req.query.employeeId && { employeeId: req.query.employeeId }),
      },
      include: { employee: { select: { id: true, firstName: true, lastName: true, role: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ requests });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/hr/leave-requests', async (req, res) => {
  try {
    const start = new Date(req.body.startDate);
    const end   = new Date(req.body.endDate);
    const days  = Math.ceil((end - start) / 86400000) + 1;

    const request = await prisma.leaveRequest.create({
      data: {
        employeeId: req.body.employeeId || req.user.id,
        leaveType:  req.body.leaveType   || 'ANNUAL',
        startDate:  start,
        endDate:    end,
        days,
        reason:     req.body.reason      || '',
        status:     'PENDING',
        submittedAt: new Date(),
      },
    });
    res.status(201).json({ request });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/hr/leave-requests/:id', requireRole(HR_ROLES), async (req, res) => {
  try {
    const request = await prisma.leaveRequest.update({
      where: { id: req.params.id },
      data:  { status: req.body.status, approvedBy: req.user.id, reviewedAt: new Date(), hrNotes: req.body.notes || null },
    });
    res.json({ request });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Payroll ──────────────────────────────────────────────────────────────────
app.get('/api/hr/payroll', async (req, res) => {
  try {
    const records = await prisma.payrollRecord.findMany({
      where: {
        employee: { companyId: req.user.companyId },
        ...(req.query.employeeId && { employeeId: req.query.employeeId }),
        ...(req.query.period     && { period:     req.query.period }),
      },
      include: { employee: { select: { id: true, firstName: true, lastName: true, role: true } } },
      orderBy: { periodStart: 'desc' },
    });
    res.json({ records });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/hr/payroll/run', requireRole(FINANCE_ROLES), async (req, res) => {
  try {
    const { periodStart, periodEnd, projectId } = req.body;
    const start = new Date(periodStart);
    const end   = new Date(periodEnd);

    const employees = await prisma.employee.findMany({
      where:   { companyId: req.user.companyId, status: 'ACTIVE' },
      include: {
        attendanceRecords: { where: { date: { gte: start, lte: end } } },
        timesheets:        { where: { weekStart: { gte: start }, status: 'APPROVED' } },
      },
    });

    const payrollRecords = [];

    for (const emp of employees) {
      const daysWorked    = emp.attendanceRecords.filter(a => a.type === 'PRESENT').length;
      const overtimeHours = emp.timesheets.reduce((s, t) => s + (t.overtimeHours || 0), 0);
      const basePay       = emp.dailyRate > 0 ? emp.dailyRate * daysWorked : emp.baseSalary;
      const overtimePay   = overtimeHours * ((emp.dailyRate || emp.baseSalary / 22) * 1.5 / 8);
      const grossPay      = basePay + overtimePay;
      // NSSF 10% employee, 10% employer — Uganda
      const nssfEmployee  = grossPay * 0.10;
      const paye          = computePAYE(grossPay);   // Uganda PAYE
      const netPay        = grossPay - nssfEmployee - paye;

      const record = await prisma.payrollRecord.create({
        data: {
          employeeId:   emp.id,
          companyId:    req.user.companyId,
          projectId:    projectId || null,
          period:       `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}`,
          periodStart:  start,
          periodEnd:    end,
          daysWorked,
          overtimeHours,
          basePay:      Math.round(basePay),
          overtimePay:  Math.round(overtimePay),
          grossPay:     Math.round(grossPay),
          nssfEmployee: Math.round(nssfEmployee),
          nssfEmployer: Math.round(grossPay * 0.10),
          paye:         Math.round(paye),
          netPay:       Math.round(netPay),
          status:       'DRAFT',
          processedBy:  req.user.id,
          processedAt:  new Date(),
        },
      });
      payrollRecords.push(record);
    }

    res.status(201).json({
      message:     `Payroll run: ${payrollRecords.length} employees processed`,
      totalGross:  payrollRecords.reduce((s, r) => s + r.grossPay, 0),
      totalNet:    payrollRecords.reduce((s, r) => s + r.netPay,   0),
      records:     payrollRecords,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Uganda PAYE 2024 tax bands (monthly, UGX)
function computePAYE(gross) {
  const g = gross;
  if (g <= 235000)   return 0;
  if (g <= 335000)   return (g - 235000) * 0.10;
  if (g <= 410000)   return 10000 + (g - 335000) * 0.20;
  if (g <= 10000000) return 25000 + (g - 410000) * 0.30;
  return 2876700 + (g - 10000000) * 0.40;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
app.get('/api/hr/dashboard', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const today     = new Date();
    today.setHours(0,0,0,0);

    const [emps, todayAttendance, pendingLeave, pendingTimesheets] = await Promise.all([
      prisma.employee.findMany({ where: { companyId }, select: { status: true, role: true, department: true } }),
      prisma.attendance.count({ where: { employee: { companyId }, date: { gte: today }, type: 'PRESENT' } }),
      prisma.leaveRequest.count({ where: { employee: { companyId }, status: 'PENDING' } }),
      prisma.timesheet.count({    where: { employee: { companyId }, status: 'PENDING' } }),
    ]);

    const byDept = {};
    for (const e of emps) {
      byDept[e.department] = (byDept[e.department] || 0) + 1;
    }

    res.json({
      totalEmployees:      emps.length,
      activeEmployees:     emps.filter(e => e.status === 'ACTIVE').length,
      presentToday:        todayAttendance,
      attendanceRate:      emps.length ? Math.round((todayAttendance / emps.length) * 100) : 0,
      pendingLeave,
      pendingTimesheets,
      byDepartment:        byDept,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const copilotRouter = require('../../../packages/shared/routes/copilot');
app.use('/api/copilot', copilotRouter);

app.listen(PORT, () => console.log(`HR Portal listening on port ${PORT}`));
module.exports = app;
