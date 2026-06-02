import crypto from 'crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { EmployeeRole } from '@taproot/shared';
import { query, withTransaction } from '../db/client';
import { config } from '../config';
import {
  hashPassword,
  verifyPassword,
  hashPin,
  verifyPin,
  hashToken,
  generateSecureToken,
  generateTotpSecret,
  verifyTotpCode,
  generateTotpQrUri,
  encryptTotpSecret,
  decryptTotpSecret,
  generateBackupCodes,
  hashBackupCode,
  dummyPasswordDelay,
} from './crypto';
import {
  signAccessToken,
  signRefreshToken,
  signMfaToken,
  verifyRefreshToken,
  verifyMfaToken,
  extractBearerToken,
  verifyAccessToken,
  type AccessTokenPayload,
} from './jwt';
import { resolvePermissions } from './permissions';
import { createAuditLog } from './audit';
import { sendPasswordResetEmail } from '../email';
import { authenticate } from './middleware';
import {
  parseBody,
  loginBodySchema,
  loginMfaBodySchema,
  loginPinBodySchema,
  refreshBodySchema,
  mfaVerifySchema,
  mfaDisableSchema,
  passwordChangeSchema,
  passwordResetRequestSchema,
  passwordResetConfirmSchema,
} from './schemas';
import { AuthError, TokenInvalidError, TokenExpiredError, ValidationError } from '../errors';

// ─── Generic auth error response — identical for all login failures (no enumeration) ──

