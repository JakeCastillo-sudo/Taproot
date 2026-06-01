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

let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  return _anthropic;
}

const MODEL = 'claude-sonnet-4-20250514';

export default async function aiRoutes(fastify: FastifyInstance): Promise<void> {

  // ── POST /api/v1/ai/nl-query ────────────────────────────────────────────────

  fastify.post(
    '/api/v1/ai/nl-query',
    {
      preHandler: requirePermissions(Permission.AI_REPORTS),
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const body = req.body as {
        query:      string;
        locationId: string;
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
             COALESCE(SUM(total_amount), 0)                      AS total_revenue,
             COALESCE(AVG(total_amount), 0)                      AS avg_order,
             COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)  AS orders_today,
             COALESCE(SUM(total_amount) FILTER (WHERE created_at >= CURRENT_DATE), 0) AS revenue_today
           FROM orders
           WHERE organization_id = $1
             AND location_id = $2
             AND status NOT IN ('voided','draft')`,
          [user.orgId, body.locationId],
        ),
      ]);

      const summary = summaryRows[0];
      const context = [
        `Organization: ${org?.name ?? user.orgId}`,
        `Location: ${location?.name ?? body.locationId}`,
        `Total orders (all time): ${summary?.total_orders ?? 0}`,
        `Total revenue (all time): $${((Number(summary?.total_revenue) || 0) / 100).toFixed(2)}`,
        `Average order value: $${((Number(summary?.avg_order) || 0) / 100).toFixed(2)}`,
        `Orders today: ${summary?.orders_today ?? 0}`,
        `Revenue today: $${((Number(summary?.revenue_today) || 0) / 100).toFixed(2)}`,
      ].join('\n');

      const systemPrompt = `You are a business analytics assistant for a restaurant/retail POS system called Taproot.
You have access to summary sales data. Answer questions about the business in plain English.
If you can provide a data table, include it as a JSON array in your response.
Respond ONLY with JSON in this exact format:
{
  "answer": "plain English answer",
  "data": [{ "column": "value" }] or null,
  "chartType": "bar" | "line" | "donut" | null
}`;

      const userMessage = `Business context:\n${context}\n\nQuestion: ${body.query.trim()}`;

      let answer = '';
      let data: Record<string, unknown>[] | null = null;
      let chartType: string | null = null;

      try {
        const client = getAnthropic();
        const msg = await client.messages.create({
          model: MODEL,
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
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
          };
          answer    = parsed.answer ?? '';
          data      = parsed.data   ?? null;
          chartType = parsed.chartType ?? null;
        }
      } catch (err: unknown) {
        // Return a graceful fallback if AI is unavailable
        answer = `I'm currently unable to process that query. Here's what I can tell you from the data: ${context}`;
        if (err instanceof Error && err.message.includes('API key')) {
          answer = 'AI features require a valid Anthropic API key. Please configure ANTHROPIC_API_KEY.';
        }
      }

      return reply.send({ answer, data, chartType });
    },
  );
}
