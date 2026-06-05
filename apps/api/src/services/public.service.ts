/**
 * public.service — unauthenticated storefront for QR-code ordering.
 *
 * Resolves an organization by slug, exposes its active menu, and accepts customer
 * orders (attributed to a system employee, orderType 'online'). Used by the public
 * /order/:slug pages — never requires a login.
 */

import { query } from '../db/client';
import { NotFoundError, ValidationError } from '../errors';
import * as OrderSvc from './order.service';
import { publishOrderEvent, buildEvent } from './realtime.service';
import { getMerchantStripeClient, TAPROOT_APPLICATION_FEE_RATE } from '../payments/stripe.config';

interface PublicOrg { id: string; name: string; slug: string; settings: { businessProfile?: { logoUrl?: string } } }

async function resolveOrg(slug: string): Promise<PublicOrg> {
  const { rows: [org] } = await query<PublicOrg>(
    `SELECT id, name, slug, settings FROM organizations WHERE slug = $1 AND deleted_at IS NULL`,
    [slug],
  );
  if (!org) throw new NotFoundError('Restaurant not found');
  return org;
}

async function firstLocation(orgId: string): Promise<{ id: string; name: string; address: Record<string, unknown>; phone: string | null } | null> {
  const { rows: [loc] } = await query<{ id: string; name: string; address: Record<string, unknown>; phone: string | null }>(
    `SELECT id, name, address, phone FROM locations WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`,
    [orgId],
  );
  return loc ?? null;
}

interface OnlineConfig {
  enabled?: boolean; pickupEnabled?: boolean; deliveryEnabled?: boolean;
  pickupPrepMinutes?: number; deliveryRadiusMiles?: number; deliveryFeeCents?: number;
  minOrderCents?: number;
}

export interface PublicMenu {
  org: { name: string; logo: string | null; address: Record<string, unknown> | null };
  online: {
    enabled: boolean; pickupEnabled: boolean; deliveryEnabled: boolean;
    deliveryFeeCents: number; minOrderCents: number; pickupPrepMinutes: number;
    paymentAvailable: boolean;
  };
  categories: Array<{
    id: string; name: string; color: string | null; icon: string | null;
    products: Array<{ id: string; variantId: string | null; name: string; description: string | null; price: number }>;
  }>;
}

async function getOnlineConfig(orgId: string): Promise<{ cfg: OnlineConfig; paymentAvailable: boolean }> {
  const { rows: [org] } = await query<{
    settings: { onlineOrdering?: OnlineConfig };
    stripe_connect_account_id: string | null;
    payment_processing_enabled: boolean;
  }>(
    `SELECT settings, stripe_connect_account_id, payment_processing_enabled FROM organizations WHERE id = $1`,
    [orgId],
  );
  const cfg = org?.settings?.onlineOrdering ?? {};
  const paymentAvailable = Boolean(org?.stripe_connect_account_id && org?.payment_processing_enabled && process.env.STRIPE_PUBLISHABLE_KEY);
  return { cfg, paymentAvailable };
}

