/**
 * Stripe webhook routes — unified endpoint plugin with Redis idempotency.
 *
 * Route summary
 * ─────────────
 * POST /api/v1/webhooks/stripe/connect   — Stripe Connect account events
 * POST /api/v1/webhooks/stripe/terminal  — Stripe Terminal + payment events
 *
 * Security
 * ────────
 * - Both endpoints are excluded from JWT auth (PUBLIC_ROUTES in index.ts)
 * - Every request is verified via Stripe signature before processing
 * - Replayed / duplicate events are discarded using a Redis idempotency key:
 *     webhook:processed:{eventId}    TTL 72 h (259200 s)
 *
 * Raw body requirement
 * ────────────────────
 * Stripe signature verification requires the raw, unparsed request body.
 * This plugin registers its own addContentTypeParser for application/json
 * that stores the raw buffer on req.rawBody before JSON parsing.
 * Because Fastify content parsers are scoped to the plugin that registers them,
 * this does NOT affect other routes.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getPublisher } from '../db/redis';
import { handleConnectWebhook } from '../payments/connect.service';
import { handleTerminalWebhook } from '../payments/terminal.service';
import { AppError } from '../errors';

const IDEMPOTENCY_TTL_SECONDS = 259_200; // 72 hours

type RawBodyRequest = FastifyRequest & { rawBody?: Buffer };

async function isEventAlreadyProcessed(eventId: string): Promise<boolean> {
  const redis = getPublisher();
  const key   = `webhook:processed:${eventId}`;
  const result = await redis.set(key, '1', 'EX', IDEMPOTENCY_TTL_SECONDS, 'NX');
  // SET ... NX returns null if key already existed
  return result === null;
}

export default async function webhookRoutes(fastify: FastifyInstance): Promise<void> {

  // ── Raw body capture ────────────────────────────────────────────────────────
  // Scoped to this plugin — does not interfere with other route parsers.
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req: FastifyRequest, body: Buffer, done) => {
      try {
        // Attach raw buffer for signature verification
        (_req as RawBodyRequest).rawBody = body;
        // Also parse as JSON so req.body works normally in non-webhook routes
        // (This parser is only active within this plugin's scope)
        done(null, JSON.parse(body.toString('utf8')));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  // ── POST /api/v1/webhooks/stripe/connect ────────────────────────────────────
  // Higher rate limit — events come from Stripe servers, not end-users.
  fastify.post(
    '/api/v1/webhooks/stripe/connect',
    { config: { rateLimit: { max: 1000, timeWindow: 60_000 } } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const signature = req.headers['stripe-signature'] as string | undefined;
      if (!signature) {
        return reply.code(400).send({ code: 'BAD_REQUEST', message: 'Missing Stripe-Signature header' });
      }

      const rawBody: Buffer | string = (req as RawBodyRequest).rawBody ?? JSON.stringify(req.body);

      // Idempotency: peek at the event ID before full verification
      // (We still verify signature on every request — idempotency is a processing guard)
      let eventId: string | undefined;
      try {
        const parsed = typeof rawBody === 'string'
          ? JSON.parse(rawBody)
          : JSON.parse(rawBody.toString('utf8'));
        eventId = parsed?.id as string | undefined;
      } catch {
        // Non-critical — fall through to full processing
      }

      if (eventId) {
        const alreadyProcessed = await isEventAlreadyProcessed(eventId);
        if (alreadyProcessed) {
          return reply.code(200).send({ received: true, duplicate: true });
        }
      }

      try {
        await handleConnectWebhook(rawBody, signature);
        return reply.code(200).send({ received: true });
      } catch (err) {
        if (err instanceof AppError) {
          return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        }
        throw err;
      }
    },
  );

  // ── POST /api/v1/webhooks/stripe/terminal ───────────────────────────────────
  fastify.post(
    '/api/v1/webhooks/stripe/terminal',
    { config: { rateLimit: { max: 1000, timeWindow: 60_000 } } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const signature = req.headers['stripe-signature'] as string | undefined;
      if (!signature) {
        return reply.code(400).send({ code: 'BAD_REQUEST', message: 'Missing Stripe-Signature header' });
      }

      const rawBody: Buffer | string = (req as RawBodyRequest).rawBody ?? JSON.stringify(req.body);

      let eventId: string | undefined;
      try {
        const parsed = typeof rawBody === 'string'
          ? JSON.parse(rawBody)
          : JSON.parse(rawBody.toString('utf8'));
        eventId = parsed?.id as string | undefined;
      } catch {
        // Non-critical
      }

      if (eventId) {
        const alreadyProcessed = await isEventAlreadyProcessed(eventId);
        if (alreadyProcessed) {
          return reply.code(200).send({ received: true, duplicate: true });
        }
      }

      try {
        await handleTerminalWebhook(rawBody, signature);
        return reply.code(200).send({ received: true });
      } catch (err) {
        if (err instanceof AppError) {
          return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        }
        throw err;
      }
    },
  );
}
