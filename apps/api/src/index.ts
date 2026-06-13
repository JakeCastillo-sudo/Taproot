import 'dotenv/config';
import crypto from 'crypto';
import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
  type FastifyReply,
} from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { validateConfig, config } from './config';
import { logger } from './lib/logger';
import { pool } from './db/client';
import bcrypt from 'bcrypt';
import { runWeeklyCampaignJob } from './jobs/weeklyCampaign.job';
import { runEmailSequenceJob } from './jobs/emailSequence.job';
import inviteRoutes from './routes/invite.routes';
import { getPublisher } from './db/redis';
import { registerValidationHooks } from './middleware/validation';
import { registerErrorHandler } from './middleware/errorHandler';
import authPlugin from './auth/index';
import inventoryRoutes from './routes/inventory.routes';
import orderRoutes from './routes/order.routes';
import websocketRoutes from './routes/websocket.routes';
import paymentRoutes from './routes/payment.routes';
import webhookRoutes from './routes/webhook.routes';
import customerRoutes from './routes/customer.routes';
import reportRoutes from './routes/report.routes';
import importRoutes from './routes/import.routes';
import aiRoutes from './routes/ai.routes';
import migrationRoutes from './routes/migration.routes';
import registrationRoutes from './routes/registration.routes';
import billingRoutes from './routes/billing.routes';
import onboardingRoutes from './routes/onboarding.routes';
import settingsRoutes from './routes/settings.routes';
import modifierRoutes from './routes/modifier.routes';
import employeeRoutes from './routes/employee.routes';
import cashDrawerRoutes from './routes/cashDrawer.routes';
import tableRoutes from './routes/table.routes';
import publicRoutes from './routes/public.routes';
import kitchenRoutes from './routes/kitchen.routes';
import reservationRoutes from './routes/reservation.routes';
import discountRoutes from './routes/discount.routes';
import intelligenceRoutes from './routes/intelligence.routes';
import integrationsRoutes from './routes/integrations.routes';
import smsRoutes from './routes/sms.routes';
import franchiseRoutes from './routes/franchise.routes';
import analyticsRoutes from './routes/analytics.routes';
import apiKeysRoutes from './routes/apiKeys.routes';
import webhooksRoutes from './routes/webhooks.routes';
import schedulingRoutes from './routes/scheduling.routes';
import { registerAdminRoutes } from './routes/admin.routes';
import { registerMonitoring } from './monitoring/health';
import { initSentry, registerSentryHooks } from './monitoring/sentry';
import { checkSubscription } from './middleware/subscription';
import { validateStripeMode } from './payments/stripe.config';
import { assertSecureConfig } from './lib/security';
import { raiseSecurityAlert } from './lib/audit';

// Validate required env vars at startup — throws immediately if any are missing
validateConfig();

// Security hardening assertions — fail secure: refuse to boot on weak config
assertSecureConfig();

// Validate Stripe mode (prevents accidental live charges in dev)
validateStripeMode();

// Initialise Sentry error monitoring (no-op if SENTRY_DSN not set)
initSentry();

