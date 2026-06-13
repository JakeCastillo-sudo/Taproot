/**
 * Employee invite routes — email-based invite → verify → accept flow.
 *
 * Auth: /employees/invite and /employees/:id/resend-invite go through the GLOBAL
 * auth preHandler (they are NOT in PUBLIC_ROUTES) and additionally require an
 * owner/manager role. /invite/verify and /invite/accept are PUBLIC (listed in
 * index.ts PUBLIC_ROUTES) so an invitee with no account can complete setup.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import type { AccessTokenPayload } from '../auth/jwt';
import { query } from '../db/client';
import { sendEmployeeInvite } from '../services/email.service';

type AuthedRequest = FastifyRequest & { user: AccessTokenPayload };

const VALID_ROLES = new Set(['manager', 'cashier', 'kitchen', 'readonly']);
const INVITE_TTL_MS = 48 * 60 * 60 * 1000;

function requireAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  const { user } = req as AuthedRequest;
  if (user.role !== 'owner' && user.role !== 'manager') {
    reply.code(403).send({ code: 'FORBIDDEN', message: 'Manager or owner role required' });
    return false;
  }
  return true;
}

async function getInviterName(employeeId: string): Promise<string> {
  const { rows: [row] } = await query<{ first_name: string }>(
    `SELECT first_name FROM employees WHERE id = $1`,
    [employeeId],
  );
  return row?.first_name ?? 'A manager';
}

async function getOrgName(orgId: string): Promise<string> {
  const { rows: [row] } = await query<{ name: string }>(
    `SELECT name FROM organizations WHERE id = $1`,
    [orgId],
  );
  return row?.name ?? 'your restaurant';
}

export default async function inviteRoutes(fastify: FastifyInstance): Promise<void> {
  // ── POST /api/v1/employees/invite (auth + owner/manager) ───────────────────
  fastify.post('/api/v1/employees/invite', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(req, reply)) return;
    const { user } = req as AuthedRequest;
    const orgId = user.orgId;
    const body = (req.body ?? {}) as {
      email?: string; firstName?: string; lastName?: string; role?: string;
    };

    const email = body.email?.trim().toLowerCase();
    const firstName = body.firstName?.trim();
    const role = body.role?.trim();

    if (!email || !firstName || !role) {
      return reply.code(400).send({
        code: 'VALIDATION_ERROR',
        message: 'email, firstName and role are required',
      });
    }
    if (!VALID_ROLES.has(role)) {
      return reply.code(400).send({
        code: 'VALIDATION_ERROR',
        message: `role must be one of: ${[...VALID_ROLES].join(', ')}`,
      });
    }

    const existing = await query(
      `SELECT id FROM employees
       WHERE organization_id = $1 AND email = $2 AND deleted_at IS NULL`,
      [orgId, email],
    );
    if (existing.rows.length > 0) {
      return reply.code(409).send({
        code: 'EMPLOYEE_EXISTS',
        message: 'An employee with this email already exists',
      });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    // Unusable placeholder password until the invitee sets their own on accept.
    const placeholderHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);

    const { rows: [created] } = await query<{ id: string }>(
      `INSERT INTO employees (
         organization_id, email, first_name, last_name, role,
         password_hash, invite_token, invite_token_expires_at,
         invite_sent_at, account_setup_required
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),true)
       RETURNING id`,
      [orgId, email, firstName, body.lastName?.trim() ?? '', role, placeholderHash, token, expiresAt],
    );

    const [inviterName, restaurantName] = await Promise.all([
      getInviterName(user.sub),
      getOrgName(orgId),
    ]);

    sendEmployeeInvite({
      to: email,
      employeeName: firstName,
      restaurantName,
      inviterName,
      role,
      inviteToken: token,
      orgId,
    }).catch((err) => console.error('[Email] Invite send failed:', err));

    return reply.code(201).send({ success: true, employeeId: created.id, inviteSent: true });
  });

  // ── GET /api/v1/invite/verify?token=xxx (PUBLIC) ───────────────────────────
  fastify.get('/api/v1/invite/verify', async (req: FastifyRequest, reply: FastifyReply) => {
    const token = (req.query as { token?: string }).token;
    if (!token) {
      return reply.code(400).send({ valid: false, reason: 'missing_token' });
    }

    const { rows: [emp] } = await query<{
      first_name: string; role: string;
      invite_accepted_at: string | null; invite_token_expires_at: string | null;
      restaurant_name: string;
    }>(
      `SELECT e.first_name, e.role, e.invite_accepted_at, e.invite_token_expires_at,
              o.name AS restaurant_name
         FROM employees e
         JOIN organizations o ON o.id = e.organization_id
        WHERE e.invite_token = $1`,
      [token],
    );

    if (!emp) return reply.send({ valid: false, reason: 'not_found' });
    if (emp.invite_accepted_at) return reply.send({ valid: false, reason: 'already_used' });
    if (!emp.invite_token_expires_at || new Date(emp.invite_token_expires_at) < new Date()) {
      return reply.send({ valid: false, reason: 'expired' });
    }

    return reply.send({
      valid: true,
      employeeName: emp.first_name,
      restaurantName: emp.restaurant_name,
      role: emp.role,
    });
  });

  // ── POST /api/v1/invite/accept (PUBLIC) ────────────────────────────────────
  fastify.post('/api/v1/invite/accept', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as { token?: string; password?: string; pin?: string };
    const { token, password, pin } = body;

    if (!token || !password) {
      return reply.code(400).send({
        code: 'MISSING_FIELDS',
        message: 'token and password are required',
      });
    }
    if (password.length < 8) {
      return reply.code(400).send({
        code: 'WEAK_PASSWORD',
        message: 'Password must be at least 8 characters',
      });
    }
    if (pin && !/^\d{4,6}$/.test(pin)) {
      return reply.code(400).send({
        code: 'INVALID_PIN',
        message: 'PIN must be 4–6 digits',
      });
    }

    const { rows: [emp] } = await query<{
      id: string; invite_accepted_at: string | null; invite_token_expires_at: string | null;
    }>(
      `SELECT id, invite_accepted_at, invite_token_expires_at
         FROM employees WHERE invite_token = $1`,
      [token],
    );

    if (!emp) {
      return reply.code(404).send({ code: 'INVALID_TOKEN', message: 'Invalid or expired invitation' });
    }
    if (emp.invite_accepted_at) {
      return reply.code(409).send({ code: 'ALREADY_ACCEPTED', message: 'This invitation has already been used' });
    }
    if (!emp.invite_token_expires_at || new Date(emp.invite_token_expires_at) < new Date()) {
      return reply.code(410).send({ code: 'EXPIRED', message: 'This invitation has expired' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const pinHash = pin ? await bcrypt.hash(pin, 10) : null;

    await query(
      `UPDATE employees SET
         password_hash = $1,
         pin_hash = $2,
         invite_token = NULL,
         invite_token_expires_at = NULL,
         invite_accepted_at = NOW(),
         account_setup_required = false,
         updated_at = NOW()
       WHERE id = $3`,
      [passwordHash, pinHash, emp.id],
    );

    return reply.send({ success: true });
  });

  // ── POST /api/v1/employees/:id/resend-invite (auth + owner/manager) ────────
  fastify.post('/api/v1/employees/:id/resend-invite', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(req, reply)) return;
    const { user } = req as AuthedRequest;
    const orgId = user.orgId;
    const { id } = req.params as { id: string };

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const { rows: [emp] } = await query<{ email: string; first_name: string; role: string }>(
      `UPDATE employees SET
         invite_token = $1,
         invite_token_expires_at = $2,
         invite_sent_at = NOW()
       WHERE id = $3 AND organization_id = $4 AND account_setup_required = true
       RETURNING email, first_name, role`,
      [token, expiresAt, id, orgId],
    );

    if (!emp) {
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'No pending invite for this employee' });
    }

    const [inviterName, restaurantName] = await Promise.all([
      getInviterName(user.sub),
      getOrgName(orgId),
    ]);

    sendEmployeeInvite({
      to: emp.email,
      employeeName: emp.first_name,
      restaurantName,
      inviterName,
      role: emp.role,
      inviteToken: token,
      orgId,
    }).catch((err) => console.error('[Email] Invite resend failed:', err));

    return reply.send({ success: true });
  });
}
