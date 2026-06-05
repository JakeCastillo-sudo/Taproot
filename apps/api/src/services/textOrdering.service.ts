/**
 * textOrdering.service — AI-powered SMS ordering.
 *
 * processIncomingText parses a free-text order with Claude, fuzzy-matches items
 * to real products, creates the order (pay-at-counter), and returns the SMS
 * reply. Falls back gracefully when AI is unavailable or items don't match.
 */

import { query } from '../db/client';
import { askClaudeJSON } from './ai.service';
import * as PublicSvc from './public.service';

interface ParsedOrder {
  isOrderIntent: boolean;
  items: Array<{ name: string; quantity: number }>;
  clarificationNeeded: string | null;
}

interface ProductMatch { id: string; name: string }

function normalize(s: string): string { return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim(); }

/** Simple fuzzy match: exact → contains → token overlap. */
function matchProduct(name: string, products: ProductMatch[]): ProductMatch | null {
  const n = normalize(name);
  if (!n) return null;
  let best: ProductMatch | null = null; let bestScore = 0;
  for (const p of products) {
    const pn = normalize(p.name);
    let score = 0;
    if (pn === n) score = 100;
    else if (pn.includes(n) || n.includes(pn)) score = 60;
    else {
      const nt = new Set(n.split(' ')); const pt = pn.split(' ');
      const overlap = pt.filter((t) => nt.has(t)).length;
      score = overlap * 20;
    }
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return bestScore >= 40 ? best : null;
}

export async function processIncomingText(orgSlug: string, from: string, body: string): Promise<string> {
  const { rows: [org] } = await query<{ id: string; settings: Record<string, unknown> | null }>(
    `SELECT id, settings FROM organizations WHERE slug = $1 AND deleted_at IS NULL`, [orgSlug]);
  if (!org) return 'Sorry, we could not find that restaurant.';

  const textCfg = ((org.settings?.onlineOrdering as Record<string, unknown> | undefined)?.textEnabled);
  if (textCfg !== true) return 'Text ordering is not enabled for this restaurant.';

  // Products available for matching (active only — three-state rule)
  const { rows: products } = await query<ProductMatch>(
    `SELECT p.id, p.name FROM products p
      WHERE p.organization_id = $1 AND p.deleted_at IS NULL AND p.archived_at IS NULL AND p.is_active = true
      LIMIT 500`, [org.id]);

  const menuNames = products.map((p) => p.name).join(', ');
  const parsed = await askClaudeJSON<ParsedOrder>(
    `You parse SMS food orders for a restaurant. The menu is: ${menuNames}.
Return JSON: { "isOrderIntent": boolean, "items": [{ "name": string, "quantity": number }], "clarificationNeeded": string|null }.
Map requests to the closest menu item names. If the message is not an order (greeting, question), set isOrderIntent false.`,
    `Customer text: "${body}"`,
    512,
  );

  if (!parsed || !parsed.isOrderIntent) {
    return parsed?.clarificationNeeded
      ? parsed.clarificationNeeded
      : `Hi! Text us your order and we'll get it started. Our menu: ${menuNames.slice(0, 200)}…`;
  }
  if (parsed.clarificationNeeded) return parsed.clarificationNeeded;

  // Match parsed items to products
  const lineItems: Array<{ productId: string; variantId: null; quantity: number; specialInstructions?: string }> = [];
  const unmatched: string[] = [];
  for (const it of parsed.items ?? []) {
    const m = matchProduct(it.name, products);
    if (m) lineItems.push({ productId: m.id, variantId: null, quantity: Math.max(1, it.quantity || 1) });
    else unmatched.push(it.name);
  }

  if (lineItems.length === 0) {
    return `Sorry, we couldn't match your order${unmatched.length ? ` (${unmatched.join(', ')})` : ''}. Reply with item names from our menu.`;
  }

  try {
    const result = await PublicSvc.createPublicOrder(orgSlug, {
      items: lineItems,
      fulfillmentType: 'pickup',
      customerPhone: from,
      customerName: `Text order ${from}`,
    });
    const total = `$${(result.total / 100).toFixed(2)}`;
    let reply = `Got it! Order #${result.orderNumber}. Total: ${total}. Ready in ~${result.estimatedMinutes} min.`;
    if (unmatched.length) reply += ` (Couldn't add: ${unmatched.join(', ')}.)`;
    reply += ' Reply CANCEL to cancel.';
    return reply;
  } catch (e) {
    return `Sorry, we couldn't place your order: ${e instanceof Error ? e.message : 'please try again'}.`;
  }
}
