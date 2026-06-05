/**
 * Migration 015 — cash_drawer
 *
 * Cash drawer session tracking: open/close a shift, record mid-shift cash drops
 * to the safe, and reconcile expected vs actual at close. All money columns are
 * integer CENTS (bigint).
 */

/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS cash_drawer_sessions (
      id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id  uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      location_id      uuid          NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      employee_id      uuid          NOT NULL REFERENCES employees(id),
      opened_at        timestamptz   NOT NULL DEFAULT now(),
      closed_at        timestamptz,
      opening_amount   bigint        NOT NULL DEFAULT 0,
      expected_amount  bigint,
      actual_amount    bigint,
      discrepancy      bigint,
      notes            text,
      created_at       timestamptz   NOT NULL DEFAULT now(),
      updated_at       timestamptz   NOT NULL DEFAULT now()
    );
  `);

  // At most one open session per location (closed_at IS NULL)
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS cash_drawer_one_open_per_location
      ON cash_drawer_sessions(location_id)
      WHERE closed_at IS NULL;
  `);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS cash_drops (
      id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id   uuid          NOT NULL REFERENCES cash_drawer_sessions(id) ON DELETE CASCADE,
      employee_id  uuid          NOT NULL REFERENCES employees(id),
      amount       bigint        NOT NULL,
      reason       text,
      created_at   timestamptz   NOT NULL DEFAULT now()
    );
  `);

  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_cash_drops_session ON cash_drops(session_id)`);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS cash_drops`);
  pgm.sql(`DROP TABLE IF EXISTS cash_drawer_sessions`);
};
