/**
 * Migration 011 — day_parts
 *
 * Adds a day_parts array column to products so items can be restricted
 * to specific meal periods (breakfast, brunch, lunch, dinner).
 *
 * ADDITIVE filtering rule:
 *   NULL / empty array = visible in ALL day parts (existing behaviour preserved)
 *   Non-empty array    = visible only when active day part matches
 *
 * This ensures all existing demo products remain visible after this migration.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.addColumns('products', {
    day_parts: {
      type:    'varchar(50)[]',
      notNull: false,
      default: null,
      comment: 'null or empty = visible in all day parts; otherwise restricted to listed parts',
    },
  });

  // GIN index for efficient array containment queries (@> / = ANY())
  pgm.createIndex('products', 'day_parts', {
    name:   'idx_products_day_parts',
    method: 'gin',
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropIndex('products', 'day_parts', { name: 'idx_products_day_parts' });
  pgm.dropColumns('products', ['day_parts']);
};
