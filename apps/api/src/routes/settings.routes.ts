/**
 * Settings routes — organization-level configuration.
 *
 * GET  /api/v1/settings/dashboard-layout
 * PATCH /api/v1/settings/dashboard-layout
 *
 * The dashboard layout is stored in organizations.settings JSONB under
 * the key "dashboardLayout". If the key is absent the frontend falls back
 * to its built-in defaults (safe-default rule).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AccessTokenPayload } from '../auth/jwt';
import { query } from '../db/client';

type AuthedRequest = FastifyRequest & { user: AccessTokenPayload };

export default async function settingsRoutes(fastify: FastifyInstance): Promise<void> {

  // ── GET /api/v1/settings/dashboard-layout ─────────────────────────────────

  fastify.get('/api/v1/settings/dashboard-layout', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;

    const { rows: [row] } = await query<{ dashboard_layout: unknown }>(
      `SELECT COALESCE(settings->'dashboardLayout', 'null'::jsonb) AS dashboard_layout
         FROM organizations
        WHERE id = $1`,
      [user.orgId],
    );

    // row.dashboard_layout is the parsed JSONB value (null if not set)
    return reply.send({ dashboardLayout: row?.dashboard_layout ?? null });
  });

  // ── PATCH /api/v1/settings/dashboard-layout ────────────────────────────────

  fastify.patch('/api/v1/settings/dashboard-layout', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const layout = req.body; // validated by client, stored as-is

    await query(
      `UPDATE organizations
          SET settings   = jsonb_set(
                COALESCE(settings, '{}'::jsonb),
                '{dashboardLayout}',
                $2::jsonb
              ),
              updated_at = NOW()
        WHERE id = $1`,
      [user.orgId, JSON.stringify(layout)],
    );

    return reply.send({ success: true });
  });
}
