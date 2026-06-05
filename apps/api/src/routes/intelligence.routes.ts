/**
 * Intelligence routes (Sprint 5 — AI layer). Authenticated globally; org from JWT.
 * REPORTS_VIEW permission required.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AccessTokenPayload } from '../auth/jwt';
import { Permission, requirePermissions } from '../auth/permissions';
import * as IntelSvc from '../services/intelligence.service';

type AuthedRequest = FastifyRequest & { user: AccessTokenPayload };
const guard = { preHandler: [requirePermissions(Permission.REPORTS_VIEW)] };

export default async function intelligenceRoutes(fastify: FastifyInstance): Promise<void> {

  fastify.get('/api/v1/intelligence/forecast', guard, async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const q = req.query as { locationId?: string; timezone?: string };
    const result = await IntelSvc.getDemandForecast(user.orgId, q.locationId, q.timezone ?? 'UTC');
    return reply.send(result);
  });
}
