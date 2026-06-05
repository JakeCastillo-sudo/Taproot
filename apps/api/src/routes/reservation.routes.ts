/**
 * Reservation + waitlist routes. Authenticated globally; org scope from JWT.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AccessTokenPayload } from '../auth/jwt';
import * as ResSvc from '../services/reservation.service';

type AuthedRequest = FastifyRequest & { user: AccessTokenPayload };

function resolveLocation(user: AccessTokenPayload, provided?: string): string {
  return provided || user.locationIds[0] || '20000000-0000-0000-0000-000000000001';
}

export default async function reservationRoutes(fastify: FastifyInstance): Promise<void> {

  fastify.get('/api/v1/reservations', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const q = req.query as { date?: string; locationId?: string; type?: ResSvc.ReservationType };
    const locationId = resolveLocation(user, q.locationId);
    const reservations = await ResSvc.listReservations(user.orgId, locationId, { date: q.date, type: q.type });
    return reply.send({ reservations });
  });

  fastify.post('/api/v1/reservations', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const body = req.body as ResSvc.CreateReservationData & { locationId?: string };
    const locationId = resolveLocation(user, body.locationId);
    const reservation = await ResSvc.createReservation(user.orgId, locationId, body, user.sub);
    return reply.code(201).send(reservation);
  });

  fastify.patch('/api/v1/reservations/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    const reservation = await ResSvc.updateReservation(user.orgId, id, req.body as ResSvc.UpdateReservationData, user.sub);
    return reply.send(reservation);
  });

  fastify.delete('/api/v1/reservations/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    await ResSvc.deleteReservation(user.orgId, id, user.sub);
    return reply.code(204).send();
  });

  fastify.post('/api/v1/reservations/:id/notify', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    const result = await ResSvc.notifyReservation(user.orgId, id, user.sub);
    return reply.send(result);
  });

  fastify.post('/api/v1/reservations/:id/seat', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    const { tableId } = (req.body ?? {}) as { tableId?: string | null };
    const reservation = await ResSvc.seatReservation(user.orgId, id, tableId ?? null, user.sub);
    return reply.send(reservation);
  });
}
