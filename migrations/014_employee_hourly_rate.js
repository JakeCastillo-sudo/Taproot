/**
 * Migration 014 — employee_hourly_rate
 *
 * Adds an optional hourly pay rate to employees, used by the Employee Management
 * UI (S1-05) and future scheduling/labor reports. Idempotent (IF NOT EXISTS) so
 * it is safe to re-run.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS hourly_rate numeric(10,2) DEFAULT NULL`);
  pgm.sql(`COMMENT ON COLUMN employees.hourly_rate IS 'Optional hourly pay rate (dollars) for scheduling/labor reports'`);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE employees DROP COLUMN IF EXISTS hourly_rate`);
};
