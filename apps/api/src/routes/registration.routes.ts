/**
 * Registration routes
 *
 * POST /api/v1/register        — create org + employee + start trial
 * POST /api/v1/register/check-email — check email availability
 *
 * These are PUBLIC routes (no JWT required). They perform:
 *   1. Input validation (Zod)
 *   2. Email uniqueness check
 *   3. Org + location + employee creation (single transaction)
 *   4. 14-day trial initialisation in DB (Stripe subscription created
 *      only when user adds payment method on /billing)
 *   5. Welcome email (non-blocking)
 *   6. Auto-login: return JWT tokens
 */

import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { query, withTransaction } from '../db/client';
import { signAccessToken, signRefreshToken } from '../auth/jwt';
import { createAuditLog } from '../auth/audit';
import { DEFAULT_ROLE_PERMISSIONS } from '../auth/permissions';
import { sendWelcomeEmail } from '../services/email.service';
import { config } from '../config';

// ─── Validation schema ────────────────────────────────────────────────────────

const RegisterSchema = z.object({
  firstName:      z.string().min(1).max(100),
  lastName:       z.string().min(1).max(100),
  email:          z.string().email().max(255).toLowerCase(),
  password:       z.string().min(10).max(128),
  businessName:   z.string().min(1).max(255),
  businessType:   z.enum(['restaurant', 'cafe', 'bar', 'retail', 'food_truck', 'other']),
  phone:          z.string().max(50).optional(),
  referralSource: z.enum(['legalzoom', 'google', 'referral', 'other']).optional(),
});

// ─── Slug generation ──────────────────────────────────────────────────────────

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

