/**
 * Delivery integration service — DoorDash Drive + Uber Eats.
 *
 * Receives provider webhooks and creates a Taproot order so the kitchen display
 * picks it up like any other open order. Orders are attributed to a system
 * employee (org owner). Third-party items are stored as line items with a NULL
 * product_id (migration 026) — they carry their own name/price and are not
 * matched to the catalog.
 *
 * Money: the orders/line-item numeric columns store CENTS (matching the rest of
 * the app), so provider cents flow straight through — no ×100.
 */
import crypto from 'crypto';
import { query, withTransaction } from '../db/client';
import { calculateWaitTime } from './waitTime.service';

export type DeliveryProvider = 'doordash' | 'ubereats';

export interface DeliveryWebhookPayload {
  provider: DeliveryProvider;
  externalOrderId: string;
  storeId: string;
  customer: { name: string; phone?: string };
  items: Array<{
    name: string;
    quantity: number;
    price: number; // cents
    modifiers?: Array<{ name: string; price: number }>;
    externalId?: string;
  }>;
  subtotal: number; // cents
  deliveryFee?: number;
  tip?: number;
  estimatedPickupTime?: string;
  deliveryAddress?: { street: string; city: string; state: string; zip: string };
  specialInstructions?: string;
}

// ── Webhook signature verification ─────────────────────────────────────────────
//
// NOTE: signed against the body string passed in. In production the caller must
// pass the EXACT raw request bytes (provider signs the raw body); see the route
// handler. Both helpers are length-guarded so timingSafeEqual never throws.

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function verifyDoorDashWebhook(payload: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return safeEqual(signature, expected);
}

export function verifyUberEatsWebhook(payload: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  // Uber prefixes with the algorithm.
  return safeEqual(signature, `sha256=${expected}`) || safeEqual(signature, expected);
}

// ── System employee (delivery orders have no cashier) ───────────────────────────

async function systemEmployeeId(orgId: string): Promise<string | null> {
  const { rows: [e] } = await query<{ id: string }>(
    `SELECT id FROM employees
      WHERE organization_id = $1 AND deleted_at IS NULL
      ORDER BY (role = 'owner') DESC, created_at ASC
      LIMIT 1`,
    [orgId],
  );
  return e?.id ?? null;
}

// ── Process incoming delivery order ─────────────────────────────────────────────

export async function processDeliveryOrder(
  orgId: string,
  locationId: string,
  payload: DeliveryWebhookPayload,
): Promise<{ orderId: string; orderNumber: string; duplicate: boolean }> {
  // Idempotency — provider may retry the same webhook.
  const existing = await query<{ id: string; order_number: string }>(
    `SELECT id, order_number FROM orders
      WHERE delivery_order_id = $1 AND delivery_provider = $2 AND organization_id = $3
      LIMIT 1`,
    [payload.externalOrderId, payload.provider, orgId],
  );
  if (existing.rows[0]) {
    return { orderId: existing.rows[0].id, orderNumber: existing.rows[0].order_number, duplicate: true };
  }

  const employeeId = await systemEmployeeId(orgId);
  if (!employeeId) {
    throw new Error(`No employee found for org ${orgId} to attribute the delivery order`);
  }

  const notes = [
    payload.provider === 'doordash' ? '🚗 DoorDash order' : '🚗 Uber Eats order',
    payload.customer.name ? `Customer: ${payload.customer.name}` : null,
    payload.customer.phone ? `Phone: ${payload.customer.phone}` : null,
    payload.specialInstructions ? `Note: ${payload.specialInstructions}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  // Pickup ETA: trust the platform's estimate when present; otherwise compute our
  // own from the current kitchen queue (FEAT-WAIT-001). Never blocks order creation.
  let pickupTime = payload.estimatedPickupTime ?? null;
  if (!pickupTime) {
    try {
      const wait = await calculateWaitTime(orgId, locationId);
      pickupTime = new Date(Date.now() + wait.estimatedMinutes * 60 * 1000).toISOString();
    } catch {
      pickupTime = null;
    }
  }

  return withTransaction(async (client) => {
    const { rows: [order] } = await client.query<{ id: string; order_number: string }>(
      `INSERT INTO orders (
         organization_id, location_id, employee_id,
         order_type, status, source,
         delivery_provider, delivery_order_id, delivery_status, estimated_pickup_time,
         customer_name, customer_phone, delivery_address,
         notes, subtotal, tax_total, total, metadata
       ) VALUES (
         $1, $2, $3,
         'delivery', 'open', 'online',
         $4, $5, 'pending', $6,
         $7, $8, $9,
         $10, $11, 0, $11, $12
       ) RETURNING id, order_number`,
      [
        orgId,
        locationId,
        employeeId,
        payload.provider,
        payload.externalOrderId,
        pickupTime,
        payload.customer.name ?? null,
        payload.customer.phone ?? null,
        payload.deliveryAddress ? JSON.stringify(payload.deliveryAddress) : null,
        notes,
        payload.subtotal,
        JSON.stringify({ delivery: { fee: payload.deliveryFee ?? 0, tip: payload.tip ?? 0 } }),
      ],
    );

    for (const item of payload.items) {
      const modifiers = (item.modifiers ?? []).map((m) => ({ name: m.name, priceDelta: m.price }));
      const lineTotal =
        item.price * item.quantity +
        modifiers.reduce((s, m) => s + m.priceDelta, 0) * item.quantity;
      await client.query(
        `INSERT INTO order_line_items (order_id, name, quantity, unit_price, modifiers, total)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [order.id, item.name, item.quantity, item.price, JSON.stringify(modifiers), lineTotal],
      );
    }

    return { orderId: order.id, orderNumber: order.order_number, duplicate: false };
  });
}

