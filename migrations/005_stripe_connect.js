'use strict';

/**
 * Migration 005 — Stripe Connect + Terminal readers
 *
 * Adds Connect columns to organizations and creates terminal_readers table.
 */

/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  // ── 1. organizations: Stripe Connect fields ───────────────────────────────
  pgm.sql(`
    ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS stripe_connect_account_id   varchar(255),
      ADD COLUMN IF NOT EXISTS stripe_connect_status       varchar(50)  NOT NULL DEFAULT 'not_connected',
      ADD COLUMN IF NOT EXISTS stripe_connect_enabled_at   timestamptz,
      ADD COLUMN IF NOT EXISTS payment_processing_enabled  boolean      NOT NULL DEFAULT false
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_stripe_connect
      ON organizations(stripe_connect_account_id)
      WHERE stripe_connect_account_id IS NOT NULL
  `);

  // ── 2. terminal_readers ───────────────────────────────────────────────────
  pgm.sql(`
    CREATE TABLE terminal_readers (
      id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id  uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      location_id      uuid          NOT NULL REFERENCES locations(id)     ON DELETE CASCADE,
      stripe_reader_id varchar(255)  NOT NULL,
      label            varchar(255)  NOT NULL,
      model            varchar(100)  NOT NULL,
      status           varchar(50)   NOT NULL DEFAULT 'unknown',
      last_seen_at     timestamptz,
      metadata         jsonb         NOT NULL DEFAULT '{}',
      created_at       timestamptz   NOT NULL DEFAULT now(),
      updated_at       timestamptz   NOT NULL DEFAULT now(),
      CONSTRAINT terminal_readers_stripe_id_unique UNIQUE (stripe_reader_id)
    )
  `);

  pgm.sql(`CREATE INDEX idx_terminal_readers_org ON terminal_readers(organization_id)`);
  pgm.sql(`CREATE INDEX idx_terminal_readers_loc ON terminal_readers(location_id)`);
};

/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS terminal_readers CASCADE`);
  pgm.sql(`DROP INDEX IF EXISTS idx_organizations_stripe_connect`);
  pgm.sql(`
    ALTER TABLE organizations
      DROP COLUMN IF EXISTS payment_processing_enabled,
      DROP COLUMN IF EXISTS stripe_connect_enabled_at,
      DROP COLUMN IF EXISTS stripe_connect_status,
      DROP COLUMN IF EXISTS stripe_connect_account_id
  `);
};
