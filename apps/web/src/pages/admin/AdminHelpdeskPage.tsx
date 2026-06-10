/**
 * Admin Helpdesk — /admin/helpdesk
 *
 * AI troubleshooting interface grounded in docs/TECH_SPEC.md (backend loads the
 * spec as the model's knowledge base). Two columns: customer context + open
 * tickets on the left, an AI chat thread on the right. Selecting an org passes
 * its id to the query so the AI answers with that customer in mind.
 */
import { useState, useRef, useEffect, type ReactNode } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Bot,
  Send,
  Search,
  Trash2,
  AlertTriangle,
  FileText,
  Loader2,
} from 'lucide-react';
import {
  adminApi,
  type HelpdeskMessage,
  type AdminOrg,
} from '../../lib/adminApi';
import { StatusBadge, PlanBadge, fmtRelative } from './adminUi';

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  escalationTier?: 1 | 2 | 3;
  suggestedActions?: string[];
  relatedDocs?: string[];
}

const SUGGESTED_QUESTIONS = [
  'How do I help a customer whose import is stuck?',
  'Customer says payment is failing — what to check?',
  "How do I reset an employee's PIN?",
  "Customer's Stripe isn't connected — walkthrough?",
  'Why would a product not appear in the POS?',
  'Customer says their tax rate is wrong — how to fix?',
  'Menu import shows $0 prices — what happened?',
  'Account is locked — how to unlock?',
  'How does the impersonation feature work?',
  'What migrations need to be run?',
];

