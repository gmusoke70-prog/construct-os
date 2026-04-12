/**
 * CopilotChat — Floating AI assistant widget shared across all portals
 *
 * Features:
 *  - Slide-in panel (bottom-right)
 *  - Conversation history with auto-scroll
 *  - Suggested prompts per portal role
 *  - Tool usage indicators ("Checked BOQ summary", "Queried risks")
 *  - Markdown rendering (bold, code, lists)
 *  - Streaming text output
 *  - New / clear conversation
 *  - Persist conversationId in sessionStorage
 */

'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';

const SUGGESTED_PROMPTS = {
  QUANTITY_SURVEYOR: [
    'Summarise the BOQ for this project',
    'What are the top 3 cost risks?',
    'Estimate cost for 200m² residential, Kampala, Standard quality',
    'Compare current BOQ to the approved budget',
  ],
  PROJECT_MANAGER: [
    'Give me a project health summary',
    'Which tasks are overdue?',
    'What are the critical risks?',
    'Draft a progress report for the client',
  ],
  ARCHITECT: [
    'Suggest a floor layout for a 3-bedroom house on 50x30m land',
    'What are the setback requirements in Kampala?',
    'Review my room sizing for compliance',
    'Tips for passive cooling in Uganda climate',
  ],
  STRUCTURAL_ENGINEER: [
    'Explain the FEM analysis results',
    'What does a safety factor of 1.8 mean?',
    'Which members are overstressed?',
    'Recommend a suitable column section for 3 floors',
  ],
  PROCUREMENT_OFFICER: [
    'What materials are running low on stock?',
    'Compare current cement price to market rates',
    'Which POs are pending approval?',
    'Suggest criteria for evaluating a new supplier',
  ],
  HR_MANAGER: [
    'What is today\'s attendance rate?',
    'Which employees have pending leave requests?',
    'Summarise payroll for last month',
    'Are there any labour compliance issues?',
  ],
  FINANCE_MANAGER: [
    'Give me the monthly P&L summary',
    'Which invoices are overdue?',
    'Project cash flow for next 3 months',
    'What is the budget utilisation rate?',
  ],
  CLIENT: [
    'What phase is the project in?',
    'When will the project be complete?',
    'Explain the latest invoice',
    'What work was done this week?',
  ],
};

const PORTAL_COLORS = {
  QUANTITY_SURVEYOR:   '#059669',
  PROJECT_MANAGER:     '#2563eb',
  ARCHITECT:           '#7c3aed',
  STRUCTURAL_ENGINEER: '#0891b2',
  PROCUREMENT_OFFICER: '#d97706',
  HR_MANAGER:          '#db2777',
  FINANCE_MANAGER:     '#16a34a',
  CLIENT:              '#6b7280',
  DEFAULT:             '#2563eb',
};

// ─── Simple markdown renderer ─────────────────────────────────────────────────
function renderMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    .replace(/^\- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\n/g, '<br/>');
}