async function uniqueSlug(base: string): Promise<string> {
  let slug  = base;
  let tries = 0;
  while (true) {
    const existing = await query('SELECT id FROM organizations WHERE slug = $1', [slug]);
    if (existing.rows.length === 0) return slug;
    tries++;
    slug = `${base}-${tries}`;
  }
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default async function registrationRoutes(fastify: FastifyInstance): Promise<void> {
  // Stricter rate limit: 10 registrations per hour per IP
  await fastify.register(rateLimit, {
    max:        10,
    timeWindow: 60 * 60 * 1000,
    keyGenerator: (req) => {
      const fwd = req.headers['x-forwarded-for'];
      if (fwd) {
        const first = Array.isArray(fwd) ? fwd[0] : fwd.split(',')[0];
        return `reg:${first.trim()}`;
      }
      return `reg:${req.ip}`;
    },
    errorResponseBuilder: () => ({
      code: 'RATE_LIMITED',
      message: 'Too many registration attempts. Please try again in an hour.',
    }),
  });

  // ── POST /api/v1/register ────────────────────────────────────────────────────

  fastify.post<{ Body: z.infer<typeof RegisterSchema> }>('/api/v1/register', async (request, reply) => {
    const parsed = RegisterSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        code:    'VALIDATION_ERROR',
        message: 'Invalid registration data',
        errors:  parsed.error.flatten().fieldErrors,
      });
    }

    const { firstName, lastName, email, password, businessName,
            businessType, phone, referralSource } = parsed.data;

    // Check email availability
    const emailCheck = await query(
      'SELECT id FROM employees WHERE email = $1 AND deleted_at IS NULL',
      [email],
    );
    if (emailCheck.rows.length > 0) {
      return reply.code(409).send({
        code:    'EMAIL_TAKEN',
        message: 'An account with this email already exists.',
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, config.BCRYPT_ROUNDS);

    // LegalZoom trial extension
    const isLegalZoom = referralSource === 'legalzoom';
    const trialDays   = isLegalZoom ? 30 : 14;
    const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);

    // ── Transactional creation ──────────────────────────────────────────────────
    const { org, location, employee } = await withTransaction(async (client) => {
      const slug = await uniqueSlug(toSlug(businessName));

      // Metadata tags for LegalZoom tracking
      const metadata = isLegalZoom
        ? JSON.stringify({ tags: ['legalzoom'] })
        : JSON.stringify({});

      // Create organization
      const orgRes = await client.query<{ id: string; name: string; slug: string }>(
        `INSERT INTO organizations
           (name, slug, plan, billing_email, trial_ends_at,
            subscription_status, referral_source, metadata)
         VALUES ($1, $2, 'trial', $3, $4, 'trialing', $5, $6::jsonb)
         RETURNING id, name, slug`,
        [businessName, slug, email, trialEndsAt, referralSource ?? null, metadata],
      );
      const org = orgRes.rows[0];

      // Create first location (same name as business)
      const locRes = await client.query<{ id: string }>(
        `INSERT INTO locations
           (organization_id, name, address, timezone, currency, created_by)
         VALUES ($1, $2, '{"city":"","state":"","country":"US"}'::jsonb,
                 'America/New_York', 'USD', gen_random_uuid())
         RETURNING id`,
        [org.id, businessName],
      );
      const location = locRes.rows[0];

      // Create owner employee
      const empRes = await client.query<{
        id: string; email: string; first_name: string; last_name: string; role: string;
      }>(
        `INSERT INTO employees
           (organization_id, email, password_hash, first_name, last_name,
            role, is_active, primary_location_id)
         VALUES ($1, $2, $3, $4, $5, 'owner', true, $6)
         RETURNING id, email, first_name, last_name, role`,
        [org.id, email, passwordHash, firstName, lastName, location.id],
      );
      const employee = empRes.rows[0];

      // Grant owner access to the new location
      await client.query(
        `INSERT INTO employee_locations (employee_id, location_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [employee.id, location.id],
      );

      return { org, location, employee };
    });

    // ── Audit log ──────────────────────────────────────────────────────────────
    await createAuditLog({
      organizationId: org.id,
      actorId:        employee.id,
      actorType:      'employee',
      action:         isLegalZoom ? 'org.created_via_legalzoom' : 'org.created',
      resourceType:   'organization',
      resourceId:     org.id,
      metadata:       { businessType, referralSource, trialDays },
    });

    // ── Generate JWT tokens ────────────────────────────────────────────────────
    const sessionId    = crypto.randomUUID();
    const ownerRole    = 'owner' as const;
    const permissions  = DEFAULT_ROLE_PERMISSIONS[ownerRole];
    const accessToken  = signAccessToken({
      sub:         employee.id,
      orgId:       org.id,
      locationIds: [location.id],
      role:        ownerRole,
      permissions: permissions as unknown as string[],
      sessionId,
    });
    const refreshToken = signRefreshToken(employee.id, sessionId);

    // ── Welcome email (non-blocking) ───────────────────────────────────────────
    sendWelcomeEmail(
      { email: employee.email, firstName: employee.first_name },
      { name: org.name },
    ).catch((err) => fastify.log.error({ err }, '[registration] welcome email failed'));

    return reply.code(201).send({
      accessToken,
      refreshToken,
      employee: {
        id:        employee.id,
        email:     employee.email,
        firstName: employee.first_name,
        lastName:  employee.last_name,
        role:      employee.role,
      },
      org: {
        id:   org.id,
        name: org.name,
        slug: org.slug,
      },
      location: { id: location.id },
      trialEndsAt:  trialEndsAt.toISOString(),
      trialDays,
      nextStep:     'onboarding',
    });
  });

  // ── POST /api/v1/register/check-email ────────────────────────────────────────

  fastify.post<{ Body: { email: string } }>(
    '/api/v1/register/check-email',
    async (request, reply) => {
      const email = (request.body?.email ?? '').toLowerCase().trim();
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return reply.code(400).send({ code: 'INVALID_EMAIL', available: false });
      }

      const res = await query(
        'SELECT id FROM employees WHERE email = $1 AND deleted_at IS NULL',
        [email],
      );
      return reply.code(200).send({ available: res.rows.length === 0 });
    },
  );
}