// buildApp returns the Fastify instance typed broadly so helmet's HTTP/2 type
// augmentation doesn't conflict with route helper signatures.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildApp(): Promise<any> {
  // Cast to FastifyInstance so all usages below keep the familiar API surface.
  const fastify = Fastify({
    logger: {
      level: config.NODE_ENV === 'production' ? 'info' : 'debug',
      ...(config.NODE_ENV !== 'production' && {
        transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss Z' } },
      }),
      // Production-safe serializers — never log auth headers or request bodies.
      // Typed loosely to avoid pino/Fastify serializer generic conflicts.
      serializers: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        req(request: any) {
          return {
            method:    request.method as string,
            url:       request.url as string,
            requestId: request.headers?.['x-request-id'] as string | undefined,
            // Intentionally omit: headers (may contain Authorization), body (may contain card data)
          };
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        res(reply: any) {
          return {
            statusCode: reply.statusCode as number,
          };
        },
      },
    },
    genReqId: () => crypto.randomUUID(),
    trustProxy: true,
  });

  // Parse application/x-www-form-urlencoded (Twilio SMS webhooks post form bodies).
  fastify.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    try {
      const params: Record<string, string> = {};
      for (const [k, v] of new URLSearchParams(body as string)) params[k] = v;
      done(null, params);
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // ─── Security headers ─────────────────────────────────────────────────────────

  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc:  ["'self'"],
        // 'unsafe-inline' required for Stripe.js embedded UI
        scriptSrc:   ["'self'", "'unsafe-inline'", 'https://js.stripe.com', 'https://plausible.io'],
        styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc:     ["'self'", 'https://fonts.gstatic.com'],
        imgSrc:      ["'self'", 'data:', 'https:'],
        connectSrc:  ["'self'", 'https://api.stripe.com', 'https://api.anthropic.com', 'https://plausible.io'],
        // NOTE: stays 'none' (stricter than the hardening spec's js.stripe.com) —
        // this API serves JSON only; Stripe iframes are embedded by the Vercel
        // frontend, which is governed by its own headers.
        frameSrc:    ["'none'"],
        objectSrc:   ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    // Additional headers set explicitly below
    frameguard:               { action: 'deny' },
    referrerPolicy:           { policy: 'strict-origin-when-cross-origin' },
    xContentTypeOptions:      true,
    hsts: config.NODE_ENV === 'production'
      ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
      : false,
  });

  // Permissions-Policy (helmet does not yet set this — add manually)
  // + extra hardening headers / server-fingerprint removal (Security L1)
  fastify.addHook('onSend', async (req, reply) => {
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('X-Permitted-Cross-Domain-Policies', 'none');
    reply.removeHeader('X-Powered-By');
    reply.removeHeader('Server');

    // Rate-limit abuse signal (Security L10) — deduped 1/org/hour in Redis
    if (reply.statusCode === 429) {
      const orgId = (req as FastifyRequest & { user?: { orgId?: string } }).user?.orgId;
      void raiseSecurityAlert({
        type: 'rate_limit_abuse',
        severity: 'medium',
        orgId: orgId ?? `ip:${req.ip}`,
        details: { url: req.url, ip: req.ip },
      });
    }
  });

  // ─── CORS ─────────────────────────────────────────────────────────────────────
  // Railway deploy trigger: 2026-06-03T00:00:00Z

  // Explicit extra origins from env (comma-separated) — used for preview deployments, staging, etc.
  const corsOrigins = (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean);
  // Production custom domains — hardcoded so CORS never depends solely on an env var (defense in depth).
  const PROD_ORIGINS = ['https://taproot-pos.com', 'https://www.taproot-pos.com'];

  await fastify.register(cors, {
    origin: (origin, callback) => {
      // Server-to-server or same-origin requests have no Origin header — allow them.
      if (!origin) return callback(null, true);
      // Production custom domains (always allowed)
      if (PROD_ORIGINS.includes(origin)) return callback(null, true);
      // Explicitly listed origins (CORS_ORIGINS env var or APP_URL)
      if (corsOrigins.includes(origin)) return callback(null, true);
      if (origin === config.APP_URL) return callback(null, true);
      // Any Vercel preview / production deployment (*.vercel.app)
      if (origin.endsWith('.vercel.app')) return callback(null, true);
      // Local development
      if (origin.startsWith('http://localhost')) return callback(null, true);
      callback(new Error('Not allowed by CORS'), false);
    },
    methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-Organization-Slug',
      'X-Location-Token',
      'X-Request-ID',
      'X-Taproot-Client',  // CSRF indicator header from the web client
    ],
    exposedHeaders: ['X-Request-ID'],
    credentials: true,
  });

  // ─── Rate limiting ────────────────────────────────────────────────────────────
  //
  // Global:   200 requests / minute / IP  (default for all routes)
  // Auth:     5–20 / window  (set per-route in auth/routes.ts — already stricter)
  // Imports:  20 / hour      (set per-route in import.routes.ts)
  // AI:       30 / hour      (set per-route in ai.routes.ts)
  // Webhooks: 1000 / minute  (set per-route in webhook.routes.ts)

  await fastify.register(rateLimit, {
    global:       true,
    max:          200,
    timeWindow:   60_000, // 1 minute
    keyGenerator: (req) => {
      // Prefer X-Forwarded-For when behind proxy; fall back to remote IP
      const forwarded = req.headers['x-forwarded-for'];
      if (forwarded) {
        const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
        return first.trim();
      }
      return req.ip;
    },
    errorResponseBuilder: (_req, context) => {
      // context.ttl is ms until reset (v10 API)
      const ctx = context as { ttl?: number; after?: string };
      const retryAfter = ctx.ttl != null ? Math.ceil(ctx.ttl / 1000) : 60;
      return {
        statusCode: 429,
        code:       'RATE_LIMITED',
        message:    `Too many requests. Retry after ${retryAfter} seconds.`,
        retryAfter,
      };
    },
    addHeadersOnExceeding: {
      'x-ratelimit-limit':     true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset':     true,
    },
    addHeaders: {
      'x-ratelimit-limit':     true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset':     true,
      'retry-after':           true,
    },
  });

  // ─── Global input validation hooks ───────────────────────────────────────────

  await registerValidationHooks(fastify);

  // ─── HTTPS enforcement in production ─────────────────────────────────────────

  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (
      config.NODE_ENV === 'production' &&
      request.headers['x-forwarded-proto'] !== 'https'
    ) {
      return reply.code(301).redirect(`https://${request.hostname}${request.url}`);
    }
  });

  // ─── Auth plugin (registers /api/v1/auth/* routes + request decorators) ──────

  // ─── Sentry request context hooks ────────────────────────────────────────────
  registerSentryHooks(fastify);

  // ─── Public routes (before auth middleware) ──────────────────────────────────
  await fastify.register(registrationRoutes);
  await fastify.register(publicRoutes);

  await fastify.register(authPlugin);
  await fastify.register(inventoryRoutes);
  await fastify.register(orderRoutes);
  await fastify.register(websocketRoutes);
  await fastify.register(webhookRoutes);
  await fastify.register(paymentRoutes);
  await fastify.register(customerRoutes);
  await fastify.register(reportRoutes);
  await fastify.register(importRoutes);
  await fastify.register(aiRoutes);
  await fastify.register(migrationRoutes);
  await fastify.register(billingRoutes);
  await fastify.register(onboardingRoutes);
  await fastify.register(settingsRoutes);
  await fastify.register(modifierRoutes);
  await fastify.register(employeeRoutes);
  await fastify.register(inviteRoutes);
  await fastify.register(cashDrawerRoutes);
  await fastify.register(tableRoutes);
  await fastify.register(kitchenRoutes);
  await fastify.register(reservationRoutes);
  await fastify.register(discountRoutes);
  await fastify.register(intelligenceRoutes);
  await fastify.register(integrationsRoutes);
  await fastify.register(franchiseRoutes);
  await fastify.register(analyticsRoutes);
  await fastify.register(apiKeysRoutes);
  await fastify.register(webhooksRoutes);
  await fastify.register(schedulingRoutes);
  await fastify.register(smsRoutes);

  // ─── Admin / Executive portal (separate admin JWT — see middleware/adminAuth) ──
  await registerAdminRoutes(fastify);

  // ─── Dev-only utilities (never registered in production) ──────────────────────
  //
  // POST /api/v1/dev/reset-rate-limits
  //   Calls redis.flushall() so the demo account's rate-limit counters are cleared
  //   without needing to restart the server or wait for the window to expire.
  //   No auth required — this endpoint is registered only when NODE_ENV=development.
  if (config.NODE_ENV === 'development') {
    fastify.post('/api/v1/dev/reset-rate-limits', async (_req, reply) => {
      const redis = getPublisher();
      await redis.flushall();
      fastify.log.warn('DEV: Redis flushed via /api/v1/dev/reset-rate-limits');
      return reply.send({ success: true });
    });
  }

  // ─── Monitoring: Prometheus metrics + structured health ───────────────────────
  await registerMonitoring(fastify);

  // ─── Health check ─────────────────────────────────────────────────────────────
  //
  // GET /api/health — returns { status, version, timestamp, checks, uptime }
  // Checks: database (SELECT 1), redis (PING), stripe (key presence)
  // Response time target: < 500 ms

  const START_TIME = Date.now();

  fastify.get('/api/health', {
    config: { rateLimit: { max: 60, timeWindow: 60_000 } },
  }, async (_req, reply) => {
    const checks: Record<string, 'ok' | 'error'> = {};

    // Database check — SELECT 1 with 3s timeout
    try {
      await Promise.race([
        pool.query('SELECT 1'),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 3_000),
        ),
      ]);
      checks['database'] = 'ok';
    } catch (err) {
      checks['database'] = 'error';
      fastify.log.error({ err }, '[health] database check failed');
    }

    // Redis check — PING with 2s timeout
    try {
      const redis = getPublisher();
      await Promise.race([
        redis.ping(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 2_000),
        ),
      ]);
      checks['redis'] = 'ok';
    } catch (err) {
      checks['redis'] = 'error';
      fastify.log.error({ err }, '[health] redis check failed');
    }

    // Stripe check — key presence only (no live API call)
    checks['stripe'] = config.STRIPE_SECRET_KEY ? 'ok' : 'error';

    const anyError = Object.values(checks).some((v) => v === 'error');
    const status   = anyError ? 'degraded' : 'ok';

    // Always return HTTP 200 — Railway (and most uptime monitors) use the
    // status code to decide whether to keep the deployment alive. A 503 here
    // causes Railway to kill the container even when the app itself is
    // running fine. Service health is communicated through the `status` and
    // `checks` fields in the response body instead.
    return reply.code(200).send({
      status,
      version:   process.env.npm_package_version ?? '1.2.0',
      timestamp: new Date().toISOString(),
      checks,
      uptime:    Math.floor((Date.now() - START_TIME) / 1_000),
    });
  });

  // ─── Global authentication preHandler ────────────────────────────────────────

  const PUBLIC_ROUTES = new Set([
    'GET /api/health',
    'POST /api/v1/auth/login',
    'POST /api/v1/auth/login/mfa',
    'POST /api/v1/auth/login/pin',
    'POST /api/v1/auth/refresh',
    'POST /api/v1/auth/password/reset/request',
    'POST /api/v1/auth/password/reset/confirm',
    // Stripe webhooks — authenticated via signature, not JWT
    'POST /api/v1/webhooks/stripe/connect',
    'POST /api/v1/webhooks/stripe/terminal',
    // Metrics — authenticated via X-Metrics-Secret header, not JWT
    'GET /metrics',
    // Registration — public
    'POST /api/v1/register',
    'POST /api/v1/register/check-email',
    // Employee invite acceptance — public (invitee has no account yet)
    'GET /api/v1/invite/verify',
    'POST /api/v1/invite/accept',
    // Public QR-code storefront
    'GET /public/:orgSlug/menu',
    'POST /public/:orgSlug/order',
    'POST /public/:orgSlug/payment-intent',
    'POST /public/:orgSlug/order/:orderId/confirm',
    'GET /public/:orgSlug/order/:orderId/status',
    // Twilio inbound SMS — verified via Twilio signature, not JWT
    'POST /webhook/sms/:orgSlug',
    // Dev-only — this route is not registered in production so this entry is harmless
    ...(config.NODE_ENV === 'development' ? ['POST /api/v1/dev/reset-rate-limits'] : []),
  ]);

  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const routeKey = `${request.method} ${request.routeOptions.url}`;
    if (PUBLIC_ROUTES.has(routeKey)) return;
    // Admin / executive-portal routes use a SEPARATE admin JWT (middleware/adminAuth)
    // and must NOT pass through the org-auth + subscription guard. Each admin route
    // enforces its own auth via authenticateAdmin; POST /admin/auth/login is public.
    if (request.routeOptions.url?.startsWith('/api/v1/admin/')) return;
    await fastify.authenticate(request, reply);
    // Check subscription access after authentication
    await checkSubscription(request, reply);
  });

  // ─── Global error handler (production-safe) ───────────────────────────────────

  registerErrorHandler(fastify);

  return fastify;
}

