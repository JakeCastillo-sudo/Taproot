/**
 * Migration 016 — reservations
 *
 * Waitlist + reservations. (Prompt called this "014"; renumbered to 016 because
 * 014_employee_hourly_rate and 015_cash_drawer were created earlier this sprint.)
 */

/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS reservations (
      id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id  uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      location_id      uuid          NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      customer_name    varchar(255)  NOT NULL,
      party_size       integer       NOT NULL DEFAULT 2,
      phone            varchar(50),
      email            varchar(255),
      type             varchar(20)   NOT NULL DEFAULT 'waitlist',
      reserved_for     timestamptz,
      table_id         uuid          REFERENCES tables(id) ON DELETE SET NULL,
      status           varchar(30)   NOT NULL DEFAULT 'waiting',
      notes            text,
      notified_at      timestamptz,
      created_at       timestamptz   NOT NULL DEFAULT now(),
      updated_at       timestamptz   NOT NULL DEFAULT now(),
      CONSTRAINT reservations_type_check CHECK (type IN ('reservation','waitlist')),
      CONSTRAINT reservations_status_check CHECK (status IN
        ('waiting','notified','confirmed','arrived','seated','no_show','cancelled','removed'))
    );
  `);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_reservations_loc_date ON reservations(location_id, reserved_for)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_reservations_type_status ON reservations(type, status)`);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS reservations`);
};
