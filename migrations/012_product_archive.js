/**
 * Migration 012 — product_archive
 *
 * Adds archive support to products. Archived products are hidden from the POS
 * register but remain visible in the admin Inventory → Archived tab.
 *
 * Three product states:
 *   ACTIVE:   is_active=true,  archived_at=NULL  → visible in POS
 *   ARCHIVED: is_active=true,  archived_at=SET   → hidden from POS, visible in admin
 *   DELETED:  deleted_at=SET                     → hidden everywhere (existing soft-delete)
 *
 * CANONICAL QUERY PATTERN — use everywhere products are listed for POS/cashier:
 *   WHERE p.deleted_at IS NULL AND p.archived_at IS NULL
 */

/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.addColumns('products', {
    archived_at: {
      type:    'timestamptz',
      notNull: false,
      default: null,
      comment: 'Set when product is archived. NULL = active. Archived products hidden from POS.',
    },
    archive_reason: {
      type:    'varchar(255)',
      notNull: false,
      default: null,
      comment: 'Optional reason for archiving (e.g. "Out of season", "86\'d", "Being reformulated")',
    },
    archived_by: {
      type:       'uuid',
      notNull:    false,
      default:    null,
      references: 'employees(id)',
      onDelete:   'SET NULL',
      comment:    'Employee who archived this product',
    },
  });

  // Partial index — only indexes rows where archived_at is set (keeps index tiny)
  pgm.createIndex('products', 'archived_at', {
    name:  'idx_products_archived_at',
    where: 'archived_at IS NOT NULL',
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropIndex('products', 'archived_at', { name: 'idx_products_archived_at' });
  pgm.dropColumns('products', ['archived_at', 'archive_reason', 'archived_by']);
};