// ── Provider config ─────────────────────────────────────────────────────────────

export interface DeliveryProviderRow {
  id: string;
  provider: string;
  is_enabled: boolean;
  store_id: string | null;
  has_secret: boolean;
  settings: Record<string, unknown> | null;
  created_at: string;
}

export async function getDeliveryProviders(orgId: string): Promise<DeliveryProviderRow[]> {
  // Never return the raw webhook_secret/api_key — expose a `has_secret` flag only.
  const { rows } = await query<DeliveryProviderRow>(
    `SELECT id, provider, is_enabled, store_id,
            (webhook_secret IS NOT NULL AND webhook_secret <> '') AS has_secret,
            settings, created_at
       FROM delivery_providers
      WHERE organization_id = $1
      ORDER BY provider`,
    [orgId],
  );
  return rows;
}

export async function upsertDeliveryProvider(
  orgId: string,
  provider: string,
  config: {
    isEnabled: boolean;
    webhookSecret?: string;
    apiKey?: string;
    storeId?: string;
    settings?: object;
  },
): Promise<void> {
  await query(
    `INSERT INTO delivery_providers
       (organization_id, provider, is_enabled, webhook_secret, api_key, store_id, settings)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (organization_id, provider) DO UPDATE SET
       is_enabled     = $3,
       webhook_secret = COALESCE($4, delivery_providers.webhook_secret),
       api_key        = COALESCE($5, delivery_providers.api_key),
       store_id       = COALESCE($6, delivery_providers.store_id),
       settings       = COALESCE($7, delivery_providers.settings)`,
    [
      orgId,
      provider,
      config.isEnabled,
      config.webhookSecret ?? null,
      config.apiKey ?? null,
      config.storeId ?? null,
      config.settings ? JSON.stringify(config.settings) : null,
    ],
  );
}

// ── Resolve org/location for an incoming webhook by store id ─────────────────────

export async function resolveStore(
  provider: DeliveryProvider,
  storeId: string,
): Promise<{ orgId: string; locationId: string; webhookSecret: string | null } | null> {
  const { rows: [row] } = await query<{ org_id: string; location_id: string; webhook_secret: string | null }>(
    `SELECT dp.organization_id AS org_id,
            (SELECT l.id FROM locations l
              WHERE l.organization_id = dp.organization_id AND l.deleted_at IS NULL
              ORDER BY l.created_at ASC LIMIT 1) AS location_id,
            dp.webhook_secret
       FROM delivery_providers dp
      WHERE dp.store_id = $1 AND dp.provider = $2 AND dp.is_enabled = true
      LIMIT 1`,
    [storeId, provider],
  );
  if (!row || !row.location_id) return null;
  return { orgId: row.org_id, locationId: row.location_id, webhookSecret: row.webhook_secret };
}

