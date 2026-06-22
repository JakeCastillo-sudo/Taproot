/**
 * counterBridge.service — v2.3 THE COUNTER BRIDGE.
 *
 * A class reservation carries a pre-ordered café/bar add-on; at check-in the add-on
 * order FIRES to the KDS. The moat — no incumbent studio platform does this.
 *
 * CORE-CLEAN BY CONSTRUCTION. The whole flow is built from order.service PUBLIC
 * functions only:
 *   • attach (at booking): OrderSvc.createOrder (→ 'open') then OrderSvc.parkOrder
 *     (→ 'parked', HELD/off-KDS) = a pre-ordered, not-yet-fired add-on.
 *   • fire (at check-in): OrderSvc.resumeOrder ('parked' → 'open') = the add-on order
 *     becomes visible on the café/bar KDS. The fire is naturally IDEMPOTENT — resumeOrder
 *     only acts on a parked order, so a second check-in is a no-op.
 * After firing, payment + fulfillment flow through the EXISTING café order lifecycle
 * (KDS → make → pay → bump) — this service writes NO payment code and changes NO core.
 * order.service / payment.service / kitchen.service are not modified (verified in notes).
 *
 * NO new migration: reuses class_reservations.add_on_order_id (reserved in v2.2) and
 * order metadata for the counter tag. Studio-gated at the route layer; only ever acts on
 * studio reservations, so a restaurant's order/KDS/payment path is provably untouched.
 */
import { query } from '../db/client';
import { ValidationError, NotFoundError } from '../errors';
import { createAuditLog } from '../auth/audit';
import * as OrderSvc from './order.service';

let _ready: boolean | null = null;
async function bridgeReady(): Promise<boolean> {
  if (_ready !== null) return _ready;
  try {
    const { rows } = await query<{ ready: boolean }>(
      `SELECT to_regclass('public.class_reservations') IS NOT NULL AS ready`,
    );
    _ready = Boolean(rows[0]?.ready);
  } catch {
    _ready = false;
  }
  return _ready;
}

export interface AddOnSummary {
  orderId: string | null;
  status: string | null;       // order status: parked=pre-ordered, open/in_progress=fired, completed=paid
  fired: boolean;              // true once the order has left 'parked' (resumed to the KDS)
  items: Array<{ name: string; quantity: number; unitPrice: number }>;
}

interface ReservationRow {
  id: string; member_id: string; customer_id: string | null;
  add_on_order_id: string | null; location_id: string | null;
  class_name: string; ends_at: string; member_name: string | null;
}

async function loadReservation(orgId: string, reservationId: string): Promise<ReservationRow> {
  const { rows: [r] } = await query<ReservationRow>(
    `SELECT r.id, r.member_id, r.add_on_order_id,
            m.customer_id, m.display_name AS member_name,
            s.location_id, s.name AS class_name, s.ends_at
       FROM class_reservations r
       JOIN class_sessions s ON s.id = r.session_id
       JOIN members m ON m.id = r.member_id
      WHERE r.id = $1 AND r.organization_id = $2 AND r.deleted_at IS NULL`,
    [reservationId, orgId],
  );
  if (!r) throw new NotFoundError('Reservation');
  return r;
}

async function resolveLocation(orgId: string, sessionLocationId: string | null): Promise<string> {
  if (sessionLocationId) return sessionLocationId;
  // Fall back to the org's first active location (the add-on order needs a real location).
  const { rows: [loc] } = await query<{ id: string }>(
    `SELECT id FROM locations WHERE organization_id = $1 AND is_active = true AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`,
    [orgId],
  );
  if (!loc) throw new ValidationError('No active location to route the add-on order to');
  return loc.id;
}

/**
 * Attach pre-ordered add-on items to a reservation (at booking time). Creates ONE
 * café/bar order from the add_on catalog items and PARKS it (held, off the KDS) — so it
 * is pre-ordered but does not reach the counter until the member checks in. Links it via
 * class_reservations.add_on_order_id. Tags the order so the counter knows it is a studio
 * post-class add-on. Reuses OrderSvc.createOrder + parkOrder (no core change).
 */
