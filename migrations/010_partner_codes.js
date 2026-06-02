/**
 * Migration 010 — partner_codes
 *
 * Stores partner referral codes that extend trial periods.
 * Adding a new partner requires only a DB INSERT — no code changes.
 *
 * Example:
 *   INSERT INTO partner_codes (code, partner_name, trial_days)
 *   VALUES ('REDDIT2026', 'Reddit Community', 14);
 */

/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.createTable('partner_codes', {
    id: {
      type:       'uuid',
      primaryKey: true,
      default:    pgm.func('gen_random_uuid()'),
    },
    code: {
      type:     'varchar(100)',
      notNull:  true,
      unique:   true,
    },
    partner_name: {
      type:    'varchar(255)',
      notNull: true,
    },
    trial_days: {
      type:    'integer',
      notNull: true,
      default: 14,
    },
    is_active: {
      type:    'boolean',
      notNull: true,
      default: true,
    },
    uses_count: {
      type:    'integer',
      notNull: true,
      default: 0,
    },
    max_uses: {
      type:    'integer',
      notNull: false,
      comment: 'null = unlimited',
    },
    created_at: {
      type:    'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    expires_at: {
      type:    'timestamptz',
      notNull: false,
    },
  });

  pgm.createIndex('partner_codes', 'code');
  pgm.createIndex('partner_codes', 'is_active');

  // Seed: generic codes to start — add real partner codes via DB insert
  pgm.sql(`
    INSERT INTO partner_codes (code, partner_name, trial_days, is_active)
    VALUES
      ('TAPROOT30',  'Extended Trial',   30, true),
      ('EARLYBIRD',  'Early Adopter',    21, true)
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropTable('partner_codes');
};
