/**
 * Migration 007 — Database security: least-privilege application user.
 *
 * Creates a dedicated `taproot_app` Postgres role with minimal permissions:
 *  - SELECT / INSERT / UPDATE / DELETE on all tables
 *  - USAGE / SELECT on all sequences
 *  - REVOKE UPDATE / DELETE on immutable audit tables
 *    (audit_logs, inventory_movements, sync_events)
 *
 * Run as a Postgres superuser. The app user's password is intentionally set to
 * a placeholder — replace with a strong password before production deployment.
 *
 * NOTE: Idempotent — CREATE ROLE uses IF NOT EXISTS and GRANTs are safe to
 * repeat. Running this migration twice will not cause errors.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  // ── Create application user ───────────────────────────────────────────────
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_roles WHERE rolname = 'taproot_app'
      ) THEN
        CREATE ROLE taproot_app WITH LOGIN
          PASSWORD 'CHANGE_BEFORE_PRODUCTION'
          NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
      END IF;
    END
    $$;
  `);

  // ── Connect + schema usage ────────────────────────────────────────────────
  pgm.sql(`
    GRANT CONNECT ON DATABASE CURRENT_DATABASE() TO taproot_app;
    GRANT USAGE ON SCHEMA public TO taproot_app;
  `);

  // ── DML on all existing tables ────────────────────────────────────────────
  pgm.sql(`
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON ALL TABLES IN SCHEMA public
      TO taproot_app;
  `);

  // ── Sequence access (needed for SERIAL / BIGSERIAL PKs) ──────────────────
  pgm.sql(`
    GRANT USAGE, SELECT
      ON ALL SEQUENCES IN SCHEMA public
      TO taproot_app;
  `);

  // ── Future tables automatically inherit the DML grant ────────────────────
  pgm.sql(`
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO taproot_app;

    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO taproot_app;
  `);

  // ── Revoke destructive ops on immutable audit / ledger tables ────────────
  // These tables are append-only by design — the app must never delete or
  // overwrite rows in them.
  pgm.sql(`
    REVOKE UPDATE, DELETE ON TABLE audit_logs         FROM taproot_app;
    REVOKE UPDATE, DELETE ON TABLE inventory_movements FROM taproot_app;
  `);

  // sync_events may not exist in all deployments — guard with a conditional
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'sync_events'
      ) THEN
        REVOKE UPDATE, DELETE ON TABLE sync_events FROM taproot_app;
      END IF;
    END
    $$;
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  // Re-grant the revoked permissions (restores full DML access)
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_roles WHERE rolname = 'taproot_app'
      ) THEN
        GRANT UPDATE, DELETE ON TABLE audit_logs TO taproot_app;
        GRANT UPDATE, DELETE ON TABLE inventory_movements TO taproot_app;
      END IF;
    END
    $$;
  `);

  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'sync_events'
      ) AND EXISTS (
        SELECT 1 FROM pg_roles WHERE rolname = 'taproot_app'
      ) THEN
        GRANT UPDATE, DELETE ON TABLE sync_events TO taproot_app;
      END IF;
    END
    $$;
  `);

  // Revoke default privileges
  pgm.sql(`
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM taproot_app;

    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      REVOKE USAGE, SELECT ON SEQUENCES FROM taproot_app;
  `);

  pgm.sql(`
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM taproot_app;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM taproot_app;
    REVOKE USAGE ON SCHEMA public FROM taproot_app;
    REVOKE CONNECT ON DATABASE CURRENT_DATABASE() FROM taproot_app;
  `);

  pgm.sql(`DROP ROLE IF EXISTS taproot_app;`);
};
