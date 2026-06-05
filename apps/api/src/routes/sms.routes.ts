/**
 * SMS webhook — Twilio inbound text ordering.
 * POST /webhook/sms/:orgSlug  (public — verified via Twilio signature, not JWT)
 */

import crypto from 'crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config';
import * as TextOrdering from '../services/textOrdering.service';
import { sendSms } from '../services/sms.service';

function twiml(message: string): string {
  const esc = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${esc}</Message></Response>`;
}

/** Validate Twilio's X-Twilio-Signature (HMAC-SHA1 of full URL + sorted params). */
function validSignature(req: FastifyRequest, params: Record<string, string>): boolean {
  const token = config.TWILIO_AUTH_TOKEN;
  if (!token) return true; // dev mode — no token configured
  const sig = req.headers['x-twilio-signature'];
  if (typeof sig !== 'string') return false;
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
  const host = req.headers['host'];
  const url = `${proto}://${host}${req.url}`;
  let data = url;
  for (const key of Object.keys(params).sort()) data += key + params[key];
  const expected = crypto.createHmac('sha1', token).update(Buffer.from(data, 'utf-8')).digest('base64');
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch { return false; }
}

export default async function smsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/webhook/sms/:orgSlug', async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgSlug } = req.params as { orgSlug: string };
    const body = (req.body ?? {}) as Record<string, string>;

    if (!validSignature(req, body)) {
      return reply.code(403).send('Invalid signature');
    }

    const from = body.From ?? '';
    const text = body.Body ?? '';
    if (!from || !text) return reply.type('text/xml').send(twiml('Sorry, we could not read your message.'));

    const replyText = await TextOrdering.processIncomingText(orgSlug, from, text);

    // If Twilio is configured we can also send proactively; the TwiML reply covers the inbound webhook.
    if (!config.TWILIO_ACCOUNT_SID) void sendSms(from, replyText); // dev: log the reply

    return reply.type('text/xml').send(twiml(replyText));
  });
}
