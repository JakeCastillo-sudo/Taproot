/**
 * Email service — Transactional email templates for Taproot POS
 *
 * Wraps the base email transport (apps/api/src/email.ts) with product-specific
 * HTML templates. All emails include:
 *   - Taproot green (#1D9E75) header
 *   - Plain-text fallback
 *   - From: noreply@taprootpos.com
 *
 * Transport config:
 *   Development  → jsonTransport (logs to console, no real emails)
 *   Production   → SendGrid SMTP (smtp.sendgrid.net:587)
 *                  requires SENDGRID_API_KEY env var
 */

import { sendEmail } from '../email';
import { config } from '../config';
import { query } from '../db/client';
import { buildWeeklyStats } from '../lib/email/campaigns/weeklyStats';
import { buildFeatureTip } from '../lib/email/campaigns/featureTip';
import { buildMenuInsight, type MenuInsightItem } from '../lib/email/campaigns/menuInsight';
import { buildBenchmarks } from '../lib/email/campaigns/benchmarks';

// ─── HTML template helpers ────────────────────────────────────────────────────

function escape(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param unsubscribeUrl  When provided (marketing emails — drip nudges + weekly
 *   campaign), an unsubscribe line is added to the footer for CAN-SPAM
 *   compliance. Transactional emails omit it.
 */
function emailLayout(title: string, body: string, unsubscribeUrl?: string): string {
  const unsub = unsubscribeUrl
    ? `<br/><a href="${unsubscribeUrl}" style="color:#bbb;">Unsubscribe from tips &amp; updates</a>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escape(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:580px;margin:40px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
    <!-- Header -->
    <div style="background:#1D9E75;padding:28px 32px;text-align:center;">
      <span style="display:inline-block;width:44px;height:44px;background:rgba(255,255,255,.2);border-radius:10px;line-height:44px;font-size:22px;font-weight:700;color:#fff;">T</span>
      <h1 style="margin:12px 0 0;color:#fff;font-size:20px;font-weight:600;letter-spacing:-.3px;">Taproot POS</h1>
    </div>
    <!-- Body -->
    <div style="padding:32px;">
      ${body}
    </div>
    <!-- Footer -->
    <div style="padding:16px 32px 24px;border-top:1px solid #f0f0f0;text-align:center;">
      <p style="margin:0;font-size:11px;color:#aaa;">
        © ${new Date().getFullYear()} Taproot POS · <a href="https://taprootpos.com" style="color:#1D9E75;">taprootpos.com</a>
        <br/>
        <a href="mailto:support@taprootpos.com" style="color:#aaa;">support@taprootpos.com</a>
        ${unsub}
      </p>
    </div>
  </div>
</body>
</html>`;
}

/** Format integer cents as $X.XX for email bodies. */
function fmtUsd(cents: number): string {
  return `$${(Math.round(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function btnPrimary(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;margin-top:8px;padding:12px 28px;background:#1D9E75;color:#fff;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">${escape(label)}</a>`;
}

// ─── welcomeEmail ─────────────────────────────────────────────────────────────

export async function sendWelcomeEmail(
  employee: { email: string; firstName: string },
  org: { name: string },
): Promise<void> {
  const onboardingUrl = `${config.APP_URL}/`;
  const html = emailLayout('Welcome to Taproot POS 🌿', `
    <h2 style="margin-top:0;color:#111;font-size:22px;">Welcome, ${escape(employee.firstName)}! 🌿</h2>
    <p style="color:#444;line-height:1.6;">You&apos;ve created your Taproot POS account for <strong>${escape(org.name)}</strong>.
    Your 14-day free trial has started — no credit card required.</p>

    <h3 style="color:#111;font-size:15px;margin-bottom:8px;">Get started in 3 steps:</h3>
    <ol style="color:#444;line-height:2;padding-left:20px;">
      <li>Add your menu — upload a PDF or import from your existing POS</li>
      <li>Connect Stripe — takes under 5 minutes, get paid instantly</li>
      <li>Take your first order — your POS is ready to go</li>
    </ol>

    <div style="margin:24px 0;">
      ${btnPrimary(onboardingUrl, 'Open Taproot POS →')}
    </div>

    <p style="color:#888;font-size:13px;">Questions? Reply to this email or write to
    <a href="mailto:support@taprootpos.com" style="color:#1D9E75;">support@taprootpos.com</a>.
    We typically respond within a few hours.</p>
  `);

  await sendEmail({
    to:      employee.email,
    subject: 'Welcome to Taproot POS 🌿',
    html,
    text: `Welcome to Taproot POS, ${employee.firstName}!\n\nYou've created your account for ${org.name}. Your 14-day free trial has started.\n\nGet started: ${onboardingUrl}\n\nQuestions? Email support@taprootpos.com`,
  });
}

// ─── franchiseInviteEmail ─────────────────────────────────────────────────────

export async function sendFranchiseInviteEmail(
  email: string,
  franchisorName: string,
  franchiseCode: string,
  locationName: string,
): Promise<void> {
  const registerUrl = `${config.APP_URL}/register`;
  const html = emailLayout(`You're invited to join ${franchisorName} on Taproot POS`, `
    <h2 style="margin-top:0;color:#111;font-size:22px;">You&apos;re invited! 🌿</h2>
    <p style="color:#444;line-height:1.6;"><strong>${escape(franchisorName)}</strong> has invited you to run
    <strong>${escape(locationName)}</strong> as part of their franchise network on Taproot POS.</p>

    <h3 style="color:#111;font-size:15px;margin-bottom:8px;">How to join:</h3>
    <ol style="color:#444;line-height:2;padding-left:20px;">
      <li>Create your Taproot POS account (free 14-day trial)</li>
      <li>Go to Settings → Franchise</li>
      <li>Enter your franchise code below</li>
    </ol>

    <div style="margin:20px 0;padding:16px;background:#F1F5F9;border-radius:10px;text-align:center;">
      <p style="margin:0 0 4px;color:#888;font-size:12px;">Your franchise code</p>
      <p style="margin:0;font-family:ui-monospace,monospace;font-size:22px;font-weight:700;letter-spacing:2px;color:#0F6E56;">${escape(franchiseCode)}</p>
    </div>

    <div style="margin:24px 0;">
      ${btnPrimary(registerUrl, 'Create your account →')}
    </div>

    <p style="color:#888;font-size:13px;">Once you join, ${escape(franchisorName)}&apos;s corporate menu syncs to
    your register automatically.</p>
  `);

  await sendEmail({
    to:      email,
    subject: `You're invited to join ${franchisorName} on Taproot POS`,
    html,
    text: `${franchisorName} has invited you to run ${locationName} on Taproot POS.\n\n1. Create your account: ${registerUrl}\n2. Go to Settings → Franchise\n3. Enter franchise code: ${franchiseCode}\n\nOnce you join, the corporate menu syncs to your register automatically.`,
  });
}

// ─── trialEndingEmail ─────────────────────────────────────────────────────────

export async function sendTrialEndingEmail(
  employee: { email: string; firstName: string },
  org:       { name: string },
  daysRemaining: number,
): Promise<void> {
  const urgency = daysRemaining <= 1 ? '⚠️ ' : daysRemaining <= 3 ? '⏰ ' : '';
  const billingUrl = `${config.APP_URL}/billing`;
  const html = emailLayout(`Your Taproot trial ends in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`, `
    <h2 style="margin-top:0;color:#111;font-size:22px;">${urgency}Your free trial ends in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}</h2>
    <p style="color:#444;line-height:1.6;">Hi ${escape(employee.firstName)}, your 14-day free trial for
    <strong>${escape(org.name)}</strong> ends soon.</p>

    <p style="color:#444;line-height:1.6;">After your trial ends, you&apos;ll lose access to:</p>
    <ul style="color:#444;line-height:2;padding-left:20px;">
      <li>Taking orders and processing payments</li>
      <li>Inventory management and reporting</li>
      <li>AI menu import and migration tools</li>
    </ul>

    <p style="color:#444;line-height:1.6;"><strong>Taproot Starter: $199/mo per location.</strong> Cancel anytime.</p>

    <div style="margin:24px 0;">
      ${btnPrimary(billingUrl, 'Upgrade now →')}
    </div>

    <p style="color:#888;font-size:13px;">Questions about pricing?
    <a href="mailto:support@taprootpos.com" style="color:#1D9E75;">Email us</a> — we&apos;re happy to help.</p>
  `);

  await sendEmail({
    to:      employee.email,
    subject: `${urgency}Your Taproot trial ends in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`,
    html,
    text: `Hi ${employee.firstName},\n\nYour Taproot POS trial for ${org.name} ends in ${daysRemaining} day(s).\n\nUpgrade at: ${billingUrl}\n\nTaproot Starter: $199/mo per location. Cancel anytime.`,
  });
}

// ─── paymentFailedEmail ───────────────────────────────────────────────────────

export async function sendPaymentFailedEmail(
  employee: { email: string; firstName: string },
  org:      { name: string },
): Promise<void> {
  const billingUrl = `${config.APP_URL}/billing`;
  const html = emailLayout('Action required: Payment failed', `
    <h2 style="margin-top:0;color:#c0392b;font-size:22px;">⚠️ Payment failed</h2>
    <p style="color:#444;line-height:1.6;">Hi ${escape(employee.firstName)}, we were unable to process the payment for
    your Taproot POS subscription for <strong>${escape(org.name)}</strong>.</p>

    <p style="color:#444;line-height:1.6;">You have a <strong>7-day grace period</strong> to update your payment method
    before access is suspended.</p>

    <div style="margin:24px 0;">
      ${btnPrimary(billingUrl, 'Update payment method →')}
    </div>

    <p style="color:#888;font-size:13px;">Need help?
    <a href="mailto:support@taprootpos.com" style="color:#1D9E75;">Contact support</a></p>
  `);

  await sendEmail({
    to:      employee.email,
    subject: 'Action required: Payment failed for Taproot POS',
    html,
    text: `Hi ${employee.firstName},\n\nWe couldn't process payment for ${org.name}'s Taproot subscription. You have 7 days to update your payment method.\n\nUpdate at: ${billingUrl}`,
  });
}

// ─── passwordResetEmail ───────────────────────────────────────────────────────

export async function sendPasswordResetEmailTemplate(
  employee: { email: string; firstName: string },
  resetUrl: string,
): Promise<void> {
  const html = emailLayout('Reset your Taproot password', `
    <h2 style="margin-top:0;color:#111;font-size:22px;">Reset your password</h2>
    <p style="color:#444;line-height:1.6;">Hi ${escape(employee.firstName)}, we received a request to reset your Taproot POS password.</p>

    <div style="margin:24px 0;">
      ${btnPrimary(resetUrl, 'Reset password →')}
    </div>

    <p style="color:#888;font-size:13px;">This link expires in 1 hour. If you didn&apos;t request a reset,
    you can safely ignore this email. Your password won&apos;t change.</p>
  `);

  await sendEmail({
    to:      employee.email,
    subject: 'Reset your Taproot password',
    html,
    text: `Hi ${employee.firstName},\n\nReset your Taproot POS password: ${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.`,
  });
}

// ─── lowStockAlertEmail ───────────────────────────────────────────────────────

export async function sendLowStockAlertEmail(
  employee: { email: string; firstName: string },
  items: Array<{ name: string; quantity: number; unit: string; threshold: number }>,
): Promise<void> {
  const inventoryUrl = `${config.APP_URL}/inventory`;
  const rows = items.map((item) => `
    <tr style="border-bottom:1px solid #f0f0f0;">
      <td style="padding:10px 8px;color:#111;">${escape(item.name)}</td>
      <td style="padding:10px 8px;color:${item.quantity === 0 ? '#e74c3c' : '#e67e22'};font-weight:600;">
        ${item.quantity} ${escape(item.unit)}
      </td>
      <td style="padding:10px 8px;color:#888;">${item.threshold} ${escape(item.unit)}</td>
    </tr>
  `).join('');

  const html = emailLayout(`Low stock alert: ${items.length} item${items.length === 1 ? '' : 's'} need attention`, `
    <h2 style="margin-top:0;color:#111;font-size:22px;">📦 Low stock alert</h2>
    <p style="color:#444;line-height:1.6;">Hi ${escape(employee.firstName)}, ${items.length} item${items.length === 1 ? '' : 's'} need restocking.</p>

    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <thead>
        <tr style="background:#f8f8f8;">
          <th style="padding:10px 8px;text-align:left;font-size:12px;color:#888;font-weight:600;">ITEM</th>
          <th style="padding:10px 8px;text-align:left;font-size:12px;color:#888;font-weight:600;">ON HAND</th>
          <th style="padding:10px 8px;text-align:left;font-size:12px;color:#888;font-weight:600;">REORDER AT</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <div style="margin-top:20px;">
      ${btnPrimary(inventoryUrl, 'View inventory →')}
    </div>
  `);

  const textRows = items.map((i) => `  • ${i.name}: ${i.quantity} ${i.unit} (reorder at ${i.threshold})`).join('\n');
  await sendEmail({
    to:      employee.email,
    subject: `Low stock alert: ${items.length} item${items.length === 1 ? '' : 's'} need attention`,
    html,
    text: `Hi ${employee.firstName},\n\nLow stock alert:\n${textRows}\n\nView inventory: ${inventoryUrl}`,
  });
}

// ─── weeklyCampaign (marketing — driven by jobs/weeklyCampaign.job.ts) ─────────

export type WeeklyCampaignType = 'weekly_stats' | 'feature_tip' | 'menu_insight' | 'benchmarks';

export interface WeeklyCampaignParams {
  to: string;
  campaignType: WeeklyCampaignType;
  ownerName: string;
  restaurantName: string;
  stats?: { orders7d: number; revenue7d: number; productCount: number; modifierCount: number };
  flags?: { onlineOrderingEnabled: boolean; loyaltyEnabled: boolean };
  topItems?: MenuInsightItem[];
  platformAvgOrders7d?: number;
}

/**
 * Render + send one weekly marketing campaign. Selects the template by type and
 * sends through the shared transport (jsonTransport in dev → logs; SMTP in prod).
 */
export async function sendWeeklyCampaign(p: WeeklyCampaignParams): Promise<void> {
  const appUrl = config.APP_URL;
  const common = { ownerName: p.ownerName, restaurantName: p.restaurantName, appUrl };
  const s = p.stats ?? { orders7d: 0, revenue7d: 0, productCount: 0, modifierCount: 0 };

  let rendered: ReturnType<typeof buildWeeklyStats>;
  switch (p.campaignType) {
    case 'weekly_stats':
      rendered = buildWeeklyStats({ ...common, orders7d: s.orders7d, revenue7d: s.revenue7d, productCount: s.productCount });
      break;
    case 'feature_tip':
      rendered = buildFeatureTip({
        ...common,
        modifierCount: s.modifierCount,
        onlineOrderingEnabled: p.flags?.onlineOrderingEnabled ?? false,
        loyaltyEnabled: p.flags?.loyaltyEnabled ?? false,
      });
      break;
    case 'menu_insight':
      rendered = buildMenuInsight({ ...common, topItems: p.topItems ?? [] });
      break;
    case 'benchmarks':
      rendered = buildBenchmarks({ ...common, yourOrders7d: s.orders7d, platformAvgOrders7d: p.platformAvgOrders7d ?? 0 });
      break;
    default:
      throw new Error(`Unknown weekly campaign type: ${String(p.campaignType)}`);
  }

  await sendEmail({ to: p.to, subject: rendered.subject, html: rendered.html, text: rendered.text });
}

// ─── email_logs (best-effort audit trail + onboarding-sequence dedup) ──────────

/**
 * Record an email send to email_logs. Best-effort: never throws and never blocks
 * the send (the row is the dedup source for the onboarding sequence job, so a
 * missing table — migration 024 not yet applied — simply means the job can't
 * dedup and will re-evaluate next tick; it does not break sending).
 */
async function logEmail(params: {
  orgId?: string;
  recipient: string;
  template: string;
  status?: string;
  errorMessage?: string;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO email_logs
         (organization_id, recipient_email, template_name, status, error_message)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        params.orgId ?? null,
        params.recipient,
        params.template,
        params.status ?? 'sent',
        params.errorMessage ?? null,
      ],
    );
  } catch {
    // email_logs may not exist yet (migration 024 pending) — non-fatal.
  }
}

