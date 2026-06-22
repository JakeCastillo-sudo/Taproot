/**
 * counterBridge.routes — pre-order café/bar add-ons on a reservation; fire at check-in (v2.3).
 *
 * ┌─ SANDBOX SEAM ───────────────────────────────────────────────────────────────┐
 * │ NOT registered in index.ts (boot path untouched). To wire after review:        │
 * │   import counterBridgeRoutes from './routes/counterBridge.routes';              │
 * │   await fastify.register(counterBridgeRoutes);                                 │
 * └───────────────────────────────────────────────────────────────────────────────┘
 * Double-gated: requireManager + hasCapability('studio'). The auto-fire at check-in
 * runs via the existing check-in route (classBooking.checkIn calls the bridge); these
 * endpoints cover attach / view / manual-fire.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AccessTokenPayload } from '../auth/jwt';
import * as BridgeSvc from '../services/counterBridge.service';
import * as CapabilitySvc from '../services/capability.service';

type AuthedRequest = FastifyRequest & { user: AccessTokenPayload };

function requireManager(req: FastifyRequest, reply: FastifyReply): boolean {
  const { user } = req as AuthedRequest;
  if (user.role !== 'owner' && user.role !== 'manager') {
    reply.status(403).send({ code: 'FORBIDDEN', message: 'Owner or manager access required' });
    return false;
  }
  return true;
}
async function gate(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  if (!requireManager(req, reply)) return false;
  const { user } = req as AuthedRequest;
  if (!(await CapabilitySvc.hasCapability(user.orgId, 'studio'))) {
    reply.status(404).send({ code: 'NOT_FOUND', message: 'Studio features are not enabled for this organization' });
    return false;
  }
  return true;
}

export default async function counterBridgeRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/v1/reservations/:id/add-ons', async (req, reply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    return reply.send(await BridgeSvc.getReservationAddOns(user.orgId, (req.params as { id: string }).id));
  });

  fastify.post('/api/v1/reservations/:id/add-ons', async (req, reply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    const body = (req.body ?? {}) as { itemIds?: string[] };
    if (!Array.isArray(body.itemIds) || body.itemIds.length === 0) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'itemIds[] is required' });
    return reply.status(201).send(await BridgeSvc.attachAddOns(user.orgId, user.sub, (req.params as { id: string }).id, body.itemIds));
  });

  // Manual fire (the normal fire is automatic at check-in). Idempotent.
  fastify.post('/api/v1/reservations/:id/fire-add-ons', async (req, reply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    return reply.send(await BridgeSvc.fireAddOnsForReservation(user.orgId, user.sub, (req.params as { id: string }).id));
  });
}
