/**
 * kitchen.service — Kitchen Display System.
 *
 * Open/in-progress orders are kitchen tickets. Per-item "ready" state and order
 * "bumped" state are stored in orders.metadata.kitchen (no schema change):
 *   metadata.kitchen = { readyItems: [lineItemId...], bumpedAt: ISO }
 * Bumped orders drop off the KDS.
 */

import { query } from '../db/client';
import { NotFoundError } from '../errors';

export interface KitchenItem {
  id: string; name: string; quantity: number;
  modifiers: Array<{ name: string }>; specialInstructions: string | null;
  ready: boolean; station: string;
}

export interface KitchenTicket {
  id: string; orderNumber: string; tableId: string | null; tableName: string | null;
  orderType: string; createdAt: string; minutesOpen: number;
  items: KitchenItem[];
}

export async function getTickets(orgId: string, locationId: string): Promise<KitchenTicket[]> {
  const { rows } = await query<{
    id: string; order_number: string; table_id: string | null; table_name: string | null;
    order_type: string; created_at: string; ready_items: string[] | null;
    items: Array<{ id: string; name: string; quantity: number; modifiers: unknown; notes: string | null }> | null;
  }>(
    `SELECT o.id, o.order_number, o.table_id, t.name AS table_name, o.order_type, o.created_at,
            COALESCE(o.metadata->'kitchen'->'readyItems', '[]'::jsonb) AS ready_items,
            COALESCE(JSON_AGG(JSON_BUILD_OBJECT(
              'id', oli.id, 'name', oli.name, 'quantity', oli.quantity,
              'modifiers', oli.modifiers, 'notes', oli.notes
            ) ORDER BY oli.created_at ASC) FILTER (WHERE oli.id IS NOT NULL), '[]'::json) AS items
       FROM orders o
       LEFT JOIN tables t ON t.id = o.table_id
       LEFT JOIN order_line_items oli ON oli.order_id = o.id AND oli.voided_at IS NULL
      WHERE o.organization_id = $1 AND o.location_id = $2
        AND o.status IN ('open','in_progress')
        AND (o.metadata->'kitchen'->>'bumpedAt') IS NULL
      GROUP BY o.id, t.name
      ORDER BY o.created_at ASC`,
    [orgId, locationId],
  );

  return rows.map((r) => {
    const ready = new Set((r.ready_items ?? []).map(String));
    return {
      id: r.id, orderNumber: r.order_number, tableId: r.table_id, tableName: r.table_name,
      orderType: r.order_type, createdAt: r.created_at,
      minutesOpen: Math.max(0, Math.floor((Date.now() - new Date(r.created_at).getTime()) / 60000)),
      items: (r.items ?? []).map((it) => {
        const mods = Array.isArray(it.modifiers) ? (it.modifiers as Array<{ name?: string }>) : [];
        return {
          id: it.id, name: it.name, quantity: Math.round(Number(it.quantity)),
          modifiers: mods.map((m) => ({ name: m.name ?? '' })),
          specialInstructions: it.notes, ready: ready.has(String(it.id)), station: 'all',
        };
      }),
    };
  });
}

export async function markItemReady(orgId: string, itemId: string): Promise<void> {
  const { rows: [item] } = await query<{ order_id: string }>(
    `SELECT oli.order_id FROM order_line_items oli
       JOIN orders o ON o.id = oli.order_id
      WHERE oli.id = $1 AND o.organization_id = $2`,
    [itemId, orgId],
  );
  if (!item) throw new NotFoundError('Line item not found');

  await query(
    `UPDATE orders
        SET metadata = jsonb_set(
              jsonb_set(COALESCE(metadata, '{}'::jsonb), '{kitchen}', COALESCE(metadata->'kitchen', '{}'::jsonb)),
              '{kitchen,readyItems}',
              (COALESCE(metadata->'kitchen'->'readyItems', '[]'::jsonb) || to_jsonb($2::text))
            ),
            updated_at = now()
      WHERE id = $1`,
    [item.order_id, itemId],
  );
}

export async function bumpOrder(orgId: string, orderId: string): Promise<void> {
  const { rows: [order] } = await query<{ id: string }>(
    `SELECT id FROM orders WHERE id = $1 AND organization_id = $2`, [orderId, orgId]);
  if (!order) throw new NotFoundError('Order not found');

  await query(
    `UPDATE orders
        SET metadata = jsonb_set(
              jsonb_set(COALESCE(metadata, '{}'::jsonb), '{kitchen}', COALESCE(metadata->'kitchen', '{}'::jsonb)),
              '{kitchen,bumpedAt}', to_jsonb(now()::text)
            ),
            updated_at = now()
      WHERE id = $1 AND organization_id = $2`,
    [orderId, orgId],
  );
}
