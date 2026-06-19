import nodemailer from 'nodemailer';
import { config } from './config';

function createTransport() {
  if (config.SMTP_HOST) {
    return nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth:
        config.SMTP_USER && config.SMTP_PASS
          ? { user: config.SMTP_USER, pass: config.SMTP_PASS }
          : undefined,
    });
  }
  // Development: captures mail without sending; logs preview URL
  return nodemailer.createTransport({ jsonTransport: true });
}

const transport = createTransport();

async function sendMail(to: string, subject: string, text: string, html: string): Promise<void> {
  try {
    const info = await transport.sendMail({
      from: config.SMTP_FROM,
      to,
      subject,
      text,
      html,
    });

    if (config.NODE_ENV !== 'production') {
      // WG-016: dev-only, and no recipient/body PII — log subject + messageId only.
      console.log('[email] Dev transport captured message:', {
        subject,
        messageId: info.messageId,
      });
    }
  } catch (err) {
    console.error('[email] Send failed:', {
      to,
      subject,
      error: err instanceof Error ? err.message : String(err),
    });
    // Do not rethrow — email failure must not fail the HTTP request
  }
}

/** General-purpose email sender — used by queue processors and other services. */
export async function sendEmail(opts: {
  to:     string;
  subject: string;
  html:    string;
  text:    string;
}): Promise<void> {
  await sendMail(opts.to, opts.subject, opts.text, opts.html);
}

export async function sendPasswordResetEmail(
  email: string,
  resetToken: string,
  orgName: string,
): Promise<void> {
  const resetUrl = `${config.APP_URL}/reset-password?token=${encodeURIComponent(resetToken)}`;

  await sendMail(
    email,
    `${orgName} — Reset your password`,
    `You requested a password reset for your ${orgName} account.\n\nClick the link to reset your password (expires in 1 hour):\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email.`,
    `<p>You requested a password reset for your <strong>${escapeHtml(orgName)}</strong> account.</p>
<p><a href="${resetUrl}">Reset your password</a> (expires in 1 hour)</p>
<p>If you didn't request this, you can safely ignore this email.</p>`,
  );
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
