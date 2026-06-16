/**
 * 025 — Email unsubscribe ledger (CAN-SPAM compliance)
 *
 * One row per opted-out email. Campaign + onboarding sends check this table and
 * skip unsubscribed addresses; transactional email (invites, receipts, password
 * resets, security alerts) is NOT gated by it.
 */

exports.up = (pgm) => {
  pgm.createTable('email_unsubscribes', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    email: { type: 'varchar(255)', notNull: true, unique: true },
    organization_id: {
      type: 'uuid',
      references: 'organizations(id)',
      onDelete: 'SET NULL',
      notNull: false,
    },
    unsubscribed_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    reason: { type: 'varchar(255)', notNull: false },
  });

  pgm.createIndex('email_unsubscribes', 'email', {
    name: 'idx_email_unsubscribes_email',
    unique: true,
  });
};

exports.down = (pgm) => {
  pgm.dropTable('email_unsubscribes');
};