export async function getPublicMenu(slug: string): Promise<PublicMenu> {
  const org = await resolveOrg(slug);
  const loc = await firstLocation(org.id);
  const { cfg, paymentAvailable } = await getOnlineConfig(org.id);

  const { rows: products } = await query<{
    id: string; variant_id: string | null; name: string; description: string | null;
    category_id: string | null; price: number | null;
  }>(
    `SELECT p.id, p.name, p.description, p.category_id,
            (SELECT pv.id FROM product_variants pv WHERE pv.product_id = p.id AND pv.deleted_at IS NULL ORDER BY pv.sort_order ASC LIMIT 1) AS variant_id,
            (SELECT MIN(pp.price) FROM product_prices pp
               JOIN product_variants pv ON pv.id = pp.variant_id
              WHERE pv.product_id = p.id AND pp.is_active = true
                AND (pp.effective_until IS NULL OR pp.effective_until > now())) AS price
       FROM products p
      WHERE p.organization_id = $1 AND p.deleted_at IS NULL AND p.archived_at IS NULL AND p.is_active = true
      ORDER BY p.name ASC`,
    [org.id],
  );

  const { rows: cats } = await query<{ id: string; name: string; color: string | null; icon: string | null; sort_order: number }>(
    `SELECT id, name, color, icon, sort_order FROM categories
      WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY sort_order ASC, name ASC`,
    [org.id],
  );

  const uncategorized: PublicMenu['categories'][number] = { id: '__none__', name: 'More', color: null, icon: null, products: [] };
  const byCat = new Map<string, PublicMenu['categories'][number]>();
  for (const c of cats) byCat.set(c.id, { id: c.id, name: c.name, color: c.color, icon: c.icon, products: [] });

  for (const p of products) {
    const entry = { id: p.id, variantId: p.variant_id, name: p.name, description: p.description, price: Math.round(Number(p.price ?? 0)) };
    const bucket = (p.category_id && byCat.get(p.category_id)) || uncategorized;
    bucket.products.push(entry);
  }

  const categories = [...byCat.values()].filter((c) => c.products.length > 0);
  if (uncategorized.products.length > 0) categories.push(uncategorized);

  return {
    org: { name: org.name, logo: org.settings?.businessProfile?.logoUrl ?? null, address: loc?.address ?? null },
    online: {
      // When onlineOrdering settings are absent, default to enabled pickup (no delivery)
      enabled: cfg.enabled ?? true,
      pickupEnabled: cfg.pickupEnabled ?? true,
      deliveryEnabled: cfg.deliveryEnabled ?? false,
      deliveryFeeCents: cfg.deliveryFeeCents ?? 0,
      minOrderCents: cfg.minOrderCents ?? 0,
      pickupPrepMinutes: cfg.pickupPrepMinutes ?? 15,
      paymentAvailable,
    },
    categories,
  };
}

export interface PublicOrderInput {
  tableId?: string | null;
  items: Array<{ productId: string; variantId?: string | null; quantity: number; specialInstructions?: string }>;
  customerName?: string;
  customerPhone?: string;
  fulfillmentType?: 'pickup' | 'delivery' | 'dine_in';
  address?: string;
  requestedTime?: string;
}

async function systemEmployee(orgId: string): Promise<string> {
  const { rows: [emp] } = await query<{ id: string }>(
    `SELECT id FROM employees WHERE organization_id = $1 AND deleted_at IS NULL
      ORDER BY (role = 'owner') DESC, created_at ASC LIMIT 1`,
    [orgId],
  );
  if (!emp) throw new ValidationError('Restaurant is not accepting orders');
  return emp.id;
}

export async function createPublicOrder(slug: string, input: PublicOrderInput): Promise<{ orderId: string; orderNumber: string; estimatedMinutes: number; total: number }> {
  const org = await resolveOrg(slug);
  const loc = await firstLocation(org.id);
  if (!loc) throw new ValidationError('Restaurant is not accepting orders');
  if (!input.items?.length) throw new ValidationError('Your order is empty');
  const { cfg } = await getOnlineConfig(org.id);
  if (cfg.enabled === false) throw new ValidationError('Online ordering is currently closed');

  const empId = await systemEmployee(org.id);

  const fulfillment = input.fulfillmentType ?? 'pickup';
  const noteParts = [
    input.customerName ? `Customer: ${input.customerName}` : null,
    input.customerPhone ? `Phone: ${input.customerPhone}` : null,
    `Fulfillment: ${fulfillment}`,
    fulfillment === 'delivery' && input.address ? `Address: ${input.address}` : null,
    input.requestedTime ? `Requested: ${input.requestedTime}` : null,
  ].filter(Boolean);

  const order = await OrderSvc.createOrder(org.id, loc.id, empId, {
    orderType: 'online',
    source: 'online',
    tableId: input.tableId ?? null,
    notes: noteParts.length ? noteParts.join(' · ') : null,
    metadata: { fulfillment: { type: fulfillment, address: input.address ?? null, requestedTime: input.requestedTime ?? null } },
    lineItems: input.items.map((i) => ({
      productId: i.productId,
      variantId: i.variantId ?? null,
      quantity: i.quantity,
      notes: i.specialInstructions ?? null,
      modifiers: [],
    })),
  });

  void publishOrderEvent(buildEvent('order:created', loc.id, order.id, { source: 'online' }));

  return {
    orderId: order.id,
    orderNumber: order.order_number ?? order.id.slice(-6).toUpperCase(),
    estimatedMinutes: cfg.pickupPrepMinutes ?? 15,
    total: Math.round(Number(order.total ?? 0)),
  };
}

