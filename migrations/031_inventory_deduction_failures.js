/**
 * 031 — inventory_deduction_failures (WG-011 deduction retry + alert)
 *
 * Durable record of the case where automatic ingredient deduction fails after a
 * fully-paid order (DB hiccup, pool exhaustion, deleted ingredient). Previously
 * these vanished into a console.error → silent stock drift. Each row is keyed on
 * order_id (one failure per order). The opportunistic reconciler
 * (reconcilePendingDeductions in ingredientInventory.service) replays the
 * deduction on the next payment activity — safe because the WG-012 idempotency
 * guard (skip if 'sale' stock_movements already exist) prevents double-deduction.
 *
 * Pattern matches 029/030 (raw pgm.sql, IF NOT EXISTS).
 */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS inventory_deduction_failures (
      id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id  uuid         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      order_id         uuid         NOT NULL,
      error            text,
      attempts         integer      NOT NULL DEFAULT 0,
      last_attempt_at  timestamptz,
      reconciled_at    timestamptz,
      created_at       timestamptz  NOT NULL DEFAULT now()
    );
  `);

  // One failure row per order — idempotent logging anchor (ON CONFLICT DO NOTHING).
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_deduction_failures_order
             ON inventory_deduction_failures (order_id);`);

  // Fast fetch of the oldest unreconciled rows for the reconciler.
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_inventory_deduction_failures_pending
             ON inventory_deduction_failures (created_at) WHERE reconciled_at IS NULL;`);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS inventory_deduction_failures;`);
};
