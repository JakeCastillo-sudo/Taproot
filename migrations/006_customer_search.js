'use strict';

/**
 * Migration 006 — Customer search + reporting indexes
 *
 * 1. Enable pg_trgm extension for trigram-based LIKE acceleration
 * 2. GIN indexes on customers.first_name, last_name, email, phone for fast
 *    ILIKE prefix/infix searches from the customer lookup panel
 * 3. Partial index on orders(created_at) for fast date-range aggregations
 * 4. Composite index on order_line_items(product_id, order_id) for top-products report
 * 5. Composite index on payments(payment_method, status) for method breakdown report
 */

/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  // pg_trgm enables fast LIKE / ILIKE queries via GIN indexes
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

  // Customer search — GIN trigram indexes
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_customers_trgm_name
      ON customers USING GIN (
        (COALESCE(first_name,'') || ' ' || COALESCE(last_name,''))
        gin_trgm_ops
      )
      WHERE deleted_at IS NULL
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_customers_trgm_email
      ON customers USING GIN (email gin_trgm_ops)
      WHERE email IS NOT NULL AND deleted_at IS NULL
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_customers_trgm_phone
      ON customers USING GIN (phone gin_trgm_ops)
      WHERE phone IS NOT NULL AND deleted_at IS NULL
  `);

  // Reporting — date-range index on completed orders
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_orders_reporting
      ON orders(organization_id, location_id, created_at DESC)
      WHERE status NOT IN ('voided','parked')
  `);

  // Top products report
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_oli_reporting
      ON order_line_items(product_id, variant_id)
      WHERE voided_at IS NULL
  `);

  // Payment method breakdown
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_payments_method_status
      ON payments(order_id, payment_method, status)
  `);
};

/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS idx_payments_method_status`);
  pgm.sql(`DROP INDEX IF EXISTS idx_oli_reporting`);
  pgm.sql(`DROP INDEX IF EXISTS idx_orders_reporting`);
  pgm.sql(`DROP INDEX IF EXISTS idx_customers_trgm_phone`);
  pgm.sql(`DROP INDEX IF EXISTS idx_customers_trgm_email`);
  pgm.sql(`DROP INDEX IF EXISTS idx_customers_trgm_name`);
};
