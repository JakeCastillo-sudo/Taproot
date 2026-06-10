/**
 * Helpdesk AI service.
 *
 * Answers support questions grounded ONLY in docs/TECH_SPEC.md (loaded once at
 * startup). The spec is the AI's entire knowledge base, so answers stay accurate
 * to the actual product. The model also classifies an escalation tier per the
 * support matrix in section 19 of the spec.
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { join } from 'path';
import { config } from '../config';
import { query } from '../db/client';
import { BUNDLED_TECH_SPEC } from '../lib/techSpec';

// Lazy Anthropic singleton — instantiated on first use so dotenv has loaded
// (see BUG-001: module-level instantiation can pre-empt env loading).
let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  return _client;
}

/**
 * Load the tech spec once at startup — the helpdesk's entire knowledge base.
 *
 * IMPORTANT: docs/ is excluded from the Railway runtime image (.dockerignore
 * ignores `docs`), so reading docs/TECH_SPEC.md FAILS in production. We therefore
 * prefer the on-disk file when present (local dev, or if docs/ is ever un-ignored)
 * and otherwise fall back to BUNDLED_TECH_SPEC, which ships through tsc. The
 * "not found" sentinel is only ever used if BOTH are somehow empty.
 */
function loadTechSpec(): string {
  const candidates = [
    join(process.cwd(), 'docs/TECH_SPEC.md'),
    // dist/services -> repo root is four levels up (apps/api/dist/services).
    join(__dirname, '../../../../docs/TECH_SPEC.md'),
    join(__dirname, '../../../docs/TECH_SPEC.md'),
  ];
  for (const p of candidates) {
    try {
      const content = readFileSync(p, 'utf-8');
      if (content.trim()) return content;
    } catch {
      // try next candidate
    }
  }
  if (BUNDLED_TECH_SPEC.trim()) {
    return BUNDLED_TECH_SPEC;
  }
  console.warn('[Helpdesk] TECH_SPEC unavailable from disk and bundle');
  return 'Technical specification not found.';
}

const TECH_SPEC: string = loadTechSpec();

const HELPDESK_SYSTEM_PROMPT = `
You are the Taproot POS AI support assistant. You help restaurant owners and
helpdesk staff troubleshoot issues and answer questions about Taproot POS.

Your knowledge comes from the official technical specification below. Only answer
based on this specification. If something is not covered, say so clearly and
suggest escalating to engineering.

ESCALATION RULES:
- Tier 1 (answer yourself): login issues, how-to questions, settings questions,
  import questions, price display issues, basic troubleshooting
- Tier 2 (flag for human): Stripe issues requiring investigation, data issues
  needing DB queries, billing disputes, account suspension
- Tier 3 (flag for engineering): 500 errors, data corruption, security incidents,
  performance degradation

RESPONSE FORMAT:
1. Direct answer to the question
2. Step-by-step solution if applicable
3. If escalation needed: clearly state the tier and what information to gather

Be concise, clear, and empathetic. Restaurant operators are busy — every word counts.

TAPROOT TECHNICAL SPECIFICATION:
${TECH_SPEC}
`;

export interface HelpdeskMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface HelpdeskContext {
  orgId?: string;
  orgName?: string;
  plan?: string;
  recentErrors?: string[];
  employeeCount?: number;
  lastOrderAt?: string;
}

export interface HelpdeskResult {
  answer: string;
  escalationTier?: 1 | 2 | 3;
  suggestedActions?: string[];
  relatedDocs?: string[];
}

export async function processHelpdeskQuery(params: {
  query: string;
  history?: HelpdeskMessage[];
  context?: HelpdeskContext;
  adminId: string;
}): Promise<HelpdeskResult> {
  const { query: userQuery, history = [], context } = params;

  let contextBlock = '';
  if (context?.orgId) {
    contextBlock = `
CURRENT CUSTOMER CONTEXT:
Organization: ${context.orgName ?? 'Unknown'}
Plan: ${context.plan ?? 'Unknown'}
Employees: ${context.employeeCount ?? 'Unknown'}
Last Order: ${context.lastOrderAt ?? 'Unknown'}
Recent Errors: ${context.recentErrors?.join(', ') ?? 'None'}
`;
  }

  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    {
      role: 'user',
      content: `${contextBlock}

SUPPORT QUERY:
${userQuery}

Respond with JSON in this exact format:
{
  "answer": "your answer here",
  "escalationTier": null or 1 or 2 or 3,
  "escalationReason": "why escalation needed" or null,
  "suggestedActions": ["action 1", "action 2"],
  "relatedDocs": ["relevant section names"]
}`,
    },
  ];

  try {
    const response = await client().messages.create({
      model: config.CLAUDE_MODEL,
      max_tokens: 1500,
      system: HELPDESK_SYSTEM_PROMPT,
      messages,
    });

    const text = response.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('');

    const clean = text
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    const parsed = JSON.parse(clean);

    return {
      answer: parsed.answer,
      escalationTier: parsed.escalationTier ?? undefined,
      suggestedActions: parsed.suggestedActions ?? [],
      relatedDocs: parsed.relatedDocs ?? [],
    };
  } catch (err) {
    console.error('[Helpdesk AI] Error:', err);
    return {
      answer: `I'm having trouble processing that request right now. Please try again or escalate to the engineering team if this is urgent.

Error reference: ${new Date().toISOString()}`,
      escalationTier: 3,
      suggestedActions: ['Retry the query', 'Escalate to engineering'],
      relatedDocs: [],
    };
  }
}

// Fetch lightweight org context for the helpdesk.
export async function getOrgContextForHelpdesk(
  orgId: string,
): Promise<HelpdeskContext> {
  try {
    const result = await query(
      `SELECT
         o.id, o.name, o.plan, o.subscription_status,
         COUNT(DISTINCT e.id) AS employee_count,
         MAX(ord.created_at) AS last_order_at
       FROM organizations o
       LEFT JOIN employees e ON e.organization_id = o.id AND e.deleted_at IS NULL
       LEFT JOIN orders ord ON ord.organization_id = o.id AND ord.status = 'completed'
       WHERE o.id = $1
       GROUP BY o.id`,
      [orgId],
    );

    const org = result.rows[0];
    if (!org) return {};

    return {
      orgId: org.id,
      orgName: org.name,
      plan: org.plan,
      employeeCount: parseInt(org.employee_count, 10),
      lastOrderAt: org.last_order_at ? new Date(org.last_order_at).toISOString() : undefined,
    };
  } catch {
    return {};
  }
}
