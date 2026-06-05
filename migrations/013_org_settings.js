/**
 * Migration 013 — org_settings
 *
 * Adds a JSONB `settings` column to the organizations table for
 * organization-level configuration that doesn't warrant its own table.
 *
 * Current uses:
 *   settings.dashboardLayout — POS register category tile layout config
 *     (sort order, colors, icons, pinned/hidden categories, grid columns)
 *
 * Safe-default rule: if settings or settings.dashboardLayout is NULL,
 * the POS falls back to its built-in defaults. Missing config never
 * breaks the register.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.addColumns('organizations', {
    settings: {
      type:    'jsonb',
      notNull: false,
      default: null,
      comment: 'Organization-level settings JSONB (dashboardLayout, etc.)',
    },
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropColumns('organizations', ['settings']);
};