// ─── employeeInviteEmail ───────────────────────────────────────────────────────

/**
 * Send an employee invite (email-based invite → verify → accept flow). Renders
 * through the shared layout/transport and records the send in email_logs.
 */
export async function sendEmployeeInvite(params: {
  to: string;
  employeeName: string;
  restaurantName: string;
  inviterName: string;
  role: string;
  inviteToken: string;
  orgId: string;
  expiresHours?: number;
}): Promise<void> {
  const expiresHours = params.expiresHours ?? 48;
  const inviteUrl = `${config.APP_URL}/accept-invite?token=${encodeURIComponent(params.inviteToken)}`;
  const html = emailLayout(`You're invited to join ${params.restaurantName} on Taproot POS`, `
    <h2 style="margin-top:0;color:#111;font-size:22px;">You&apos;re invited! 🌿</h2>
    <p style="color:#444;line-height:1.6;">Hi ${escape(params.employeeName)},</p>
    <p style="color:#444;line-height:1.6;"><strong>${escape(params.inviterName)}</strong> has invited you to join
    <strong>${escape(params.restaurantName)}</strong> as a <strong>${escape(params.role)}</strong> on Taproot POS —
    the point-of-sale system their restaurant runs on.</p>

    <div style="margin:24px 0;">
      ${btnPrimary(inviteUrl, 'Accept Invitation →')}
    </div>

    <p style="color:#888;font-size:13px;">This invitation expires in ${expiresHours} hours. If you weren&apos;t
    expecting this, you can safely ignore this email.</p>
  `);

  await sendEmail({
    to: params.to,
    subject: `You've been invited to join ${params.restaurantName} on Taproot POS`,
    html,
    text: `Hi ${params.employeeName},\n\n${params.inviterName} has invited you to join ${params.restaurantName} as a ${params.role} on Taproot POS.\n\nAccept your invitation: ${inviteUrl}\n\nThis invitation expires in ${expiresHours} hours. If you weren't expecting this, ignore this email.`,
  });

  await logEmail({ orgId: params.orgId, recipient: params.to, template: 'employee_invite' });
}

