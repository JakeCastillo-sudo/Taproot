/**
 * 022 — Admin users + helpdesk (Executive / Support Portal)
 *
 * Admin users are COMPLETELY separate from organization employees:
 *   - separate table (admin_users) + separate sessions (admin_sessions)
 *   - separate JWT secret (ADMIN_JWT_SECRET), issuer/audience
 *   - super-admin scope across ALL organizations
 *
 * Also creates the helpdesk schema (tickets + messages) and an
 * impersonation audit log.
 *
 * The seeded super admin is `admin@taproot-pos.com` / `TaprootAdmin2026!`
 * (real bcrypt cost-12 hash below — login works immediately).
 * CHANGE THIS PASSWORD AFTER FIRST LOGIN.
 */

exports.up = (pgm) => {
  // ── admin_users — separate from org employees ────────────────────────────
  pgm.createTable('admin_users', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    email: { type: 'varchar(255)', notNull: true, unique: true },
    password_hash: { type: 'varchar(255)', notNull: true },
    first_name: { type: 'varchar(100)', notNull: true },
    last_name: { type: 'varchar(100)', notNull: true },
    // Roles: super_admin, support, read_only
    role: { type: 'varchar(50)', notNull: true, default: 'support' },
    is_active: { type: 'boolean', notNull: true, default: true },
    mfa_secret: { type: 'varchar(255)' },
    mfa_enabled: { type: 'boolean', notNull: true, default: false },
    last_login_at: { type: 'timestamptz' },
    failed_login_attempts: { type: 'integer', notNull: true, default: 0 },
    locked_until: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('admin_users', 'admin_users_role_check',
    "CHECK (role IN ('super_admin','support','read_only'))");

  // ── admin_sessions — separate from org refresh_tokens ────────────────────
  pgm.createTable('admin_sessions', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    admin_user_id: {
      type: 'uuid', notNull: true,
      references: 'admin_users(id)', onDelete: 'CASCADE',
    },
    token_hash: { type: 'varchar(255)', notNull: true, unique: true },
    ip_address: { type: 'varchar(45)' },
    user_agent: { type: 'text' },
    expires_at: { type: 'timestamptz', notNull: true },
    revoked_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // ── admin_impersonation_log — track admin access into customer orgs ──────
  pgm.createTable('admin_impersonation_log', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    admin_user_id: { type: 'uuid', notNull: true, references: 'admin_users(id)' },
    organization_id: {
      type: 'uuid', notNull: true,
      references: 'organizations(id)',
    },
    reason: { type: 'text' },
    started_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    ended_at: { type: 'timestamptz' },
  });

  // ── helpdesk_tickets ─────────────────────────────────────────────────────
  pgm.createTable('helpdesk_tickets', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    organization_id: {
      type: 'uuid', references: 'organizations(id)', onDelete: 'SET NULL',
    },
    assigned_to: {
      type: 'uuid', references: 'admin_users(id)', onDelete: 'SET NULL',
    },
    subject: { type: 'varchar(500)', notNull: true },
    status: { type: 'varchar(50)', notNull: true, default: 'open' },
    priority: { type: 'varchar(50)', notNull: true, default: 'normal' },
    channel: { type: 'varchar(50)', default: 'admin_portal' },
    resolved_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('helpdesk_tickets', 'helpdesk_tickets_status_check',
    "CHECK (status IN ('open','in_progress','resolved','closed'))");
  pgm.addConstraint('helpdesk_tickets', 'helpdesk_tickets_priority_check',
    "CHECK (priority IN ('low','normal','high','critical'))");

  // ── helpdesk_messages ────────────────────────────────────────────────────
  pgm.createTable('helpdesk_messages', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    ticket_id: {
      type: 'uuid', notNull: true,
      references: 'helpdesk_tickets(id)', onDelete: 'CASCADE',
    },
    // sender_type: admin | customer | ai  (sender_id null for AI)
    sender_type: { type: 'varchar(20)', notNull: true },
    sender_id: { type: 'uuid' },
    content: { type: 'text', notNull: true },
    // ai_context stores what the AI used to generate the response
    ai_context: { type: 'jsonb' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('helpdesk_messages', 'helpdesk_messages_sender_type_check',
    "CHECK (sender_type IN ('admin','customer','ai'))");

  // ── Indexes ──────────────────────────────────────────────────────────────
  pgm.createIndex('admin_users', 'email');
  pgm.createIndex('admin_sessions', 'token_hash');
  pgm.createIndex('admin_sessions', 'admin_user_id');
  pgm.createIndex('admin_impersonation_log', 'admin_user_id');
  pgm.createIndex('admin_impersonation_log', 'organization_id');
  pgm.createIndex('helpdesk_tickets', 'organization_id');
  pgm.createIndex('helpdesk_tickets', 'assigned_to');
  pgm.createIndex('helpdesk_tickets', 'status');
  pgm.createIndex('helpdesk_messages', 'ticket_id');

  // ── Seed first super admin ───────────────────────────────────────────────
  // Email:    admin@taproot-pos.com
  // Password: TaprootAdmin2026!   (real bcrypt cost-12 hash — CHANGE AFTER FIRST LOGIN)
  pgm.sql(`
    INSERT INTO admin_users (email, password_hash, first_name, last_name, role)
    VALUES (
      'admin@taproot-pos.com',
      '$2b$12$E24Y1nQ1rk6.bhgLA.k.TuLxIv/Mcv.AK7eGCJ032TLUN0XESkSeK',
      'Taproot',
      'Admin',
      'super_admin'
    ) ON CONFLICT (email) DO NOTHING
  `);
};

exports.down = (pgm) => {
  pgm.dropTable('helpdesk_messages');
  pgm.dropTable('helpdesk_tickets');
  pgm.dropTable('admin_impersonation_log');
  pgm.dropTable('admin_sessions');
  pgm.dropTable('admin_users');
};
