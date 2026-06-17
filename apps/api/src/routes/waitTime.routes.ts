/**
 * Wait-time routes (FEAT-WAIT-001). Authenticated globally via the index.ts
 * preHandler hook (org scope from JWT). Role checks happen in-handler, matching
 * delivery.routes.ts. Location ids in the path are verified to belong to the
 * caller's org (tenant isolation) before any read/write.
 *
 *  - GET  /api/v1/locations/:locationId/wait-time           (authed)        live estimate
 *  - GET  /api/v1/locations/:locationId/wait-time/config    (authed)        current config
 *  - PUT  /api/v1/locations/:locationId/wait-time/config    (owner)         update config
 *  - POST /api/v1/locations/:locationId/wait-time/rush      (owner/manager) toggle rush mode
 *  - GET  /api/v1/locations/:locationId/wait-time/accuracy  (authed)        7-day actual prep
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AccessTokenPayload } from '../auth/jwt';
import { query } from '../db/client';
import {
  calculateWaitTime,
  getWaitTimeConfig,
  saveWaitTimeConfig,
  setRushMode,
  getAccuracyHistory,
  type WaitTimeConfig,
} from '../services/waitTime.service';

type AuthedRequest = FastifyRequest & { user: AccessTokenPayload };

async function locationInOrg(orgId: string, locationId: string): Promise<boolean> {
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM locations WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [locationId, orgId],
  );
  return rows.length > 0;
}

export async function registerWaitTimeRoutes(fastify: FastifyInstance): Promise<void> {
  // ── GET live estimate (any authed role — POS + KDS) ───────────────────────────
  fastify.get('/api/v1/locations/:locationId/wait-time', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { locationId } = req.params as { locationId: string };
    if (!(await locationInOrg(user.orgId, locationId))) {
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'Location not found' });
    }
    const result = await calculateWaitTime(user.orgId, locationId);
    return reply.send(result);
  });

  // ── GET config (any authed role) ──────────────────────────────────────────────
  fastify.get('/api/v1/locations/:locationId/wait-time/config', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { locationId } = req.params as { locationId: string };
    if (!(await locationInOrg(user.orgId, locationId))) {
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'Location not found' });
    }
    const cfg = await getWaitTimeConfig(locationId);
    return reply.send(cfg);
  });

  // ── PUT config (owner only) ───────────────────────────────────────────────────
  fastify.put('/api/v1/locations/:locationId/wait-time/config', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    if (user.role !== 'owner') {
      return reply.code(403).send({ code: 'FORBIDDEN', message: 'Owner role required' });
    }
    const { locationId } = req.params as { locationId: string };
    if (!(await locationInOrg(user.orgId, locationId))) {
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'Location not found' });
    }
    const body = (req.body ?? {}) as Partial<WaitTimeConfig>;

    // Whitelist + coerce — never persist arbitrary client keys into settings.
    const patch: Partial<WaitTimeConfig> = {};
    const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
    const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
    if (bool(body.enabled) !== undefined) patch.enabled = body.enabled;
    if (num(body.basePrepMinutes) !== undefined) patch.basePrepMinutes = Math.max(0, body.basePrepMinutes!);
    if (num(body.minutesPerItem) !== undefined) patch.minutesPerItem = Math.max(0, body.minutesPerItem!);
    if (num(body.rushExtraMinutes) !== undefined) patch.rushExtraMinutes = Math.max(0, body.rushExtraMinutes!);
    if (num(body.maxWaitMinutes) !== undefined) patch.maxWaitMinutes = Math.max(5, body.maxWaitMinutes!);
    if (bool(body.showOnPublicMenu) !== undefined) patch.showOnPublicMenu = body.showOnPublicMenu;
    if (bool(body.autoPauseEnabled) !== undefined) patch.autoPauseEnabled = body.autoPauseEnabled;
    if (num(body.autoPauseThreshold) !== undefined) patch.autoPauseThreshold = Math.max(0, body.autoPauseThreshold!);

    await saveWaitTimeConfig(locationId, patch);
    return reply.send({ success: true });
  });

  // ── POST rush mode (owner/manager) ────────────────────────────────────────────
  fastify.post('/api/v1/locations/:locationId/wait-time/rush', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    if (user.role !== 'owner' && user.role !== 'manager') {
      return reply.code(403).send({ code: 'FORBIDDEN', message: 'Manager or owner role required' });
    }
    const { locationId } = req.params as { locationId: string };
    if (!(await locationInOrg(user.orgId, locationId))) {
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'Location not found' });
    }
    const { enabled, extraMinutes = 15, durationMinutes = 60 } = (req.body ?? {}) as {
      enabled?: boolean; extraMinutes?: number; durationMinutes?: number;
    };
    await setRushMode(locationId, enabled === true, extraMinutes, durationMinutes);
    return reply.send({ success: true, rushMode: enabled === true });
  });

  // ── GET accuracy history (any authed role) ────────────────────────────────────
  fastify.get('/api/v1/locations/:locationId/wait-time/accuracy', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { locationId } = req.params as { locationId: string };
    if (!(await locationInOrg(user.orgId, locationId))) {
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'Location not found' });
    }
    const history = await getAccuracyHistory(user.orgId, locationId);
    return reply.send({ history });
  });
}
