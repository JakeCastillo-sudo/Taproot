/**
 * studioSchedule.routes — studio rooms, class templates, sessions (v2.2).
 *
 * ┌─ SANDBOX SEAM ───────────────────────────────────────────────────────────────┐
 * │ NOT registered in index.ts (boot path untouched). To wire after review:        │
 * │   import studioScheduleRoutes from './routes/studioSchedule.routes';            │
 * │   await fastify.register(studioScheduleRoutes);                                │
 * └───────────────────────────────────────────────────────────────────────────────┘
 * Double-gated: requireManager + hasCapability('studio') (404 for non-studio orgs).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AccessTokenPayload } from '../auth/jwt';
import * as SchedSvc from '../services/studioSchedule.service';
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

export default async function studioScheduleRoutes(fastify: FastifyInstance): Promise<void> {
  // Rooms
  fastify.get('/api/v1/studio/rooms', async (req, reply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    return reply.send({ rooms: await SchedSvc.listRooms(user.orgId) });
  });
  fastify.post('/api/v1/studio/rooms', async (req, reply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    return reply.status(201).send({ room: await SchedSvc.createRoom(user.orgId, user.sub, req.body as SchedSvc.RoomInput) });
  });
  fastify.delete('/api/v1/studio/rooms/:id', async (req, reply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    await SchedSvc.deleteRoom(user.orgId, (req.params as { id: string }).id);
    return reply.send({ success: true });
  });

  // Templates
  fastify.get('/api/v1/class-templates', async (req, reply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    return reply.send({ templates: await SchedSvc.listTemplates(user.orgId) });
  });
  fastify.post('/api/v1/class-templates', async (req, reply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    return reply.status(201).send({ template: await SchedSvc.createTemplate(user.orgId, user.sub, req.body as SchedSvc.TemplateInput) });
  });
  fastify.delete('/api/v1/class-templates/:id', async (req, reply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    await SchedSvc.deleteTemplate(user.orgId, (req.params as { id: string }).id);
    return reply.send({ success: true });
  });
  // Materialize sessions from a template's recurrence over a date range.
  fastify.post('/api/v1/class-templates/:id/generate', async (req, reply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    const body = (req.body ?? {}) as { fromDate?: string; toDate?: string };
    if (!body.fromDate || !body.toDate) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'fromDate and toDate (YYYY-MM-DD) are required' });
    return reply.send(await SchedSvc.generateSessions(user.orgId, user.sub, (req.params as { id: string }).id, body.fromDate, body.toDate));
  });

  // Sessions
  fastify.get('/api/v1/classes', async (req, reply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    const q = req.query as { location_id?: string; from?: string; to?: string };
    return reply.send({ sessions: await SchedSvc.listSessions(user.orgId, { locationId: q.location_id, from: q.from, to: q.to }) });
  });
  fastify.post('/api/v1/class-sessions', async (req, reply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    return reply.status(201).send({ session: await SchedSvc.createOneOffSession(user.orgId, user.sub, req.body as SchedSvc.OneOffSessionInput) });
  });
  fastify.post('/api/v1/class-sessions/:id/cancel', async (req, reply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    return reply.send(await SchedSvc.cancelSession(user.orgId, user.sub, (req.params as { id: string }).id));
  });
}