const AUTH_ERROR = { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' } as const;

// ─── DB row types ─────────────────────────────────────────────────────────────

interface EmployeeRow {
  id: string;
  organization_id: string;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  role: EmployeeRole;
  permissions: string[];
  totp_enabled: boolean;
  totp_secret: string | null;
  pin_hash: string | null;
  last_login_at: string | null;
  failed_login_attempts: number;
  locked_until: string | null;
  location_ids: string[] | null;
  deleted_at: string | null;
}

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  deleted_at: string | null;
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function findOrgBySlug(slug: string): Promise<OrgRow | null> {
  const { rows } = await query<OrgRow>(
    `SELECT id, name, slug, deleted_at FROM organizations WHERE slug = $1 LIMIT 1`,
    [slug],
  );
  return rows[0] ?? null;
}

async function findEmployeeByEmail(
  orgId: string,
  email: string,
): Promise<EmployeeRow | null> {
  const { rows } = await query<EmployeeRow>(
    `SELECT id, organization_id, email, password_hash,
            first_name, last_name, role, permissions,
            totp_enabled, totp_secret, pin_hash,
            last_login_at, failed_login_attempts, locked_until,
            COALESCE(location_ids, '{}') AS location_ids,
            deleted_at
     FROM employees
     WHERE organization_id = $1
       AND lower(email) = lower($2)
       AND deleted_at IS NULL
     LIMIT 1`,
    [orgId, email],
  );
  return rows[0] ?? null;
}

async function findEmployeeById(employeeId: string): Promise<EmployeeRow | null> {
  const { rows } = await query<EmployeeRow>(
    `SELECT id, organization_id, email, password_hash,
            first_name, last_name, role, permissions,
            totp_enabled, totp_secret, pin_hash,
            last_login_at, failed_login_attempts, locked_until,
            COALESCE(location_ids, '{}') AS location_ids,
            deleted_at
     FROM employees
     WHERE id = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [employeeId],
  );
  return rows[0] ?? null;
}

async function findOrgByEmail(email: string): Promise<OrgRow | null> {
  const { rows } = await query<OrgRow>(
    `SELECT o.id, o.name, o.slug, o.deleted_at
     FROM organizations o
     JOIN employees e ON e.organization_id = o.id
     WHERE lower(e.email) = lower($1) AND e.deleted_at IS NULL
     ORDER BY e.created_at ASC
     LIMIT 1`,
    [email],
  );
  return rows[0] ?? null;
}

async function resolveOrgFromRequest(
  request: FastifyRequest,
  emailFallback?: string,
): Promise<OrgRow | null> {
  const slug = (request.headers['x-organization-slug'] as string | undefined)?.trim();
  if (slug) return findOrgBySlug(slug);
  // Fall back to email-based lookup (allows login without knowing the org slug)
  if (emailFallback) return findOrgByEmail(emailFallback);
  return null;
}

// ─── Shared login completion (used by /login, /login/mfa, /login/pin) ────────

interface LoginCompletionOpts {
  employee: EmployeeRow;
  org: OrgRow;
  request: FastifyRequest;
  reply: FastifyReply;
  locationId?: string;
  shortLived?: boolean; // true for PIN login (4h expiry, no new refresh token)
  existingSessionId?: string; // PIN login reuses existing session
}

async function completeLogin(opts: LoginCompletionOpts): Promise<FastifyReply> {
  const { employee, org, request, reply, shortLived = false, existingSessionId } = opts;

  const permissions = resolvePermissions(employee.role, employee.permissions ?? []);
  const locationIds = employee.location_ids ?? [];

  let sessionId: string;

  if (shortLived && existingSessionId) {
    sessionId = existingSessionId;
  } else {
    sessionId = crypto.randomUUID();
    const rawRefresh = generateSecureToken(32);
    const tokenHash = hashToken(rawRefresh);
    const expiresAt = new Date(Date.now() + config.REFRESH_TOKEN_EXPIRY_MS);

    await query(
      `INSERT INTO refresh_tokens (id, employee_id, token_hash, device_info, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        sessionId,
        employee.id,
        tokenHash,
        JSON.stringify({
          userAgent: request.headers['user-agent'] ?? null,
          ip: request.ip,
        }),
        expiresAt,
      ],
    );

    // Update last_login_at and reset lockout counter
    await query(
      `UPDATE employees
       SET last_login_at = now(), failed_login_attempts = 0, locked_until = NULL
       WHERE id = $1`,
      [employee.id],
    );

    // Build the refresh token JWT only when not reusing a session
    const refreshToken = signRefreshToken(employee.id, sessionId);
    const accessToken = signAccessToken({
      sub: employee.id,
      orgId: org.id,
      locationIds,
      role: employee.role,
      permissions,
      sessionId,
    });

    void createAuditLog({
      organizationId: org.id,
      actorId: employee.id,
      action: 'employee.login',
      resourceType: 'employee',
      resourceId: employee.id,
      request,
    });

    return reply.send({
      accessToken,
      refreshToken,
      expiresIn: config.ACCESS_TOKEN_EXPIRY_SECONDS,
      employee: {
        id: employee.id,
        email: employee.email,
        firstName: employee.first_name,
        lastName: employee.last_name,
        role: employee.role,
        permissions,
        locationIds,
      },
    });
  }

  // PIN login path: reuse existing session, issue a short-lived (4h) access token
  const accessToken = signAccessToken({
    sub: employee.id,
    orgId: org.id,
    locationIds,
    role: employee.role,
    permissions,
    sessionId,
  });

  void createAuditLog({
    organizationId: org.id,
    actorId: employee.id,
    action: 'employee.pin_login',
    resourceType: 'employee',
    resourceId: employee.id,
    request,
  });

  return reply.send({
    accessToken,
    expiresIn: 4 * 3600, // 4 hours
    employee: {
      id: employee.id,
      email: employee.email,
      firstName: employee.first_name,
      lastName: employee.last_name,
      role: employee.role,
      permissions,
      locationIds,
    },
  });
}

// ─── Route registration ────────────────────────────────────────────────────────

