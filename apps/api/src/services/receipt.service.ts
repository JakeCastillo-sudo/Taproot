import { query } from '../db/client';
import { NotFoundError } from '../errors';
import type { OrderWithRelations, Payment, Organization, Location } from '@taproot/shared';

// ─── Receipt types ────────────────────────────────────────────────────────────

export interface ReceiptLineItem {
  name: string;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  modifiers: Array<{ name: string; priceDelta: number }>;
  discountAmount: number;
  taxAmount: number;
  total: number;
  voided: boolean;
}

export interface ReceiptPayment {
  method: string;
  amount: number;
  tipAmount: number;
  last4: string | null;
  brand: string | null;
}

export interface Receipt {
  receiptNumber: string;
  orderId: string;
  orderNumber: string;
  orderType: string;
  locationName: string;
  locationAddress: string | null;
  locationPhone: string | null;
  orgName: string;
  orgCurrency: string;
  employeeName: string;
  customerName: string | null;
  lineItems: ReceiptLineItem[];
  payments: ReceiptPayment[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  tipTotal: number;
  total: number;
  amountPaid: number;
  changeDue: number;
  notes: string | null;
  /** ISO-8601 */
  printedAt: string;
  createdAt: string;
  /** Org-configured footer text */
  footerText: string | null;
  headerText: string | null;
  showTaxBreakdown: boolean;
}

export interface EmailReceiptInput {
  orderId: string;
  orgId: string;
  email: string;
}

// ─── buildReceipt ─────────────────────────────────────────────────────────────

export async function buildReceipt(orgId: string, orderId: string): Promise<Receipt> {
  // Load order with all relations
  const { rows: [order] } = await query<OrderWithRelations>(
    `SELECT o.*,
       json_agg(DISTINCT jsonb_build_object(
         'id', li.id,
         'name', li.name,
         'sku', li.sku,
         'quantity', li.quantity,
         'unit_price', li.unit_price,
         'modifiers', li.modifiers,
         'discount_amount', li.discount_amount,
         'tax_amount', li.tax_amount,
         'total', li.total,
         'voided_at', li.voided_at
       )) FILTER (WHERE li.id IS NOT NULL) AS "lineItems",
       json_agg(DISTINCT jsonb_build_object(
         'payment_method', p.payment_method,
         'amount', p.amount,
         'tip_amount', p.tip_amount,
         'card_last4', p.card_last4,
         'card_brand', p.card_brand,
         'status', p.status
       )) FILTER (WHERE p.id IS NOT NULL AND p.status = 'completed') AS payments,
       json_agg(DISTINCT jsonb_build_object(
         'name', ad.name,
         'amount_saved', ad.amount_saved
       )) FILTER (WHERE ad.id IS NOT NULL) AS discounts
     FROM orders o
     LEFT JOIN order_line_items li ON li.order_id = o.id
     LEFT JOIN payments p ON p.order_id = o.id
     LEFT JOIN applied_discounts ad ON ad.order_id = o.id
     WHERE o.id = $1 AND o.organization_id = $2
     GROUP BY o.id`,
    [orderId, orgId],
  );
  if (!order) throw new NotFoundError('Order');

  // Load org + location
  const [{ rows: [org] }, { rows: [loc] }] = await Promise.all([
    query<Organization>(`SELECT * FROM organizations WHERE id = $1`, [orgId]),
    query<Location>(`SELECT * FROM locations WHERE id = $1`, [order.location_id]),
  ]);

  // Load employee name
  const { rows: [emp] } = await query<{ first_name: string; last_name: string }>(
    `SELECT first_name, last_name FROM employees WHERE id = $1`,
    [order.employee_id],
  );

  // Load customer name if present
  let customerName: string | null = null;
  if (order.customer_id) {
    const { rows: [cust] } = await query<{ first_name: string | null; last_name: string | null }>(
      `SELECT first_name, last_name FROM customers WHERE id = $1`,
      [order.customer_id],
    );
    if (cust) {
      const parts = [cust.first_name, cust.last_name].filter(Boolean);
      customerName = parts.length > 0 ? parts.join(' ') : null;
    }
  }

  // Parse raw line items from the aggregate
  const rawLineItems = (order as unknown as { lineItems: Array<{
    name: string; sku: string | null; quantity: number;
    unit_price: number; modifiers: Array<{ name: string; priceDelta: number }>;
    discount_amount: number; tax_amount: number; total: number; voided_at: string | null;
  }> }).lineItems ?? [];

  const lineItems: ReceiptLineItem[] = rawLineItems.map((li) => ({
    name: li.name,
    sku: li.sku,
    quantity: Number(li.quantity),
    unitPrice: Number(li.unit_price),
    modifiers: Array.isArray(li.modifiers) ? li.modifiers : [],
    discountAmount: Number(li.discount_amount),
    taxAmount: Number(li.tax_amount),
    total: Number(li.total),
    voided: li.voided_at !== null,
  }));

  const rawPayments = (order as unknown as { payments: Array<{
    payment_method: string; amount: number; tip_amount: number;
    card_last4: string | null; card_brand: string | null;
  }> }).payments ?? [];

  const receiptPayments: ReceiptPayment[] = rawPayments.map((p) => ({
    method: p.payment_method,
    amount: Number(p.amount),
    tipAmount: Number(p.tip_amount),
    last4: p.card_last4,
    brand: p.card_brand,
  }));

  // Location address
  const addr = loc?.address
    ? `${loc.address.line1}${loc.address.line2 ? ', ' + loc.address.line2 : ''}, ${loc.address.city}, ${loc.address.state} ${loc.address.zip}`
    : null;

  const receiptConfig = org?.receipt_config;

  return {
    receiptNumber: `R-${order.order_number}`,
    orderId: order.id,
    orderNumber: order.order_number,
    orderType: order.order_type,
    locationName: loc?.name ?? '',
    locationAddress: addr,
    locationPhone: loc?.phone ?? null,
    orgName: org?.name ?? '',
    orgCurrency: org?.currency ?? 'USD',
    employeeName: emp ? `${emp.first_name} ${emp.last_name}` : '',
    customerName,
    lineItems,
    payments: receiptPayments,
    subtotal: Number(order.subtotal),
    discountTotal: Number(order.discount_total),
    taxTotal: Number(order.tax_total),
    tipTotal: Number(order.tip_total),
    total: Number(order.total),
    amountPaid: Number(order.amount_paid),
    changeDue: Number(order.change_due),
    notes: order.notes,
    printedAt: new Date().toISOString(),
    createdAt: order.created_at,
    footerText: receiptConfig?.footer ?? null,
    headerText: receiptConfig?.header ?? null,
    showTaxBreakdown: receiptConfig?.show_tax_breakdown ?? false,
  };
}

// ─── formatReceiptText ────────────────────────────────────────────────────────
// Produces a plain-text receipt string (for thermal printers / SMS).

export function formatReceiptText(receipt: Receipt): string {
  const SEP = '-'.repeat(40);
  const currency = receipt.orgCurrency;
  const fmt = (n: number) => `${currency} ${(n / 100).toFixed(2)}`;

  const lines: string[] = [];

  if (receipt.headerText) {
    lines.push(receipt.headerText, '');
  }

  lines.push(receipt.orgName.toUpperCase());
  lines.push(receipt.locationName);
  if (receipt.locationAddress) lines.push(receipt.locationAddress);
  if (receipt.locationPhone)   lines.push(receipt.locationPhone);
  lines.push('');
  lines.push(`Order: ${receipt.orderNumber}`);
  lines.push(`Date:  ${new Date(receipt.createdAt).toLocaleString()}`);
  lines.push(`Staff: ${receipt.employeeName}`);
  if (receipt.customerName) lines.push(`Customer: ${receipt.customerName}`);
  lines.push(SEP);

  for (const li of receipt.lineItems) {
    if (li.voided) continue;
    const itemTotal = fmt(li.total);
    const itemLine = `${li.quantity}x ${li.name}`.padEnd(32) + itemTotal.padStart(8);
    lines.push(itemLine);
    for (const mod of li.modifiers) {
      const modLine = `   + ${mod.name}`.padEnd(32) +
        (mod.priceDelta !== 0 ? fmt(mod.priceDelta).padStart(8) : '');
      lines.push(modLine);
    }
    if (li.discountAmount > 0) {
      lines.push(`   Discount`.padEnd(32) + ('-' + fmt(li.discountAmount)).padStart(8));
    }
  }

  lines.push(SEP);
  lines.push('Subtotal'.padEnd(32) + fmt(receipt.subtotal).padStart(8));

  if (receipt.discountTotal > 0) {
    lines.push('Discount'.padEnd(32) + ('-' + fmt(receipt.discountTotal)).padStart(8));
  }

  if (receipt.showTaxBreakdown) {
    lines.push('Tax'.padEnd(32) + fmt(receipt.taxTotal).padStart(8));
  } else if (receipt.taxTotal > 0) {
    lines.push('Tax'.padEnd(32) + fmt(receipt.taxTotal).padStart(8));
  }

  lines.push('TOTAL'.padEnd(32) + fmt(receipt.total).padStart(8));

  if (receipt.tipTotal > 0) {
    lines.push('Tip'.padEnd(32) + fmt(receipt.tipTotal).padStart(8));
  }

  lines.push(SEP);

  for (const p of receipt.payments) {
    const label = p.brand
      ? `${p.brand.toUpperCase()} ****${p.last4}`
      : p.method.replace(/_/g, ' ');
    lines.push(label.padEnd(32) + fmt(p.amount).padStart(8));
    if (p.tipAmount > 0) {
      lines.push('  Tip'.padEnd(32) + fmt(p.tipAmount).padStart(8));
    }
  }

  if (receipt.changeDue > 0) {
    lines.push('Change Due'.padEnd(32) + fmt(receipt.changeDue).padStart(8));
  }

  if (receipt.notes) {
    lines.push('');
    lines.push(`Notes: ${receipt.notes}`);
  }

  lines.push('');
  if (receipt.footerText) {
    lines.push(receipt.footerText);
  }

  return lines.join('\n');
}

// ─── sendReceiptEmail ─────────────────────────────────────────────────────────
// Delegates to the email service (SMTP). Returns early gracefully if SMTP
// is not configured.

export async function sendReceiptEmail(
  orgId: string,
  orderId: string,
  toEmail: string,
): Promise<{ sent: boolean; reason?: string }> {
  // Lazy-load email service to avoid hard dep when SMTP not configured
  const { config } = await import('../config');
  if (!config.SMTP_HOST) {
    return { sent: false, reason: 'SMTP not configured' };
  }

  let receipt: Receipt;
  try {
    receipt = await buildReceipt(orgId, orderId);
  } catch {
    return { sent: false, reason: 'Could not load order' };
  }

  const nodemailer = await import('nodemailer');
  const transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: config.SMTP_USER
      ? { user: config.SMTP_USER, pass: config.SMTP_PASS }
      : undefined,
  });

  const plainText = formatReceiptText(receipt);

  try {
    await transporter.sendMail({
      from: config.SMTP_FROM,
      to: toEmail,
      subject: `Your receipt from ${receipt.orgName} — ${receipt.orderNumber}`,
      text: plainText,
      html: plainTextToHtml(receipt, plainText),
    });
    return { sent: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[receipt] Email send failed:', msg);
    return { sent: false, reason: msg };
  }
}

// ─── plainTextToHtml ──────────────────────────────────────────────────────────

function plainTextToHtml(receipt: Receipt, plain: string): string {
  const escaped = plain
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Receipt ${receipt.orderNumber}</title></head>
<body style="font-family:monospace;white-space:pre;max-width:480px;margin:0 auto;padding:16px">
${escaped}
</body>
</html>`;
}
