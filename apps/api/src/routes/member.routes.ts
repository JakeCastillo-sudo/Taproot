/**
 * member.routes — members, waivers, credit ledger, manual subscriptions (v2.1).
 *
 * ┌─ SANDBOX SEAM ───────────────────────────────────────────────────────────────┐
 * │ NOT registered in index.ts (the boot path, which this sandbox does not touch). │
 * │ To wire after review (see docs/V2_1_SANDBOX_NOTES.md):                          │
 * │   import memberRoutes from './routes/member.routes';                            │
 * │   await fastify.register(memberRoutes);                                         │
 * └───────────────────────────────────────────────────────────────────────────────┘
 *
 * Every route is double-gated: requireManager (owner/manager) AND requireStudio
 * (org must have capabilities.studio). A restaurant org gets a clean 404, never an
 * error. Thrown AppError subclasses (ValidationError/NotFoundError) are formatted by
 * the global error handler.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AccessTokenPayload } from '../auth/jwt';
import * as MemberSvc from '../services/member.service';
import * as CreditSvc from '../services/memberCredit.service';
import * as SubSvc from '../services/memberSubscription.service';
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

// Studio gate: a non-studio org gets a clean 404 (the feature simply doesn't exist
// for them), never a 500. Defense-in-depth on top of the UI gate.
async function requireStudio(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const { user } = req as AuthedRequest;
  if (!(await CapabilitySvc.hasCapability(user.orgId, 'studio'))) {
    reply.status(404).send({ code: 'NOT_FOUND', message: 'Studio features are not enabled for this organization' });
    return false;
  }
  return true;
}

async function gate(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  if (!requireManager(req, reply)) return false;
  if (!(await requireStudio(req, reply))) return false;
  return true;
}

export default async function memberRoutes(fastify: FastifyInstance): Promise<void> {
  // ── Members ──────────────────────────────────────────────────────────────────
  fastify.get('/api/v1/members', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    const q = req.query as { search?: string; status?: string; page?: string; perPage?: string };
    const result = await MemberSvc.listMembers(user.orgId, {
      search: q.search,
      status: q.status as MemberSvc.ListMembersParams['status'],
      page: q.page ? parseInt(q.page, 10) : undefined,
      perPage: q.perPage ? parseInt(q.perPage, 10) : undefined,
    });
    return reply.send(result);
  });

  fastify.post('/api/v1/members', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    const member = await MemberSvc.createMember(user.orgId, user.sub, req.body as MemberSvc.CreateMemberInput);
    return reply.status(201).send({ member });
  });

  fastify.get('/api/v1/members/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    const member = await MemberSvc.getMember(user.orgId, (req.params as { id: string }).id);
    return reply.send({ member });
  });

  fastify.patch('/api/v1/members/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    const member = await MemberSvc.updateMember(user.orgId, (req.params as { id: string }).id, user.sub, req.body as MemberSvc.UpdateMemberInput);
    return reply.send({ member });
  });

  fastify.delete('/api/v1/members/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    await MemberSvc.deleteMember(user.orgId, (req.params as { id: string }).id, user.sub);
    return reply.send({ success: true });
  });

  fastify.post('/api/v1/members/:id/waiver', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    const body = (req.body ?? {}) as { waiverDocId?: string | null };
    const member = await MemberSvc.signWaiver(user.orgId, (req.params as { id: string }).id, user.sub, body.waiverDocId ?? null);
    return reply.send({ member });
  });

  // ── Credits ──────────────────────────────────────────────────────────────────
  fastify.get('/api/v1/members/:id/credits', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    const balance = await CreditSvc.getBalance(user.orgId, (req.params as { id: string }).id);
    return reply.send(balance);
  });

  fastify.post('/api/v1/members/:id/credits', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    const body = (req.body ?? {}) as Omit<CreditSvc.GrantCreditsInput, 'memberId'>;
    const credit = await CreditSvc.grantCredits(user.orgId, user.sub, {
      ...body, memberId: (req.params as { id: string }).id,
    });
    return reply.status(201).send({ credit });
  });

  // Manual deduct (e.g. staff burns a credit for a walk-in). Automatic deduct at
  // class check-in arrives in v2.2 (the scheduling/reservation layer).
  fastify.post('/api/v1/members/:id/credits/deduct', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    const body = (req.body ?? {}) as { count?: number };
    const result = await CreditSvc.deductCredit(user.orgId, user.sub, (req.params as { id: string }).id, body.count ?? 1);
    return reply.send(result);
  });

  // ── Manual subscriptions ───────────────────────────────────────────────────────
  fastify.get('/api/v1/members/:id/subscriptions', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    const subscriptions = await SubSvc.listSubscriptions(user.orgId, (req.params as { id: string }).id);
    return reply.send({ subscriptions });
  });

  fastify.post('/api/v1/members/:id/subscriptions', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    const subscription = await SubSvc.recordSubscription(user.orgId, user.sub, (req.params as { id: string }).id, req.body as SubSvc.RecordSubscriptionInput);
    return reply.status(201).send({ subscription });
  });

  fastify.patch('/api/v1/members/subscriptions/:subId', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    const subscription = await SubSvc.updateSubscription(user.orgId, (req.params as { subId: string }).subId, user.sub, req.body as SubSvc.UpdateSubscriptionInput);
    return reply.send({ subscription });
  });

  fastify.post('/api/v1/members/subscriptions/:subId/cancel', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    const subscription = await SubSvc.cancelSubscription(user.orgId, (req.params as { subId: string }).subId, user.sub);
    return reply.send({ subscription });
  });
}