export async function registerAuthRoutes(fastify: FastifyInstance): Promise<void> {

  // ── POST /login ─────────────────────────────────────────────────────────────
  fastify.post('/login', {
    config: { rateLimit: { max: 5, timeWindow: 15 * 60 * 1000 } },
  }, async (request, reply) => {
    const body = parseBody(loginBodySchema, request.body);
    // Resolve org by slug header OR by email (so users don't need to know their slug)
    const org = await resolveOrgFromRequest(request, body.email);

    if (!org || org.deleted_at) {
      await dummyPasswordDelay();
      return reply.code(401).send(AUTH_ERROR);
    }

    const employee = await findEmployeeByEmail(org.id, body.email);

    if (!employee) {
      await dummyPasswordDelay(); // prevent timing-based enumeration
      return reply.code(401).send(AUTH_ERROR);
    }

    // Account lockout check
    if (employee.locked_until && new Date(employee.locked_until) > new Date()) {
      return reply.code(401).send(AUTH_ERROR);
    }

    const valid = await verifyPassword(body.password, employee.password_hash);

    if (!valid) {
      const newAttempts = employee.failed_login_attempts + 1;
      const locked = newAttempts >= config.LOCKOUT_MAX_ATTEMPTS;

      await query(
        `UPDATE employees
         SET failed_login_attempts = $1,
             locked_until = CASE WHEN $2 THEN now() + interval '${config.LOCKOUT_DURATION_MINUTES} minutes' ELSE locked_until END
         WHERE id = $3`,
        [newAttempts, locked, employee.id],
      );

      void createAuditLog({
        organizationId: org.id,
        actorId: employee.id,
        action: 'employee.login_failed',
        resourceType: 'employee',
        resourceId: employee.id,
        request,
        metadata: { attempt: newAttempts, locked },
      });

      return reply.code(401).send(AUTH_ERROR);
    }

    // MFA gate
    if (employee.totp_enabled) {
      const mfaToken = signMfaToken(employee.id, org.id);
      return reply.send({ requiresMfa: true, mfaToken });
    }

    return completeLogin({ employee, org, request, reply, locationId: body.locationId });
  });

  // ── POST /login/mfa ─────────────────────────────────────────────────────────
  fastify.post('/login/mfa', {
    config: { rateLimit: { max: 3, timeWindow: 5 * 60 * 1000 } },
  }, async (request, reply) => {
    const body = parseBody(loginMfaBodySchema, request.body);

    let mfaPayload;
    try {
      mfaPayload = verifyMfaToken(body.mfaToken);
    } catch {
      return reply.code(401).send(AUTH_ERROR);
    }

    const employee = await findEmployeeById(mfaPayload.sub);
    if (!employee) return reply.code(401).send(AUTH_ERROR);

    const org = await findOrgBySlug(
      (request.headers['x-organization-slug'] as string | undefined)?.trim() ?? '',
    );
    if (!org || org.id !== mfaPayload.orgId) return reply.code(401).send(AUTH_ERROR);

    let totpValid = false;

    if (employee.totp_secret) {
      try {
        const plainSecret = decryptTotpSecret(employee.totp_secret);
        totpValid = verifyTotpCode(plainSecret, body.totpCode);
      } catch {
        totpValid = false;
      }
    }

    // Fall back to backup code if TOTP failed
    if (!totpValid) {
      const normalizedCode = body.totpCode.replace(/-/g, '').toUpperCase();
      // Backup codes are 8 chars after stripping dashes; TOTP codes are 6 digits — they're distinct
      if (normalizedCode.length === 8) {
        const codeHash = hashBackupCode(normalizedCode);
        const { rows } = await query<{ id: string }>(
          `SELECT id FROM mfa_backup_codes
           WHERE employee_id = $1 AND code_hash = $2 AND used_at IS NULL
           LIMIT 1`,
          [employee.id, codeHash],
        );
        if (rows.length > 0) {
          await query(
            `UPDATE mfa_backup_codes SET used_at = now() WHERE id = $1`,
            [rows[0].id],
          );
          totpValid = true;
        }
      }
    }

    if (!totpValid) {
      void createAuditLog({
        organizationId: org.id,
        actorId: employee.id,
        action: 'employee.mfa_failed',
        resourceType: 'employee',
        resourceId: employee.id,
        request,
      });
      return reply.code(401).send(AUTH_ERROR);
    }

    return completeLogin({ employee, org, request, reply });
  });

  // ── POST /login/pin ─────────────────────────────────────────────────────────
  fastify.post('/login/pin', {
    config: { rateLimit: { max: 10, timeWindow: 5 * 60 * 1000 } },
  }, async (request, reply) => {
    const body = parseBody(loginPinBodySchema, request.body);

    // Requires an active authenticated session from the same location (X-Location-Token)
    const locationToken = request.headers['x-location-token'] as string | undefined;
    if (!locationToken) {
      return reply.code(401).send({ code: 'LOCATION_SESSION_REQUIRED', message: 'X-Location-Token header required' });
    }

    let locationSession: AccessTokenPayload;
    try {
      locationSession = verifyAccessToken(extractBearerToken(`Bearer ${locationToken}`));
    } catch {
      return reply.code(401).send(AUTH_ERROR);
    }

    if (!locationSession.locationIds.includes(body.locationId) && locationSession.locationIds.length > 0) {
      return reply.code(403).send({ code: 'FORBIDDEN', message: 'Location access denied' });
    }

    const employee = await findEmployeeById(body.employeeId);
    if (!employee || !employee.pin_hash) {
      await dummyPasswordDelay();
      return reply.code(401).send(AUTH_ERROR);
    }

    const org = await findOrgBySlug(
      (request.headers['x-organization-slug'] as string | undefined)?.trim() ?? '',
    );
    if (!org || org.id !== employee.organization_id) {
      return reply.code(401).send(AUTH_ERROR);
    }

    const pinValid = await verifyPin(body.pin, employee.pin_hash);
    if (!pinValid) {
      return reply.code(401).send(AUTH_ERROR);
    }

    return completeLogin({
      employee,
      org,
      request,
      reply,
      locationId: body.locationId,
      shortLived: true,
      existingSessionId: locationSession.sessionId,
    });
  });

  // ── POST /refresh ───────────────────────────────────────────────────────────
  fastify.post('/refresh', {
    config: { rateLimit: { max: 20, timeWindow: 60 * 1000 } },
  }, async (request, reply) => {
    const { refreshToken: rawToken } = parseBody(refreshBodySchema, request.body);

    let payload;
    try {
      payload = verifyRefreshToken(rawToken);
    } catch (err) {
      const code = err instanceof TokenExpiredError ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID';
      return reply.code(401).send({ code, message: 'Invalid refresh token' });
    }

    const tokenHash = hashToken(rawToken);
    const { rows: tokenRows } = await query<{
      id: string;
      employee_id: string;
      revoked_at: string | null;
      expires_at: string;
    }>(
      `SELECT id, employee_id, revoked_at, expires_at
       FROM refresh_tokens
       WHERE token_hash = $1
       LIMIT 1`,
      [tokenHash],
    );

    const storedToken = tokenRows[0];
    if (!storedToken || storedToken.revoked_at || new Date(storedToken.expires_at) < new Date()) {
      return reply.code(401).send({ code: 'TOKEN_INVALID', message: 'Invalid refresh token' });
    }

    const employee = await findEmployeeById(payload.sub);
    if (!employee) {
      return reply.code(401).send({ code: 'TOKEN_INVALID', message: 'Invalid refresh token' });
    }

    const org = await query<OrgRow>(
      `SELECT id, name, slug, deleted_at FROM organizations WHERE id = $1 LIMIT 1`,
      [employee.organization_id],
    ).then((r) => r.rows[0]);

    if (!org || org.deleted_at) {
      return reply.code(401).send({ code: 'TOKEN_INVALID', message: 'Invalid refresh token' });
    }

    // Token rotation — revoke old, issue new
    const newSessionId = crypto.randomUUID();
    const newRawToken = generateSecureToken(32);
    const newTokenHash = hashToken(newRawToken);
    const expiresAt = new Date(Date.now() + config.REFRESH_TOKEN_EXPIRY_MS);

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`,
        [storedToken.id],
      );
      await client.query(
        `INSERT INTO refresh_tokens (id, employee_id, token_hash, device_info, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          newSessionId,
          employee.id,
          newTokenHash,
          JSON.stringify({ userAgent: request.headers['user-agent'] ?? null, ip: request.ip }),
          expiresAt,
        ],
      );
    });

    const permissions = resolvePermissions(employee.role, employee.permissions ?? []);
    const locationIds = employee.location_ids ?? [];

    const accessToken = signAccessToken({
      sub: employee.id,
      orgId: org.id,
      locationIds,
      role: employee.role,
      permissions,
      sessionId: newSessionId,
    });

    return reply.send({
      accessToken,
      refreshToken: newRawToken,
      expiresIn: config.ACCESS_TOKEN_EXPIRY_SECONDS,
      employee: {
        id: employee.id,
        email: employee.email,
        firstName: employee.first_name,
        lastName: employee.last_name,
        role: employee.role,
        permissions,
        locationIds,
      },
    });
  });

  // ── POST /logout ─────────────────────────────────────────────────────────────
  fastify.post('/logout', { preHandler: [authenticate] }, async (request, reply) => {
    const user = (request as FastifyRequest & { user: AccessTokenPayload }).user;

    await query(
      `UPDATE refresh_tokens SET revoked_at = now()
       WHERE id = $1 AND revoked_at IS NULL`,
      [user.sessionId],
    );

    void createAuditLog({
      organizationId: user.orgId,
      actorId: user.sub,
      action: 'employee.logout',
      resourceType: 'employee',
      resourceId: user.sub,
      request,
    });

    return reply.send({ success: true });
  });

  // ── POST /logout/all ──────────────────────────────────────────────────────────
  fastify.post('/logout/all', { preHandler: [authenticate] }, async (request, reply) => {
    const user = (request as FastifyRequest & { user: AccessTokenPayload }).user;

    await query(
      `UPDATE refresh_tokens SET revoked_at = now()
       WHERE employee_id = $1 AND revoked_at IS NULL`,
      [user.sub],
    );

    void createAuditLog({
      organizationId: user.orgId,
      actorId: user.sub,
      action: 'employee.logout_all',
      resourceType: 'employee',
      resourceId: user.sub,
      request,
    });

    return reply.send({ success: true });
  });

  // ── POST /mfa/setup ───────────────────────────────────────────────────────────
  fastify.post('/mfa/setup', { preHandler: [authenticate] }, async (request, reply) => {
    const user = (request as FastifyRequest & { user: AccessTokenPayload }).user;
    const employee = await findEmployeeById(user.sub);
    if (!employee) return reply.code(401).send(AUTH_ERROR);

    const org = await findOrgBySlug(
      (request.headers['x-organization-slug'] as string | undefined)?.trim() ?? '',
    );
    if (!org) return reply.code(400).send({ code: 'ORG_REQUIRED', message: 'Organization header required' });

    const plainSecret = generateTotpSecret();
    const encryptedSecret = encryptTotpSecret(plainSecret);
    const qrUri = generateTotpQrUri(plainSecret, employee.email, org.name);

    // Store encrypted secret but leave totp_enabled = false until /mfa/verify confirms it
    await query(
      `UPDATE employees SET totp_secret = $1 WHERE id = $2`,
      [encryptedSecret, employee.id],
    );

    // Return the plain secret once — after this, it's only stored encrypted
    return reply.send({ secret: plainSecret, qrUri });
  });

  // ── POST /mfa/verify ──────────────────────────────────────────────────────────
  fastify.post('/mfa/verify', { preHandler: [authenticate] }, async (request, reply) => {
    const user = (request as FastifyRequest & { user: AccessTokenPayload }).user;
    const { code } = parseBody(mfaVerifySchema, request.body);

    const employee = await findEmployeeById(user.sub);
    if (!employee || !employee.totp_secret) {
      return reply.code(400).send({ code: 'MFA_NOT_SETUP', message: 'MFA setup has not been started' });
    }

    const plainSecret = decryptTotpSecret(employee.totp_secret);
    if (!verifyTotpCode(plainSecret, code)) {
      return reply.code(401).send({ code: 'INVALID_CODE', message: 'Invalid TOTP code' });
    }

    // Generate backup codes
    const plainCodes = generateBackupCodes(8);
    const codeHashes = plainCodes.map(hashBackupCode);

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE employees SET totp_enabled = true WHERE id = $1`,
        [employee.id],
      );
      // Clear existing backup codes and insert fresh ones
      await client.query(
        `DELETE FROM mfa_backup_codes WHERE employee_id = $1`,
        [employee.id],
      );
      for (const codeHash of codeHashes) {
        await client.query(
          `INSERT INTO mfa_backup_codes (employee_id, code_hash) VALUES ($1, $2)`,
          [employee.id, codeHash],
        );
      }
    });

    void createAuditLog({
      organizationId: user.orgId,
      actorId: user.sub,
      action: 'employee.mfa_enabled',
      resourceType: 'employee',
      resourceId: user.sub,
      request,
    });

    return reply.send({ success: true, backupCodes: plainCodes });
  });

  // ── POST /mfa/disable ─────────────────────────────────────────────────────────
  fastify.post('/mfa/disable', { preHandler: [authenticate] }, async (request, reply) => {
    const user = (request as FastifyRequest & { user: AccessTokenPayload }).user;
    const { password } = parseBody(mfaDisableSchema, request.body);

    const employee = await findEmployeeById(user.sub);
    if (!employee) return reply.code(401).send(AUTH_ERROR);

    const valid = await verifyPassword(password, employee.password_hash);
    if (!valid) {
      return reply.code(401).send(AUTH_ERROR);
    }

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE employees
         SET totp_enabled = false, totp_secret = NULL
         WHERE id = $1`,
        [employee.id],
      );
      await client.query(
        `DELETE FROM mfa_backup_codes WHERE employee_id = $1`,
        [employee.id],
      );
      await client.query(
        `UPDATE refresh_tokens SET revoked_at = now()
         WHERE employee_id = $1 AND revoked_at IS NULL`,
        [employee.id],
      );
    });

    void createAuditLog({
      organizationId: user.orgId,
      actorId: user.sub,
      action: 'employee.mfa_disabled',
      resourceType: 'employee',
      resourceId: user.sub,
      request,
    });

    return reply.send({ success: true });
  });

  // ── POST /password/change ─────────────────────────────────────────────────────
  fastify.post('/password/change', { preHandler: [authenticate] }, async (request, reply) => {
    const user = (request as FastifyRequest & { user: AccessTokenPayload }).user;
    const body = parseBody(passwordChangeSchema, request.body);

    const employee = await findEmployeeById(user.sub);
    if (!employee) return reply.code(401).send(AUTH_ERROR);

    const currentValid = await verifyPassword(body.currentPassword, employee.password_hash);
    if (!currentValid) {
      return reply.code(401).send({ code: 'INVALID_CREDENTIALS', message: 'Current password is incorrect' });
    }

    const samePassword = await verifyPassword(body.newPassword, employee.password_hash);
    if (samePassword) {
      return reply.code(400).send({ code: 'SAME_PASSWORD', message: 'New password must differ from current password' });
    }

    const newHash = await hashPassword(body.newPassword);

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE employees SET password_hash = $1 WHERE id = $2`,
        [newHash, employee.id],
      );
      await client.query(
        `UPDATE refresh_tokens SET revoked_at = now()
         WHERE employee_id = $1 AND revoked_at IS NULL`,
        [employee.id],
      );
    });

    void createAuditLog({
      organizationId: user.orgId,
      actorId: user.sub,
      action: 'employee.password_changed',
      resourceType: 'employee',
      resourceId: user.sub,
      request,
    });

    return reply.send({ success: true });
  });

  // ── POST /password/reset/request ──────────────────────────────────────────────
  fastify.post('/password/reset/request', {
    config: { rateLimit: { max: 3, timeWindow: 15 * 60 * 1000 } },
  }, async (request, reply) => {
    const { email } = parseBody(passwordResetRequestSchema, request.body);

    // Always return 200 — never reveal whether an email exists
    const org = await resolveOrgFromRequest(request);

    if (org && !org.deleted_at) {
      const employee = await findEmployeeByEmail(org.id, email);

      if (employee) {
        const rawToken = generateSecureToken(32);
        const tokenHash = hashToken(rawToken);
        const expiresAt = new Date(Date.now() + config.PASSWORD_RESET_EXPIRY_MS);

        try {
          await query(
            `INSERT INTO password_reset_tokens (employee_id, token_hash, expires_at)
             VALUES ($1, $2, $3)`,
            [employee.id, tokenHash, expiresAt],
          );

          // Fire-and-forget — do not await, do not fail the request
          void sendPasswordResetEmail(employee.email, rawToken, org.name);

          void createAuditLog({
            organizationId: org.id,
            actorId: employee.id,
            action: 'employee.password_reset_requested',
            resourceType: 'employee',
            resourceId: employee.id,
            request,
          });
        } catch {
          // Swallow DB errors — no enumeration
        }
      }
    }

    return reply.send({ success: true });
  });

  // ── POST /password/reset/confirm ──────────────────────────────────────────────
  fastify.post('/password/reset/confirm', {
    config: { rateLimit: { max: 5, timeWindow: 15 * 60 * 1000 } },
  }, async (request, reply) => {
    const body = parseBody(passwordResetConfirmSchema, request.body);
    const tokenHash = hashToken(body.token);

    const { rows } = await query<{
      id: string;
      employee_id: string;
      expires_at: string;
      used_at: string | null;
    }>(
      `SELECT id, employee_id, expires_at, used_at
       FROM password_reset_tokens
       WHERE token_hash = $1
       LIMIT 1`,
      [tokenHash],
    );

    const resetToken = rows[0];

    if (
      !resetToken ||
      resetToken.used_at ||
      new Date(resetToken.expires_at) < new Date()
    ) {
      return reply.code(400).send({
        code: 'TOKEN_INVALID',
        message: 'Reset token is invalid or has expired',
      });
    }

    const newHash = await hashPassword(body.newPassword);

    const employee = await findEmployeeById(resetToken.employee_id);
    if (!employee) {
      return reply.code(400).send({ code: 'TOKEN_INVALID', message: 'Reset token is invalid or has expired' });
    }

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE employees SET password_hash = $1 WHERE id = $2`,
        [newHash, resetToken.employee_id],
      );
      await client.query(
        `UPDATE password_reset_tokens SET used_at = now() WHERE id = $1`,
        [resetToken.id],
      );
      await client.query(
        `UPDATE refresh_tokens SET revoked_at = now()
         WHERE employee_id = $1 AND revoked_at IS NULL`,
        [resetToken.employee_id],
      );
    });

    const { rows: orgRows } = await query<{ id: string }>(
      `SELECT id FROM organizations WHERE id = $1 LIMIT 1`,
      [employee.organization_id],
    );

    void createAuditLog({
      organizationId: employee.organization_id,
      actorId: employee.id,
      action: 'employee.password_reset_completed',
      resourceType: 'employee',
      resourceId: employee.id,
      request,
    });

    return reply.send({ success: true });
  });
}
