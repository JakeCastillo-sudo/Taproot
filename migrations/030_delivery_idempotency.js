/**
 * 030 — Delivery order idempotency (WG-010 duplicate delivery orders)
 *
 * Migration 026 created only NON-unique indexes on orders(delivery_provider)
 * and orders(delivery_order_id) separately — so two concurrent provider
 * webhooks for the same external order can both pass the SELECT-for-existing
 * check in processDeliveryOrder and both INSERT, duplicating the order (kitchen
 * makes the food twice).
 *
 * This adds a PARTIAL UNIQUE index on (organization_id, delivery_provider,
 * delivery_order_id) limited to rows where delivery_order_id IS NOT NULL, so
 * POS orders (delivery_order_id NULL) are untouched. The service uses
 * INSERT ... ON CONFLICT DO NOTHING against this index for atomic dedup.
 *
 * PRECONDITION: if duplicate delivery rows already exist this index will fail to
 * create — resolve them first (see the duplicate-check query in the WG-009/010
 * report). In practice the delivery system has had no real traffic.
 *
 * Pattern matches 028/029 (raw pgm.sql, IF NOT EXISTS).
 */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_delivery_dedup
      ON orders (organization_id, delivery_provider, delivery_order_id)
      WHERE delivery_order_id IS NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS uq_orders_delivery_dedup;`);
};