// ─── onboarding sequence (driven by jobs/emailSequence.job.ts) ─────────────────

export type OnboardingTemplate =
  | 'onboarding_day1'
  | 'onboarding_day3'
  | 'onboarding_day7'
  | 'trial_ending_soon';

/**
 * Render + send one onboarding-sequence email and record it in email_logs (the
 * template_name row is what the sequence job uses to avoid re-sending). Returns
 * silently for an unknown template.
 */
export async function sendOnboardingSequenceEmail(params: {
  to: string;
  template: OnboardingTemplate | string;
  ownerName: string;
  restaurantName: string;
  orgId: string;
  trialEndsAt?: string | null;
  hasProducts?: boolean;
  hasOrders?: boolean;
  hasEmployees?: boolean;
}): Promise<void> {
  const appUrl = config.APP_URL;
  const importUrl = `${appUrl}/import`;
  const posUrl = `${appUrl}/`;
  const settingsUrl = `${appUrl}/settings`;
  const billingUrl = `${appUrl}/billing`;
  const name = escape(params.ownerName);
  const rest = escape(params.restaurantName);

  let subject: string;
  let body: string;
  let text: string;

  switch (params.template) {
    case 'onboarding_day1':
      subject = 'Did you import your menu yet? (takes 60 seconds)';
      body = `
        <h2 style="margin-top:0;color:#111;font-size:22px;">Import your menu in 60 seconds 🌿</h2>
        <p style="color:#444;line-height:1.6;">Hi ${name}, most restaurants spend 8 hours hand-entering their
        menu into a new POS. Taproot takes about 60 seconds.</p>
        <ol style="color:#444;line-height:2;padding-left:20px;">
          <li>Open the menu importer</li>
          <li>Upload your menu PDF</li>
          <li>Our AI reads and imports everything</li>
          <li>Review and confirm</li>
        </ol>
        <div style="margin:24px 0;">${btnPrimary(importUrl, 'Import My Menu Now →')}</div>
        <p style="color:#888;font-size:13px;">No PDF? Just type your top 10 items and we&apos;ll build from there.
        Reply to this email if you need help.</p>`;
      text = `Hi ${params.ownerName},\n\nMost restaurants spend 8 hours entering their menu. Taproot takes 60 seconds:\n1. Open ${importUrl}\n2. Upload your menu PDF\n3. AI imports everything\n4. Review and confirm\n\nImport now: ${importUrl}`;
      break;

    case 'onboarding_day3':
      subject = '3 things that make the biggest difference this week';
      body = `
        <h2 style="margin-top:0;color:#111;font-size:22px;">3 quick wins for ${rest}</h2>
        <p style="color:#444;line-height:1.6;">Hi ${name}, three things our most successful restaurants set up early:</p>
        <ol style="color:#444;line-height:2;padding-left:20px;">
          <li>Set your tax rate (Settings → Business → Tax)</li>
          <li>Add employees with PIN login (Settings → Employees)</li>
          <li>Take one test order so you know the flow cold</li>
        </ol>
        <div style="margin:24px 0;">${btnPrimary(posUrl, 'Go to My POS →')}</div>
        <p style="color:#888;font-size:13px;">Reply any time — we read every email.</p>`;
      text = `Hi ${params.ownerName},\n\n3 quick wins this week:\n1. Set your tax rate (Settings → Business → Tax)\n2. Add employees with PIN login (Settings → Employees)\n3. Take one test order\n\nGo to your POS: ${posUrl}`;
      break;

    case 'onboarding_day7': {
      const mark = (done?: boolean): string => (done ? '✅' : '⬜');
      subject = "One week in — here's what other restaurants do first";
      body = `
        <h2 style="margin-top:0;color:#111;font-size:22px;">Your first week at ${rest}</h2>
        <p style="color:#444;line-height:1.6;">Hi ${name}, here&apos;s where you are:</p>
        <ul style="list-style:none;padding-left:0;color:#444;line-height:2.2;">
          <li>${mark(params.hasProducts)} Imported your menu</li>
          <li>⬜ Set your tax rate</li>
          <li>${mark(params.hasEmployees)} Added employees with PINs</li>
          <li>${mark(params.hasOrders)} Taken your first order</li>
          <li>⬜ Set up QR code ordering</li>
          <li>⬜ Connected a Stripe Terminal reader</li>
        </ul>
        <div style="margin:24px 0;">${btnPrimary(settingsUrl, "See What's Left →")}</div>
        <p style="color:#888;font-size:13px;">Reply and tell me how it&apos;s going. Seriously. — Jake</p>`;
      text = `Hi ${params.ownerName},\n\nYour first week checklist:\n${params.hasProducts ? '[x]' : '[ ]'} Imported your menu\n[ ] Set your tax rate\n${params.hasEmployees ? '[x]' : '[ ]'} Added employees with PINs\n${params.hasOrders ? '[x]' : '[ ]'} Taken your first order\n[ ] Set up QR code ordering\n[ ] Connected a Stripe Terminal reader\n\nSee what's left: ${settingsUrl}`;
      break;
    }

    case 'trial_ending_soon': {
      const ends = params.trialEndsAt
        ? new Date(params.trialEndsAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
        : 'soon';
      subject = 'Your free trial ends in 2 days';
      body = `
        <h2 style="margin-top:0;color:#B45309;font-size:22px;">Your free trial ends ${escape(ends)}</h2>
        <p style="color:#444;line-height:1.6;">Hi ${name}, your trial for <strong>${rest}</strong> ends on
        <strong>${escape(ends)}</strong>.</p>
        <p style="color:#444;line-height:1.6;">With payment info on file, your account continues at $99/month —
        everything included, no add-ons, no contracts. Without it, access pauses (your data stays safe).</p>
        <div style="margin:24px 0;">${btnPrimary(billingUrl, 'Add Payment Info →')}</div>
        <p style="color:#888;font-size:13px;">Cancel anytime. No contract. No penalty. Questions? Just reply. — Jake Castillo, Founder</p>`;
      text = `Hi ${params.ownerName},\n\nYour free trial for ${rest} ends ${ends}.\n\nWith payment info: continues at $99/month. Without it: access pauses (data safe).\n\nAdd payment info: ${billingUrl}\n\nCancel anytime. No contract.`;
      break;
    }

    default:
      console.warn(`[Email] Unknown onboarding template: ${params.template}`);
      return;
  }

  await sendEmail({ to: params.to, subject, html: emailLayout(subject, body), text });
  await logEmail({ orgId: params.orgId, recipient: params.to, template: String(params.template) });
}
