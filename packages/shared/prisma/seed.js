/**
 * Construct-OS — Demo Seed
 *
 * Creates one demo company + one temp account per portal role.
 *
 * Run:  node packages/shared/prisma/seed.js
 *   OR  npm run db:seed   (from project root)
 *
 * ┌──────────────────────┬────────────────────────────┬────────────┐
 * │ Portal               │ Email                      │ Password   │
 * ├──────────────────────┼────────────────────────────┼────────────┤
 * │ Admin                │ admin@demo.cos             │ Demo@1234  │
 * │ Project Manager      │ pm@demo.cos                │ Demo@1234  │
 * │ Architect            │ arch@demo.cos              │ Demo@1234  │
 * │ Structural Engineer  │ struct@demo.cos            │ Demo@1234  │
 * │ Quantity Surveyor    │ qs@demo.cos                │ Demo@1234  │
 * │ Procurement          │ proc@demo.cos              │ Demo@1234  │
 * │ HR Manager           │ hr@demo.cos                │ Demo@1234  │
 * │ Finance Manager      │ finance@demo.cos           │ Demo@1234  │
 * │ Client               │ client@demo.cos            │ Demo@1234  │
 * └──────────────────────┴────────────────────────────┴────────────┘
 */

'use strict';

const { PrismaClient } = require('@prisma/client');
const bcrypt           = require('bcryptjs');

const prisma = new PrismaClient();

const PASS      = 'Demo@1234';
const DEMO_SLUG = 'construct-demo-corp';

const USERS = [
  { name: 'Demo Admin',              email: 'admin@demo.cos',   role: 'ADMIN'               },
  { name: 'Demo Project Manager',    email: 'pm@demo.cos',      role: 'PROJECT_MANAGER'      },
  { name: 'Demo Architect',          email: 'arch@demo.cos',    role: 'ARCHITECT'            },
  { name: 'Demo Structural Engineer',email: 'struct@demo.cos',  role: 'STRUCTURAL_ENGINEER'  },
  { name: 'Demo Quantity Surveyor',  email: 'qs@demo.cos',      role: 'QUANTITY_SURVEYOR'    },
  { name: 'Demo Procurement Officer',email: 'proc@demo.cos',    role: 'PROCUREMENT'          },
  { name: 'Demo HR Manager',         email: 'hr@demo.cos',      role: 'HR'                   },
  { name: 'Demo Finance Manager',    email: 'finance@demo.cos', role: 'FINANCE'              },
  { name: 'Demo Client',             email: 'client@demo.cos',  role: 'CLIENT'               },
];

