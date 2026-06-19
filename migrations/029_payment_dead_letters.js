/**
 * 029 — payment_dead_letters (WG-001 charge-without-order recovery)
 *
 * Durable record of the rare case where a Stripe charge SUCCEEDS but the
 * order/payment DB write fails (processPayment catch block). Each row carries
 * everything needed to replay the payment INSERT idempotently, keyed on the
 * Stripe PaymentIntent id. The opportunistic reconciler (reconcilePending in
 * payment.service) drains these on the next payment activity. Card payments
 * only — the only path that is dead-lettered.
 *
 * Pattern matches 028 (raw pgm.sql, IF NOT EXISTS). Money in INTEGER CENTS.
 */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS payment_dead_letters (
      id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id       uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      order_id              uuid          NOT NULL,
      employee_id           uuid,

      payment_method        varchar(50)   NOT NULL,
      amount                integer       NOT NULL,
      tip_amount            integer       NOT NULL DEFAULT 0,
      processor             varchar(50)   NOT NULL DEFAULT 'stripe',
      processor_payment_id  varchar(255)  NOT NULL,
      card_last4            varchar(10),
      card_brand            varchar(50),

      error                 text,
      status                varchar(50)   NOT NULL DEFAULT 'pending',
      reconcile_attempts    integer       NOT NULL DEFAULT 0,
      last_attempt_at       timestamptz,
      reconciled_at         timestamptz,
      created_at            timestamptz   NOT NULL DEFAULT now()
    );
  `);

  // One dead-letter per PaymentIntent — idempotent logging anchor.
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_dead_letters_pi
             ON payment_dead_letters (processor_payment_id);`);

  // Fast fetch of the oldest unreconciled rows for the reconciler.
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_payment_dead_letters_pending
             ON payment_dead_letters (created_at) WHERE reconciled_at IS NULL;`);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS payment_dead_letters;`);
};
