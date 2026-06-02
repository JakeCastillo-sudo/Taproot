#!/usr/bin/env node
/**
 * Register Taproot webhook endpoints with Stripe.
 *
 * Usage:
 *   node scripts/register-webhooks.js --env=staging
 *   node scripts/register-webhooks.js --env=production
 *
 * Requires:
 *   STRIPE_SECRET_KEY in environment (or apps/api/.env)
 *
 * Outputs:
 *   Webhook signing secrets to add to your .env file
 */

'use strict';

const https      = require('https');
const path       = require('path');
const { existsSync } = require('fs');

// ── Load .env for the requested environment ────────────────────────────────────

const args       = process.argv.slice(2);
const envArg     = args.find((a) => a.startsWith('--env='));
const targetEnv  = envArg ? envArg.split('=')[1] : 'staging';

if (!['staging', 'production'].includes(targetEnv)) {
  console.error('Usage: node register-webhooks.js --env=staging|production');
  process.exit(1);
}

// Try to load .env from apps/api
const envFile = path.resolve(__dirname, '..', 'apps', 'api', '.env');
if (existsSync(envFile)) {
  require('dotenv').config({ path: envFile });
}

const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!stripeKey) {
  console.error('❌ STRIPE_SECRET_KEY not found in environment or apps/api/.env');
  process.exit(1);
}

if (targetEnv === 'production' && !stripeKey.startsWith('sk_live_')) {
  console.error('❌ Production requires a live Stripe key (sk_live_...)');
  process.exit(1);
}

// ── Webhook endpoint URLs ──────────────────────────────────────────────────────

const BASE_URL = targetEnv === 'production'
  ? 'https://api.taprootpos.com'
  : 'https://staging.taprootpos.com';

const ENDPOINTS = [
  {
    url:    `${BASE_URL}/api/v1/webhooks/stripe`,
    events: [
      'payment_intent.succeeded',
      'payment_intent.payment_failed',
      'charge.refunded',
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
      'invoice.payment_succeeded',
      'invoice.payment_failed',
    ],
    description: `Taproot ${targetEnv} — main webhook`,
  },
  {
    url:    `${BASE_URL}/api/v1/webhooks/stripe/connect`,
    events: [
      'account.updated',
      'account.application.deauthorized',
      'capability.updated',
    ],
    description: `Taproot ${targetEnv} — Connect webhook`,
    connect: true,  // Stripe Connect account events
  },
  {
    url:    `${BASE_URL}/api/v1/webhooks/stripe/terminal`,
    events: [
      'terminal.reader.action_updated',
    ],
    description: `Taproot ${targetEnv} — Terminal webhook`,
  },
];

// ── Stripe API helper ─────────────────────────────────────────────────────────

function stripeRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? new URLSearchParams(body).toString() : '';

    const options = {
      hostname: 'api.stripe.com',
      port: 443,
      path,
      method,
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data),
        'Stripe-Version': '2024-06-20',
      },
    };

    const req = https.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseBody);
          if (parsed.error) {
            reject(new Error(`Stripe API error: ${parsed.error.message}`));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error(`Failed to parse Stripe response: ${responseBody}`));
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function flattenParams(obj, prefix = '') {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((v, i) => { result[`${fullKey}[${i}]`] = v; });
    } else if (value !== null && value !== undefined) {
      result[fullKey] = String(value);
    }
  }
  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔧 Registering Stripe webhooks for ${targetEnv.toUpperCase()}\n`);
  console.log(`   Base URL: ${BASE_URL}`);
  console.log(`   Stripe mode: ${stripeKey.startsWith('sk_live_') ? 'LIVE' : 'TEST'}\n`);

  const results = [];

  for (const endpoint of ENDPOINTS) {
    console.log(`📡 Registering: ${endpoint.description}`);
    console.log(`   URL: ${endpoint.url}`);
    console.log(`   Events: ${endpoint.events.join(', ')}`);

    try {
      const params = {
        url: endpoint.url,
        description: endpoint.description,
      };

      // Add enabled_events
      endpoint.events.forEach((event, i) => {
        params[`enabled_events[${i}]`] = event;
      });

      const webhookEndpoint = await stripeRequest(
        'POST',
        '/v1/webhook_endpoints',
        params,
      );

      console.log(`   ✅ Created: ${webhookEndpoint.id}`);
      console.log(`   🔑 Signing secret: ${webhookEndpoint.secret}\n`);

      results.push({
        id:          webhookEndpoint.id,
        description: endpoint.description,
        url:         endpoint.url,
        secret:      webhookEndpoint.secret,
      });
    } catch (err) {
      console.error(`   ❌ Failed: ${err.message}\n`);
      results.push({ error: err.message, url: endpoint.url });
    }
  }

  // ── Output summary ───────────────────────────────────────────────────────────

  console.log('═══════════════════════════════════════════════════');
  console.log('  Webhook Registration Complete');
  console.log('═══════════════════════════════════════════════════\n');
  console.log('Add these to your apps/api/.env file:\n');

  for (const result of results) {
    if (result.error) {
      console.log(`# ❌ ${result.url}: ${result.error}`);
      continue;
    }

    // Map endpoint to env var name
    if (result.url.endsWith('/connect')) {
      console.log(`STRIPE_CONNECT_WEBHOOK_SECRET=${result.secret}`);
    } else if (result.url.endsWith('/terminal')) {
      console.log(`STRIPE_TERMINAL_WEBHOOK_SECRET=${result.secret}`);
    } else {
      console.log(`STRIPE_WEBHOOK_SECRET=${result.secret}`);
    }
  }

  console.log('\n⚠️  Copy these secrets NOW — Stripe only shows them once.\n');
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
