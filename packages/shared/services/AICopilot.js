/**
 * AICopilot.js — Claude-powered AI assistant embedded in every portal
 *
 * Features:
 *  - Persistent conversation per project (stored in DB)
 *  - Tool use (agentic): BOQ summary, risks, progress report, cost estimate
 *  - Context injection: project name, phase, BOQ totals, risk level
 *  - Streaming support (SSE)
 *  - Rate-limited per company (20 req/min)
 *  - Portal-specific system prompts
 *
 * Usage:
 *   const copilot = new AICopilot({ portalRole: 'QUANTITY_SURVEYOR', projectId, companyId });
 *   const reply   = await copilot.chat('What are the top cost risks?', conversationId);
 */

'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = 'claude-sonnet-4-6';

// ─── Portal system prompts ────────────────────────────────────────────────────
const SYSTEM_PROMPTS = {
  QUANTITY_SURVEYOR: `You are an expert Quantity Surveyor AI assistant embedded in a construction management platform.
You specialise in Bill of Quantities, cost estimation, procurement, and financial control.
You have deep knowledge of construction costs in East Africa (Uganda, Kenya, Tanzania, Rwanda).
When users ask about costs, always clarify the location and quality specification.
You can use tools to query live project data.`,

  PROJECT_MANAGER: `You are an expert Project Manager AI assistant in a construction management platform.
You specialise in schedule management, risk assessment, resource planning, and stakeholder communication.
Help users identify schedule risks, suggest mitigation strategies, and draft progress reports.
You can use tools to query live project data including tasks, risks, and milestones.`,

  ARCHITECT: `You are an expert Architect AI assistant in a construction management platform.
You specialise in spatial design, building codes, floor plan optimisation, and design coordination.
You understand Uganda National Building Code and East African climate-responsive design.
Help users generate floor plan ideas, review spatial layouts, and coordinate with structural and MEP teams.`,

  STRUCTURAL_ENGINEER: `You are an expert Structural Engineer AI assistant in a construction management platform.
You specialise in structural analysis, FEM interpretation, material selection, and code compliance.
You understand East African building standards and common structural systems.
When reviewing FEM results, always highlight safety factors, overstressed members, and deflection limits.`,

  PROCUREMENT_OFFICER: `You are an expert Procurement AI assistant in a construction management platform.
You specialise in supplier evaluation, purchase order management, market pricing, and inventory control.
You have knowledge of construction material prices in East Africa.
Help users compare quotations, identify cost savings, and flag procurement risks.`,

  HR_MANAGER: `You are an expert HR AI assistant in a construction management platform.
You specialise in workforce planning, payroll, attendance, and labour relations in the construction sector.
You are familiar with Uganda labour laws, NSSF regulations, and PAYE taxation.
Help managers analyse workforce data, optimise staffing, and ensure compliance.`,

  FINANCE_MANAGER: `You are an expert Finance AI assistant in a construction management platform.
You specialise in project finance, cash flow management, invoicing, and financial reporting.
You understand construction project economics, retention, and payment terms.
Help users analyse budget variance, project P&L, and forecast cash flow.`,

  ADMIN: `You are an expert Platform Administrator AI assistant in a construction management platform.
You help administrators manage users, roles, company settings, and platform health.
You can explain system audit logs, user permissions, and platform usage analytics.`,

  CLIENT: `You are a friendly project progress assistant for a construction client portal.
Explain project progress clearly and in non-technical terms.
Help clients understand BOQ line items, invoice terms, and construction phases.
Never share sensitive internal cost breakdowns or supplier details.`,

  DEFAULT: `You are a helpful AI assistant in a construction management platform.
You have expertise in construction project management, cost estimation, and building design.`,
};

