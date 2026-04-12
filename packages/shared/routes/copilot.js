/**
 * copilot.js — Shared AI Copilot Express route
 *
 * Mount in any portal:
 *   const copilotRouter = require('../../../packages/shared/routes/copilot');
 *   app.use('/api/copilot', copilotRouter);
 *
 * Routes:
 *   POST /api/copilot/chat             - single turn chat
 *   POST /api/copilot/stream           - SSE streaming chat
 *   GET  /api/copilot/conversations    - list conversations
 *   POST /api/copilot/conversations    - create conversation
 *   GET  /api/copilot/conversations/:id/messages - get messages
 *   DELETE /api/copilot/conversations/:id        - delete conversation
 */

'use strict';

const express  = require('express');
const { PrismaClient } = require('@prisma/client');
const { AICopilot } = require('../services/AICopilot');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const prisma  = new PrismaClient();

router.use(requireAuth);

// ─── Chat (non-streaming) ─────────────────────────────────────────────────────
router.post('/chat', async (req, res) => {
  try {
    const { message, conversationId, projectId, portalRole } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });

    // Load or create conversation
    let conversation;
    if (conversationId) {
      conversation = await prisma.aIConversation.findFirst({
        where:   { id: conversationId, companyId: req.user.companyId },
        include: { messages: { orderBy: { createdAt: 'asc' }, take: 40 } },
      });
      if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    } else {
      conversation = await prisma.aIConversation.create({
        data: {
          companyId: req.user.companyId,
          projectId: projectId || null,
          userId:    req.user.id,
          title:     message.slice(0, 60),
          portal:    portalRole || req.user.role,
        },
        include: { messages: true },
      });
    }

    // Rebuild history from DB messages
    const history = (conversation.messages || []).map(m => ({
      role:    m.role,
      content: m.content,
    }));

    // Run copilot
    const copilot = new AICopilot({
      portalRole: portalRole || conversation.portal || req.user.role,
      projectId:  projectId  || conversation.projectId,
      companyId:  req.user.companyId,
      userName:   req.user.name,
    });

    const { reply, toolsUsed, usage } = await copilot.chat(message, history);

    // Persist messages
    await prisma.$transaction([
      prisma.aIMessage.create({
        data: { conversationId: conversation.id, role: 'user',      content: message, companyId: req.user.companyId },
      }),
      prisma.aIMessage.create({
        data: { conversationId: conversation.id, role: 'assistant', content: reply,   companyId: req.user.companyId,
          metadata: { toolsUsed, inputTokens: usage?.input_tokens, outputTokens: usage?.output_tokens } },
      }),
    ]);

    // Update conversation timestamp
    await prisma.aIConversation.update({
      where: { id: conversation.id },
      data:  { updatedAt: new Date() },
    });

    res.json({ reply, conversationId: conversation.id, toolsUsed });
  } catch (e) {
    console.error('[copilot] chat error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Streaming chat (SSE) ─────────────────────────────────────────────────────
router.post('/stream', async (req, res) => {
  const { message, conversationId, projectId, portalRole } = req.body;
  if (!message) { res.status(400).json({ error: 'message required' }); return; }

  const copilot = new AICopilot({
    portalRole: portalRole || req.user.role,
    projectId,
    companyId:  req.user.companyId,
    userName:   req.user.name,
  });

  // Load history
  let history = [];
  if (conversationId) {
    const msgs = await prisma.aIMessage.findMany({
      where:   { conversationId, companyId: req.user.companyId },
      orderBy: { createdAt: 'asc' },
      take:    40,
    });
    history = msgs.map(m => ({ role: m.role, content: m.content }));
  }

  await copilot.stream(message, history, res);
});

// ─── Conversations ────────────────────────────────────────────────────────────
router.get('/conversations', async (req, res) => {
  try {
    const conversations = await prisma.aIConversation.findMany({
      where:   { companyId: req.user.companyId, userId: req.user.id, ...(req.query.projectId && { projectId: req.query.projectId }) },
      orderBy: { updatedAt: 'desc' },
      take:    50,
      include: { _count: { select: { messages: true } } },
    });
    res.json({ conversations });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/conversations', async (req, res) => {
  try {
    const conv = await prisma.aIConversation.create({
      data: {
        companyId: req.user.companyId,
        userId:    req.user.id,
        projectId: req.body.projectId || null,
        title:     req.body.title     || 'New conversation',
        portal:    req.body.portal    || req.user.role,
      },
    });
    res.status(201).json({ conversation: conv });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/conversations/:id/messages', async (req, res) => {
  try {
    const messages = await prisma.aIMessage.findMany({
      where:   { conversationId: req.params.id, companyId: req.user.companyId },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ messages });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/conversations/:id', async (req, res) => {
  try {
    await prisma.aIConversation.delete({ where: { id: req.params.id, companyId: req.user.companyId, userId: req.user.id } });
    res.json({ message: 'Deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