export function AdminHelpdeskPage() {
  const navigate = useNavigate();
  const [orgSearch, setOrgSearch] = useState('');
  const [selectedOrg, setSelectedOrg] = useState<AdminOrg | null>(null);
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const orgResultsQ = useQuery({
    queryKey: ['admin', 'helpdesk', 'orgsearch', orgSearch],
    queryFn: () => adminApi.organizations.list({ search: orgSearch, page: 1 }),
    enabled: orgSearch.trim().length >= 2,
  });

  const ticketsQ = useQuery({
    queryKey: ['admin', 'helpdesk', 'tickets'],
    queryFn: () => adminApi.helpdesk.getTickets('open'),
  });

  const askMutation = useMutation({
    mutationFn: (question: string) => {
      const history: HelpdeskMessage[] = turns.map((t) => ({ role: t.role, content: t.content }));
      return adminApi.helpdesk.query({
        query: question,
        orgId: selectedOrg?.id,
        history,
      });
    },
    onSuccess: (res) => {
      setTurns((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: res.answer,
          escalationTier: res.escalationTier,
          suggestedActions: res.suggestedActions,
          relatedDocs: res.relatedDocs,
        },
      ]);
    },
    onError: (e: unknown) => {
      setTurns((prev) => [
        ...prev,
        {
          role: 'assistant',
          content:
            e instanceof Error
              ? `Sorry — I couldn't process that (${e.message}). Try again or escalate to engineering.`
              : 'Something went wrong.',
          escalationTier: 3,
        },
      ]);
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, askMutation.isPending]);

  const send = (question: string) => {
    const q = question.trim();
    if (!q || askMutation.isPending) return;
    setTurns((prev) => [...prev, { role: 'user', content: q }]);
    setInput('');
    askMutation.mutate(q);
  };

  const handleSuggestedAction = (action: string) => {
    const a = action.toLowerCase();
    if (a.includes('stripe')) {
      window.open('https://dashboard.stripe.com', '_blank', 'noopener');
    } else if ((a.includes('employee') || a.includes('pin') || a.includes('account')) && selectedOrg) {
      navigate(`/admin/organizations/${selectedOrg.id}`);
    } else if (a.includes('import')) {
      // Surface the org so the agent can dig into the import job.
      if (selectedOrg) navigate(`/admin/organizations/${selectedOrg.id}`);
      else send(action);
    } else {
      send(action);
    }
  };

  return (
    <div className="flex h-screen">
      {/* LEFT: context + tickets */}
      <div className="w-[35%] min-w-[300px] border-r border-gray-200 bg-white flex flex-col">
        <div className="p-5 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Customer Context</h2>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={orgSearch}
              onChange={(e) => setOrgSearch(e.target.value)}
              placeholder="Search by org name or email…"
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>

          {/* search results */}
          {orgSearch.trim().length >= 2 && !selectedOrg && (
            <div className="mt-2 max-h-44 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-50">
              {orgResultsQ.isLoading ? (
                <div className="p-3 text-xs text-gray-400">Searching…</div>
              ) : (orgResultsQ.data?.organizations.length ?? 0) === 0 ? (
                <div className="p-3 text-xs text-gray-400">No matches.</div>
              ) : (
                orgResultsQ.data?.organizations.slice(0, 8).map((o) => (
                  <button
                    key={o.id}
                    onClick={() => { setSelectedOrg(o); setOrgSearch(''); }}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50"
                  >
                    <div className="text-sm font-medium text-gray-800">{o.name}</div>
                    <div className="text-[11px] text-gray-400">{o.slug} · {o.plan}</div>
                  </button>
                ))
              )}
            </div>
          )}

          {/* selected org card */}
          {selectedOrg && (
            <div className="mt-3 p-3 rounded-lg border border-primary/20 bg-primary/5">
              <div className="flex items-start justify-between">
                <div className="text-sm font-semibold text-gray-900">{selectedOrg.name}</div>
                <button
                  onClick={() => setSelectedOrg(null)}
                  className="text-[11px] text-gray-400 hover:text-gray-600"
                >
                  clear
                </button>
              </div>
              <div className="flex items-center gap-1.5 mt-1.5">
                <PlanBadge plan={selectedOrg.plan} />
                <StatusBadge status={selectedOrg.subscriptionStatus} />
              </div>
              <dl className="mt-2 text-[11px] text-gray-500 space-y-0.5">
                <div>Employees: {selectedOrg.employeeCount}</div>
                <div>Last order: {fmtRelative(selectedOrg.lastOrderAt)}</div>
              </dl>
              <button
                onClick={() => navigate(`/admin/organizations/${selectedOrg.id}`)}
                className="mt-2 text-[11px] font-medium text-primary hover:text-primary-dark"
              >
                Open full profile →
              </button>
            </div>
          )}
        </div>

        {/* tickets */}
        <div className="flex-1 overflow-y-auto p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Open Tickets</h2>
          {ticketsQ.isLoading ? (
            <div className="text-xs text-gray-400">Loading…</div>
          ) : (ticketsQ.data?.length ?? 0) === 0 ? (
            <div className="text-xs text-gray-400">No open tickets.</div>
          ) : (
            <div className="space-y-2">
              {ticketsQ.data?.map((t) => (
                <button
                  key={t.id}
                  onClick={() => send(`Re: ticket "${t.subject}" — what should I check?`)}
                  className="w-full text-left p-3 rounded-lg border border-gray-100 hover:border-gray-200 hover:bg-gray-50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-gray-800 truncate">{t.subject}</span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${
                      t.priority === 'critical' || t.priority === 'high'
                        ? 'bg-red-100 text-red-600'
                        : 'bg-gray-100 text-gray-500'
                    }`}>{t.priority}</span>
                  </div>
                  <div className="text-[11px] text-gray-400 mt-0.5">
                    {t.org_name ?? 'No org'} · {t.status}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: chat */}
      <div className="flex-1 flex flex-col bg-gray-50">
        {/* header */}
        <div className="px-6 py-4 bg-white border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Bot size={18} className="text-primary" />
            </div>
            <div>
              <div className="text-sm font-semibold text-gray-900">Taproot AI Support</div>
              {selectedOrg && (
                <div className="text-[11px] text-gray-500">
                  Helping: {selectedOrg.name} · {selectedOrg.plan} · {selectedOrg.subscriptionStatus}
                </div>
              )}
            </div>
          </div>
          {turns.length > 0 && (
            <button
              onClick={() => setTurns([])}
              className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-800"
            >
              <Trash2 size={13} /> Clear conversation
            </button>
          )}
        </div>

        {/* messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-5">
          {turns.length === 0 ? (
            <div className="max-w-2xl mx-auto">
              <p className="text-sm text-gray-500 mb-3">
                Ask anything about Taproot. The assistant answers from the technical
                specification and flags issues that need human escalation.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => send(q)}
                    className="text-left text-sm text-gray-700 bg-white border border-gray-100 hover:border-primary/40 hover:bg-primary/5 rounded-lg px-3 py-2.5 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-2xl mx-auto space-y-4">
              {turns.map((t, i) => (
                <ChatBubble key={i} turn={t} onAction={handleSuggestedAction} />
              ))}
              {askMutation.isPending && (
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <Loader2 size={15} className="animate-spin" /> Thinking…
                </div>
              )}
            </div>
          )}
        </div>

        {/* input */}
        <div className="px-6 py-4 bg-white border-t border-gray-200">
          <div className="max-w-2xl mx-auto flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={1}
              placeholder="Ask anything about Taproot…  (Enter to send, Shift+Enter for newline)"
              className="flex-1 resize-none px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary max-h-32"
            />
            <button
              onClick={() => send(input)}
              disabled={!input.trim() || askMutation.isPending}
              className="flex items-center gap-1.5 bg-primary hover:bg-primary-dark disabled:opacity-50 text-white text-sm font-semibold px-4 py-2.5 rounded-lg"
            >
              <Send size={15} /> Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatBubble({
  turn,
  onAction,
}: {
  turn: ChatTurn;
  onAction: (action: string) => void;
}) {
  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-primary text-white rounded-2xl rounded-br-sm px-4 py-2.5 text-sm whitespace-pre-wrap">
          {turn.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] space-y-2">
        <div className="bg-white border border-gray-100 rounded-2xl rounded-bl-sm px-4 py-3 text-sm text-gray-800 shadow-sm">
          <MarkdownText content={turn.content} />
        </div>

        {turn.escalationTier && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
            <AlertTriangle size={15} className="text-amber-500 mt-0.5 shrink-0" />
            <div className="text-xs text-amber-800">
              <span className="font-semibold">Tier {turn.escalationTier} escalation recommended.</span>{' '}
              {turn.escalationTier >= 3
                ? 'Route to engineering.'
                : 'This issue may require human investigation.'}
            </div>
          </div>
        )}

        {turn.suggestedActions && turn.suggestedActions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {turn.suggestedActions.map((a, i) => (
              <button
                key={i}
                onClick={() => onAction(a)}
                className="text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 rounded-full px-3 py-1"
              >
                {a}
              </button>
            ))}
          </div>
        )}

        {turn.relatedDocs && turn.relatedDocs.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-gray-400">
            <FileText size={12} />
            <span>Related:</span>
            {turn.relatedDocs.map((d, i) => (
              <span key={i} className="text-gray-500">
                {d}{i < turn.relatedDocs!.length - 1 ? ',' : ''}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Lightweight, dependency-free, XSS-safe markdown renderer ────────────────
// The helpdesk AI emits prose with **bold**, `code`, and bullet/numbered steps.
// We parse into React elements (NO dangerouslySetInnerHTML) so untrusted model
// output can never inject HTML. Supports: bold, inline code, #-headings, and
// unordered/ordered lists; everything else renders as paragraphs with breaks.

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`)/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[2] !== undefined) {
      nodes.push(<strong key={key++} className="font-semibold">{m[2]}</strong>);
    } else if (m[3] !== undefined) {
      nodes.push(
        <code key={key++} className="px-1 py-0.5 rounded bg-gray-100 text-[12px] font-mono text-gray-800">
          {m[3]}
        </code>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function MarkdownText({ content }: { content: string }): ReactNode {
  const lines = content.split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  const isBullet = (s: string) => /^\s*[-*]\s+/.test(s);
  const isNumbered = (s: string) => /^\s*\d+\.\s+/.test(s);
  const isHeading = (s: string) => /^#{1,6}\s+/.test(s);

  while (i < lines.length) {
    const line = lines[i];
    if (isBullet(line)) {
      const items: string[] = [];
      while (i < lines.length && isBullet(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      blocks.push(
        <ul key={key++} className="list-disc pl-5 space-y-0.5">
          {items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}
        </ul>,
      );
      continue;
    }
    if (isNumbered(line)) {
      const items: string[] = [];
      while (i < lines.length && isNumbered(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      blocks.push(
        <ol key={key++} className="list-decimal pl-5 space-y-0.5">
          {items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}
        </ol>,
      );
      continue;
    }
    if (isHeading(line)) {
      blocks.push(
        <div key={key++} className="font-semibold text-gray-900">
          {renderInline(line.replace(/^#{1,6}\s+/, ''))}
        </div>,
      );
      i++;
      continue;
    }
    if (line.trim() === '') {
      i++;
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !isBullet(lines[i]) &&
      !isNumbered(lines[i]) &&
      !isHeading(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++}>
        {para.map((p, j) => (
          <span key={j}>
            {renderInline(p)}
            {j < para.length - 1 ? <br /> : null}
          </span>
        ))}
      </p>,
    );
  }

  return <div className="space-y-2">{blocks}</div>;
}