async function main() {
  console.log('🌱  Construct-OS demo seed starting…\n');

  const passwordHash = await bcrypt.hash(PASS, 12);

  // ── 1. Upsert demo company ───────────────────────────────────────────────
  const company = await prisma.company.upsert({
    where:  { slug: DEMO_SLUG },
    update: {},
    create: {
      name:    'Construct Demo Corp',
      slug:    DEMO_SLUG,
      country: 'UG',
      plan:    'PROFESSIONAL',
    },
  });
  console.log(`✅  Company: ${company.name}  (id: ${company.id})`);

  // ── 2. Upsert each user ──────────────────────────────────────────────────
  const createdUsers = {};

  for (const u of USERS) {
    const user = await prisma.user.upsert({
      where:  { email: u.email },
      update: { passwordHash, name: u.name, role: u.role, isActive: true },
      create: {
        companyId:    company.id,
        name:         u.name,
        email:        u.email,
        passwordHash,
        role:         u.role,
        isActive:     true,
      },
    });
    createdUsers[u.role] = user;
    console.log(`✅  ${u.role.padEnd(22)} → ${u.email}`);
  }

  // ── 3. Create a demo project ─────────────────────────────────────────────
  const project = await prisma.project.upsert({
    where:  { companyId_slug: { companyId: company.id, slug: 'nakasero-demo-tower' } },
    update: {},
    create: {
      companyId:       company.id,
      name:            'Nakasero Demo Tower',
      slug:            'nakasero-demo-tower',
      description:     'A 10-storey mixed-use development in Nakasero, Kampala.',
      status:          'ACTIVE',
      location:        'Nakasero, Kampala, Uganda',
      currency:        'UGX',
      estimatedBudget: 12_500_000_000,   // 12.5 billion UGX
      startDate:       new Date('2026-01-15'),
      endDate:         new Date('2027-06-30'),
      completionPct:   18,
    },
  });
  console.log(`\n✅  Demo project: ${project.name}  (id: ${project.id})`);

  // ── 4. Add project members (skip CLIENT role) ────────────────────────────
  const memberRoles = [
    'ADMIN', 'PROJECT_MANAGER', 'ARCHITECT', 'STRUCTURAL_ENGINEER',
    'QUANTITY_SURVEYOR', 'PROCUREMENT', 'HR', 'FINANCE',
  ];

  for (const role of memberRoles) {
    const user = createdUsers[role];
    if (!user) continue;
    await prisma.projectMember.upsert({
      where:  { projectId_userId: { projectId: project.id, userId: user.id } },
      update: {},
      create: { projectId: project.id, userId: user.id, role: user.role, isLead: role === 'PROJECT_MANAGER' },
    });
  }
  console.log(`✅  Project members linked`);

  // ── 5. Seed phases ───────────────────────────────────────────────────────
  const phases = [
    { name: 'Substructure',    order: 1, status: 'DONE',        startDate: new Date('2026-01-15'), endDate: new Date('2026-03-15') },
    { name: 'Superstructure',  order: 2, status: 'IN_PROGRESS', startDate: new Date('2026-03-16'), endDate: new Date('2026-09-30') },
    { name: 'Finishes & MEP',  order: 3, status: 'BACKLOG',     startDate: new Date('2026-10-01'), endDate: new Date('2027-03-31') },
    { name: 'External Works',  order: 4, status: 'BACKLOG',     startDate: new Date('2027-04-01'), endDate: new Date('2027-06-30') },
  ];

  const createdPhases = [];
  for (const p of phases) {
    const existing = await prisma.phase.findFirst({ where: { projectId: project.id, name: p.name } });
    if (existing) { createdPhases.push(existing); continue; }
    const phase = await prisma.phase.create({ data: { projectId: project.id, ...p } });
    createdPhases.push(phase);
  }
  console.log(`✅  ${createdPhases.length} phases created`);

  // ── 6. Seed a few tasks ──────────────────────────────────────────────────
  const pmUser = createdUsers['PROJECT_MANAGER'];
  const structUser = createdUsers['STRUCTURAL_ENGINEER'];

  const tasks = [
    { title: 'Geotechnical survey',    status: 'DONE',        priority: 'HIGH',     phaseIdx: 0, assigneeId: pmUser?.id },
    { title: 'Foundation design',      status: 'DONE',        priority: 'CRITICAL', phaseIdx: 0, assigneeId: structUser?.id },
    { title: 'Basement slab pour',     status: 'DONE',        priority: 'HIGH',     phaseIdx: 0, assigneeId: pmUser?.id },
    { title: 'Ground floor columns',   status: 'IN_PROGRESS', priority: 'HIGH',     phaseIdx: 1, assigneeId: structUser?.id },
    { title: 'Level 1 slab',           status: 'IN_PROGRESS', priority: 'HIGH',     phaseIdx: 1, assigneeId: pmUser?.id },
    { title: 'Level 2 formwork',       status: 'TODO',        priority: 'MEDIUM',   phaseIdx: 1, assigneeId: pmUser?.id },
    { title: 'Electrical rough-in',    status: 'BACKLOG',     priority: 'MEDIUM',   phaseIdx: 2, assigneeId: pmUser?.id },
    { title: 'Plastering — Level 1-5', status: 'BACKLOG',     priority: 'LOW',      phaseIdx: 2, assigneeId: pmUser?.id },
  ];

  for (const t of tasks) {
    const phase = createdPhases[t.phaseIdx];
    if (!phase) continue;
    const exists = await prisma.task.findFirst({ where: { projectId: project.id, title: t.title } });
    if (!exists) {
      await prisma.task.create({
        data: {
          projectId:  project.id,
          phaseId:    phase.id,
          title:      t.title,
          status:     t.status,
          priority:   t.priority,
          assigneeId: t.assigneeId || null,
          dueDate:    new Date(Date.now() + (t.phaseIdx + 1) * 30 * 24 * 60 * 60 * 1000),
        },
      });
    }
  }
  console.log(`✅  Demo tasks created`);

  // ── 7. Seed a BOQ version ────────────────────────────────────────────────
  const qsUser = createdUsers['QUANTITY_SURVEYOR'];
  if (qsUser) {
    const existingBOQ = await prisma.bOQVersion.findFirst({ where: { projectId: project.id } });
    if (!existingBOQ) {
      const boq = await prisma.bOQVersion.create({
        data: {
          projectId:   project.id,
          companyId:   company.id,
          createdById: qsUser.id,
          versionNo:   1,
          name:        'Revised Contract BOQ v1',
          status:      'APPROVED',
          totalAmount: 11_850_000_000,
        },
      });

      // Add stages
      const stageData = [
        { name: 'Substructure',  position: 1, totalCost: 2_200_000_000 },
        { name: 'Superstructure',position: 2, totalCost: 5_100_000_000 },
        { name: 'Finishes',      position: 3, totalCost: 2_800_000_000 },
        { name: 'MEP Services',  position: 4, totalCost: 1_200_000_000 },
        { name: 'External Works',position: 5, totalCost:   550_000_000 },
      ];

      for (const s of stageData) {
        const stage = await prisma.bOQStage.create({
          data: { versionId: boq.id, companyId: company.id, name: s.name, position: s.position, totalCost: s.totalCost },
        });

        await prisma.bOQItem.create({
          data: {
            stageId:      stage.id,
            rowIndex:     0,
            description:  `${s.name} — Prime cost sum`,
            unit:         'sum',
            quantity:     1,
            netQuantity:  1,
            unitRate:     s.totalCost * 0.8,
            labourRate:   50_000,
            labourHours:  1_000,
            materialCost: s.totalCost * 0.8,
            labourCost:   s.totalCost * 0.2,
            subtotal:     s.totalCost * 0.95,
            markupPercent:5,
            totalCost:    s.totalCost,
            status:       'APPROVED',
          },
        });
      }
      console.log(`✅  Demo BOQ seeded  (total: UGX ${(11_850_000_000 / 1e9).toFixed(2)}B)`);
    }
  }

  // ── 8. Seed a supplier ───────────────────────────────────────────────────
  const existingSupplier = await prisma.supplier.findFirst({ where: { companyId: company.id, name: 'Hima Cement Uganda Ltd' } });
  if (!existingSupplier) {
    await prisma.supplier.create({
      data: {
        companyId:  company.id,
        name:       'Hima Cement Uganda Ltd',
        code:       'SUP-001',
        email:      'sales@hima.co.ug',
        phone:      '+256 414 300 000',
        categories: ['CONCRETE', 'MASONRY'],
        isApproved: true,
        rating:     4.5,
        country:    'UG',
      },
    });
    await prisma.supplier.create({
      data: {
        companyId:  company.id,
        name:       'Roofings Rolling Mills Ltd',
        code:       'SUP-002',
        email:      'info@roofings.com',
        phone:      '+256 312 261 000',
        categories: ['STEEL'],
        isApproved: true,
        rating:     4.2,
        country:    'UG',
      },
    });
    console.log(`✅  Demo suppliers seeded`);
  }

  // ── 9. Seed demo invoice ─────────────────────────────────────────────────
  const existingInv = await prisma.invoice.findFirst({ where: { projectId: project.id } });
  if (!existingInv) {
    await prisma.invoice.create({
      data: {
        companyId:     company.id,
        projectId:     project.id,
        invoiceNumber: 'INV-2026-0001',
        type:          'SALES',
        clientName:    'Uganda National Roads Authority',
        clientEmail:   'finance@unra.go.ug',
        dueDate:       new Date('2026-05-31'),
        items:         [
          { desc: 'Substructure works — Phase 1 certificate', qty: 1, rate: 2_200_000_000, amount: 2_200_000_000 },
        ],
        subtotal:      2_200_000_000,
        taxRate:       0.18,
        taxAmount:     396_000_000,
        totalAmount:   2_596_000_000,
        balance:       2_596_000_000,
        amountPaid:    0,
        status:        'SENT',
        currency:      'UGX',
      },
    });
    console.log(`✅  Demo invoice seeded`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║          Construct-OS  —  Demo Accounts Ready           ║');
  console.log('╠═══════════════════════════╦═══════════════════╦══════════╣');
  console.log('║ Portal                    ║ Email             ║ Password ║');
  console.log('╠═══════════════════════════╬═══════════════════╬══════════╣');
  console.log('║ Admin                     ║ admin@demo.cos    ║ Demo@1234║');
  console.log('║ Project Manager           ║ pm@demo.cos       ║ Demo@1234║');
  console.log('║ Architect                 ║ arch@demo.cos     ║ Demo@1234║');
  console.log('║ Structural Engineer       ║ struct@demo.cos   ║ Demo@1234║');
  console.log('║ Quantity Surveyor         ║ qs@demo.cos       ║ Demo@1234║');
  console.log('║ Procurement               ║ proc@demo.cos     ║ Demo@1234║');
  console.log('║ HR Manager                ║ hr@demo.cos       ║ Demo@1234║');
  console.log('║ Finance Manager           ║ finance@demo.cos  ║ Demo@1234║');
  console.log('║ Client                    ║ client@demo.cos   ║ Demo@1234║');
  console.log('╚═══════════════════════════╩═══════════════════╩══════════╝');
  console.log('\n🚀  All done! Start the stack with:  npm run dev\n');
}

main()
  .catch(e => { console.error('❌  Seed failed:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