export async function attachAddOns(orgId: string, employeeId: string, reservationId: string, itemIds: string[]): Promise<AddOnSummary> {
  if (!(await bridgeReady())) throw new ValidationError('Scheduling not provisioned yet (migration 034 pending)');
  if (!Array.isArray(itemIds) || itemIds.length === 0) throw new ValidationError('At least one add-on item is required');

  const r = await loadReservation(orgId, reservationId);
  if (r.add_on_order_id) throw new ValidationError('Add-ons already attached to this reservation');

  // Validate every item is a studio add_on catalog product in this org.
  const { rows: valid } = await query<{ id: string }>(
    `SELECT id FROM products
      WHERE id = ANY($1::uuid[]) AND organization_id = $2 AND deleted_at IS NULL AND item_type = 'add_on'`,
    [itemIds, orgId],
  );
  if (valid.length !== itemIds.length) throw new ValidationError('One or more items are not valid studio add-ons');

  const locationId = await resolveLocation(orgId, r.location_id);

  // Create the add-on order via the EXISTING order pipeline, then park it (held/off-KDS).
  const order = await OrderSvc.createOrder(orgId, locationId, employeeId, {
    orderType: 'in_store',
    customerId: r.customer_id ?? null,
    notes: `STUDIO ADD-ON · ${r.member_name ?? 'member'} · ${r.class_name} · fires at check-in`,
    metadata: { studioAddOn: true, reservationId: r.id, fulfillment: 'bar' },
    lineItems: itemIds.map((id) => ({ productId: id, quantity: 1 })),
  });
  await OrderSvc.parkOrder(orgId, locationId, order.id, employeeId);

  await query(`UPDATE class_reservations SET add_on_order_id = $1, updated_at = now() WHERE id = $2 AND organization_id = $3`, [order.id, r.id, orgId]);

  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'studio.addon_attached', resourceType: 'class_reservation', resourceId: r.id, afterState: { orderId: order.id, items: itemIds.length } });
  return getReservationAddOns(orgId, reservationId);
}

/**
 * Fire any pre-ordered add-on to the café/bar KDS — called at check-in. Resumes the
 * parked add-on order (parked → open) so it appears on the KDS. IDEMPOTENT: only a
 * parked order is fired, so checking in twice never double-fires. Never throws on the
 * "nothing to fire" path. Reuses OrderSvc.resumeOrder (no core change).
 */
export async function fireAddOnsForReservation(orgId: string, employeeId: string, reservationId: string): Promise<{ fired: boolean; orderId: string | null }> {
  if (!(await bridgeReady())) return { fired: false, orderId: null };
  const { rows: [r] } = await query<{ add_on_order_id: string | null }>(
    `SELECT add_on_order_id FROM class_reservations WHERE id = $1 AND organization_id = $2`,
    [reservationId, orgId],
  );
  const orderId = r?.add_on_order_id ?? null;
  if (!orderId) return { fired: false, orderId: null };

  const { rows: [o] } = await query<{ status: string; location_id: string }>(
    `SELECT status, location_id FROM orders WHERE id = $1 AND organization_id = $2`,
    [orderId, orgId],
  );
  if (!o) return { fired: false, orderId };
  if (o.status !== 'parked') return { fired: false, orderId }; // already fired / handled — idempotent no-op

  await OrderSvc.resumeOrder(orgId, o.location_id, orderId, employeeId);
  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'studio.addon_fired', resourceType: 'class_reservation', resourceId: reservationId, afterState: { orderId } });
  return { fired: true, orderId };
}

/** The reservation's add-on order summary (items + lifecycle status) for display. */
export async function getReservationAddOns(orgId: string, reservationId: string): Promise<AddOnSummary> {
  if (!(await bridgeReady())) return { orderId: null, status: null, fired: false, items: [] };
  const { rows: [r] } = await query<{ add_on_order_id: string | null }>(
    `SELECT add_on_order_id FROM class_reservations WHERE id = $1 AND organization_id = $2`,
    [reservationId, orgId],
  );
  const orderId = r?.add_on_order_id ?? null;
  if (!orderId) return { orderId: null, status: null, fired: false, items: [] };

  const { rows: [o] } = await query<{ status: string }>(
    `SELECT status FROM orders WHERE id = $1 AND organization_id = $2`, [orderId, orgId],
  );
  const { rows: items } = await query<{ name: string; quantity: number; unit_price: number }>(
    `SELECT name, quantity, unit_price FROM order_line_items WHERE order_id = $1 AND voided_at IS NULL`,
    [orderId],
  );
  return {
    orderId,
    status: o?.status ?? null,
    fired: o ? o.status !== 'parked' : false,
    items: items.map((i) => ({ name: i.name, quantity: Number(i.quantity), unitPrice: Math.round(Number(i.unit_price)) })),
  };
}
