/**
 * WEEK 4 campaign — "What restaurants like yours are doing".
 * Anonymous, aggregated platform benchmarks + a community tip. Never exposes any
 * individual restaurant's data — only platform-wide averages computed in the job.
 */
import { emailLayout, btnPrimary, escapeHtml, statRow, type RenderedEmail } from '../layout';

export interface BenchmarksInput {
  ownerName: string;
  restaurantName: string;
  appUrl: string;
  yourOrders7d: number;
  platformAvgOrders7d: number;   // avg completed orders / active org over last 7d
}

export function buildBenchmarks(i: BenchmarksInput): RenderedEmail {
  const name = escapeHtml(i.ownerName || 'there');
  const yourPerDay = Math.round((i.yourOrders7d / 7) * 10) / 10;
  const avgPerDay = Math.round((i.platformAvgOrders7d / 7) * 10) / 10;
  const subject = `What restaurants like ${i.restaurantName} are doing`;

  const compare =
    i.platformAvgOrders7d > 0 && i.yourOrders7d > 0
      ? (i.yourOrders7d >= i.platformAvgOrders7d
          ? `You're <strong>at or above</strong> the Taproot average — nice work.`
          : `There's room to grow toward the Taproot average.`)
      : `Compare your numbers as you ring up more orders.`;

  const body = `
    <p style="margin:0 0 4px;color:#1D9E75;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;">From the Taproot community</p>
    <h2 style="margin:0 0 12px;color:#111;font-size:22px;">Hi ${name}, how you stack up</h2>
    <p style="color:#444;line-height:1.6;">Anonymous, aggregated benchmarks across Taproot restaurants this week:</p>
    <table style="width:100%;border-collapse:collapse;margin:18px 0;">
      ${statRow('Your orders / day', String(yourPerDay))}
      ${statRow('Taproot average / day', String(avgPerDay))}
    </table>
    <p style="color:#444;line-height:1.6;">${compare}</p>
    <p style="color:#444;line-height:1.6;"><strong>What's working for others:</strong> restaurants using QR ordering and a loyalty program consistently report higher average tickets and more repeat visits. If you haven't turned those on yet, this week's a good time.</p>
    <div style="margin:22px 0;">${btnPrimary(`${i.appUrl}/reports`, 'See your numbers →')}</div>
    <p style="color:#aaa;font-size:11px;">Benchmarks are platform-wide averages. We never share any individual restaurant's data.</p>`;

  const text = `Hi ${i.ownerName}, how ${i.restaurantName} stacks up this week:
- Your orders/day: ${yourPerDay}
- Taproot average/day: ${avgPerDay}

Restaurants using QR ordering + loyalty tend to see higher average tickets and more repeat visits.

See your numbers: ${i.appUrl}/reports`;

  return { subject, html: emailLayout(subject, body), text };
}
