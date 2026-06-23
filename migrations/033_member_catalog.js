/**
 * 033 — member + studio catalog (v2.1)
 *
 * The member identity + sellable studio catalog + credit ledger. Everything here
 * is DORMANT for restaurants: the app only exposes it for orgs with
 * capabilities.studio = true (v2.0 spine), and every service graceful-guards these
 * tables/columns so the code is safe BEFORE this migration runs. Money = INTEGER
 * CENTS (studio prices live in product_prices like every other product; this
 * migration adds no money columns — credits are integer COUNTS, not money).
 *
 * Pattern matches 028-032 (raw pgm.sql, IF NOT EXISTS). DO NOT run here — Jake runs
 * it in Railway after review (two-step verify in docs/V2_1_SANDBOX_NOTES.md).
 *
 * ── studio_meta shapes (products.studio_meta JSONB), by item_type (spec §3.2) ──
 *   membership:  { billing_interval, price_cents, included_credits|"unlimited",
 *                  booking_window_hrs, freeze_policy_id, commitment }
 *   class_pack:  { credit_count, expiry_days, shareable:bool, transferable:bool }
 *   drop_in:     { credits_required:int }   (a normal priced item; 1 visit)
 *   add_on:      { fulfillment:"bar"|"retail"|"none", redeem_at:"checkin"|"prebook" }
 */

exports.up = (pgm) => {
  // ── members — extends customers (customer_id optional link for unified identity) ──
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS members (
      id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id   uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      customer_id       uuid          REFERENCES customers(id) ON DELETE SET NULL,
      display_name      varchar(255),
      email             varchar(255),
      phone             varchar(50),
      status            varchar(20)   NOT NULL DEFAULT 'prospect',
      waiver_signed_at  timestamptz,
      waiver_doc_id     uuid,
      home_location_id  uuid          REFERENCES locations(id) ON DELETE SET NULL,
      tags              varchar(100)[],
      created_at        timestamptz   NOT NULL DEFAULT now(),
      updated_at        timestamptz   NOT NULL DEFAULT now(),
      deleted_at        timestamptz,
      CONSTRAINT members_status_check
        CHECK (status IN ('prospect','active','frozen','cancelled','lead'))
    );
  `);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_members_org      ON members(organization_id) WHERE deleted_at IS NULL;`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_members_customer ON members(customer_id) WHERE customer_id IS NOT NULL;`);

  // ── member_credits — the burn-down ledger (integer credit COUNTS, not money) ──
  // credits_remaining is decremented atomically (WG-006 conditional-UPDATE pattern);
  // the CHECK is a DB-level backstop so it can never go negative or exceed total.
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS member_credits (
      id                      uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id         uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      member_id               uuid          NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      credit_type             varchar(50)   NOT NULL DEFAULT 'class_pack',
      source_catalog_item_id  uuid          REFERENCES products(id) ON DELETE SET NULL,
      source_ref              varchar(255),
      credits_total           integer       NOT NULL,
      credits_remaining       integer       NOT NULL,
      expires_at              timestamptz,
      created_at              timestamptz   NOT NULL DEFAULT now(),
      updated_at              timestamptz   NOT NULL DEFAULT now(),
      CONSTRAINT member_credits_total_nonneg     CHECK (credits_total >= 0),
      CONSTRAINT member_credits_remaining_bounds CHECK (credits_remaining >= 0 AND credits_remaining <= credits_total)
    );
  `);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_member_credits_member ON member_credits(member_id);`);
  // Idempotency anchor for auto-grant-on-checkout retries (keyed on order/source id).
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS uq_member_credits_source_ref
             ON member_credits(organization_id, source_ref) WHERE source_ref IS NOT NULL;`);

  // ── member_subscriptions — MANUAL mode only (v2.1). Owner records an existing
  //    membership + entitlements; Taproot tracks access, does NOT charge.
  //    Taproot-native recurring billing (gateway_ref, dunning) is v2.5. ──
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS member_subscriptions (
      id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id     uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      member_id           uuid          NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      catalog_item_id     uuid          REFERENCES products(id) ON DELETE SET NULL,
      state               varchar(20)   NOT NULL DEFAULT 'active',
      managed_externally  boolean       NOT NULL DEFAULT true,
      notes               text,
      current_period_end  timestamptz,
      created_at          timestamptz   NOT NULL DEFAULT now(),
      updated_at          timestamptz   NOT NULL DEFAULT now(),
      deleted_at          timestamptz,
      CONSTRAINT member_subscriptions_state_check
        CHECK (state IN ('active','frozen','cancelled'))
    );
  `);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_member_subscriptions_member ON member_subscriptions(member_id);`);

  // ── Catalog extensions on the EXISTING products table ──
  // item_type defaults 'food' so every existing product is unchanged. studio_meta
  // holds the per-type config above. Studio items are normal products → they flow
  // through the existing checkout (no new payment path).
  pgm.sql(`
    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS item_type   varchar(50) NOT NULL DEFAULT 'food',
      ADD COLUMN IF NOT EXISTS studio_meta jsonb       NOT NULL DEFAULT '{}'::jsonb;
  `);
  // CHECK added idempotently (ADD CONSTRAINT has no IF NOT EXISTS). All existing rows
  // are 'food', which satisfies it.
  pgm.sql(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_item_type_check') THEN
        ALTER TABLE products ADD CONSTRAINT products_item_type_check
          CHECK (item_type IN ('food','retail','membership','class_pack','drop_in','add_on','gift_card'));
      END IF;
    END $$;
  `);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_products_item_type
             ON products(organization_id, item_type) WHERE deleted_at IS NULL;`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE products DROP CONSTRAINT IF EXISTS products_item_type_check;`);
  pgm.sql(`ALTER TABLE products DROP COLUMN IF EXISTS studio_meta;`);
  pgm.sql(`ALTER TABLE products DROP COLUMN IF EXISTS item_type;`);
  pgm.sql(`DROP TABLE IF EXISTS member_subscriptions;`);
  pgm.sql(`DROP TABLE IF EXISTS member_credits;`);
  pgm.sql(`DROP TABLE IF EXISTS members;`);
};
