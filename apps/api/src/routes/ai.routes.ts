/**
 * AI Routes — copilot + AI intelligence endpoints.
 *
 * POST /api/v1/ai/nl-query   Natural-language query (chart/table aware)
 * GET  /api/v1/ai/forecast   Single-date demand forecast (S9-01)
 */

import Anthropic from '@anthropic-ai/sdk';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AccessTokenPayload } from '../auth/jwt';
import { requirePermissions, Permission } from '../auth/permissions';
import { ValidationError } from '../errors';
import { config } from '../config';
import { query } from '../db/client';
import * as AiForecastSvc from '../services/aiForecast.service';
import { getDailyIntelligence } from '../services/intelligence.service';
import { cacheGet, cacheSet } from '../services/ai.service';

type AuthedRequest = FastifyRequest & { user: AccessTokenPayload };

const MODEL = config.CLAUDE_MODEL;

export default async function aiRoutes(fastify: FastifyInstance): Promise<void> {

  // ── GET /api/v1/ai/forecast — single-date demand forecast (S9-01) ──────────
  fastify.get(
    '/api/v1/ai/forecast',
    { preHandler: requirePermissions(Permission.AI_COPILOT) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const q = req.query as Record<string, string>;
      const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
      const result = await AiForecastSvc.getForecast(
        user.orgId,
        q.locationId || undefined,
        q.date || tomorrow,
        q.timezone || 'UTC',
      );
      return reply.send(result);
    },
  );

  // ── GET /api/v1/ai/daily-intelligence — owner morning digest (S9-04) ───────
  fastify.get(
    '/api/v1/ai/daily-intelligence',
    { preHandler: requirePermissions(Permission.AI_COPILOT) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const q = req.query as Record<string, string>;
      return reply.send(await getDailyIntelligence(user.orgId, q.locationId || undefined, q.timezone || 'UTC'));
    },
  );

  // ── GET /api/v1/ai/suggested-questions — context-aware chips (S9-06) ───────
  fastify.get(
    '/api/v1/ai/suggested-questions',
    { preHandler: requirePermissions(Permission.AI_REPORTS) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const cacheKey = `ai:suggested-q:${user.orgId}`;
      const cached = await cacheGet<string[]>(cacheKey);
      if (cached) return reply.send({ questions: cached });

      const questions: string[] = [
        'What was my best selling item last week?',
        'Compare this week to last week',
      ];

      // Season with live context — busiest day, top employee, low stock
      try {
        const [{ rows: [busy] }, { rows: [topEmp] }, { rows: lowStock }] = await Promise.all([
          query<{ dow: number }>(
            `SELECT EXTRACT(DOW FROM created_at)::int AS dow FROM orders
              WHERE organization_id = $1 AND status NOT IN ('voided','parked')
                AND created_at >= now() - interval '30 days'
              GROUP BY 1 ORDER BY SUM(total) DESC LIMIT 1`,
            [user.orgId],
          ),
          query<{ name: string }>(
            `SELECT e.first_name AS name FROM orders o
              JOIN employees e ON e.id = o.employee_id
             WHERE o.organization_id = $1 AND o.status = 'completed'
               AND o.created_at >= now() - interval '7 days'
             GROUP BY e.first_name ORDER BY SUM(o.total) DESC LIMIT 1`,
            [user.orgId],
          ),
          query<{ name: string }>(
            `SELECT p.name FROM inventory_levels il JOIN products p ON p.id = il.product_id
              WHERE il.organization_id = $1 AND il.reorder_point > 0
                AND il.quantity_on_hand <= il.reorder_point LIMIT 1`,
            [user.orgId],
          ),
        ]);
        const dows = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        if (busy) questions.push(`When is my busiest hour on ${dows[busy.dow]}s?`);
        if (topEmp) questions.push(`How did ${topEmp.name} perform this week?`);
        if (lowStock.length) questions.push('What should I 86 based on low stock?');
        else questions.push('Which items are slow movers this month?');
      } catch { /* fall back to the static list */ }

      await cacheSet(cacheKey, questions, 60 * 60);
      return reply.send({ questions });
    },
  );

  // ── POST /api/v1/ai/nl-query ────────────────────────────────────────────────

  fastify.post(
    '/api/v1/ai/nl-query',
    {
      config:     { rateLimit: { max: 30, timeWindow: 60 * 60 * 1000 } }, // 30/hour
      preHandler: requirePermissions(Permission.AI_REPORTS),
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const body = req.body as {
        query:      string;
        locationId: string;
        history?:   Array<{ role: 'user' | 'assistant'; content: string }>;
      };

      if (!body.query?.trim()) throw new ValidationError('query is required');
      if (!body.locationId)    throw new ValidationError('locationId is required');

      // Build context from DB
      const [
        { rows: [org] },
        { rows: [location] },
        { rows: summaryRows },
      ] = await Promise.all([
        query<{ name: string; plan: string }>(
          `SELECT name, plan FROM organizations WHERE id = $1`,
          [user.orgId],
        ),
        query<{ name: string }>(
          `SELECT name FROM locations WHERE id = $1 AND organization_id = $2`,
          [body.locationId, user.orgId],
        ),
        query<{
          total_orders: string;
          total_revenue: string;
          avg_order: string;
          orders_today: string;
          revenue_today: string;
        }>(
          `SELECT
             COUNT(*)                                             AS total_orders,
             COALESCE(SUM(total), 0)                              AS total_revenue,
             COALESCE(AVG(total), 0)                              AS avg_order,
             COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)  AS orders_today,
             COALESCE(SUM(total) FILTER (WHERE created_at >= CURRENT_DATE), 0) AS revenue_today
           FROM orders
           WHERE organization_id = $1
             AND location_id = $2
             AND status NOT IN ('voided','parked')`,
          [user.orgId, body.locationId],
        ),
      ]);

      // Top products (last 30 days) for richer answers
      const { rows: topProducts } = await query<{ name: string; units: string; revenue: string }>(
        `SELECT li.name, SUM(li.quantity) AS units, SUM(li.total) AS revenue
           FROM order_line_items li
           JOIN orders o ON o.id = li.order_id AND o.status NOT IN ('voided','parked')
          WHERE o.organization_id = $1 AND o.location_id = $2 AND li.voided_at IS NULL
            AND o.created_at >= now() - interval '30 days'
          GROUP BY li.name ORDER BY revenue DESC LIMIT 8`,
        [user.orgId, body.locationId],
      );

      const summary = summaryRows[0];
      const context = [
        `Organization: ${org?.name ?? user.orgId}`,
        `Location: ${location?.name ?? body.locationId}`,
        `Total orders (all time): ${summary?.total_orders ?? 0}`,
        `Total revenue (all time): $${((Number(summary?.total_revenue) || 0) / 100).toFixed(2)}`,
        `Average order value: $${((Number(summary?.avg_order) || 0) / 100).toFixed(2)}`,
        `Orders today: ${summary?.orders_today ?? 0}`,
        `Revenue today: $${((Number(summary?.revenue_today) || 0) / 100).toFixed(2)}`,
        `Top products (30d): ${topProducts.map((p) => `${p.name} (${p.units} sold, $${(Number(p.revenue) / 100).toFixed(0)})`).join('; ') || 'none'}`,
      ].join('\n');

      const systemPrompt = `You are an AI copilot for a restaurant/retail POS called Taproot.
You have summary sales data and top products. Answer the owner's question in plain English using the data.
When a comparison or breakdown is useful, include a small data table. Suggest 3 short, relevant follow-up questions.
When your answer implies a next step the owner could take in the app, include a suggestedAction
(action one of: "view_orders" | "view_employee" | "archive_product" | "update_price"; params may include {"productName": "..."} or {"employeeName": "..."}). Otherwise suggestedAction is null.
Respond ONLY with JSON in this exact format:
{
  "answer": "plain English answer",
  "data": [{ "column": "value" }] or null,
  "chartType": "bar" | "line" | "pie" | null,
  "suggestedQuestions": ["...", "...", "..."],
  "suggestedAction": { "label": "View these orders", "action": "view_orders", "params": {} } or null
}`;

      const userMessage = `Business context:\n${context}\n\nQuestion: ${body.query.trim()}`;
      const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
        ...(body.history ?? []).slice(-6),
        { role: 'user', content: userMessage },
      ];

      let answer = '';
      let data: Record<string, unknown>[] | null = null;
      let chartType: string | null = null;
      let suggestedQuestions: string[] = [];
      let suggestedAction: { label: string; action: string; params: Record<string, unknown> } | null = null;

      try {
        // Lazy-initialize per call so dotenv is guaranteed loaded (BUG-001 prevention)
        const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
        const msg = await client.messages.create({
          model: MODEL,
          max_tokens: 1024,
          system: systemPrompt,
          messages,
        });

        const block = msg.content[0];
        if (block.type === 'text') {
          const cleaned = block.text
            .replace(/^```(?:json)?\n?/i, '')
            .replace(/\n?```$/i, '')
            .trim();
          const parsed = JSON.parse(cleaned) as {
            answer: string;
            data?: Record<string, unknown>[] | null;
            chartType?: string | null;
            suggestedQuestions?: string[];
            suggestedAction?: { label?: string; action?: string; params?: Record<string, unknown> } | null;
          };
          answer    = parsed.answer ?? '';
          data      = parsed.data   ?? null;
          chartType = parsed.chartType ?? null;
          suggestedQuestions = Array.isArray(parsed.suggestedQuestions) ? parsed.suggestedQuestions.slice(0, 3) : [];
          const VALID_ACTIONS = ['view_orders', 'view_employee', 'archive_product', 'update_price'];
          if (parsed.suggestedAction
              && typeof parsed.suggestedAction.label === 'string'
              && VALID_ACTIONS.includes(parsed.suggestedAction.action ?? '')) {
            suggestedAction = {
              label: parsed.suggestedAction.label,
              action: parsed.suggestedAction.action as string,
              params: parsed.suggestedAction.params ?? {},
            };
          }
        }
      } catch (err: unknown) {
        // Return a graceful fallback if AI is unavailable
        answer = `I'm currently unable to process that query. Here's a quick snapshot:\n${context}`;
        if (err instanceof Error && err.message.includes('API key')) {
          answer = 'AI features require a valid Anthropic API key. Please configure ANTHROPIC_API_KEY.';
        }
        suggestedQuestions = ['What were my top sellers this week?', 'How do sales compare to last week?', 'Which days are busiest?'];
      }

      return reply.send({ answer, data, chartType, suggestedQuestions, suggestedAction });
    },
  );
}
