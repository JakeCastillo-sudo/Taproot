/**
 * security — shared validators, sanitizers, and startup assertions
 * (Security Hardening, Layer 3 / PCI DSS Req 6.2, OWASP A03).
 *
 * Complements (does not replace) the existing defenses:
 *   - middleware/validation.ts — global XSS strip, body limits, UUID params
 *   - auth/schemas.ts          — zod schemas already applied on auth routes
 *   - pg parameterized queries — primary SQL-injection defense everywhere
 *
 * Use these validators when adding/expanding route input validation.
 */

import { z } from 'zod';
import { config } from '../config';

// ─── Common validators (zod) ──────────────────────────────────────────────────

export const validators = {
  /** UUID — never trust client-provided IDs without validation. */
  uuid: z.string().uuid('Invalid ID format'),

  /** Email — normalized lowercase, length-capped. */
  email: z.string()
    .trim()
    .email('Invalid email')
    .toLowerCase()
    .max(255, 'Email too long'),

  /** Strong password: 8–128 chars, upper + lower + digit. */
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password too long')
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      'Password must contain uppercase, lowercase, and number'),

  /** POS PIN — 4–6 digits only. */
  pin: z.string().regex(/^\d{4,6}$/, 'PIN must be 4-6 digits'),

  /** Money in cents — positive integer, $100k ceiling. */
  amountCents: z.number()
    .int('Amount must be integer cents')
    .min(0, 'Amount cannot be negative')
    .max(10_000_000, 'Amount exceeds maximum ($100,000)'),

  /** Short text (names/labels) — no angle/curly brackets. */
  shortText: z.string()
    .trim()
    .min(1, 'Required')
    .max(255, 'Too long')
    .regex(/^[^<>{}]*$/, 'Invalid characters'),

  /** Long text — capped, script tags stripped. */
  longText: z.string()
    .trim()
    .max(5000, 'Too long')
    .transform((s) => s.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')),

  /** URL-safe org slug. */
  slug: z.string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/, 'Slug can only contain letters, numbers, hyphens')
    .min(3, 'Slug too short')
    .max(50, 'Slug too long'),

  /** Pagination. */
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),

  /** Date range bounds — reject absurd queries. */
  dateFrom: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format')
    .refine((d) => new Date(d) >= new Date('2020-01-01'), 'Date too far in the past'),

  dateTo: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format')
    .refine((d) => {
      const max = new Date();
      max.setFullYear(max.getFullYear() + 1);
      return new Date(d) <= max;
    }, 'Date too far in the future'),
};

// ─── SQL injection guards for DYNAMIC query parts ─────────────────────────────
// (Parameterized queries handle values; these guard identifiers like ORDER BY.)

export function sanitizeSortField(field: string, allowedFields: string[]): string {
  if (!allowedFields.includes(field)) {
    throw new Error(`Invalid sort field: ${field}`);
  }
  return field;
}

export function sanitizeSortOrder(order: string): 'ASC' | 'DESC' {
  const upper = (order ?? '').toUpperCase();
  return upper === 'DESC' ? 'DESC' : 'ASC'; // safe default
}

// ─── XSS prevention ───────────────────────────────────────────────────────────

export function stripHtml(input: string): string {
  return input
    .replace(/<[^>]*>/g, '')        // remove HTML tags
    .replace(/javascript:/gi, '')   // remove js: URLs
    .replace(/on\w+\s*=/gi, '')     // remove inline event handlers
    .trim();
}

// ─── Path traversal prevention ────────────────────────────────────────────────

export function safePath(input: string): string {
  return input
    .replace(/\.\./g, '')   // no directory traversal
    .replace(/[/\\]/g, '')  // no path separators
    .trim();
}

// ─── Upload limits ────────────────────────────────────────────────────────────

/** Menu PDF / CSV upload ceiling (multipart). JSON bodies are capped at 1 MB
 *  by middleware/validation.ts. */
export const UPLOAD_SIZE_LIMIT = 50 * 1024 * 1024; // 50 MB

// ─── Startup assertions (fail secure: refuse to boot on weak config) ─────────

export function assertSecureConfig(): void {
  // PCI Req 8: strong key material. config.ts already enforces >=64 chars in
  // production; this is the universal floor (256-bit) for every environment.
  if (!config.JWT_SECRET || config.JWT_SECRET.length < 32) {
    throw new Error(
      'SECURITY: JWT_SECRET must be at least 32 characters (256 bits). ' +
      'Generate with: openssl rand -hex 32',
    );
  }
  // Never allow a production boot with the bcrypt cost below industry floor.
  if (config.BCRYPT_ROUNDS < 12) {
    throw new Error('SECURITY: BCRYPT_ROUNDS must be >= 12');
  }
  // PCI DSS 8.3.4: lockout for at least 30 minutes.
  if (config.NODE_ENV === 'production' && config.LOCKOUT_DURATION_MINUTES < 30) {
    throw new Error('SECURITY: LOCKOUT_DURATION_MINUTES must be >= 30 in production (PCI DSS 8.3.4)');
  }
}
