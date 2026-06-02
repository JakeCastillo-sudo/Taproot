/**
 * Migration 009 — Subscription billing fields
 *
 * Adds Stripe Billing + subscription state columns to the organizations table.
 * These fields power the $199/mo SaaS billing model with 14-day free trial
 * (30-day for LegalZoom referrals).
 */

/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  // ── Subscription columns on organizations ───────────────────────────────────
  pgm.addColumns('organizations', {
    stripe_customer_id: {
      type: 'varchar(255)',
      notNull: false,
    },
    stripe_subscription_id: {
      type: 'varchar(255)',
      notNull: false,
    },
    subscription_status: {
      type: 'varchar(50)',
      notNull: true,
      default: 'trialing',
    },
    subscription_plan: {
      type: 'varchar(50)',
      notNull: true,
      default: 'starter',
    },
    trial_ends_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func("now() + interval '14 days'"),
    },
    subscription_ends_at: {
      type: 'timestamptz',
      notNull: false,
    },
    location_count: {
      type: 'integer',
      notNull: true,
      default: 1,
    },
    referral_source: {
      type: 'varchar(100)',
      notNull: false,
    },
    metadata: {
      type: 'jsonb',
      notNull: true,
      default: '{}',
    },
  });

  // ── Constraints ──────────────────────────────────────────────────────────────
  pgm.addConstraint(
    'organizations',
    'organizations_subscription_status_check',
    `CHECK (subscription_status IN ('trialing','active','past_due','cancelled','unpaid'))`,
  );

  pgm.addConstraint(
    'organizations',
    'organizations_subscription_plan_check',
    `CHECK (subscription_plan IN ('starter','growth','enterprise'))`,
  );

  // ── Indexes ──────────────────────────────────────────────────────────────────
  pgm.createIndex('organizations', 'stripe_customer_id', {
    name: 'idx_organizations_stripe_customer_id',
    unique: true,
    where: 'stripe_customer_id IS NOT NULL',
  });

  pgm.createIndex('organizations', 'subscription_status', {
    name: 'idx_organizations_subscription_status',
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('organizations', 'subscription_status', {
    name: 'idx_organizations_subscription_status',
  });
  pgm.dropIndex('organizations', 'stripe_customer_id', {
    name: 'idx_organizations_stripe_customer_id',
  });
  pgm.dropConstraint('organizations', 'organizations_subscription_plan_check');
  pgm.dropConstraint('organizations', 'organizations_subscription_status_check');
  pgm.dropColumns('organizations', [
    'stripe_customer_id',
    'stripe_subscription_id',
    'subscription_status',
    'subscription_plan',
    'trial_ends_at',
    'subscription_ends_at',
    'location_count',
    'referral_source',
    'metadata',
  ]);
};