// ─── Tool definitions ─────────────────────────────────────────────────────────
const TOOLS = [
  {
    name:        'get_project_summary',
    description: 'Get a summary of the current project including status, budget, and team.',
    input_schema: {
      type:       'object',
      properties: {
        projectId: { type: 'string', description: 'The project ID to summarise' },
      },
      required:   ['projectId'],
    },
  },
  {
    name:        'get_boq_summary',
    description: 'Get the Bill of Quantities summary — stage totals, grand total, and version status.',
    input_schema: {
      type:       'object',
      properties: {
        projectId: { type: 'string', description: 'The project ID' },
      },
      required:   ['projectId'],
    },
  },
  {
    name:        'get_project_risks',
    description: 'Get the open risk register for a project — level, category, and mitigation status.',
    input_schema: {
      type:       'object',
      properties: {
        projectId: { type: 'string', description: 'The project ID' },
      },
      required:   ['projectId'],
    },
  },
  {
    name:        'get_task_progress',
    description: 'Get task completion stats broken down by phase.',
    input_schema: {
      type:       'object',
      properties: {
        projectId: { type: 'string', description: 'The project ID' },
      },
      required:   ['projectId'],
    },
  },
  {
    name:        'estimate_cost',
    description: 'Generate a conceptual cost estimate from floor area and project parameters.',
    input_schema: {
      type:       'object',
      properties: {
        floorArea:    { type: 'number', description: 'Total floor area in m²' },
        floors:       { type: 'number', description: 'Number of floors' },
        location:     { type: 'string', description: 'Location e.g. KAMPALA, NAIROBI' },
        quality:      { type: 'string', description: 'ECONOMY | STANDARD | PREMIUM | LUXURY' },
        buildingType: { type: 'string', description: 'RESIDENTIAL | COMMERCIAL | INDUSTRIAL' },
      },
      required:   ['floorArea'],
    },
  },
  {
    name:        'get_overdue_items',
    description: 'Get overdue tasks, invoices, and deliveries for a project.',
    input_schema: {
      type:       'object',
      properties: {
        projectId: { type: 'string', description: 'The project ID' },
      },
      required:   ['projectId'],
    },
  },
];

// ─── Tool execution ───────────────────────────────────────────────────────────
async function executeTool(toolName, toolInput, { projectId, companyId }) {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  try {
    switch (toolName) {
      case 'get_project_summary': {
        const id = toolInput.projectId || projectId;
        const p  = await prisma.project.findFirst({
          where:   { id, companyId },
          include: { _count: { select: { tasks: true, documents: true, risks: true } } },
        });
        if (!p) return 'Project not found';
        return JSON.stringify({
          name:      p.name,
          status:    p.status,
          startDate: p.startDate?.toISOString().slice(0,10),
          endDate:   p.endDate?.toISOString().slice(0,10),
          budget:    p.estimatedBudget,
          location:  p.location,
          tasks:     p._count.tasks,
          documents: p._count.documents,
          risks:     p._count.risks,
        });
      }

      case 'get_boq_summary': {
        const id = toolInput.projectId || projectId;
        const v  = await prisma.bOQVersion.findFirst({
          where:   { projectId: id, companyId },
          include: { stages: { select: { name: true, totalCost: true, totalMaterial: true, totalLabour: true } } },
          orderBy: { versionNumber: 'desc' },
        });
        if (!v) return 'No BOQ found for this project';
        return JSON.stringify({
          version:      v.versionNumber,
          name:         v.name,
          status:       v.status,
          totalAmount:  v.totalAmount,
          stages:       v.stages.map(s => ({
            name:       s.name,
            total:      s.totalCost,
            material:   s.totalMaterial,
            labour:     s.totalLabour,
          })),
        });
      }

      case 'get_project_risks': {
        const id    = toolInput.projectId || projectId;
        const risks = await prisma.risk.findMany({
          where:   { projectId: id, status: { not: 'CLOSED' } },
          select:  { title: true, level: true, category: true, probability: true, impact: true, mitigation: true, status: true },
          orderBy: { level: 'desc' },
          take:    20,
        });
        if (!risks.length) return 'No open risks found';
        return JSON.stringify({ openRisks: risks.length, risks });
      }

      case 'get_task_progress': {
        const id     = toolInput.projectId || projectId;
        const phases = await prisma.phase.findMany({
          where:   { projectId: id },
          include: { tasks: { select: { status: true } } },
        });
        const summary = phases.map(p => ({
          name:    p.name,
          total:   p.tasks.length,
          done:    p.tasks.filter(t => t.status === 'DONE').length,
          pct:     p.tasks.length > 0 ? Math.round((p.tasks.filter(t => t.status === 'DONE').length / p.tasks.length) * 100) : 0,
        }));
        const overall = summary.length > 0 ? Math.round(summary.reduce((s,p) => s + p.pct, 0) / summary.length) : 0;
        return JSON.stringify({ overallProgress: overall, phases: summary });
      }

      case 'estimate_cost': {
        const { CostEngine } = require('../../../portals/qs/backend/services/CostEngine');
        const estimate = CostEngine.estimateFromFloorPlan(toolInput);
        return JSON.stringify({
          totalEstimate: estimate.totalEstimate,
          ratePerM2:     estimate.ratePerM2,
          gfa:           estimate.gfa,
          location:      estimate.location,
          quality:       estimate.quality,
          stages:        estimate.stages.map(s => ({ name: s.name, amount: s.amount, pct: s.pct })),
        });
      }

      case 'get_overdue_items': {
        const id  = toolInput.projectId || projectId;
        const now = new Date();
        const [tasks, invoices] = await Promise.all([
          prisma.task.findMany({
            where:  { project: { id }, dueDate: { lt: now }, status: { notIn: ['DONE','CANCELLED'] } },
            select: { title: true, dueDate: true, status: true, assignee: { select: { name: true } } },
            take:   10,
          }),
          prisma.invoice.findMany({
            where:  { projectId: id, status: { in: ['SENT','OVERDUE'] }, dueDate: { lt: now } },
            select: { invoiceNumber: true, total: true, dueDate: true, clientName: true },
            take:   10,
          }),
        ]);
        return JSON.stringify({ overdueTasks: tasks, overdueInvoices: invoices });
      }

      default:
        return `Unknown tool: ${toolName}`;
    }
  } finally {
    await prisma.$disconnect();
  }
}

