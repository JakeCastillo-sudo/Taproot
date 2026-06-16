/**
 * Shared HTML email layout helpers for campaign templates.
 *
 * Kept in its own module (not services/email.service.ts) so the campaign builders
 * in lib/email/campaigns/* can reuse the Taproot-branded shell WITHOUT importing
 * email.service.ts — email.service imports the builders to send them, so sharing
 * the helpers here avoids a circular import. Mirrors the look of email.service's
 * transactional templates (same green header / footer).
 */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param unsubUrl  When provided (marketing/campaign emails), a CAN-SPAM footer is
 *   rendered: sender identification, one-click unsubscribe, and a physical postal
 *   address. Omit for transactional email.
 */
export function emailLayout(title: string, body: string, unsubUrl?: string): string {
  const footer = unsubUrl
    ? `<div style="text-align:center;padding:16px 32px 24px;border-top:1px solid #E5E7EB;">
        <p style="margin:0 0 6px;font-size:11px;color:#9CA3AF;">You're receiving this because you have a Taproot POS account.</p>
        <p style="margin:0 0 6px;font-size:11px;color:#9CA3AF;">
          <a href="${unsubUrl}" style="color:#6B7280;text-decoration:underline;">Unsubscribe from marketing emails</a>
          &nbsp;·&nbsp;
          <a href="https://taproot-pos.com/support" style="color:#6B7280;text-decoration:underline;">Support</a>
          &nbsp;·&nbsp;
          <a href="https://taproot-pos.com/privacy" style="color:#6B7280;text-decoration:underline;">Privacy Policy</a>
        </p>
        <p style="margin:0;font-size:11px;color:#9CA3AF;">Taproot POS · Huntsville, Alabama</p>
      </div>`
    : `<div style="padding:16px 32px 24px;border-top:1px solid #f0f0f0;text-align:center;">
        <p style="margin:0;font-size:11px;color:#aaa;">
          © ${new Date().getFullYear()} Taproot POS · <a href="https://taproot-pos.com" style="color:#1D9E75;">taproot-pos.com</a><br/>
          You're receiving this weekly summary because you run a Taproot restaurant.
          <a href="mailto:support@taproot-pos.com" style="color:#aaa;">support@taproot-pos.com</a>
        </p>
      </div>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:580px;margin:40px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
    <div style="background:#1D9E75;padding:28px 32px;text-align:center;">
      <span style="display:inline-block;width:44px;height:44px;background:rgba(255,255,255,.2);border-radius:10px;line-height:44px;font-size:22px;font-weight:700;color:#fff;">T</span>
      <h1 style="margin:12px 0 0;color:#fff;font-size:20px;font-weight:600;letter-spacing:-.3px;">Taproot POS</h1>
    </div>
    <div style="padding:32px;">
      ${body}
    </div>
    ${footer}
  </div>
</body>
</html>`;
}

export function btnPrimary(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;margin-top:8px;padding:12px 28px;background:#1D9E75;color:#fff;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">${escapeHtml(label)}</a>`;
}

/** Format integer cents → "$1,234.56". */
export function fmtCents(cents: number): string {
  return `$${(Math.round(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A simple stat row used across campaign templates. */
export function statRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:8px 0;color:#666;font-size:14px;">${escapeHtml(label)}</td>
    <td style="padding:8px 0;color:#111;font-size:15px;font-weight:600;text-align:right;">${escapeHtml(value)}</td>
  </tr>`;
}
