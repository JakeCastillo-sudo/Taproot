/**
 * Cash drawer routes. Location resolved from body/query or the employee's first
 * location. Authenticated via the global hook.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AccessTokenPayload } from '../auth/jwt';
import * as CashSvc from '../services/cashDrawer.service';

type AuthedRequest = FastifyRequest & { user: AccessTokenPayload };

function resolveLocation(user: AccessTokenPayload, provided?: string): string {
  return provided || user.locationIds[0] || '20000000-0000-0000-0000-000000000001';
}

export default async function cashDrawerRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /api/v1/cash-drawer/current
  fastify.get('/api/v1/cash-drawer/current', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const locationId = resolveLocation(user, (req.query as { locationId?: string }).locationId);
    const session = await CashSvc.getCurrentSession(user.orgId, locationId);
    return reply.send({ session });
  });

  // GET /api/v1/cash-drawer/history
  fastify.get('/api/v1/cash-drawer/history', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const locationId = resolveLocation(user, (req.query as { locationId?: string }).locationId);
    const sessions = await CashSvc.getHistory(user.orgId, locationId);
    return reply.send({ sessions });
  });

  // POST /api/v1/cash-drawer/open
  fastify.post('/api/v1/cash-drawer/open', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const body = req.body as { openingAmount: number; locationId?: string };
    const locationId = resolveLocation(user, body.locationId);
    const result = await CashSvc.openSession(user.orgId, locationId, user.sub, Math.round(body.openingAmount ?? 0));
    return reply.code(201).send(result);
  });

  // POST /api/v1/cash-drawer/drop
  fastify.post('/api/v1/cash-drawer/drop', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const body = req.body as { amount: number; reason?: string; locationId?: string };
    const locationId = resolveLocation(user, body.locationId);
    const result = await CashSvc.recordDrop(user.orgId, locationId, user.sub, Math.round(body.amount), body.reason);
    return reply.code(201).send(result);
  });

  // POST /api/v1/cash-drawer/close
  fastify.post('/api/v1/cash-drawer/close', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const body = req.body as { actualAmount: number; notes?: string; locationId?: string };
    const locationId = resolveLocation(user, body.locationId);
    const session = await CashSvc.closeSession(user.orgId, locationId, user.sub, Math.round(body.actualAmount), body.notes);
    return reply.send({ session });
  });
}
