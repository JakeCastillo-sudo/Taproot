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

export interface PublicMenu {
  org: { name: string; logo: string | null; address: Record<string, unknown> | null };
  categories: Array<{
    id: string; name: string; color: string | null; icon: string | null;
    products: Array<{ id: string; variantId: string | null; name: string; description: string | null; price: number }>;
  }>;
}

export async function getPublicMenu(slug: string): Promise<PublicMenu> {
  const org = await resolveOrg(slug);
  const loc = await firstLocation(org.id);

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
    categories,
  };
}

export interface PublicOrderInput {
  tableId?: string | null;
  items: Array<{ productId: string; variantId?: string | null; quantity: number; specialInstructions?: string }>;
  customerName?: string;
  customerPhone?: string;
}

export async function createPublicOrder(slug: string, input: PublicOrderInput): Promise<{ orderId: string; orderNumber: string; estimatedMinutes: number }> {
  const org = await resolveOrg(slug);
  const loc = await firstLocation(org.id);
  if (!loc) throw new ValidationError('Restaurant is not accepting orders');
  if (!input.items?.length) throw new ValidationError('Your order is empty');

  // Online orders are attributed to a system employee (prefer an owner).
  const { rows: [emp] } = await query<{ id: string }>(
    `SELECT id FROM employees WHERE organization_id = $1 AND deleted_at IS NULL
      ORDER BY (role = 'owner') DESC, created_at ASC LIMIT 1`,
    [org.id],
  );
  if (!emp) throw new ValidationError('Restaurant is not accepting orders');

  const noteParts = [
    input.customerName ? `Customer: ${input.customerName}` : null,
    input.customerPhone ? `Phone: ${input.customerPhone}` : null,
  ].filter(Boolean);

  const order = await OrderSvc.createOrder(org.id, loc.id, emp.id, {
    orderType: 'online',
    source: 'online',
    tableId: input.tableId ?? null,
    notes: noteParts.length ? noteParts.join(' · ') : null,
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
    estimatedMinutes: 15,
  };
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