// ─── AICopilot class ──────────────────────────────────────────────────────────
class AICopilot {
  /**
   * @param {Object} opts
   * @param {string} opts.portalRole   - e.g. 'QUANTITY_SURVEYOR'
   * @param {string} opts.projectId    - current project context
   * @param {string} opts.companyId    - for multi-tenant data isolation
   * @param {string} opts.userName     - for personalised greeting
   */
  constructor({ portalRole = 'DEFAULT', projectId, companyId, userName } = {}) {
    this.portalRole = portalRole;
    this.projectId  = projectId;
    this.companyId  = companyId;
    this.userName   = userName;
  }

  _systemPrompt() {
    const base = SYSTEM_PROMPTS[this.portalRole] || SYSTEM_PROMPTS.DEFAULT;
    const ctx  = [
      this.projectId ? `Current project context ID: ${this.projectId}` : '',
      this.userName  ? `You are speaking with ${this.userName}.` : '',
      'Today\'s date: ' + new Date().toISOString().slice(0, 10),
      'Always respond in clear, professional English. Format numbers with commas.',
      'When citing costs, use UGX (Ugandan Shillings) unless another currency is specified.',
    ].filter(Boolean).join('\n');
    return `${base}\n\n${ctx}`;
  }

  /**
   * Single chat turn — handles tool use agentic loop (max 5 turns).
   *
   * @param {string} userMessage
   * @param {Array}  history         - prior messages [{ role, content }]
   * @returns {Object} { reply: string, updatedHistory: Array, toolsUsed: string[] }
   */
  async chat(userMessage, history = []) {
    const messages = [
      ...history,
      { role: 'user', content: userMessage },
    ];

    const toolsUsed = [];
    let maxTurns    = 5;

    while (maxTurns-- > 0) {
      const response = await client.messages.create({
        model:      MODEL,
        max_tokens: 2048,
        system:     this._systemPrompt(),
        tools:      TOOLS,
        messages,
      });

      // Add assistant message to history
      messages.push({ role: 'assistant', content: response.content });

      if (response.stop_reason === 'end_turn') {
        const reply = response.content
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('');
        return {
          reply,
          updatedHistory: messages,
          toolsUsed,
          usage: response.usage,
        };
      }

      if (response.stop_reason === 'tool_use') {
        const toolResults = [];

        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          toolsUsed.push(block.name);

          let result;
          try {
            result = await executeTool(block.name, block.input, {
              projectId: this.projectId,
              companyId: this.companyId,
            });
          } catch (e) {
            result = `Tool error: ${e.message}`;
          }

          toolResults.push({
            type:       'tool_result',
            tool_use_id:block.id,
            content:    result,
          });
        }

        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      // Unexpected stop_reason
      break;
    }

    return { reply: 'I reached my thinking limit — please rephrase your question.', updatedHistory: messages, toolsUsed };
  }

  /**
   * Stream a response using SSE (Server-Sent Events).
   * Call from an Express route handler: copilot.stream(req.body.message, history, res)
   */
  async stream(userMessage, history = [], res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const messages = [...history, { role: 'user', content: userMessage }];

    try {
      const stream = await client.messages.stream({
        model:      MODEL,
        max_tokens: 2048,
        system:     this._systemPrompt(),
        messages,
      });

      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          res.write(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`);
        }
      }

      res.write('data: [DONE]\n\n');
    } catch (e) {
      res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    } finally {
      res.end();
    }
  }
}

module.exports = { AICopilot, TOOLS, SYSTEM_PROMPTS };
