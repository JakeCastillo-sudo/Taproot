/**
 * WEEK 3 campaign — "Your top 3 items and what to do with them".
 * Uses real 30-day sales from the restaurant's POS.
 */
import { emailLayout, btnPrimary, escapeHtml, type RenderedEmail } from '../layout';

export interface MenuInsightItem { name: string; qty: number; }

export interface MenuInsightInput {
  ownerName: string;
  restaurantName: string;
  appUrl: string;
  topItems: MenuInsightItem[];   // up to 3, highest-selling first
}

const ACTIONS = [
  'Add a quick modifier to upsell it (e.g. "add cheese (+$1.50)") — your best-seller is where small add-ons add up fastest.',
  'Feature it on your QR menu and online ordering page so it sells even when you\'re slammed.',
  'Bundle it with a slower item to lift your average ticket.',
];

export function buildMenuInsight(i: MenuInsightInput): RenderedEmail {
  const name = escapeHtml(i.ownerName || 'there');
  const items = i.topItems.slice(0, 3);
  const quiet = items.length === 0;

  const subject = quiet
    ? `${i.restaurantName}: your menu insights are waiting`
    : `${i.restaurantName}: your top sellers (and what to do with them) 🍽️`;

  const rows = items
    .map((it, idx) => `
      <div style="padding:14px 0;border-bottom:1px solid #f0f0f0;">
        <p style="margin:0;color:#111;font-size:15px;font-weight:600;">#${idx + 1}: ${escapeHtml(it.name)}
          <span style="color:#1D9E75;font-weight:600;"> · ${Math.round(it.qty).toLocaleString('en-US')} sold</span></p>
        <p style="margin:4px 0 0;color:#666;font-size:13px;line-height:1.5;">Tip: ${escapeHtml(ACTIONS[idx] ?? ACTIONS[0])}</p>
      </div>`)
    .join('');

  const body = quiet
    ? `
      <h2 style="margin-top:0;color:#111;font-size:22px;">Hi ${name},</h2>
      <p style="color:#444;line-height:1.6;">Once ${escapeHtml(i.restaurantName)} has a few weeks of sales, we'll show your top sellers here with ideas to make each one earn more. Keep ringing up orders!</p>
      <div style="margin:22px 0;">${btnPrimary(`${i.appUrl}/`, 'Open your register →')}</div>`
    : `
      <h2 style="margin-top:0;color:#111;font-size:22px;">Hi ${name}, here are your top sellers</h2>
      <p style="color:#444;line-height:1.6;">Your best-performing items at ${escapeHtml(i.restaurantName)} over the last 30 days — and one idea for each:</p>
      <div style="margin:16px 0;">${rows}</div>
      <div style="margin:22px 0;">${btnPrimary(`${i.appUrl}/settings/products`, 'Edit menu →')}</div>`;

  const text = quiet
    ? `Hi ${i.ownerName}, your menu insights will appear here once ${i.restaurantName} has more sales. Open your register: ${i.appUrl}/`
    : `Hi ${i.ownerName}, your top sellers at ${i.restaurantName} (last 30 days):
${items.map((it, idx) => `#${idx + 1}: ${it.name} — ${Math.round(it.qty)} sold\n  Tip: ${ACTIONS[idx] ?? ACTIONS[0]}`).join('\n')}

Edit menu: ${i.appUrl}/settings/products`;

  return { subject, html: emailLayout(subject, body), text };
}
