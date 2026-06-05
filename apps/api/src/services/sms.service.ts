/**
 * sms.service — send SMS via Twilio REST (no SDK dependency).
 * When Twilio isn't configured, messages are logged to the console (dev mode).
 */

import { config } from '../config';

export async function sendSms(to: string, body: string): Promise<boolean> {
  const sid = config.TWILIO_ACCOUNT_SID;
  const token = config.TWILIO_AUTH_TOKEN;
  const from = config.TWILIO_PHONE_NUMBER;

  if (!sid || !token || !from) {
    // eslint-disable-next-line no-console
    console.info(`[sms] (dev — no Twilio) → ${to}: ${body}`);
    return false;
  }

  try {
    const params = new URLSearchParams({ To: to, From: from, Body: body });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    return res.ok;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[sms] send failed:', e instanceof Error ? e.message : e);
    return false;
  }
}

export function smsConfigured(): boolean {
  return Boolean(config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN && config.TWILIO_PHONE_NUMBER);
}