// ── Provider payload normalizers ─────────────────────────────────────────────────
//
// Field names are provider-approximate (DoorDash/Uber Eats differ); adjust to the
// real schemas when onboarding each provider.

export function normalizeDoorDashPayload(raw: Record<string, unknown>): DeliveryWebhookPayload {
  const r = raw as Record<string, any>;
  return {
    provider: 'doordash',
    externalOrderId: String(r.order_id ?? r.id ?? ''),
    storeId: String(r.store_id ?? ''),
    customer: { name: r.consumer?.name ?? r.customer?.name ?? 'DoorDash Customer', phone: r.consumer?.phone_number ?? undefined },
    items: (r.items ?? []).map((it: any) => ({
      name: it.name ?? 'Item',
      quantity: Number(it.quantity ?? 1),
      price: Number(it.price?.unit_amount ?? it.unit_price ?? 0),
      modifiers: (it.modifiers ?? it.options ?? []).map((m: any) => ({
        name: m.name ?? '',
        price: Number(m.price?.unit_amount ?? m.price ?? 0),
      })),
      externalId: it.merchant_supplied_id ?? it.id ?? undefined,
    })),
    subtotal: Number(r.subtotal?.unit_amount ?? r.subtotal ?? 0),
    deliveryFee: Number(r.delivery_fee?.unit_amount ?? 0) || undefined,
    tip: Number(r.tip?.unit_amount ?? 0) || undefined,
    estimatedPickupTime: r.estimated_pickup_time ?? undefined,
    deliveryAddress: r.delivery_address
      ? {
          street: r.delivery_address.street ?? '',
          city: r.delivery_address.city ?? '',
          state: r.delivery_address.state ?? '',
          zip: r.delivery_address.zip_code ?? r.delivery_address.zip ?? '',
        }
      : undefined,
    specialInstructions: r.special_instructions ?? undefined,
  };
}

export function normalizeUberEatsPayload(raw: Record<string, unknown>): DeliveryWebhookPayload {
  const r = raw as Record<string, any>;
  const cart = r.cart ?? r;
  return {
    provider: 'ubereats',
    externalOrderId: String(r.id ?? r.order_id ?? ''),
    storeId: String(r.restaurant_id ?? r.store_id ?? ''),
    customer: {
      name: [r.customer?.first_name, r.customer?.last_name].filter(Boolean).join(' ') || r.eater?.first_name || 'Uber Eats Customer',
      phone: r.customer?.phone ?? undefined,
    },
    items: (cart.items ?? []).map((it: any) => ({
      name: it.title ?? it.name ?? 'Item',
      quantity: Number(it.quantity ?? 1),
      price: Number(it.price?.total_price ?? it.price?.unit_price ?? 0),
      modifiers: (it.selected_modifier_groups ?? it.modifiers ?? []).flatMap((g: any) =>
        (g.selected_items ?? g.items ?? [g]).map((m: any) => ({
          name: m.title ?? m.name ?? '',
          price: Number(m.price?.total_price ?? m.price ?? 0),
        })),
      ),
      externalId: it.instance_id ?? it.id ?? undefined,
    })),
    subtotal: Number(cart.subtotal?.amount ?? r.payment?.charges?.sub_total?.amount ?? 0),
    estimatedPickupTime: r.estimated_ready_for_pickup_at ?? undefined,
    deliveryAddress: r.delivery?.location
      ? {
          street: r.delivery.location.street_address ?? '',
          city: r.delivery.location.city ?? '',
          state: r.delivery.location.state ?? '',
          zip: r.delivery.location.postal_code ?? '',
        }
      : undefined,
    specialInstructions: r.special_instructions ?? cart.special_instructions ?? undefined,
  };
}
