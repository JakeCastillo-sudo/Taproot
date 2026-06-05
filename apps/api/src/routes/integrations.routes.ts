/**
 * Integration export routes — accounting CSV (QuickBooks / Xero format).
 * Authenticated globally; org from JWT.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AccessTokenPayload } from '../auth/jwt';
import { Permission, requirePermissions } from '../auth/permissions';
import { query } from '../db/client';

type AuthedRequest = FastifyRequest & { user: AccessTokenPayload };

function csvCell(v: unknown): string { return `"${String(v ?? '').replace(/"/g, '""')}"`; }

async function dailySales(orgId: string, from: string, to: string, tz: string) {
  const { rows } = await query<{ day: string; net: string; tax: string; orders: string }>(
    `SELECT to_char(o.created_at AT TIME ZONE $4, 'YYYY-MM-DD') AS day,
            COALESCE(SUM(CASE WHEN o.status NOT IN ('voided','parked') THEN (o.subtotal - o.discount_total) ELSE 0 END),0) AS net,
            COALESCE(SUM(CASE WHEN o.status NOT IN ('voided','parked') THEN o.tax_total ELSE 0 END),0) AS tax,
            COUNT(*) FILTER (WHERE o.status NOT IN ('voided','parked')) AS orders
       FROM orders o
      WHERE o.organization_id = $1 AND o.created_at >= $2 AND o.created_at <= $3
      GROUP BY day ORDER BY day ASC`,
    [orgId, from, to, tz],
  );
  return rows;
}

export default async function integrationsRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /api/v1/integrations/export/:provider?from=&to=&timezone=
  fastify.get(
    '/api/v1/integrations/export/:provider',
    { preHandler: [requirePermissions(Permission.REPORTS_VIEW)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const { provider } = req.params as { provider: string };
      const q = req.query as { from?: string; to?: string; timezone?: string };
      const from = q.from ?? new Date(Date.now() - 30 * 864e5).toISOString();
      const to = q.to ?? new Date().toISOString();
      const tz = q.timezone ?? 'UTC';

      const rows = await dailySales(user.orgId, from, to, tz);
      const money = (c: number) => (Number(c) / 100).toFixed(2);

      // Xero & QuickBooks both accept this simple line-per-day sales journal.
      const header = provider === 'xero'
        ? ['*Date', '*Description', '*Amount', 'Account', 'TaxAmount']
        : ['Date', 'Description', 'Amount', 'Account', 'Tax'];
      const lines = [header.map(csvCell).join(',')];
      for (const r of rows) {
        lines.push([r.day, `Taproot daily sales (${r.orders} orders)`, money(Number(r.net)), 'Sales', money(Number(r.tax))].map(csvCell).join(','));
      }
      const csv = lines.join('\n');
      const filename = `taproot-${provider}-export.csv`;
      return reply
        .header('Content-Type', 'text/csv')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(csv);
    },
  );
}
