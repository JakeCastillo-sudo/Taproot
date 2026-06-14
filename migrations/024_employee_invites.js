/**
 * 024 — Employee invites + email audit log
 *
 * NOTE: there is no 023 migration (sequence jumps 022 -> 024). The weekly
 * campaign feature was reconciled onto the shared email_logs ledger created
 * below — there is no separate campaign_sends table.
 *
 * Adds:
 *   - invite columns on employees (email-based invite → verify → accept flow)
 *   - email_logs table (best-effort audit trail + onboarding-sequence dedup source)
 *
 * employees uses deleted_at for soft-delete (NO is_active column).
 */

exports.up = (pgm) => {
  pgm.addColumns('employees', {
    invite_token: { type: 'varchar(255)', notNull: false, default: null },
    invite_token_expires_at: { type: 'timestamptz', notNull: false, default: null },
    invite_sent_at: { type: 'timestamptz', notNull: false, default: null },
    invite_accepted_at: { type: 'timestamptz', notNull: false, default: null },
    account_setup_required: { type: 'boolean', notNull: true, default: false },
  });

  pgm.createIndex('employees', 'invite_token', {
    name: 'idx_employees_invite_token',
    unique: true,
    where: 'invite_token IS NOT NULL',
  });

  pgm.createTable('email_logs', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    organization_id: {
      type: 'uuid',
      references: 'organizations(id)',
      onDelete: 'CASCADE',
      notNull: false,
    },
    recipient_email: { type: 'varchar(255)', notNull: true },
    template_name: { type: 'varchar(100)', notNull: true },
    resend_id: { type: 'varchar(255)' },
    status: { type: 'varchar(50)', notNull: true, default: 'sent' },
    error_message: { type: 'text' },
    metadata: { type: 'jsonb' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('email_logs', 'organization_id');
  pgm.createIndex('email_logs', 'recipient_email');
  pgm.createIndex('email_logs', 'created_at');
};

exports.down = (pgm) => {
  pgm.dropTable('email_logs');
  pgm.dropIndex('employees', 'invite_token', { name: 'idx_employees_invite_token' });
  pgm.dropColumns('employees', [
    'invite_token',
    'invite_token_expires_at',
    'invite_sent_at',
    'invite_accepted_at',
    'account_setup_required',
  ]);
};