// ─── Online card payment (Stripe Connect direct charge) ───────────────────────

export async function createOnlinePaymentIntent(slug: string, input: PublicOrderInput): Promise<{
  clientSecret: string; orderId: string; orderNumber: string; amount: number;
  publishableKey: string; connectedAccountId: string;
}> {
  const org = await resolveOrg(slug);
  const { cfg, paymentAvailable } = await getOnlineConfig(org.id);
  if (!paymentAvailable) throw new ValidationError('Online card payment is not available — pay at counter');

  const { rows: [orgRow] } = await query<{ stripe_connect_account_id: string | null }>(
    `SELECT stripe_connect_account_id FROM organizations WHERE id = $1`, [org.id]);
  const accountId = orgRow?.stripe_connect_account_id;
  if (!accountId) throw new ValidationError('Online card payment is not available — pay at counter');

  const created = await createPublicOrder(slug, input);
  const deliveryFee = input.fulfillmentType === 'delivery' ? (cfg.deliveryFeeCents ?? 0) : 0;
  const amount = created.total + deliveryFee;

  const merchant = getMerchantStripeClient(accountId);
  const pi = await merchant.paymentIntents.create({
    amount,
    currency: 'usd',
    automatic_payment_methods: { enabled: true },
    application_fee_amount: Math.floor(amount * TAPROOT_APPLICATION_FEE_RATE),
    metadata: { orderId: created.orderId, source: 'online' },
  }) as { id: string; client_secret: string | null };

  return {
    clientSecret: pi.client_secret ?? '',
    orderId: created.orderId,
    orderNumber: created.orderNumber,
    amount,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? '',
    connectedAccountId: accountId,
  };
}

export async function confirmOnlinePayment(slug: string, orderId: string, paymentIntentId: string): Promise<{ status: string }> {
  const org = await resolveOrg(slug);
  const { rows: [orgRow] } = await query<{ stripe_connect_account_id: string | null }>(
    `SELECT stripe_connect_account_id FROM organizations WHERE id = $1`, [org.id]);
  const accountId = orgRow?.stripe_connect_account_id;
  if (!accountId) throw new ValidationError('Payment not available');

  const { rows: [order] } = await query<{ id: string; total: number }>(
    `SELECT id, total FROM orders WHERE id = $1 AND organization_id = $2`, [orderId, org.id]);
  if (!order) throw new NotFoundError('Order not found');

  const merchant = getMerchantStripeClient(accountId);
  const pi = await merchant.paymentIntents.retrieve(paymentIntentId) as {
    status: string; amount: number; charges?: { data?: Array<{ payment_method_details?: { card?: { last4?: string; brand?: string } } }> };
  };
  if (pi.status !== 'succeeded') throw new ValidationError(`Payment not completed (status: ${pi.status})`);

  const card = pi.charges?.data?.[0]?.payment_method_details?.card;
  await query(
    `INSERT INTO payments (order_id, payment_method, amount, status, processor, processor_payment_id, card_last4, card_brand)
     VALUES ($1, 'credit_card', $2, 'completed', 'stripe', $3, $4, $5)`,
    [orderId, pi.amount, paymentIntentId, card?.last4 ?? null, card?.brand ?? null],
  );
  await query(
    `UPDATE orders SET amount_paid = $2, status = 'completed', fulfilled_at = now(), updated_at = now() WHERE id = $1`,
    [orderId, pi.amount],
  );

  return { status: 'completed' };
}

export async function getPublicOrderStatus(slug: string, orderId: string): Promise<{ status: string; orderNumber: string; estimatedMinutes: number }> {
  const org = await resolveOrg(slug);
  const { rows: [order] } = await query<{ status: string; order_number: string; created_at: string }>(
    `SELECT status, order_number, created_at FROM orders WHERE id = $1 AND organization_id = $2`,
    [orderId, org.id],
  );
  if (!order) throw new NotFoundError('Order not found');
  const mins = Math.max(0, 15 - Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60000));
  return { status: order.status, orderNumber: order.order_number, estimatedMinutes: mins };
}