// Process-level safety nets — log with full context, never crash silently.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: reason instanceof Error ? reason.stack : String(reason) });
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.stack ?? err.message });
});

/**
 * Seed the first admin/executive-portal user on startup (idempotent).
 * Resilient: if migration 022 (admin_users) hasn't run yet, it logs and skips
 * rather than crashing boot. Creates admin@taproot-pos.com / TaprootAdmin2026!
 * (super_admin) only when no admin users exist. bcrypt cost 12 matches adminLogin.
 */
async function seedFirstAdminUser(): Promise<void> {
  try {
    const { rows: [t] } = await pool.query<{ exists: boolean }>(
      `SELECT to_regclass('public.admin_users') IS NOT NULL AS exists`,
    );
    if (!t?.exists) {
      logger.warn('[admin seed] admin_users table not found — run migration 022 then restart to seed the admin user');
      return;
    }
    const { rows: [{ count }] } = await pool.query<{ count: string }>(`SELECT COUNT(*)::int AS count FROM admin_users`);
    if (Number(count) > 0) return;
    const hash = await bcrypt.hash('TaprootAdmin2026!', 12);
    await pool.query(
      `INSERT INTO admin_users (email, password_hash, first_name, last_name, role)
       VALUES ($1, $2, 'Taproot', 'Admin', 'super_admin')
       ON CONFLICT (email) DO NOTHING`,
      ['admin@taproot-pos.com', hash],
    );
    logger.warn('[admin seed] created admin@taproot-pos.com (super_admin) — change this password');
  } catch (err) {
    logger.error('[admin seed] failed (non-fatal)', { error: err instanceof Error ? err.message : String(err) });
  }
}

