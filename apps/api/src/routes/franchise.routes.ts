/**
 * Franchise routes (S8-01) — chain/franchise network management.
 *
 * GET   /api/v1/franchise/info        Current org's franchise state (any authed user)
 * POST  /api/v1/franchise/enable      Become a franchisor + generate code (owner)
 * GET   /api/v1/franchise/network     Franchisee list w/ 30d metrics (franchisor, owner/manager)
 * POST  /api/v1/franchise/invite      Email an invite + code (franchisor, owner/manager)
 * POST  /api/v1/franchise/join        Join a network via code (owner)
 * GET   /api/v1/franchise/menu        Corporate menu (franchisee: local locked items; franchisor: master)
 * PATCH /api/v1/franchise/menu/push   Push products to all franchisees (franchisor, owner/manager)
 *
 * Note: the build spec placed these in settings.routes.ts; they live in a
 * dedicated file to match the one-domain-one-file route pattern.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AccessTokenPayload } from '../auth/jwt';
import * as FranchiseSvc from '../services/franchise.service';

type AuthedRequest = FastifyRequest & { user: AccessTokenPayload };

function requireManager(req: FastifyRequest, reply: FastifyReply): boolean {
  const { user } = req as AuthedRequest;
  if (user.role !== 'owner' && user.role !== 'manager') {
    reply.code(403).send({ code: 'FORBIDDEN', message: 'Manager or owner role required' });
    return false;
  }
  return true;
}

function requireOwner(req: FastifyRequest, reply: FastifyReply): boolean {
  const { user } = req as AuthedRequest;
  if (user.role !== 'owner') {
    reply.code(403).send({ code: 'FORBIDDEN', message: 'Owner role required' });
    return false;
  }
  return true;
}

export default async function franchiseRoutes(fastify: FastifyInstance): Promise<void> {

  // ── GET /api/v1/franchise/info ─────────────────────────────────────────────
  fastify.get('/api/v1/franchise/info', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    return reply.send(await FranchiseSvc.getFranchiseInfo(user.orgId));
  });

  // ── POST /api/v1/franchise/enable ──────────────────────────────────────────
  fastify.post('/api/v1/franchise/enable', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireOwner(req, reply)) return;
    const { user } = req as AuthedRequest;
    const result = await FranchiseSvc.enableFranchisor(user.orgId);
    return reply.send(result);
  });

  // ── GET /api/v1/franchise/network ──────────────────────────────────────────
  fastify.get('/api/v1/franchise/network', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireManager(req, reply)) return;
    const { user } = req as AuthedRequest;
    return reply.send(await FranchiseSvc.getNetwork(user.orgId));
  });

  // ── POST /api/v1/franchise/invite ──────────────────────────────────────────
  fastify.post('/api/v1/franchise/invite', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireManager(req, reply)) return;
    const { user } = req as AuthedRequest;
    const { email, locationName } = (req.body ?? {}) as { email?: string; locationName?: string };
    const result = await FranchiseSvc.inviteFranchisee(user.orgId, email ?? '', locationName ?? '');
    return reply.send(result);
  });

  // ── POST /api/v1/franchise/join ────────────────────────────────────────────
  fastify.post('/api/v1/franchise/join', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireOwner(req, reply)) return;
    const { user } = req as AuthedRequest;
    const { franchiseCode } = (req.body ?? {}) as { franchiseCode?: string };
    const info = await FranchiseSvc.joinNetwork(user.orgId, franchiseCode ?? '');
    return reply.send(info);
  });

  // ── GET /api/v1/franchise/menu ─────────────────────────────────────────────
  fastify.get('/api/v1/franchise/menu', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    return reply.send(await FranchiseSvc.getCorporateMenu(user.orgId));
  });

  // ── PATCH /api/v1/franchise/menu/push ──────────────────────────────────────
  fastify.patch('/api/v1/franchise/menu/push', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireManager(req, reply)) return;
    const { user } = req as AuthedRequest;
    const { productIds } = (req.body ?? {}) as { productIds?: string[] };
    const result = await FranchiseSvc.pushMenu(user.orgId, productIds ?? []);
    return reply.send(result);
  });
}
