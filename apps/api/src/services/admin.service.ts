/**
 * Admin service — platform-wide operations for the Taproot internal team.
 *
 * This service is reachable ONLY through the admin auth middleware. It is
 * deliberately separate from the org-scoped services: admins are cross-org
 * super-users, so these queries intentionally span every organization.
 */
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { query } from '../db/client';
import { createAuditLog } from '../auth/audit';

const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET
  ?? `${process.env.JWT_SECRET ?? ''}_admin`;

// ── Auth ─────────────────────────────────────────────────────────────────────

export interface AdminLoginResult {
  accessToken: string;
  admin: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
  };
}

export async function adminLogin(
  email: string,
  password: string,
  ipAddress: string,
  userAgent: string,
): Promise<AdminLoginResult> {
  const result = await query(
    `SELECT * FROM admin_users WHERE email = $1 AND is_active = true`,
    [email.toLowerCase().trim()],
  );

  const admin = result.rows[0];
  if (!admin) {
    throw new Error('INVALID_CREDENTIALS');
  }

  // Lockout check.
  if (admin.locked_until && new Date(admin.locked_until) > new Date()) {
    const mins = Math.ceil(
      (new Date(admin.locked_until).getTime() - Date.now()) / 60000,
    );
    throw new Error(`ACCOUNT_LOCKED:${mins}`);
  }

  const valid = await bcrypt.compare(password, admin.password_hash);
  if (!valid) {
    const attempts = admin.failed_login_attempts + 1;
    const lockUntil = attempts >= 5
      ? new Date(Date.now() + 15 * 60 * 1000)
      : null;
    await query(
      `UPDATE admin_users
         SET failed_login_attempts = $1, locked_until = $2
       WHERE id = $3`,
      [attempts, lockUntil, admin.id],
    );
    throw new Error('INVALID_CREDENTIALS');
  }

  // Reset counters on success.
  await query(
    `UPDATE admin_users
       SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW()
     WHERE id = $1`,
    [admin.id],
  );

  const sessionId = crypto.randomUUID();
  const token = jwt.sign(
    { sub: admin.id, email: admin.email, role: admin.role, sessionId },
    ADMIN_JWT_SECRET,
    {
      algorithm: 'HS256',
      expiresIn: '8h',
      issuer: 'taproot-admin',
      audience: 'taproot-admin-api',
    },
  );

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await query(
    `INSERT INTO admin_sessions
       (admin_user_id, token_hash, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + INTERVAL '8 hours')`,
    [admin.id, tokenHash, ipAddress, userAgent],
  );

  return {
    accessToken: token,
    admin: {
      id: admin.id,
      email: admin.email,
      firstName: admin.first_name,
      lastName: admin.last_name,
      role: admin.role,
    },
  };
}

// ── Organization Management ───────────────────────────────────────────────────

export interface ListOrganizationsParams {
  search?: string;
  status?: string;
  plan?: string;
  page?: number;
  limit?: number;
}

export async function listOrganizations(params: ListOrganizationsParams) {
  const { search, status, plan, page = 1, limit = 50 } = params;
  const offset = (page - 1) * limit;

  let whereClause = 'WHERE o.deleted_at IS NULL';
  const values: unknown[] = [];
  let paramIdx = 1;

  if (search) {
    whereClause += ` AND (
      o.name ILIKE $${paramIdx} OR
      o.slug ILIKE $${paramIdx} OR
      o.billing_email ILIKE $${paramIdx}
    )`;
    values.push(`%${search}%`);
    paramIdx++;
  }

  if (status) {
    whereClause += ` AND o.subscription_status = $${paramIdx}`;
    values.push(status);
    paramIdx++;
  }

  if (plan) {
    whereClause += ` AND o.plan = $${paramIdx}`;
    values.push(plan);
    paramIdx++;
  }

  const result = await query(
    `SELECT
       o.id, o.name, o.slug, o.plan,
       o.subscription_status, o.subscription_plan,
       o.trial_ends_at, o.billing_email,
       o.stripe_connect_status, o.created_at,
       COUNT(DISTINCT e.id) AS employee_count,
       COUNT(DISTINCT ord.id) FILTER (
         WHERE ord.created_at > NOW() - INTERVAL '30 days'
       ) AS order_count_30d,
       COALESCE(SUM(ord.total) FILTER (
         WHERE ord.created_at > NOW() - INTERVAL '30 days'
           AND ord.status = 'completed'
       ), 0) AS revenue_30d,
       MAX(ord.created_at) AS last_order_at
     FROM organizations o
     LEFT JOIN employees e ON e.organization_id = o.id AND e.deleted_at IS NULL
     LEFT JOIN orders ord ON ord.organization_id = o.id
     ${whereClause}
     GROUP BY o.id
     ORDER BY o.created_at DESC
     LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    [...values, limit, offset],
  );

  const countResult = await query(
    `SELECT COUNT(*) FROM organizations o ${whereClause}`,
    values,
  );

  return {
    organizations: result.rows,
    total: parseInt(countResult.rows[0].count, 10),
    page,
    limit,
  };
}

export async function getOrganizationDetail(orgId: string) {
  const org = await query(
    `SELECT o.*,
       COUNT(DISTINCT e.id) AS employee_count,
       COUNT(DISTINCT ord.id) AS total_orders,
       COALESCE(SUM(ord.total) FILTER (WHERE ord.status = 'completed'), 0) AS total_revenue,
       COUNT(DISTINCT p.id) AS product_count,
       COUNT(DISTINCT c.id) AS customer_count
     FROM organizations o
     LEFT JOIN employees e ON e.organization_id = o.id AND e.deleted_at IS NULL
     LEFT JOIN orders ord ON ord.organization_id = o.id
     LEFT JOIN products p ON p.organization_id = o.id AND p.deleted_at IS NULL
     LEFT JOIN customers c ON c.organization_id = o.id AND c.deleted_at IS NULL
     WHERE o.id = $1
     GROUP BY o.id`,
    [orgId],
  );

  if (!org.rows[0]) throw new Error('NOT_FOUND');

  const employees = await query(
    `SELECT id, email, first_name, last_name, role,
       last_login_at, created_at, deleted_at
     FROM employees
     WHERE organization_id = $1
     ORDER BY created_at`,
    [orgId],
  );

  const recentOrders = await query(
    `SELECT id, order_number, status, total, created_at
     FROM orders
     WHERE organization_id = $1
     ORDER BY created_at DESC
     LIMIT 10`,
    [orgId],
  );

  const auditLog = await query(
    `SELECT action, actor_id, resource_type, resource_id, created_at, metadata
     FROM audit_logs
     WHERE organization_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [orgId],
  );

  return {
    ...org.rows[0],
    employees: employees.rows,
    recentOrders: recentOrders.rows,
    auditLog: auditLog.rows,
  };
}

