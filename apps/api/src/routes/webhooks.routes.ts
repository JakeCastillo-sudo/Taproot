/**
 * Outbound webhook subscription routes (S8-04).
 *
 * GET    /api/v1/webhooks            List subscriptions
 * POST   /api/v1/webhooks            Create (returns signing secret ONCE)
 * DELETE /api/v1/webhooks/:id        Delete
 * POST   /api/v1/webhooks/:id/test   Send a signed test payload
 *
 * NOTE: routes/webhook.routes.ts (singular) handles INBOUND Stripe webhooks
 * at /api/v1/webhooks/stripe/* — static segments win routing, no conflict.
 * Owner/manager only.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AccessTokenPayload } from '../auth/jwt';
import * as WebhookSvc from '../services/webhook.service';

type AuthedRequest = FastifyRequest & { user: AccessTokenPayload };

function requireManager(req: FastifyRequest, reply: FastifyReply): boolean {
  const { user } = req as AuthedRequest;
  if (user.role !== 'owner' && user.role !== 'manager') {
    reply.code(403).send({ code: 'FORBIDDEN', message: 'Manager or owner role required' });
    return false;
  }
  return true;
}

export default async function webhooksRoutes(fastify: FastifyInstance): Promise<void> {

  fastify.get('/api/v1/webhooks', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireManager(req, reply)) return;
    const { user } = req as AuthedRequest;
    return reply.send({
      webhooks: await WebhookSvc.listWebhooks(user.orgId),
      availableEvents: WebhookSvc.WEBHOOK_EVENTS,
    });
  });

  fastify.post('/api/v1/webhooks', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireManager(req, reply)) return;
    const { user } = req as AuthedRequest;
    const body = (req.body ?? {}) as { url?: string; events?: string[] };
    const created = await WebhookSvc.createWebhook(user.orgId, {
      url: body.url ?? '',
      events: body.events ?? [],
    });
    return reply.code(201).send(created);
  });

  fastify.delete('/api/v1/webhooks/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireManager(req, reply)) return;
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    await WebhookSvc.deleteWebhook(user.orgId, id);
    return reply.send({ success: true });
  });

  fastify.post('/api/v1/webhooks/:id/test', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireManager(req, reply)) return;
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    return reply.send(await WebhookSvc.testWebhook(user.orgId, id));
  });
}
