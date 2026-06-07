/**
 * Scheduling + time clock routes (S9-02).
 *
 * Time clock (any authenticated employee — acts on self):
 *   POST /api/v1/timeclock/clockin    { locationId }
 *   POST /api/v1/timeclock/clockout   { breakMinutes? }
 *   GET  /api/v1/timeclock/current
 *
 * Manager/owner:
 *   GET  /api/v1/timeclock/report?from=&to=&location_id=
 *   GET  /api/v1/schedules?week=YYYY-MM-DD
 *   POST /api/v1/schedules            { weekStart, shifts[] }
 *   GET  /api/v1/ai/schedule-suggestion?week=YYYY-MM-DD&locationId=
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AccessTokenPayload } from '../auth/jwt';
import { ValidationError } from '../errors';
import * as SchedulingSvc from '../services/scheduling.service';

type AuthedRequest = FastifyRequest & { user: AccessTokenPayload };

function requireManager(req: FastifyRequest, reply: FastifyReply): boolean {
  const { user } = req as AuthedRequest;
  if (user.role !== 'owner' && user.role !== 'manager') {
    reply.code(403).send({ code: 'FORBIDDEN', message: 'Manager or owner role required' });
    return false;
  }
  return true;
}

export default async function schedulingRoutes(fastify: FastifyInstance): Promise<void> {

  // ── Time clock ──────────────────────────────────────────────────────────────

  fastify.post('/api/v1/timeclock/clockin', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { locationId } = (req.body ?? {}) as { locationId?: string };
    const loc = locationId || user.locationIds[0];
    if (!loc) throw new ValidationError('locationId is required');
    const entry = await SchedulingSvc.clockIn(user.orgId, user.sub, loc);
    return reply.code(201).send(entry);
  });

  fastify.post('/api/v1/timeclock/clockout', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { breakMinutes } = (req.body ?? {}) as { breakMinutes?: number };
    const entry = await SchedulingSvc.clockOut(user.orgId, user.sub, breakMinutes ?? 0);
    return reply.send(entry);
  });

  fastify.get('/api/v1/timeclock/current', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const entry = await SchedulingSvc.getCurrentEntry(user.orgId, user.sub);
    return reply.send({ entry });
  });

  fastify.get('/api/v1/timeclock/report', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireManager(req, reply)) return;
    const { user } = req as AuthedRequest;
    const q = req.query as Record<string, string>;
    const to = q.to || new Date().toISOString();
    const from = q.from || new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
    return reply.send(await SchedulingSvc.getTimeClockReport(user.orgId, from, to, q.location_id || undefined));
  });

  // ── Schedules ───────────────────────────────────────────────────────────────

  fastify.get('/api/v1/schedules', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const q = req.query as Record<string, string>;
    if (!q.week) throw new ValidationError('week=YYYY-MM-DD is required');
    return reply.send({ shifts: await SchedulingSvc.listSchedules(user.orgId, q.week, q.location_id || undefined) });
  });

  fastify.post('/api/v1/schedules', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireManager(req, reply)) return;
    const { user } = req as AuthedRequest;
    const body = (req.body ?? {}) as { weekStart?: string; shifts?: SchedulingSvc.ShiftInput[] };
    if (!body.weekStart) throw new ValidationError('weekStart is required');
    const result = await SchedulingSvc.saveWeekSchedule(user.orgId, body.weekStart, body.shifts ?? []);
    return reply.send(result);
  });

  fastify.get('/api/v1/ai/schedule-suggestion', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireManager(req, reply)) return;
    const { user } = req as AuthedRequest;
    const q = req.query as Record<string, string>;
    if (!q.week) throw new ValidationError('week=YYYY-MM-DD is required');
    const loc = q.locationId || user.locationIds[0];
    if (!loc) throw new ValidationError('locationId is required');
    return reply.send(await SchedulingSvc.getAIScheduleSuggestion(user.orgId, loc, q.week, q.timezone || 'UTC'));
  });
}
