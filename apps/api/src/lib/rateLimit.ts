/**
 * rateLimit — canonical per-endpoint rate-limit catalog
 * (Security Hardening, Layer 2 / PCI DSS Req 8.3.4, OWASP brute-force).
 *
 * The GLOBAL limiter (200/min/IP, Redis-agnostic in-memory per instance) is
 * registered in index.ts. Sensitive routes apply STRICTER limits via Fastify's
 * per-route `config.rateLimit`. This file centralizes those values so audits
 * have one place to look.
 *
 * CURRENTLY APPLIED (set at the route level):
 *   auth login         5 / 15 min   (stricter than the PCI max of 10)
 *   auth MFA           3 / 5 min
 *   auth PIN login     10 / 15 min
 *   auth refresh       20 / 1 min
 *   password reset     3 / 1 hour
 *   registration       5 / 1 hour   (registration.routes.ts)
 *   AI nl-query        30 / 1 hour
 *   imports            20 / 1 hour  (import.routes.ts)
 *
 * NOTE: payment routes intentionally rely on the global limiter + Stripe's own
 * fraud controls; adding a low per-route cap risks blocking a busy register
 * during a rush (POS is sacred). Documented in docs/SECURITY.md.
 */

interface RateLimitSpec {
  max: number;
  timeWindow: number; // ms
  errorResponseBuilder: () => {
    statusCode: number;
    code: string;
    message: string;
    retryAfter: number;
  };
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

function spec(max: number, timeWindow: number, code: string, message: string): RateLimitSpec {
  return {
    max,
    timeWindow,
    errorResponseBuilder: () => ({
      statusCode: 429,
      code,
      message,
      retryAfter: Math.ceil(timeWindow / 1000),
    }),
  };
}

export const RATE_LIMITS = {
  /** Login attempts — PCI 8.3.4 (we run stricter than the 10-attempt maximum). */
  AUTH_LOGIN: spec(5, 15 * MIN, 'TOO_MANY_ATTEMPTS',
    'Too many login attempts. Please wait 15 minutes before trying again.'),

  /** Registrations per IP. */
  AUTH_REGISTER: spec(5, HOUR, 'TOO_MANY_REGISTRATIONS',
    'Too many registration attempts.'),

  /** Password reset requests. */
  AUTH_FORGOT_PASSWORD: spec(3, HOUR, 'TOO_MANY_RESET_ATTEMPTS',
    'Too many password reset attempts.'),

  /** Payment attempts (reference value — see NOTE above before applying). */
  PAYMENT: spec(20, 15 * MIN, 'TOO_MANY_PAYMENT_ATTEMPTS',
    'Too many payment attempts.'),

  /** Document imports. */
  IMPORT: spec(10, HOUR, 'TOO_MANY_IMPORTS',
    'Too many import attempts.'),

  /** AI endpoints — protects API spend. */
  AI: spec(50, HOUR, 'AI_RATE_LIMIT',
    'AI usage limit reached. Please wait before making more AI requests.'),

  /** Baseline for everything else (the global limiter). */
  GENERAL: spec(200, MIN, 'RATE_LIMIT_EXCEEDED',
    'Too many requests. Please slow down.'),
} as const;

export type RateLimitName = keyof typeof RATE_LIMITS;

/** Per-route Fastify config helper: `{ config: routeRateLimit('AUTH_LOGIN') }` */
export function routeRateLimit(name: RateLimitName): { rateLimit: RateLimitSpec } {
  return { rateLimit: RATE_LIMITS[name] };
}
