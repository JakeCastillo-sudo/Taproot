/**
 * Weekly marketing campaign job (STEP 5D) — separate from onboarding emails.
 *
 * Runs Sundays only. Rotates 4 data-driven campaigns by week-of-month and sends
 * each ACTIVE (paying) org's owner one personalized email, deduped via the shared
 * email_logs ledger using a date-stamped template_name (so the same campaign type
 * recurs next cycle but never double-sends within a cycle).
 *
 * Resilient: no-ops if migration 024 (email_logs) hasn't been applied. The
 * scheduler (index.ts) ticks hourly but is gated behind CAMPAIGNS_ENABLED — see
 * index.ts — so no real emails go out until that flag is set.
 */
import { query } from '../db/client';
import { logger } from '../lib/logger';
import { sendWeeklyCampaign, type WeeklyCampaignType } from '../services/email.service';

const CAMPAIGNS: WeeklyCampaignType[] = ['weekly_stats', 'feature_tip', 'menu_insight', 'benchmarks'];

async function tableExists(name: string): Promise<boolean> {
  const { rows: [r] } = await query<{ exists: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [`public.${name}`],
  );
  return Boolean(r?.exists);
}

interface CustomerRow {
  id: string;
  name: string;
  email: string;
  first_name: string;
  product_count: string;
  orders_7d: string;
  revenue_7d: string;
  modifier_count: string;
  settings: { onlineOrdering?: { enabled?: boolean }; loyalty?: { enabled?: boolean } } | null;
}

export async function runWeeklyCampaignJob(now: Date = new Date()): Promise<void> {
  if (now.getDay() !== 0) return; // Sundays only (0 = Sunday)

  if (!(await tableExists('email_logs'))) {
    logger.warn('[WeeklyCampaign] email_logs table missing — run migration 024, then it will send on the next Sunday tick');
    return;
  }

  const weekOfMonth = Math.ceil(now.getDate() / 7);          // 1..5
  const campaignType = CAMPAIGNS[(weekOfMonth - 1) % 4];     // 0..3
  const campaignSlug = `${campaignType}_${now.toISOString().slice(0, 10)}`;
  logger.info('[WeeklyCampaign] starting', { campaignType, campaignSlug });

  // Platform benchmark for the 'benchmarks' campaign — anonymous, aggregate avg
  // of completed orders per active org over the last 7 days. Computed once.
  let platformAvgOrders7d = 0;
  if (campaignType === 'benchmarks') {
    const { rows: [b] } = await query<{ avg: string }>(
      `SELECT COALESCE(AVG(c), 0) AS avg FROM (
         SELECT COUNT(ord.id) AS c
           FROM organizations o
           JOIN orders ord ON ord.organization_id = o.id
            AND ord.status = 'completed'
            AND ord.created_at > NOW() - INTERVAL '7 days'
          WHERE o.subscription_status = 'active'
          GROUP BY o.id
       ) s`,
    );
    platformAvgOrders7d = Math.round(Number(b?.avg ?? 0));
  }

  const { rows: customers } = await query<CustomerRow>(
    `SELECT o.id, o.name, e.email, e.first_name,
       (SELECT COUNT(*) FROM products p WHERE p.organization_id = o.id AND p.deleted_at IS NULL) AS product_count,
       (SELECT COUNT(*) FROM orders ord WHERE ord.organization_id = o.id AND ord.created_at > NOW() - INTERVAL '7 days') AS orders_7d,
       (SELECT COALESCE(SUM(ord.total), 0) FROM orders ord WHERE ord.organization_id = o.id AND ord.status = 'completed' AND ord.created_at > NOW() - INTERVAL '7 days') AS revenue_7d,
       (SELECT COUNT(*) FROM products p JOIN product_modifier_groups pmg ON pmg.product_id = p.id WHERE p.organization_id = o.id) AS modifier_count,
       o.settings
     FROM organizations o
     JOIN employees e ON e.organization_id = o.id AND e.role = 'owner' AND e.deleted_at IS NULL
     WHERE o.subscription_status = 'active'
       AND e.email IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM email_logs el WHERE el.organization_id = o.id AND el.template_name = $1
       )
     ORDER BY o.created_at ASC`,
    [campaignSlug],
  );

  logger.info('[WeeklyCampaign] recipients', { count: customers.length });
  let sent = 0;
  let failed = 0;

  for (const c of customers) {
    try {
      let topItems: { name: string; qty: number }[] = [];
      if (campaignType === 'menu_insight') {
        const { rows } = await query<{ name: string; qty: string }>(
          `SELECT oli.name, SUM(oli.quantity) AS qty
             FROM order_line_items oli
             JOIN orders ord ON ord.id = oli.order_id
            WHERE ord.organization_id = $1 AND ord.status = 'completed'
              AND ord.created_at > NOW() - INTERVAL '30 days'
            GROUP BY oli.name ORDER BY qty DESC LIMIT 3`,
          [c.id],
        );
        topItems = rows.map((r) => ({ name: r.name, qty: Number(r.qty) }));
      }

      await sendWeeklyCampaign({
        to: c.email,
        orgId: c.id,
        templateName: campaignSlug,
        campaignType,
        ownerName: c.first_name,
        restaurantName: c.name,
        stats: {
          orders7d: parseInt(c.orders_7d, 10) || 0,
          revenue7d: Math.round(Number(c.revenue_7d) || 0),
          productCount: parseInt(c.product_count, 10) || 0,
          modifierCount: parseInt(c.modifier_count, 10) || 0,
        },
        flags: {
          // online ordering is opt-in (default off); loyalty defaults ON (see loyalty.service)
          onlineOrderingEnabled: c.settings?.onlineOrdering?.enabled === true,
          loyaltyEnabled: c.settings?.loyalty?.enabled ?? true,
        },
        topItems,
        platformAvgOrders7d,
      });
      // sendWeeklyCampaign records the send to email_logs (template_name = slug),
      // which the NOT EXISTS filter above uses to dedup the next tick.
      sent++;
      await new Promise((r) => setTimeout(r, 300)); // gentle throttle between sends
    } catch (err) {
      failed++;
      logger.error('[WeeklyCampaign] send failed', {
        org: c.id, email: c.email,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('[WeeklyCampaign] done', { campaignType, sent, failed });
}
