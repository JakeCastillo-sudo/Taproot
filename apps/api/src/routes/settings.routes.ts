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

  // ── GET /api/v1/locations — list org locations (for pickers) ───────────────
  fastify.get('/api/v1/locations', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { rows } = await query<{ id: string; name: string; timezone: string; currency: string }>(
      `SELECT id, name, timezone, currency FROM locations
        WHERE organization_id = $1 AND deleted_at IS NULL
        ORDER BY created_at ASC`,
      [user.orgId],
    );
    return reply.send({ locations: rows });
  });

  // ── Helper: resolve the org's target location ──────────────────────────────
  async function resolveLocationId(orgId: string, requested?: string): Promise<string | null> {
    if (requested) {
      const { rows } = await query<{ id: string }>(
        `SELECT id FROM locations WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
        [requested, orgId],
      );
      if (rows[0]) return rows[0].id;
    }
    const { rows } = await query<{ id: string }>(
      `SELECT id FROM locations WHERE organization_id = $1 AND deleted_at IS NULL
        ORDER BY created_at ASC LIMIT 1`,
      [orgId],
    );
    return rows[0]?.id ?? null;
  }

  // ── GET /api/v1/settings/business ──────────────────────────────────────────
  fastify.get('/api/v1/settings/business', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const locationId = await resolveLocationId(user.orgId, (req.query as { locationId?: string }).locationId);

    const { rows: [org] } = await query<{ name: string; settings: { businessProfile?: { website?: string; logoUrl?: string } } }>(
      `SELECT name, settings FROM organizations WHERE id = $1`, [user.orgId],
    );
    const loc = locationId ? (await query<{
      id: string; name: string; address: Record<string, unknown>; phone: string | null;
      timezone: string; currency: string;
    }>(`SELECT id, name, address, phone, timezone, currency FROM locations WHERE id = $1`, [locationId])).rows[0] : null;

    return reply.send({
      orgName:  org?.name ?? '',
      website:  org?.settings?.businessProfile?.website ?? '',
      logoUrl:  org?.settings?.businessProfile?.logoUrl ?? '',
      location: loc ?? null,
    });
  });

  // ── PATCH /api/v1/settings/business ────────────────────────────────────────
  fastify.patch('/api/v1/settings/business', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const body = req.body as {
      name?: string; website?: string; logoUrl?: string;
      locationId?: string; locationName?: string;
      address?: Record<string, unknown>; phone?: string;
      timezone?: string; currency?: string;
    };

    if (body.name !== undefined) {
      await query(`UPDATE organizations SET name = $2, updated_at = now() WHERE id = $1`, [user.orgId, body.name.trim()]);
    }
    if (body.website !== undefined || body.logoUrl !== undefined) {
      await query(
        `UPDATE organizations
            SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{businessProfile}',
                  COALESCE(settings->'businessProfile', '{}'::jsonb)
                    || $2::jsonb),
                updated_at = now()
          WHERE id = $1`,
        [user.orgId, JSON.stringify({
          ...(body.website !== undefined ? { website: body.website } : {}),
          ...(body.logoUrl !== undefined ? { logoUrl: body.logoUrl } : {}),
        })],
      );
    }

    const locationId = await resolveLocationId(user.orgId, body.locationId);
    if (locationId) {
      const sets: string[] = [];
      const params: unknown[] = [];
      let p = 1;
      const add = (col: string, val: unknown) => { sets.push(`${col} = $${p++}`); params.push(val); };
      if (body.locationName !== undefined) add('name', body.locationName.trim());
      if (body.address !== undefined) add('address', JSON.stringify(body.address));
      if (body.phone !== undefined) add('phone', body.phone);
      if (body.timezone !== undefined) add('timezone', body.timezone);
      if (body.currency !== undefined) add('currency', body.currency);
      if (sets.length > 0) {
        sets.push('updated_at = now()');
        params.push(locationId, user.orgId);
        await query(`UPDATE locations SET ${sets.join(', ')} WHERE id = $${p++} AND organization_id = $${p}`, params);
      }
    }

    return reply.send({ success: true });
  });

  // ── GET /api/v1/settings/tax ───────────────────────────────────────────────
  fastify.get('/api/v1/settings/tax', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const locationId = await resolveLocationId(user.orgId, (req.query as { locationId?: string }).locationId);
    if (!locationId) return reply.send({ taxRates: [], taxInclusive: false, locationId: null });

    const { rows: [loc] } = await query<{ tax_config: { rates?: Array<{ name: string; rate: number; included?: boolean; appliesTo?: string }> } }>(
      `SELECT tax_config FROM locations WHERE id = $1`, [locationId],
    );
    const rates = loc?.tax_config?.rates ?? [];
    return reply.send({
      locationId,
      taxRates: rates.map((r) => ({ name: r.name, rate: Number(r.rate), appliesTo: r.appliesTo ?? 'all' })),
      taxInclusive: rates.length > 0 ? Boolean(rates[0].included) : false,
    });
  });

  // ── PATCH /api/v1/settings/tax ─────────────────────────────────────────────
  fastify.patch('/api/v1/settings/tax', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const body = req.body as {
      locationId?: string;
      taxRates: Array<{ name: string; rate: number; appliesTo?: string }>;
      taxInclusive?: boolean;
    };
    const locationId = await resolveLocationId(user.orgId, body.locationId);
    if (!locationId) return reply.code(404).send({ code: 'NO_LOCATION', message: 'No location to configure' });

    // Store in the tax_config shape calculateTax() reads: { rates: [{ name, rate, included, appliesTo }] }
    const rates = (body.taxRates ?? []).map((r) => ({
      name:      r.name,
      rate:      Number(r.rate),
      included:  Boolean(body.taxInclusive),
      appliesTo: r.appliesTo ?? 'all',
    }));

    await query(
      `UPDATE locations SET tax_config = $2::jsonb, updated_at = now()
        WHERE id = $1 AND organization_id = $3`,
      [locationId, JSON.stringify({ rates }), user.orgId],
    );
    return reply.send({ success: true });
  });

  // ── GET /api/v1/settings/receipt ───────────────────────────────────────────
  fastify.get('/api/v1/settings/receipt', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const locationId = await resolveLocationId(user.orgId, (req.query as { locationId?: string }).locationId);
    if (!locationId) return reply.send({ receiptConfig: {}, locationId: null });
    const { rows: [loc] } = await query<{ receipt_config: Record<string, unknown> }>(
      `SELECT receipt_config FROM locations WHERE id = $1`, [locationId],
    );
    return reply.send({ locationId, receiptConfig: loc?.receipt_config ?? {} });
  });

  // ── PATCH /api/v1/settings/receipt ─────────────────────────────────────────
  fastify.patch('/api/v1/settings/receipt', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const body = req.body as { locationId?: string; receiptConfig: Record<string, unknown> };
    const locationId = await resolveLocationId(user.orgId, body.locationId);
    if (!locationId) return reply.code(404).send({ code: 'NO_LOCATION', message: 'No location to configure' });
    await query(
      `UPDATE locations SET receipt_config = $2::jsonb, updated_at = now()
        WHERE id = $1 AND organization_id = $3`,
      [locationId, JSON.stringify(body.receiptConfig ?? {}), user.orgId],
    );
    return reply.send({ success: true });
  });
}