// ─── Message bubble ───────────────────────────────────────────────────────────
function MessageBubble({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`msg-wrap ${isUser ? 'user' : 'ai'}`}>
      {!isUser && (
        <div className="ai-avatar">AI</div>
      )}
      <div className={`msg-bubble ${isUser ? 'user' : 'ai'}`}>
        <div
          className="msg-text"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
        />
        {msg.toolsUsed?.length > 0 && (
          <div className="tools-used">
            {msg.toolsUsed.map((t, i) => (
              <span key={i} className="tool-chip">⚡ {t.replace(/_/g, ' ')}</span>
            ))}
          </div>
        )}
        <div className="msg-time">
          {new Date(msg.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
}

// ─── Main CopilotChat ─────────────────────────────────────────────────────────
export default function CopilotChat({ portalRole = 'DEFAULT', projectId, position = 'bottom-right' }) {
  const [open,           setOpen]           = useState(false);
  const [messages,       setMessages]       = useState([]);
  const [input,          setInput]          = useState('');
  const [loading,        setLoading]        = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [streaming,      setStreaming]      = useState('');
  const messagesEndRef = useRef(null);
  const inputRef       = useRef(null);

  const color    = PORTAL_COLORS[portalRole] || PORTAL_COLORS.DEFAULT;
  const prompts  = SUGGESTED_PROMPTS[portalRole] || SUGGESTED_PROMPTS.PROJECT_MANAGER;

  // Persist conversation across page navigation
  const storageKey = `copilot_conv_${projectId || 'global'}`;

  useEffect(() => {
    const saved = sessionStorage.getItem(storageKey);
    if (saved) {
      const { id, msgs } = JSON.parse(saved);
      setConversationId(id);
      setMessages(msgs || []);
    }
  }, [storageKey]);

  useEffect(() => {
    if (conversationId) {
      sessionStorage.setItem(storageKey, JSON.stringify({ id: conversationId, msgs: messages.slice(-20) }));
    }
  }, [conversationId, messages, storageKey]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const sendMessage = useCallback(async (text = input.trim()) => {
    if (!text || loading) return;
    setInput('');

    const userMsg = { role: 'user', content: text, createdAt: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);
    setStreaming('');

    try {
      const token = localStorage.getItem('token');

      // Use streaming endpoint
      const res = await fetch('/api/copilot/stream', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ message: text, conversationId, projectId, portalRole }),
      });

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(l => l.startsWith('data: '));

        for (const line of lines) {
          const data = line.slice(6);
          if (data === '[DONE]') break;
          try {
            const { text: delta, error } = JSON.parse(data);
            if (error) throw new Error(error);
            if (delta) {
              fullText += delta;
              setStreaming(fullText);
            }
          } catch {}
        }
      }

      const aiMsg = { role: 'assistant', content: fullText, createdAt: new Date().toISOString() };
      setMessages(prev => [...prev, aiMsg]);
      setStreaming('');

      // Non-streaming fallback to get conversationId
      if (!conversationId) {
        const chatRes = await fetch('/api/copilot/conversations', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body:    JSON.stringify({ title: text.slice(0, 60), projectId, portal: portalRole }),
        }).then(r => r.json());
        setConversationId(chatRes.conversation?.id);
      }
    } catch (e) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Sorry, I encountered an error: ${e.message}`,
        createdAt: new Date().toISOString(),
      }]);
    } finally {
      setLoading(false);
      setStreaming('');
    }
  }, [input, loading, conversationId, projectId, portalRole]);

  const clearConversation = () => {
    setMessages([]);
    setConversationId(null);
    sessionStorage.removeItem(storageKey);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const isEmpty = messages.length === 0 && !streaming;

  return (
    <>
      {/* Floating button */}
      <button
        className="copilot-fab"
        onClick={() => setOpen(o => !o)}
        style={{ background: color }}
        title="AI Copilot"
      >
        {open ? '✕' : '✦'}
        {!open && messages.length > 0 && <span className="fab-badge">{messages.length}</span>}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="copilot-panel">
          {/* Header */}
          <div className="copilot-header" style={{ background: color }}>
            <div className="copilot-header-left">
              <span className="copilot-icon">✦</span>
              <div>
                <div className="copilot-title">AI Copilot</div>
                <div className="copilot-subtitle">{portalRole.replace(/_/g, ' ')}</div>
              </div>
            </div>
            <div className="copilot-header-actions">
              {messages.length > 0 && (
                <button className="header-btn" onClick={clearConversation} title="New conversation">✎</button>
              )}
              <button className="header-btn" onClick={() => setOpen(false)}>✕</button>
            </div>
          </div>

          {/* Messages */}
          <div className="copilot-messages">
            {isEmpty ? (
              <div className="copilot-welcome">
                <div className="welcome-icon" style={{ color }}>✦</div>
                <p className="welcome-text">
                  Hello{' '}<strong>{typeof window !== 'undefined' ? '' : ''}</strong>! I'm your AI Copilot.
                  How can I help you today?
                </p>
                <div className="suggested-prompts">
                  {prompts.map((p, i) => (
                    <button
                      key={i}
                      className="prompt-chip"
                      style={{ borderColor: color + '44' }}
                      onClick={() => sendMessage(p)}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg, i) => <MessageBubble key={i} msg={msg} />)}
                {streaming && (
                  <div className="msg-wrap ai">
                    <div className="ai-avatar">AI</div>
                    <div className="msg-bubble ai">
                      <div className="msg-text" dangerouslySetInnerHTML={{ __html: renderMarkdown(streaming) }} />
                      <span className="streaming-cursor">▌</span>
                    </div>
                  </div>
                )}
                {loading && !streaming && (
                  <div className="msg-wrap ai">
                    <div className="ai-avatar">AI</div>
                    <div className="msg-bubble ai typing">
                      <span /><span /><span />
                    </div>
                  </div>
                )}
              </>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="copilot-input-area">
            <textarea
              ref={inputRef}
              className="copilot-input"
              placeholder="Ask anything…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={2}
              disabled={loading}
            />
            <button
              className="send-btn"
              style={{ background: loading ? '#9ca3af' : color }}
              onClick={() => sendMessage()}
              disabled={loading || !input.trim()}
            >
              ➤
            </button>
          </div>
          <div className="copilot-footer">Powered by Claude · Enter to send · Shift+Enter for new line</div>
        </div>
      )}

      <style>{copilotStyles}</style>
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const copilotStyles = `
.copilot-fab { position: fixed; bottom: 24px; right: 24px; z-index: 1000; width: 52px; height: 52px; border-radius: 50%; border: none; color: #fff; font-size: 22px; cursor: pointer; box-shadow: 0 4px 20px rgba(0,0,0,0.25); display: flex; align-items: center; justify-content: center; transition: transform 0.2s; }
.copilot-fab:hover { transform: scale(1.08); }
.fab-badge { position: absolute; top: 0; right: 0; background: #ef4444; color: #fff; border-radius: 9999px; font-size: 10px; min-width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; padding: 0 4px; font-weight: 700; }

.copilot-panel { position: fixed; bottom: 88px; right: 24px; z-index: 999; width: 380px; height: 560px; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.2); background: #fff; display: flex; flex-direction: column; overflow: hidden; animation: slideUp 0.2s ease; font-family: 'Inter', sans-serif; font-size: 14px; }
@keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: none; opacity: 1; } }

.copilot-header { padding: 14px 16px; display: flex; align-items: center; justify-content: space-between; }
.copilot-header-left { display: flex; align-items: center; gap: 10px; }
.copilot-icon { font-size: 20px; color: #fff; }
.copilot-title { font-weight: 700; color: #fff; font-size: 15px; }
.copilot-subtitle { font-size: 11px; color: rgba(255,255,255,0.75); text-transform: capitalize; }
.copilot-header-actions { display: flex; gap: 6px; }
.header-btn { background: rgba(255,255,255,0.2); border: none; color: #fff; border-radius: 6px; width: 28px; height: 28px; cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center; }
.header-btn:hover { background: rgba(255,255,255,0.3); }

.copilot-messages { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 12px; }

.copilot-welcome { display: flex; flex-direction: column; align-items: center; padding: 24px 16px; text-align: center; }
.welcome-icon { font-size: 36px; margin-bottom: 12px; }
.welcome-text { color: #374151; font-size: 14px; line-height: 1.5; margin-bottom: 16px; }
.suggested-prompts { display: flex; flex-direction: column; gap: 6px; width: 100%; }
.prompt-chip { background: #f8fafc; border: 1px solid; border-radius: 8px; padding: 8px 12px; text-align: left; cursor: pointer; font-size: 13px; color: #374151; transition: background 0.15s; }
.prompt-chip:hover { background: #eff6ff; }

.msg-wrap { display: flex; gap: 8px; align-items: flex-end; }
.msg-wrap.user { flex-direction: row-reverse; }
.ai-avatar { width: 28px; height: 28px; border-radius: 50%; background: #1e293b; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0; }
.msg-bubble { max-width: 82%; padding: 10px 14px; border-radius: 16px; line-height: 1.5; }
.msg-bubble.user { background: #2563eb; color: #fff; border-bottom-right-radius: 4px; }
.msg-bubble.ai   { background: #f1f5f9; color: #111827; border-bottom-left-radius: 4px; }
.msg-text h2,h3,h4 { margin: 4px 0; font-size: 14px; }
.msg-text ul { margin: 4px 0 4px 16px; padding: 0; }
.msg-text li { margin-bottom: 2px; }
.msg-text code { background: rgba(0,0,0,0.1); border-radius: 3px; padding: 1px 4px; font-family: monospace; font-size: 12px; }
.msg-time { font-size: 10px; color: rgba(0,0,0,0.35); margin-top: 4px; text-align: right; }
.msg-bubble.user .msg-time { color: rgba(255,255,255,0.5); }
.tools-used { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.tool-chip { background: rgba(0,0,0,0.08); border-radius: 9999px; padding: 2px 7px; font-size: 10px; color: #374151; }
.streaming-cursor { animation: blink 1s step-end infinite; }
@keyframes blink { 50% { opacity: 0; } }

.msg-bubble.typing { display: flex; gap: 4px; align-items: center; padding: 12px 16px; }
.msg-bubble.typing span { width: 7px; height: 7px; border-radius: 50%; background: #9ca3af; animation: bounce 1.2s infinite; }
.msg-bubble.typing span:nth-child(2) { animation-delay: 0.2s; }
.msg-bubble.typing span:nth-child(3) { animation-delay: 0.4s; }
@keyframes bounce { 0%,80%,100% { transform: none; } 40% { transform: translateY(-6px); } }

.copilot-input-area { padding: 10px 12px; border-top: 1px solid #e5e7eb; display: flex; gap: 8px; align-items: flex-end; background: #fff; }
.copilot-input { flex: 1; border: 1px solid #d1d5db; border-radius: 10px; padding: 8px 12px; font-size: 13px; font-family: inherit; resize: none; outline: none; max-height: 100px; }
.copilot-input:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,0.1); }
.send-btn { width: 36px; height: 36px; border-radius: 10px; border: none; color: #fff; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: opacity 0.2s; }
.send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.copilot-footer { padding: 6px 12px; font-size: 10px; color: #9ca3af; text-align: center; background: #f9fafb; border-top: 1px solid #f1f5f9; }
`;
