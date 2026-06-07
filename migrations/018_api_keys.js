/**
 * 018 — Public API keys + outbound webhooks (S8-04)
 *
 * api_keys:  hashed bearer keys (taproot_live_*) with scoped permissions.
 *            Only the SHA-256 hash is stored; the full key is shown once.
 * webhooks:  outbound event subscriptions with HMAC signing secrets.
 */

exports.up = (pgm) => {
  pgm.createTable('api_keys', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    organization_id: {
      type: 'uuid',
      notNull: true,
      references: 'organizations(id)',
      onDelete: 'CASCADE',
    },
    name: { type: 'varchar(255)', notNull: true },
    key_hash: { type: 'varchar(255)', notNull: true },
    key_prefix: { type: 'varchar(20)', notNull: true },
    permissions: {
      type: 'varchar(100)[]',
      notNull: true,
      default: '{}',
    },
    last_used_at: { type: 'timestamptz' },
    expires_at: { type: 'timestamptz' },
    created_by: {
      type: 'uuid',
      references: 'employees(id)',
      onDelete: 'SET NULL',
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    revoked_at: { type: 'timestamptz' },
  });

  pgm.createTable('webhooks', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    organization_id: {
      type: 'uuid',
      notNull: true,
      references: 'organizations(id)',
      onDelete: 'CASCADE',
    },
    url: { type: 'varchar(1000)', notNull: true },
    events: {
      type: 'varchar(100)[]',
      notNull: true,
    },
    secret: { type: 'varchar(255)', notNull: true },
    is_active: {
      type: 'boolean',
      notNull: true,
      default: true,
    },
    last_triggered_at: { type: 'timestamptz' },
    failure_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('api_keys', 'key_hash', { unique: true });
  pgm.createIndex('api_keys', 'organization_id');
  pgm.createIndex('webhooks', 'organization_id');
};

exports.down = (pgm) => {
  pgm.dropTable('webhooks');
  pgm.dropTable('api_keys');
};
