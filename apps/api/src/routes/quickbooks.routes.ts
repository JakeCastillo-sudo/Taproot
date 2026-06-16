/**
 * QuickBooks Online routes.
 *
 *   GET    /api/v1/quickbooks/status      (auth) — connection status + recent log
 *   GET    /api/v1/quickbooks/connect     (auth) — returns the OAuth URL to visit
 *   GET    /api/v1/quickbooks/callback    PUBLIC — OAuth redirect target
 *   PATCH  /api/v1/quickbooks/settings    (auth) — toggle sync_enabled
 *   POST   /api/v1/quickbooks/sync        (auth) — manual sync for a date
 *   DELETE /api/v1/quickbooks/disconnect  (auth) — remove the connection
 *
 * /callback is added to PUBLIC_ROUTES in index.ts (the invitee has no JWT during
 * the OAuth redirect). connect returns a URL rather than 302-ing so the browser
 * doesn't need to forward the Bearer token through a top-level navigation.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AccessTokenPayload } from '../auth/jwt';
import { config } from '../config';
import * as QB from '../services/quickbooks.service';

type AuthedRequest = FastifyRequest & { user: AccessTokenPayload };

export default async function quickbooksRoutes(fastify: FastifyInstance): Promise<void> {
  // ── Status ──────────────────────────────────────────────────────────────────
  fastify.get('/api/v1/quickbooks/status', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const status = await QB.getConnectionStatus(user.orgId);
    const log = status.connected ? await QB.getSyncLog(user.orgId, 7) : [];
    return reply.send({ ...status, log });
  });

  // ── Begin OAuth ───────────────────────────────────────────────────────────────
  fastify.get('/api/v1/quickbooks/connect', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    if (!QB.isConfigured()) {
      return reply.status(503).send({
        code: 'QB_NOT_CONFIGURED',
        message: 'QuickBooks is not configured — set QB_CLIENT_ID and QB_CLIENT_SECRET.',
      });
    }
    return reply.send({ url: QB.getAuthUrl(user.orgId) });
  });

  // ── OAuth callback (PUBLIC) ────────────────────────────────────────────────────
  fastify.get('/api/v1/quickbooks/callback', async (req: FastifyRequest, reply: FastifyReply) => {
    const { code, realmId, state } = req.query as { code?: string; realmId?: string; state?: string };
    const dest = `${config.APP_URL}/settings/accounting`;
    if (!code || !realmId || !state) {
      return reply.redirect(`${dest}?error=missing_params`);
    }
    try {
      const { orgId } = QB.parseState(state);
      await QB.exchangeCode(code, realmId, orgId);
      return reply.redirect(`${dest}?connected=true`);
    } catch {
      return reply.redirect(`${dest}?error=connect_failed`);
    }
  });

  // ── Toggle sync ─────────────────────────────────────────────────────────────
  fastify.patch('/api/v1/quickbooks/settings', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { syncEnabled } = req.body as { syncEnabled?: boolean };
    if (typeof syncEnabled !== 'boolean') {
      return reply.status(400).send({ code: 'VALIDATION', message: 'syncEnabled (boolean) required' });
    }
    await QB.setSyncEnabled(user.orgId, syncEnabled);
    return reply.send({ success: true });
  });

  // ── Manual sync ───────────────────────────────────────────────────────────────
  fastify.post('/api/v1/quickbooks/sync', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { date } = req.body as { date?: string };
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return reply.status(400).send({ code: 'VALIDATION', message: 'date (YYYY-MM-DD) required' });
    }
    try {
      await QB.syncDailySales(user.orgId, date);
      return reply.send({ success: true, date });
    } catch (e) {
      return reply.status(502).send({
        code: 'QB_SYNC_FAILED',
        message: e instanceof Error ? e.message : 'Sync failed',
      });
    }
  });

  // ── Disconnect ──────────────────────────────────────────────────────────────
  fastify.delete('/api/v1/quickbooks/disconnect', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    await QB.disconnectQuickBooks(user.orgId);
    return reply.send({ success: true });
  });
}