buildApp()
  .then(async (app) => {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    await seedFirstAdminUser();

    // Weekly marketing campaigns (STEP 5D). Ticks hourly; the job acts only on
    // Sundays and dedups via email_logs (date-stamped template_name), so it's
    // at-most-once-per-Sunday even across restarts. GATED behind CAMPAIGNS_ENABLED so NO real
    // customer emails go out until you opt in (set CAMPAIGNS_ENABLED=true on Railway).
    if (process.env.CAMPAIGNS_ENABLED === 'true') {
      const tick = (): void => void runWeeklyCampaignJob().catch((err) =>
        logger.error('[WeeklyCampaign] tick failed', { error: err instanceof Error ? err.message : String(err) }));
      setInterval(tick, 60 * 60 * 1000);
      tick();
      logger.info('[WeeklyCampaign] scheduler ENABLED (hourly tick; Sundays only)');
    } else {
      logger.info('[WeeklyCampaign] scheduler OFF — set CAMPAIGNS_ENABLED=true to send weekly campaigns');
    }

    // Onboarding drip sequence (Day 1/3/7/12). Ticks every 24h; the job dedups
    // per template (email_logs) so it's at-most-once per step. GATED behind
    // ONBOARDING_EMAILS_ENABLED so NO real customer emails go out until you opt in.
    if (process.env.ONBOARDING_EMAILS_ENABLED === 'true') {
      const tick = (): void => void runEmailSequenceJob().catch((err) =>
        logger.error('[EmailSequence] tick failed', { error: err instanceof Error ? err.message : String(err) }));
      setInterval(tick, 24 * 60 * 60 * 1000);
      tick();
      logger.info('[EmailSequence] scheduler ENABLED (24h tick)');
    } else {
      logger.info('[EmailSequence] scheduler OFF — set ONBOARDING_EMAILS_ENABLED=true to send onboarding drip');
    }
  })
  .catch((err) => {
    logger.error('Server failed to start', { error: err instanceof Error ? err.stack : String(err) });
    process.exit(1);
  });
