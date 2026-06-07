/**
 * Analytics routes (S8-03) — advanced analytics endpoints.
 *
 * GET /api/v1/analytics/cohort             ?months=6&location_id=
 * GET /api/v1/analytics/menu-engineering   ?from=&to=&location_id=
 * GET /api/v1/analytics/staff-performance  ?from=&to=&location_id=
 * GET /api/v1/analytics/peak-hours         ?from=&to=&location_id=&timezone=
 * GET /api/v1/analytics/customer-insights  ?from=&to=&location_id=
 *
 * All require REPORTS_VIEW. from/to default to the last 30 days when omitted.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AccessTokenPayload } from '../auth/jwt';
import { Permission, requirePermissions } from '../auth/permissions';
import * as AnalyticsSvc from '../services/analytics.service';

type AuthedRequest = FastifyRequest & { user: AccessTokenPayload };

function parseRange(q: Record<string, string>): AnalyticsSvc.RangeParams {
  const to = q.to || new Date().toISOString();
  const from = q.from || new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  return { from, to, locationId: q.location_id || undefined, timezone: q.timezone || 'UTC' };
}

export default async function analyticsRoutes(fastify: FastifyInstance): Promise<void> {
  const guard = { preHandler: [requirePermissions(Permission.REPORTS_VIEW)] };

  fastify.get('/api/v1/analytics/cohort', guard, async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const q = req.query as Record<string, string>;
    const months = Number(q.months) || 6;
    return reply.send(await AnalyticsSvc.getCohortAnalysis(user.orgId, months, q.location_id || undefined));
  });

  fastify.get('/api/v1/analytics/menu-engineering', guard, async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    return reply.send(await AnalyticsSvc.getMenuEngineeringMatrix(user.orgId, parseRange(req.query as Record<string, string>)));
  });

  fastify.get('/api/v1/analytics/staff-performance', guard, async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    return reply.send(await AnalyticsSvc.getStaffPerformance(user.orgId, parseRange(req.query as Record<string, string>)));
  });

  fastify.get('/api/v1/analytics/peak-hours', guard, async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    return reply.send(await AnalyticsSvc.getPeakHours(user.orgId, parseRange(req.query as Record<string, string>)));
  });

  fastify.get('/api/v1/analytics/customer-insights', guard, async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    return reply.send(await AnalyticsSvc.getCustomerInsights(user.orgId, parseRange(req.query as Record<string, string>)));
  });
}
