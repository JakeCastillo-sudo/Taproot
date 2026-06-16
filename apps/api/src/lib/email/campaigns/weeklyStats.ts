/**
 * WEEK 1 campaign — "Your week in numbers".
 * Personalized 7-day stats from the restaurant's own POS data.
 */
import { emailLayout, btnPrimary, escapeHtml, fmtCents, statRow, type RenderedEmail } from '../layout';

export interface WeeklyStatsInput {
  ownerName: string;
  restaurantName: string;
  appUrl: string;
  unsubUrl?: string;
  orders7d: number;
  revenue7d: number;   // cents
  productCount: number;
}

export function buildWeeklyStats(i: WeeklyStatsInput): RenderedEmail {
  const avgTicket = i.orders7d > 0 ? Math.round(i.revenue7d / i.orders7d) : 0;
  const name = escapeHtml(i.ownerName || 'there');
  const restaurant = escapeHtml(i.restaurantName || 'your restaurant');
  const quiet = i.orders7d === 0;

  const subject = quiet
    ? `${i.restaurantName}: let's get your first orders this week`
    : `${i.restaurantName}: your week in numbers 📊`;

  const body = quiet
    ? `
      <h2 style="margin-top:0;color:#111;font-size:22px;">Hi ${name},</h2>
      <p style="color:#444;line-height:1.6;">No orders came through ${restaurant} this past week.
      If you're still setting up, we're here to help — most restaurants are taking orders within 10 minutes of uploading their menu.</p>
      <div style="margin:24px 0;">${btnPrimary(`${i.appUrl}/`, 'Open your register →')}</div>`
    : `
      <h2 style="margin-top:0;color:#111;font-size:22px;">Hi ${name}, here's your week 📊</h2>
      <p style="color:#444;line-height:1.6;">A quick snapshot of how ${restaurant} did over the last 7 days:</p>
      <table style="width:100%;border-collapse:collapse;margin:18px 0;">
        ${statRow('Orders taken', i.orders7d.toLocaleString('en-US'))}
        ${statRow('Revenue', fmtCents(i.revenue7d))}
        ${statRow('Average ticket', fmtCents(avgTicket))}
        ${statRow('Items on your menu', i.productCount.toLocaleString('en-US'))}
      </table>
      <p style="color:#444;line-height:1.6;">Want the full breakdown — busiest hours, top sellers, and trends?</p>
      <div style="margin:20px 0;">${btnPrimary(`${i.appUrl}/reports`, 'See full report →')}</div>`;

  const text = quiet
    ? `Hi ${i.ownerName}, no orders came through ${i.restaurantName} this past week. Open your register: ${i.appUrl}/`
    : `Hi ${i.ownerName}, your week at ${i.restaurantName}:
- Orders: ${i.orders7d}
- Revenue: ${fmtCents(i.revenue7d)}
- Average ticket: ${fmtCents(avgTicket)}
- Menu items: ${i.productCount}

Full report: ${i.appUrl}/reports`;

  return { subject, html: emailLayout(subject, body, i.unsubUrl), text };
}
