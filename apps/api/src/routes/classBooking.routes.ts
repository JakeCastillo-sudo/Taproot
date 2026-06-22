/**
 * classBooking.routes — studio class reservations, check-in, waitlist (v2.2).
 *
 * ┌─ SANDBOX SEAM ───────────────────────────────────────────────────────────────┐
 * │ NOT registered in index.ts (boot path untouched). To wire after review:        │
 * │   import classBookingRoutes from './routes/classBooking.routes';                │
 * │   await fastify.register(classBookingRoutes);                                  │
 * └───────────────────────────────────────────────────────────────────────────────┘
 * Double-gated: requireManager + hasCapability('studio').
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AccessTokenPayload } from '../auth/jwt';
import * as BookingSvc from '../services/classBooking.service';
import * as CapabilitySvc from '../services/capability.service';
import type { ClassReservationSource } from '@taproot/shared';

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

export default async function classBookingRoutes(fastify: FastifyInstance): Promise<void> {
  // Book a member into a session. 200 with { status:'full' } when at capacity.
  fastify.post('/api/v1/class-reservations', async (req, reply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    const body = (req.body ?? {}) as { sessionId?: string; memberId?: string; source?: ClassReservationSource };
    if (!body.sessionId || !body.memberId) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'sessionId and memberId are required' });
    const result = await BookingSvc.book(user.orgId, user.sub, body.sessionId, body.memberId, body.source ?? 'staff');
    return reply.status(result.status === 'booked' ? 201 : 200).send(result);
  });

  fastify.delete('/api/v1/class-reservations/:id', async (req, reply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    return reply.send(await BookingSvc.cancel(user.orgId, user.sub, (req.params as { id: string }).id));
  });

  fastify.post('/api/v1/class-reservations/:id/check-in', async (req, reply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    const body = (req.body ?? {}) as { source?: ClassReservationSource };
    return reply.send({ reservation: await BookingSvc.checkIn(user.orgId, user.sub, (req.params as { id: string }).id, body.source ?? 'staff') });
  });

  fastify.post('/api/v1/class-reservations/:id/no-show', async (req, reply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    return reply.send({ reservation: await BookingSvc.markNoShow(user.orgId, user.sub, (req.params as { id: string }).id) });
  });

  fastify.get('/api/v1/class-sessions/:id/roster', async (req, reply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    return reply.send({ roster: await BookingSvc.roster(user.orgId, (req.params as { id: string }).id) });
  });

  // Waitlist
  fastify.get('/api/v1/class-sessions/:id/waitlist', async (req, reply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    return reply.send({ waitlist: await BookingSvc.listWaitlist(user.orgId, (req.params as { id: string }).id) });
  });
  fastify.post('/api/v1/class-sessions/:id/waitlist', async (req, reply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    const body = (req.body ?? {}) as { memberId?: string };
    if (!body.memberId) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'memberId is required' });
    return reply.status(201).send({ entry: await BookingSvc.joinWaitlist(user.orgId, user.sub, (req.params as { id: string }).id, body.memberId) });
  });
  fastify.post('/api/v1/class-waitlist/:id/promote', async (req, reply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    return reply.send(await BookingSvc.promoteFromWaitlist(user.orgId, user.sub, (req.params as { id: string }).id));
  });
}
