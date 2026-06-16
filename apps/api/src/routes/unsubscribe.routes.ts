/**
 * Unsubscribe routes (CAN-SPAM) — PUBLIC (no auth; the recipient may not have a
 * session). Tokens are HMAC-signed email addresses, verified without a DB lookup.
 * Both paths are listed in index.ts PUBLIC_ROUTES.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { verifyUnsubToken, recordUnsubscribe } from '../services/email.service';

export default async function unsubscribeRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/v1/unsubscribe/verify?token=xxx
  fastify.get('/api/v1/unsubscribe/verify', async (req: FastifyRequest, reply: FastifyReply) => {
    const token = (req.query as { token?: string }).token;
    const email = token ? verifyUnsubToken(token) : null;
    if (!email) return reply.send({ valid: false });
    return reply.send({ valid: true, email });
  });

  // POST /api/v1/unsubscribe  { token, reason? }
  fastify.post('/api/v1/unsubscribe', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as { token?: string; reason?: string };
    const email = body.token ? verifyUnsubToken(body.token) : null;
    if (!email) {
      return reply.code(400).send({ success: false, error: 'Invalid or expired unsubscribe link' });
    }
    try {
      await recordUnsubscribe(email, undefined, body.reason);
    } catch (err) {
      // Table missing (migration 025 not yet applied) or DB error — surface clearly.
      req.log.error({ err }, '[unsubscribe] recordUnsubscribe failed');
      return reply.code(500).send({ success: false, error: 'Could not process unsubscribe right now' });
    }
    return reply.send({ success: true, email });
  });
}
