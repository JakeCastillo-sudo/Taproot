/**
 * 027 — QuickBooks Online integration
 *
 * NOTE: highest prior migration is 025 (023 was discarded, 026 left free for a
 * possible parallel session). node-pg-migrate orders by filename, so the gap is
 * harmless.
 *
 * - quickbooks_connections: one row per org (OAuth tokens + sync settings)
 * - quickbooks_sync_log: per-day sync outcome (success | failed | partial)
 */

exports.up = (pgm) => {
  pgm.createTable('quickbooks_connections', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    organization_id: {
      type: 'uuid',
      references: 'organizations(id)',
      onDelete: 'CASCADE',
      notNull: true,
      unique: true,
    },
    realm_id: { type: 'varchar(255)', notNull: true, comment: 'QuickBooks company ID' },
    access_token: { type: 'text' },
    refresh_token: { type: 'text' },
    token_expires_at: { type: 'timestamptz' },
    last_synced_at: { type: 'timestamptz' },
    sync_enabled: { type: 'boolean', default: true },
    settings: { type: 'jsonb', default: '{}', comment: 'income_account_id, etc.' },
    created_at: { type: 'timestamptz', default: pgm.func('now()') },
  });

  pgm.createTable('quickbooks_sync_log', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    organization_id: {
      type: 'uuid',
      references: 'organizations(id)',
      onDelete: 'CASCADE',
    },
    sync_date: { type: 'date', notNull: true },
    status: { type: 'varchar(50)', notNull: true, comment: 'success | failed | partial' },
    records_synced: { type: 'integer', default: 0 },
    error_message: { type: 'text' },
    created_at: { type: 'timestamptz', default: pgm.func('now()') },
  });

  pgm.createIndex('quickbooks_sync_log', ['organization_id', 'sync_date']);
};

exports.down = (pgm) => {
  pgm.dropTable('quickbooks_sync_log');
  pgm.dropTable('quickbooks_connections');
};
