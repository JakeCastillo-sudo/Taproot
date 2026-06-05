/**
 * AI Routes — Natural Language Query endpoint.
 *
 * POST /api/v1/ai/nl-query
 */

import Anthropic from '@anthropic-ai/sdk';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AccessTokenPayload } from '../auth/jwt';
import { requirePermissions, Permission } from '../auth/permissions';
import { ValidationError } from '../errors';
import { config } from '../config';
import { query } from '../db/client';

type AuthedRequest = FastifyRequest & { user: AccessTokenPayload };

const MODEL = config.CLAUDE_MODEL;

export default async function aiRoutes(fastify: FastifyInstance): Promise<void> {

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
Respond ONLY with JSON in this exact format:
{
  "answer": "plain English answer",
  "data": [{ "column": "value" }] or null,
  "chartType": "bar" | "line" | "pie" | null,
  "suggestedQuestions": ["...", "...", "..."]
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
          };
          answer    = parsed.answer ?? '';
          data      = parsed.data   ?? null;
          chartType = parsed.chartType ?? null;
          suggestedQuestions = Array.isArray(parsed.suggestedQuestions) ? parsed.suggestedQuestions.slice(0, 3) : [];
        }
      } catch (err: unknown) {
        // Return a graceful fallback if AI is unavailable
        answer = `I'm currently unable to process that query. Here's a quick snapshot:\n${context}`;
        if (err instanceof Error && err.message.includes('API key')) {
          answer = 'AI features require a valid Anthropic API key. Please configure ANTHROPIC_API_KEY.';
        }
        suggestedQuestions = ['What were my top sellers this week?', 'How do sales compare to last week?', 'Which days are busiest?'];
      }

      return reply.send({ answer, data, chartType, suggestedQuestions });
    },
  );
}
