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

// ─── HTML template helpers ────────────────────────────────────────────────────

function escape(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function emailLayout(title: string, body: string): string {
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
      </p>
    </div>
  </div>
</body>
</html>`;
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
