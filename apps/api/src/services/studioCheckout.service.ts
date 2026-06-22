/**
 * studioCheckout.service — the "class_pack purchase → grant credits" hook (v2 activation).
 *
 * Implements the seam v2.1 documented and v2.2/v2.3 deliberately left for supervised wiring:
 * when a studio org COMPLETES an order containing class_pack catalog items, grant the buying
 * member the pack's credits. Called fire-and-forget from payment.service AFTER the order
 * completes — it must NEVER throw into the payment path (the caller voids/catches; this also
 * guards internally).
 *
 * SAFETY:
 *  • Studio-gated FIRST (hasCapability) — a restaurant org (and everyone before migration 032)
 *    returns after a single cached capability read and does ZERO else. No restaurant behavior change.
 *  • Column-guarded (products.item_type via information_schema) — no-ops before migration 033.
 *  • Reuses the v2.1 grantCredits primitive — NO new credit math.
 *  • Idempotent per order line item (source_ref = orderId:lineItemId), so a retried payment
 *    (or the WG-001 reconciler) never double-grants.
 */
import { query } from '../db/client';
import { hasCapability } from './capability.service';
import { grantCredits } from './memberCredit.service';

let _itemTypeReady: boolean | null = null;
async function itemTypeReady(): Promise<boolean> {
  if (_itemTypeReady !== null) return _itemTypeReady;
  try {
    const { rows } = await query<{ ready: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_name = 'products' AND column_name = 'item_type'
       ) AS ready`,
    );
    _itemTypeReady = Boolean(rows[0]?.ready);
  } catch {
    _itemTypeReady = false;
  }
  return _itemTypeReady;
}

export async function grantClassPackCreditsForOrder(orgId: string, employeeId: string, orderId: string): Promise<void> {
  // Gate FIRST. Non-studio orgs (all restaurants; everyone pre-migration-032) return here —
  // zero further work, zero behavior change.
  if (!(await hasCapability(orgId, 'studio'))) return;
  if (!(await itemTypeReady())) return; // pre-migration-033: products.item_type absent

  const { rows } = await query<{
    line_item_id: string; product_id: string; quantity: number;
    studio_meta: unknown; member_id: string | null;
  }>(
    `SELECT oli.id AS line_item_id, oli.product_id, oli.quantity, p.studio_meta,
            m.id AS member_id
       FROM order_line_items oli
       JOIN orders o   ON o.id = oli.order_id
       JOIN products p ON p.id = oli.product_id
       LEFT JOIN members m ON m.customer_id = o.customer_id
                          AND m.organization_id = $2 AND m.deleted_at IS NULL
      WHERE oli.order_id = $1 AND o.organization_id = $2
        AND oli.voided_at IS NULL AND p.item_type = 'class_pack'`,
    [orderId, orgId],
  );

  for (const r of rows) {
    if (!r.member_id) continue; // class_pack sold to a non-member customer — nothing to credit
    const meta = (r.studio_meta && typeof r.studio_meta === 'object') ? r.studio_meta as Record<string, unknown> : {};
    const perPack = Number(meta.credit_count) || 0;
    const total = perPack * (Number(r.quantity) || 0);
    if (total <= 0) continue;
    await grantCredits(orgId, employeeId, {
      memberId: r.member_id,
      count: total,
      creditType: 'class_pack',
      sourceCatalogItemId: r.product_id,
      sourceRef: `${orderId}:${r.line_item_id}`, // idempotent per line item
    });
  }
}
