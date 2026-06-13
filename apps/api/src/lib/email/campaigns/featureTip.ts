/**
 * WEEK 2 campaign — "One thing to try this week".
 * Personalized to what the restaurant has NOT set up yet. Picks the first
 * unmet gap (highest-impact first); if everything's set up, spotlights AI.
 */
import { emailLayout, btnPrimary, escapeHtml, type RenderedEmail } from '../layout';

export interface FeatureTipInput {
  ownerName: string;
  restaurantName: string;
  appUrl: string;
  modifierCount: number;        // product_modifier_groups rows for the org
  onlineOrderingEnabled: boolean;
  loyaltyEnabled: boolean;
}

interface Tip { eyebrow: string; title: string; body: string; ctaLabel: string; ctaPath: string; }

function pickTip(i: FeatureTipInput): Tip {
  if (!i.onlineOrderingEnabled) {
    return {
      eyebrow: 'Reach more customers',
      title: 'Turn on online ordering',
      body: 'Give your customers a link to order pickup or delivery straight from their phone — no third-party commissions. It takes about two minutes to switch on.',
      ctaLabel: 'Set up online ordering →',
      ctaPath: '/settings/online-ordering',
    };
  }
  if (i.modifierCount === 0) {
    return {
      eyebrow: 'Increase your average ticket',
      title: 'Add modifiers to upsell',
      body: 'Modifiers like "add cheese (+$1.50)" or "make it a combo" nudge every order a little higher. Restaurants that use them see noticeably larger tickets.',
      ctaLabel: 'Add modifiers →',
      ctaPath: '/settings/modifiers',
    };
  }
  if (!i.loyaltyEnabled) {
    return {
      eyebrow: 'Bring customers back',
      title: 'Launch your loyalty program',
      body: 'A simple points program turns one-time visitors into regulars. Set your earn and redeem rates once and Taproot handles the rest automatically.',
      ctaLabel: 'Set up loyalty →',
      ctaPath: '/settings/loyalty',
    };
  }
  // Everything core is set up → spotlight AI.
  return {
    eyebrow: 'Feature spotlight',
    title: 'Read your AI daily brief',
    body: "Every morning Taproot summarizes yesterday's sales, flags what to prep, and tells you what to reorder — like an overnight analyst for your restaurant. It's already on; just open the register to see it.",
    ctaLabel: 'See your daily brief →',
    ctaPath: '/',
  };
}

export function buildFeatureTip(i: FeatureTipInput): RenderedEmail {
  const tip = pickTip(i);
  const name = escapeHtml(i.ownerName || 'there');
  const subject = `One thing to try at ${i.restaurantName} this week`;

  const body = `
    <p style="margin:0 0 4px;color:#1D9E75;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;">${escapeHtml(tip.eyebrow)}</p>
    <h2 style="margin:0 0 12px;color:#111;font-size:22px;">${escapeHtml(tip.title)}</h2>
    <p style="color:#444;line-height:1.6;">Hi ${name} — here's one quick win for ${escapeHtml(i.restaurantName)} this week:</p>
    <p style="color:#444;line-height:1.6;">${escapeHtml(tip.body)}</p>
    <div style="margin:22px 0;">${btnPrimary(`${i.appUrl}${tip.ctaPath}`, tip.ctaLabel)}</div>
    <p style="color:#888;font-size:13px;">Already done it? Nice — reply and tell us how it's going.</p>`;

  const text = `Hi ${i.ownerName} — one thing to try at ${i.restaurantName} this week:

${tip.title}
${tip.body}

${tip.ctaLabel} ${i.appUrl}${tip.ctaPath}`;

  return { subject, html: emailLayout(subject, body), text };
}