export interface UpdateOrganizationInput {
  name?: string;
  plan?: string;
  subscriptionStatus?: string;
  billingEmail?: string;
  notes?: string;
}

export async function updateOrganization(
  orgId: string,
  updates: UpdateOrganizationInput,
  adminId: string,
): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (updates.name) {
    fields.push(`name = $${idx++}`);
    values.push(updates.name);
  }
  if (updates.plan) {
    fields.push(`plan = $${idx++}`);
    values.push(updates.plan);
  }
  if (updates.subscriptionStatus) {
    fields.push(`subscription_status = $${idx++}`);
    values.push(updates.subscriptionStatus);
  }
  if (updates.billingEmail) {
    fields.push(`billing_email = $${idx++}`);
    values.push(updates.billingEmail);
  }

  if (fields.length === 0) return;

  values.push(orgId);
  await query(
    `UPDATE organizations
       SET ${fields.join(', ')}, updated_at = NOW()
     WHERE id = $${idx}`,
    values,
  );

  // Record the admin action in the org's audit trail.
  // actor_type MUST be one of ('employee','system','api') per the audit_logs
  // CHECK constraint — admin actions are logged as 'system' with the admin id.
  await createAuditLog({
    organizationId: orgId,
    actorId: adminId,
    actorType: 'system',
    action: 'admin.org.updated',
    resourceType: 'organization',
    resourceId: orgId,
    afterState: updates as Record<string, unknown>,
    metadata: { adminId, source: 'admin_portal' },
  });
}

// ── Impersonation ─────────────────────────────────────────────────────────────

export async function impersonateOrganization(
  adminId: string,
  orgId: string,
  reason: string,
): Promise<string> {
  const ownerResult = await query(
    `SELECT e.*, o.slug
     FROM employees e
     JOIN organizations o ON o.id = e.organization_id
     WHERE e.organization_id = $1
       AND e.role = 'owner'
       AND e.deleted_at IS NULL
     LIMIT 1`,
    [orgId],
  );

  const owner = ownerResult.rows[0];
  if (!owner) {
    throw new Error('No owner found for organization');
  }

  await query(
    `INSERT INTO admin_impersonation_log (admin_user_id, organization_id, reason)
     VALUES ($1, $2, $3)`,
    [adminId, orgId, reason],
  );

  // Short-lived (1h) org token granting owner access, flagged as impersonation.
  const token = jwt.sign(
    {
      sub: owner.id,
      orgId: owner.organization_id,
      locationIds: owner.location_ids,
      role: owner.role,
      permissions: [],
      sessionId: crypto.randomUUID(),
      impersonatedBy: adminId,
      isImpersonation: true,
    },
    process.env.JWT_SECRET as string,
    {
      algorithm: 'HS256',
      expiresIn: '1h',
      issuer: 'taproot-pos',
      audience: 'taproot-api',
    },
  );

  return token;
}

// ── Platform Metrics ────────────────────────────────────────────────────────

export async function getPlatformMetrics() {
  const [orgs, revenue, orders, users] = await Promise.all([
    query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE subscription_status = 'active') AS active,
        COUNT(*) FILTER (WHERE subscription_status = 'trialing') AS trialing,
        COUNT(*) FILTER (
          WHERE subscription_status IN ('cancelled','past_due','unpaid')
        ) AS churned,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') AS new_30d
      FROM organizations
      WHERE deleted_at IS NULL
    `),
    query(`
      SELECT
        COALESCE(SUM(total) FILTER (
          WHERE status = 'completed' AND created_at > NOW() - INTERVAL '30 days'
        ), 0) AS mrr_proxy,
        COALESCE(SUM(total) FILTER (
          WHERE status = 'completed' AND created_at > NOW() - INTERVAL '7 days'
        ), 0) AS revenue_7d,
        COUNT(*) FILTER (
          WHERE status = 'completed' AND created_at > NOW() - INTERVAL '30 days'
        ) AS orders_30d
      FROM orders
    `),
    query(`
      SELECT
        COUNT(*) AS total_orders,
        AVG(total) AS avg_order_value,
        COUNT(DISTINCT organization_id) AS active_orgs
      FROM orders
      WHERE status = 'completed' AND created_at > NOW() - INTERVAL '30 days'
    `),
    query(`
      SELECT COUNT(*) AS total FROM employees WHERE deleted_at IS NULL
    `),
  ]);

  return {
    organizations: orgs.rows[0],
    revenue: revenue.rows[0],
    orders: orders.rows[0],
    users: users.rows[0],
  };
}
