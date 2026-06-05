/**
 * Kitchen Display routes. Authenticated globally; org scope from JWT.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AccessTokenPayload } from '../auth/jwt';
import * as KitchenSvc from '../services/kitchen.service';

type AuthedRequest = FastifyRequest & { user: AccessTokenPayload };

function resolveLocation(user: AccessTokenPayload, provided?: string): string {
  return provided || user.locationIds[0] || '20000000-0000-0000-0000-000000000001';
}

export default async function kitchenRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /api/v1/kitchen/tickets?locationId=
  fastify.get('/api/v1/kitchen/tickets', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const locationId = resolveLocation(user, (req.query as { locationId?: string }).locationId);
    const orders = await KitchenSvc.getTickets(user.orgId, locationId);
    return reply.send({ orders });
  });

  // PATCH /api/v1/kitchen/items/:itemId/ready
  fastify.patch('/api/v1/kitchen/items/:itemId/ready', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { itemId } = req.params as { itemId: string };
    await KitchenSvc.markItemReady(user.orgId, itemId);
    return reply.send({ success: true });
  });

  // PATCH /api/v1/kitchen/orders/:orderId/bump
  fastify.patch('/api/v1/kitchen/orders/:orderId/bump', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { orderId } = req.params as { orderId: string };
    await KitchenSvc.bumpOrder(user.orgId, orderId);
    return reply.send({ success: true });
  });
}
