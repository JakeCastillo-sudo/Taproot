/* eslint-disable camelcase */
'use strict';

exports.shorthands = undefined;

// ---------------------------------------------------------------------------
// UP
// ---------------------------------------------------------------------------
exports.up = (pgm) => {

  // -------------------------------------------------------------------------
  // Extensions
  // -------------------------------------------------------------------------
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS "btree_gin";`);

  // -------------------------------------------------------------------------
  // Utility: updated_at trigger function
  // -------------------------------------------------------------------------
  pgm.sql(`
    CREATE OR REPLACE FUNCTION trigger_set_updated_at()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$;
  `);

  // -------------------------------------------------------------------------
  // Order-number sequence table (per-org, per-year counter)
  // -------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE organization_order_sequences (
      organization_id uuid        NOT NULL,
      year            integer     NOT NULL,
      counter         integer     NOT NULL DEFAULT 0,
      PRIMARY KEY (organization_id, year)
    );
  `);

  // -------------------------------------------------------------------------
  // 1. organizations
  // -------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE organizations (
      id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      name             varchar(255)  NOT NULL,
      slug             varchar(100)  NOT NULL,
      plan             varchar(50)   NOT NULL DEFAULT 'trial',
      plan_expires_at  timestamptz,
      settings         jsonb         NOT NULL DEFAULT '{}',
      billing_email    varchar(255),
      created_at       timestamptz   NOT NULL DEFAULT now(),
      updated_at       timestamptz   NOT NULL DEFAULT now(),
      deleted_at       timestamptz,
      CONSTRAINT organizations_slug_unique   UNIQUE (slug),
      CONSTRAINT organizations_plan_check    CHECK  (plan IN ('trial','starter','growth','enterprise'))
    );
  `);

  // -------------------------------------------------------------------------
  // 2. locations
  // -------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE locations (
      id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id  uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name             varchar(255)  NOT NULL,
      address          jsonb         NOT NULL,
      phone            varchar(50),
      timezone         varchar(100)  NOT NULL DEFAULT 'America/New_York',
      currency         varchar(10)   NOT NULL DEFAULT 'USD',
      tax_config       jsonb         NOT NULL DEFAULT '{}',
      receipt_config   jsonb         NOT NULL DEFAULT '{}',
      is_active        boolean       NOT NULL DEFAULT true,
      settings         jsonb         NOT NULL DEFAULT '{}',
      created_by       uuid,
      created_at       timestamptz   NOT NULL DEFAULT now(),
      updated_at       timestamptz   NOT NULL DEFAULT now(),
      deleted_at       timestamptz
    );
  `);

  // -------------------------------------------------------------------------
  // 3. employees
  // -------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE employees (
      id                      uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id         uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      email                   varchar(255)  NOT NULL,
      email_verified_at       timestamptz,
      password_hash           varchar(255)  NOT NULL,
      first_name              varchar(100)  NOT NULL,
      last_name               varchar(100)  NOT NULL,
      phone                   varchar(50),
      role                    varchar(50)   NOT NULL,
      permissions             jsonb         NOT NULL DEFAULT '[]',
      pin_hash                varchar(255),
      totp_secret             varchar(255),
      totp_enabled            boolean       NOT NULL DEFAULT false,
      last_login_at           timestamptz,
      failed_login_attempts   integer       NOT NULL DEFAULT 0,
      locked_until            timestamptz,
      commission_rate         numeric(5,4)           DEFAULT 0,
      location_ids            uuid[],
      created_by              uuid,
      created_at              timestamptz   NOT NULL DEFAULT now(),
      updated_at              timestamptz   NOT NULL DEFAULT now(),
      deleted_at              timestamptz,
      CONSTRAINT employees_org_email_unique UNIQUE (organization_id, email),
      CONSTRAINT employees_role_check CHECK (role IN ('owner','manager','cashier','kitchen','readonly'))
    );
  `);

  // employees.created_by self-ref and locations.created_by added after table creation
  pgm.sql(`
    ALTER TABLE employees
      ADD CONSTRAINT employees_created_by_fk FOREIGN KEY (created_by)
        REFERENCES employees(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
  `);
  pgm.sql(`
    ALTER TABLE locations
      ADD CONSTRAINT locations_created_by_fk FOREIGN KEY (created_by)
        REFERENCES employees(id) ON DELETE SET NULL;
  `);
  pgm.sql(`
    ALTER TABLE organization_order_sequences
      ADD CONSTRAINT org_order_seq_org_fk FOREIGN KEY (organization_id)
        REFERENCES organizations(id) ON DELETE CASCADE;
  `);

  // -------------------------------------------------------------------------
  // 4. refresh_tokens
  // -------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE refresh_tokens (
      id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      employee_id  uuid          NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      token_hash   varchar(255)  NOT NULL,
      device_info  jsonb,
      expires_at   timestamptz   NOT NULL,
      revoked_at   timestamptz,
      created_at   timestamptz   NOT NULL DEFAULT now(),
      CONSTRAINT refresh_tokens_hash_unique UNIQUE (token_hash)
    );
  `);

  // -------------------------------------------------------------------------
  // 5. categories (parent_id self-ref added after)
  // -------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE categories (
      id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id  uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      parent_id        uuid,
      name             varchar(255)  NOT NULL,
      color            varchar(7),
      icon             varchar(100),
      sort_order       integer       NOT NULL DEFAULT 0,
      is_active        boolean       NOT NULL DEFAULT true,
      created_by       uuid          REFERENCES employees(id) ON DELETE SET NULL,
      created_at       timestamptz   NOT NULL DEFAULT now(),
      updated_at       timestamptz   NOT NULL DEFAULT now(),
      deleted_at       timestamptz
    );
  `);
  pgm.sql(`
    ALTER TABLE categories
      ADD CONSTRAINT categories_parent_fk FOREIGN KEY (parent_id)
        REFERENCES categories(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
  `);

  // -------------------------------------------------------------------------
  // 6. suppliers
  // -------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE suppliers (
      id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id  uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name             varchar(255)  NOT NULL,
      contact_name     varchar(255),
      email            varchar(255),
      phone            varchar(50),
      address          jsonb,
      payment_terms    varchar(100),
      lead_time_days   integer       DEFAULT 1,
      notes            text,
      is_active        boolean       NOT NULL DEFAULT true,
      created_by       uuid          REFERENCES employees(id) ON DELETE SET NULL,
      created_at       timestamptz   NOT NULL DEFAULT now(),
      updated_at       timestamptz   NOT NULL DEFAULT now(),
      deleted_at       timestamptz
    );
  `);

  // -------------------------------------------------------------------------
  // 7. products
  // -------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE products (
      id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id  uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      category_id      uuid          REFERENCES categories(id) ON DELETE SET NULL,
      supplier_id      uuid          REFERENCES suppliers(id) ON DELETE SET NULL,
      name             varchar(255)  NOT NULL,
      description      text,
      sku              varchar(100),
      barcode          varchar(100),
      product_type     varchar(50)   NOT NULL DEFAULT 'standard',
      unit_of_measure  varchar(50)   NOT NULL DEFAULT 'each',
      cost_price       numeric(12,4) DEFAULT 0,
      track_inventory  boolean       NOT NULL DEFAULT true,
      is_active        boolean       NOT NULL DEFAULT true,
      images           jsonb         NOT NULL DEFAULT '[]',
      tags             varchar(100)[],
      metadata         jsonb         NOT NULL DEFAULT '{}',
      created_by       uuid          REFERENCES employees(id) ON DELETE SET NULL,
      created_at       timestamptz   NOT NULL DEFAULT now(),
      updated_at       timestamptz   NOT NULL DEFAULT now(),
      deleted_at       timestamptz,
      CONSTRAINT products_type_check CHECK (product_type IN ('standard','recipe','bundle','service','weight')),
      CONSTRAINT products_uom_check  CHECK (unit_of_measure IN ('each','g','kg','ml','l','oz','lb','m','ft'))
    );
  `);
  pgm.sql(`
    CREATE UNIQUE INDEX products_org_sku_unique
      ON products(organization_id, sku)
      WHERE sku IS NOT NULL AND deleted_at IS NULL;
  `);
  pgm.sql(`
    CREATE UNIQUE INDEX products_org_barcode_unique
      ON products(organization_id, barcode)
      WHERE barcode IS NOT NULL AND deleted_at IS NULL;
  `);

  // -------------------------------------------------------------------------
  // 8. product_variants
  // -------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE product_variants (
      id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id       uuid          NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      organization_id  uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name             varchar(255)  NOT NULL,
      sku              varchar(100),
      barcode          varchar(100),
      options          jsonb         NOT NULL DEFAULT '{}',
      cost_price       numeric(12,4) DEFAULT 0,
      is_active        boolean       NOT NULL DEFAULT true,
      sort_order       integer       NOT NULL DEFAULT 0,
      created_at       timestamptz   NOT NULL DEFAULT now(),
      updated_at       timestamptz   NOT NULL DEFAULT now(),
      deleted_at       timestamptz
    );
  `);
  pgm.sql(`
    CREATE UNIQUE INDEX product_variants_sku_unique
      ON product_variants(product_id, sku)
      WHERE sku IS NOT NULL AND deleted_at IS NULL;
  `);

  // -------------------------------------------------------------------------
  // 9. product_prices
  // -------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE product_prices (
      id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      variant_id        uuid          NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
      location_id       uuid          REFERENCES locations(id) ON DELETE CASCADE,
      price             numeric(12,4) NOT NULL,
      compare_at_price  numeric(12,4),
      currency          varchar(10)   NOT NULL DEFAULT 'USD',
      is_active         boolean       NOT NULL DEFAULT true,
      effective_from    timestamptz   NOT NULL DEFAULT now(),
      effective_until   timestamptz,
      created_at        timestamptz   NOT NULL DEFAULT now(),
      updated_at        timestamptz   NOT NULL DEFAULT now(),
      CONSTRAINT product_prices_unique
        UNIQUE (variant_id, location_id, currency, effective_from)
    );
  `);

  // -------------------------------------------------------------------------
  // 10. modifier_groups
  // -------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE modifier_groups (
      id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id  uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name             varchar(255)  NOT NULL,
      selection_type   varchar(50)   NOT NULL DEFAULT 'single',
      min_selections   integer       NOT NULL DEFAULT 0,
      max_selections   integer,
      sort_order       integer       NOT NULL DEFAULT 0,
      is_active        boolean       NOT NULL DEFAULT true,
      created_by       uuid          REFERENCES employees(id) ON DELETE SET NULL,
      created_at       timestamptz   NOT NULL DEFAULT now(),
      updated_at       timestamptz   NOT NULL DEFAULT now(),
      deleted_at       timestamptz,
      CONSTRAINT modifier_groups_selection_check
        CHECK (selection_type IN ('single','multiple','required_single','required_multiple'))
    );
  `);

  // -------------------------------------------------------------------------
  // 11. modifiers
  // -------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE modifiers (
      id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      group_id     uuid          NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
      name         varchar(255)  NOT NULL,
      price_delta  numeric(12,4) NOT NULL DEFAULT 0,
      cost_delta   numeric(12,4) NOT NULL DEFAULT 0,
      is_default   boolean       NOT NULL DEFAULT false,
      sort_order   integer       NOT NULL DEFAULT 0,
      is_active    boolean       NOT NULL DEFAULT true,
      created_at   timestamptz   NOT NULL DEFAULT now(),
      updated_at   timestamptz   NOT NULL DEFAULT now(),
      deleted_at   timestamptz
    );
  `);

  // -------------------------------------------------------------------------
  // 12. product_modifier_groups (junction)
  // -------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE product_modifier_groups (
      product_id         uuid     NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      modifier_group_id  uuid     NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
      sort_order         integer  NOT NULL DEFAULT 0,
      PRIMARY KEY (product_id, modifier_group_id)
    );
  `);

  // -------------------------------------------------------------------------
  // 13. recipes
  // -------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE recipes (
      id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id       uuid          NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      organization_id  uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name             varchar(255)  NOT NULL DEFAULT 'Default',
      yield_factor     numeric(5,4)  NOT NULL DEFAULT 1.0,
      notes            text,
      version          integer       NOT NULL DEFAULT 1,
      is_active        boolean       NOT NULL DEFAULT true,
      created_by       uuid          REFERENCES employees(id) ON DELETE SET NULL,
      created_at       timestamptz   NOT NULL DEFAULT now(),
      updated_at       timestamptz   NOT NULL DEFAULT now(),
      deleted_at       timestamptz
    );
  `);
  pgm.sql(`
    CREATE UNIQUE INDEX recipes_product_active_unique
      ON recipes(product_id)
      WHERE is_active = true AND deleted_at IS NULL;
  `);

  // -------------------------------------------------------------------------
  // 14. recipe_lines
  // -------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE recipe_lines (
      id                      uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      recipe_id               uuid          NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      ingredient_product_id   uuid          NOT NULL REFERENCES products(id),
      ingredient_variant_id   uuid          REFERENCES product_variants(id),
      quantity                numeric(12,4) NOT NULL,
      unit                    varchar(50)   NOT NULL,
      waste_factor            numeric(5,4)  NOT NULL DEFAULT 0,
      notes                   text,
      created_at              timestamptz   NOT NULL DEFAULT now(),
      updated_at              timestamptz   NOT NULL DEFAULT now()
    );
  `);

  // -------------------------------------------------------------------------
  // 15. customers (merged_into_id self-ref added after)
  // -------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE customers (
      id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id   uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      first_name        varchar(100),
      last_name         varchar(100),
      email             varchar(255),
      phone             varchar(50),
      date_of_birth     date,
      address           jsonb,
      tags              varchar(100)[],
      notes             text,
      loyalty_points    integer       NOT NULL DEFAULT 0,
      loyalty_tier      varchar(50)   NOT NULL DEFAULT 'none',
      account_credit    numeric(12,4) NOT NULL DEFAULT 0,
      total_spend       numeric(14,4) NOT NULL DEFAULT 0,
      visit_count       integer       NOT NULL DEFAULT 0,
      last_visit_at     timestamptz,
      marketing_opt_in  boolean       NOT NULL DEFAULT false,
      merged_into_id    uuid,
      external_ids      jsonb         NOT NULL DEFAULT '{}',
      created_by        uuid          REFERENCES employees(id) ON DELETE SET NULL,
      created_at        timestamptz   NOT NULL DEFAULT now(),
      updated_at        timestamptz   NOT NULL DEFAULT now(),
      deleted_at        timestamptz,
      CONSTRAINT customers_loyalty_tier_check
        CHECK (loyalty_tier IN ('none','bronze','silver','gold','platinum'))
    );
  `);
  pgm.sql(`
    ALTER TABLE customers
      ADD CONSTRAINT customers_merged_into_fk FOREIGN KEY (merged_into_id)
        REFERENCES customers(id) DEFERRABLE INITIALLY DEFERRED;
  `);
  pgm.sql(`
    CREATE UNIQUE INDEX customers_org_email_unique
      ON customers(organization_id, email)
      WHERE email IS NOT NULL AND deleted_at IS NULL;
  `);
  pgm.sql(`
    CREATE UNIQUE INDEX customers_org_phone_unique
      ON customers(organization_id, phone)
      WHERE phone IS NOT NULL AND deleted_at IS NULL;
  `);

  // -------------------------------------------------------------------------
  // 16. tables (must precede orders due to FK)
  // -------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE tables (
      id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      location_id      uuid          NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      organization_id  uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name             varchar(100)  NOT NULL,
      section          varchar(100),
      seats            integer       NOT NULL DEFAULT 2,
      position_x       numeric(8,4)  NOT NULL DEFAULT 0,
      position_y       numeric(8,4)  NOT NULL DEFAULT 0,
      shape            varchar(50)   NOT NULL DEFAULT 'rectangle',
      width            numeric(8,4)  NOT NULL DEFAULT 80,
      height           numeric(8,4)  NOT NULL DEFAULT 80,
      is_active        boolean       NOT NULL DEFAULT true,
      created_at       timestamptz   NOT NULL DEFAULT now(),
      updated_at       timestamptz   NOT NULL DEFAULT now(),
      deleted_at       timestamptz,
      CONSTRAINT tables_shape_check CHECK (shape IN ('rectangle','circle','square'))
    );
  `);

  // -------------------------------------------------------------------------
  // 17. inventory_levels
  // -------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE inventory_levels (
      id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id   uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      location_id       uuid          NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      product_id        uuid          NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      variant_id        uuid          REFERENCES product_variants(id) ON DELETE CASCADE,
      quantity_on_hand  numeric(12,4) NOT NULL DEFAULT 0,
      quantity_on_order numeric(12,4) NOT NULL DEFAULT 0,
      reorder_point     numeric(12,4)          DEFAULT 0,
      reorder_quantity  numeric(12,4)          DEFAULT 0,
      max_stock_level   numeric(12,4),
      last_counted_at   timestamptz,
      created_at        timestamptz   NOT NULL DEFAULT now(),
      updated_at        timestamptz   NOT NULL DEFAULT now()
    );
  `);
  // Two partial unique indexes to handle nullable variant_id correctly
  pgm.sql(`
    CREATE UNIQUE INDEX inventory_levels_with_variant
      ON inventory_levels(location_id, product_id, variant_id)
      WHERE variant_id IS NOT NULL;
  `);
  pgm.sql(`
    CREATE UNIQUE INDEX inventory_levels_no_variant
      ON inventory_levels(location_id, product_id)
      WHERE variant_id IS NULL;
  `);

  // -------------------------------------------------------------------------
  // 18. inventory_movements  (immutable ledger — no updated_at)
  // -------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE inventory_movements (
      id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id  uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      location_id      uuid          NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      product_id       uuid          NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      variant_id       uuid          REFERENCES product_variants(id),
      movement_type    varchar(50)   NOT NULL,
      quantity_delta   numeric(12,4) NOT NULL,
      quantity_before  numeric(12,4) NOT NULL,
      quantity_after   numeric(12,4) NOT NULL,
      reference_type   varchar(50),
      reference_id     uuid,
      employee_id      uuid          REFERENCES employees(id),
      notes            text,
      metadata         jsonb         NOT NULL DEFAULT '{}',
      created_at       timestamptz   NOT NULL DEFAULT now(),
      CONSTRAINT inventory_movements_type_check CHECK (movement_type IN (
        'sale','return','waste','adjustment','transfer_in','transfer_out',
        'po_receipt','opening_count','cycle_count'
      ))
    );
  `);

  // -------------------------------------------------------------------------
  // 19. orders
  // -------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE orders (
      id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id   uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      location_id       uuid          NOT NULL REFERENCES locations(id),
      customer_id       uuid          REFERENCES customers(id) ON DELETE SET NULL,
      employee_id       uuid          NOT NULL REFERENCES employees(id),
      order_number      varchar(50)   NOT NULL,
      status            varchar(50)   NOT NULL DEFAULT 'open',
      order_type        varchar(50)   NOT NULL DEFAULT 'in_store',
      table_id          uuid          REFERENCES tables(id) ON DELETE SET NULL,
      subtotal          numeric(12,4) NOT NULL DEFAULT 0,
      discount_total    numeric(12,4) NOT NULL DEFAULT 0,
      tax_total         numeric(12,4) NOT NULL DEFAULT 0,
      tip_total         numeric(12,4) NOT NULL DEFAULT 0,
      total             numeric(12,4) NOT NULL DEFAULT 0,
      amount_paid       numeric(12,4) NOT NULL DEFAULT 0,
      change_due        numeric(12,4) NOT NULL DEFAULT 0,
      notes             text,
      source            varchar(50)   NOT NULL DEFAULT 'pos',
      fulfilled_at      timestamptz,
      voided_at         timestamptz,
      void_reason       text,
      metadata          jsonb         NOT NULL DEFAULT '{}',
      created_at        timestamptz   NOT NULL DEFAULT now(),
      updated_at        timestamptz   NOT NULL DEFAULT now(),
      CONSTRAINT orders_status_check CHECK (status IN (
        'open','in_progress','completed','refunded',
        'partially_refunded','voided','parked'
      )),
      CONSTRAINT orders_type_check CHECK (order_type IN (
        'in_store','takeout','delivery','table_service','online','phone'
      )),
      CONSTRAINT orders_source_check CHECK (source IN ('pos','online','kiosk','api')),
      CONSTRAINT orders_org_number_unique UNIQUE (organization_id, order_number)
    );
  `);

  // -------------------------------------------------------------------------
  // 20. order_line_items
  // -------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE order_line_items (
      id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id         uuid          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id       uuid          NOT NULL REFERENCES products(id),
      variant_id       uuid          REFERENCES product_variants(id),
      name             varchar(255)  NOT NULL,
      sku              varchar(100),
      quantity         numeric(12,4) NOT NULL,
      unit_price       numeric(12,4) NOT NULL,
      cost_price       numeric(12,4) NOT NULL DEFAULT 0,
      discount_amount  numeric(12,4) NOT NULL DEFAULT 0,
      tax_amount       numeric(12,4) NOT NULL DEFAULT 0,
      total            numeric(12,4) NOT NULL,
      modifiers        jsonb         NOT NULL DEFAULT '[]',
      notes            text,
      voided_at        timestamptz,
      void_reason      text,
      employee_id      uuid          REFERENCES employees(id),
      created_at       timestamptz   NOT NULL DEFAULT now(),
      updated_at       timestamptz   NOT NULL DEFAULT now()
    );
  `);

  // -------------------------------------------------------------------------
  // 21. payments
  // -------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE payments (
      id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id              uuid          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      payment_method        varchar(50)   NOT NULL,
      amount                numeric(12,4) NOT NULL,
      tip_amount            numeric(12,4) NOT NULL DEFAULT 0,
      status                varchar(50)   NOT NULL DEFAULT 'pending',
      processor             varchar(50),
      processor_payment_id  varchar(255),
      processor_response    jsonb,
      card_last4            varchar(4),
      card_brand            varchar(50),
      offline_queued_at     timestamptz,
      offline_synced_at     timestamptz,
      refunded_amount       numeric(12,4) NOT NULL DEFAULT 0,
      created_at            timestamptz   NOT NULL DEFAULT now(),
      updated_at            timestamptz   NOT NULL DEFAULT now(),
      CONSTRAINT payments_method_check CHECK (payment_method IN (
        'cash','credit_card','debit_card','apple_pay','google_pay',
        'gift_card','account_credit','bnpl','check','other'
      )),
      CONSTRAINT payments_status_check CHECK (status IN (
        'pending','completed','failed','refunded',
        'partially_refunded','offline_queued'
      ))
    );
  `);

  // -------------------------------------------------------------------------
  // 22. discounts
  // -------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE discounts (
      id                      uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id         uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name                    varchar(255)  NOT NULL,
      code                    varchar(100),
      discount_type           varchar(50)   NOT NULL,
      value                   numeric(12,4) NOT NULL,
      applies_to              varchar(50)   NOT NULL DEFAULT 'order',
      applies_to_ids          uuid[],
      minimum_order_amount    numeric(12,4),
      maximum_discount_amount numeric(12,4),
      usage_limit             integer,
      usage_count             integer       NOT NULL DEFAULT 0,
      per_customer_limit      integer       DEFAULT 1,
      stackable               boolean       NOT NULL DEFAULT true,
      priority                integer       NOT NULL DEFAULT 0,
      active_from             timestamptz   NOT NULL DEFAULT now(),
      active_until            timestamptz,
      customer_tags           varchar(100)[],
      is_active               boolean       NOT NULL DEFAULT true,
      created_by              uuid          REFERENCES employees(id) ON DELETE SET NULL,
      created_at              timestamptz   NOT NULL DEFAULT now(),
      updated_at              timestamptz   NOT NULL DEFAULT now(),
      deleted_at              timestamptz,
      CONSTRAINT discounts_type_check     CHECK (discount_type IN ('percentage','fixed_amount','bogo','free_item')),
      CONSTRAINT discounts_applies_check  CHECK (applies_to IN ('order','category','product'))
    );
  `);
  pgm.sql(`
    CREATE UNIQUE INDEX discounts_org_code_unique
      ON discounts(organization_id, code)
      WHERE code IS NOT NULL AND deleted_at IS NULL;
  `);

  // -------------------------------------------------------------------------
  // 23. applied_discounts
  // -------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE applied_discounts (
      id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id       uuid          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      line_item_id   uuid          REFERENCES order_line_items(id) ON DELETE CASCADE,
      discount_id    uuid          REFERENCES discounts(id) ON DELETE SET NULL,
      name           varchar(255)  NOT NULL,
      discount_type  varchar(50)   NOT NULL,
      value          numeric(12,4) NOT NULL,
      amount_saved   numeric(12,4) NOT NULL,
      created_at     timestamptz   NOT NULL DEFAULT now()
    );
  `);

  // -------------------------------------------------------------------------
  // 24. gift_cards
  // -------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE gift_cards (
      id                       uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id          uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      code                     varchar(100)  NOT NULL,
      initial_balance          numeric(12,4) NOT NULL,
      current_balance          numeric(12,4) NOT NULL,
      currency                 varchar(10)   NOT NULL DEFAULT 'USD',
      issued_to_customer_id    uuid          REFERENCES customers(id) ON DELETE SET NULL,
      issued_by_employee_id    uuid          REFERENCES employees(id),
      issued_at                timestamptz   NOT NULL DEFAULT now(),
      expires_at               timestamptz,
      is_active                boolean       NOT NULL DEFAULT true,
      created_at               timestamptz   NOT NULL DEFAULT now(),
      updated_at               timestamptz   NOT NULL DEFAULT now(),
      CONSTRAINT gift_cards_code_unique UNIQUE (code)
    );
  `);

  // -------------------------------------------------------------------------
  // 25. gift_card_transactions  (immutable ledger)
  // -------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE gift_card_transactions (
      id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      gift_card_id      uuid          NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
      order_id          uuid          REFERENCES orders(id) ON DELETE SET NULL,
      transaction_type  varchar(50)   NOT NULL,
      amount            numeric(12,4) NOT NULL,
      balance_before    numeric(12,4) NOT NULL,
      balance_after     numeric(12,4) NOT NULL,
      employee_id       uuid          REFERENCES employees(id),
      notes             text,
      created_at        timestamptz   NOT NULL DEFAULT now(),
      CONSTRAINT gift_card_txn_type_check CHECK (transaction_type IN (
        'issue','reload','redemption','refund','adjustment'
      ))
    );
  `);

  // -------------------------------------------------------------------------
  // 26. purchase_orders
  // -------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE purchase_orders (
      id                     uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id        uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      location_id            uuid          NOT NULL REFERENCES locations(id),
      supplier_id            uuid          REFERENCES suppliers(id) ON DELETE SET NULL,
      po_number              varchar(100)  NOT NULL,
      status                 varchar(50)   NOT NULL DEFAULT 'draft',
      expected_delivery_date date,
      notes                  text,
      subtotal               numeric(12,4) NOT NULL DEFAULT 0,
      tax_total              numeric(12,4) NOT NULL DEFAULT 0,
      total                  numeric(12,4) NOT NULL DEFAULT 0,
      sent_at                timestamptz,
      received_at            timestamptz,
      created_by             uuid          REFERENCES employees(id),
      created_at             timestamptz   NOT NULL DEFAULT now(),
      updated_at             timestamptz   NOT NULL DEFAULT now(),
      deleted_at             timestamptz,
      CONSTRAINT purchase_orders_org_po_unique UNIQUE (organization_id, po_number),
      CONSTRAINT purchase_orders_status_check CHECK (status IN (
        'draft','sent','confirmed','partially_received','received','cancelled'
      ))
    );
  `);

  // -------------------------------------------------------------------------
  // 27. purchase_order_lines
  // -------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE purchase_order_lines (
      id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      purchase_order_id   uuid          NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
      product_id          uuid          NOT NULL REFERENCES products(id),
      variant_id          uuid          REFERENCES product_variants(id),
      quantity_ordered    numeric(12,4) NOT NULL,
      quantity_received   numeric(12,4) NOT NULL DEFAULT 0,
      unit_cost           numeric(12,4) NOT NULL,
      total_cost          numeric(12,4) NOT NULL,
      received_at         timestamptz,
      created_at          timestamptz   NOT NULL DEFAULT now(),
      updated_at          timestamptz   NOT NULL DEFAULT now()
    );
  `);

  // -------------------------------------------------------------------------
  // 28. variance_reports
  // -------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE variance_reports (
      id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id  uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      location_id      uuid          NOT NULL REFERENCES locations(id),
      period_start     timestamptz   NOT NULL,
      period_end       timestamptz   NOT NULL,
      status           varchar(50)   NOT NULL DEFAULT 'draft',
      generated_by     uuid          REFERENCES employees(id),
      created_at       timestamptz   NOT NULL DEFAULT now(),
      updated_at       timestamptz   NOT NULL DEFAULT now(),
      CONSTRAINT variance_reports_status_check CHECK (status IN ('draft','finalized'))
    );
  `);

  // -------------------------------------------------------------------------
  // 29. variance_report_lines
  // -------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE variance_report_lines (
      id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      report_id            uuid          NOT NULL REFERENCES variance_reports(id) ON DELETE CASCADE,
      product_id           uuid          NOT NULL REFERENCES products(id),
      variant_id           uuid          REFERENCES product_variants(id),
      opening_quantity     numeric(12,4) NOT NULL,
      closing_quantity     numeric(12,4) NOT NULL,
      received_quantity    numeric(12,4) NOT NULL DEFAULT 0,
      theoretical_usage    numeric(12,4) NOT NULL,
      actual_usage         numeric(12,4) NOT NULL,
      variance_delta       numeric(12,4) NOT NULL,
      variance_pct         numeric(8,4)  NOT NULL,
      is_flagged           boolean       NOT NULL DEFAULT false,
      flag_threshold       numeric(8,4),
      ai_suggested_causes  jsonb                   DEFAULT '[]',
      created_at           timestamptz   NOT NULL DEFAULT now()
    );
  `);

  // -------------------------------------------------------------------------
  // 30. import_jobs
  // -------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE import_jobs (
      id               uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id  uuid           NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      import_type      varchar(100)   NOT NULL,
      status           varchar(50)    NOT NULL DEFAULT 'pending',
      source_filename  varchar(500),
      source_file_url  varchar(1000),
      mapping_config   jsonb,
      total_rows       integer,
      processed_rows   integer        NOT NULL DEFAULT 0,
      succeeded_rows   integer        NOT NULL DEFAULT 0,
      failed_rows      integer        NOT NULL DEFAULT 0,
      error_log        jsonb          NOT NULL DEFAULT '[]',
      preview_data     jsonb,
      started_at       timestamptz,
      completed_at     timestamptz,
      initiated_by     uuid           REFERENCES employees(id),
      created_at       timestamptz    NOT NULL DEFAULT now(),
      updated_at       timestamptz    NOT NULL DEFAULT now(),
      CONSTRAINT import_jobs_status_check CHECK (status IN (
        'pending','processing','awaiting_confirmation','completed','failed','partial'
      )),
      CONSTRAINT import_jobs_type_check CHECK (import_type IN (
        'migration_square','migration_shopify','migration_toast','migration_lightspeed',
        'migration_clover','migration_touchbistro','migration_paypal','migration_odoo',
        'migration_authorizenet','migration_vibe','document_menu','document_invoice',
        'document_goods_receipt','document_inventory','document_recipe','generic_csv'
      ))
    );
  `);

  // -------------------------------------------------------------------------
  // 31. audit_logs  (partitioned, immutable)
  // -------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE audit_logs (
      id               uuid          NOT NULL DEFAULT gen_random_uuid(),
      organization_id  uuid          NOT NULL,
      actor_id         uuid,
      actor_type       varchar(50)   NOT NULL DEFAULT 'employee',
      action           varchar(100)  NOT NULL,
      resource_type    varchar(100),
      resource_id      uuid,
      before_state     jsonb,
      after_state      jsonb,
      ip_address       varchar(45),
      user_agent       text,
      metadata         jsonb         NOT NULL DEFAULT '{}',
      created_at       timestamptz   NOT NULL DEFAULT now(),
      CONSTRAINT audit_logs_actor_type_check CHECK (actor_type IN ('employee','system','api'))
    ) PARTITION BY RANGE (created_at);
  `);

  // Monthly partitions 2025-01 through 2027-12
  pgm.sql(`
    DO $$
    DECLARE
      i         integer;
      sdate     timestamptz;
      edate     timestamptz;
      pname     text;
    BEGIN
      FOR i IN 0..35 LOOP
        sdate := date_trunc('month', TIMESTAMPTZ '2025-01-01' + (i || ' months')::interval);
        edate := sdate + interval '1 month';
        pname := 'audit_logs_' || to_char(sdate, 'YYYY_MM');
        EXECUTE format(
          'CREATE TABLE %I PARTITION OF audit_logs FOR VALUES FROM (%L) TO (%L)',
          pname, sdate, edate
        );
      END LOOP;
    END $$;
  `);

  // Default partition for out-of-range rows
  pgm.sql(`
    CREATE TABLE audit_logs_default PARTITION OF audit_logs DEFAULT;
  `);

  // -------------------------------------------------------------------------
  // 32. loyalty_transactions  (immutable ledger)
  // -------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE loyalty_transactions (
      id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id  uuid         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      customer_id      uuid         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      order_id         uuid         REFERENCES orders(id) ON DELETE SET NULL,
      transaction_type varchar(50)  NOT NULL,
      points_delta     integer      NOT NULL,
      points_before    integer      NOT NULL,
      points_after     integer      NOT NULL,
      notes            text,
      created_at       timestamptz  NOT NULL DEFAULT now(),
      CONSTRAINT loyalty_txn_type_check CHECK (transaction_type IN (
        'earn','redeem','adjust','expire','migrate'
      ))
    );
  `);

  // =========================================================================
  // INDEXES
  // =========================================================================
  pgm.sql(`
    -- organizations
    CREATE INDEX idx_organizations_deleted_at  ON organizations(deleted_at) WHERE deleted_at IS NULL;

    -- locations
    CREATE INDEX idx_locations_org             ON locations(organization_id);
    CREATE INDEX idx_locations_active          ON locations(organization_id, is_active) WHERE is_active = true AND deleted_at IS NULL;

    -- employees
    CREATE INDEX idx_employees_org             ON employees(organization_id);
    CREATE INDEX idx_employees_email           ON employees(email);
    CREATE INDEX idx_employees_org_active      ON employees(organization_id) WHERE deleted_at IS NULL;

    -- refresh_tokens
    CREATE INDEX idx_refresh_tokens_employee   ON refresh_tokens(employee_id);
    CREATE INDEX idx_refresh_tokens_hash       ON refresh_tokens(token_hash);
    CREATE INDEX idx_refresh_tokens_expires    ON refresh_tokens(expires_at);

    -- categories
    CREATE INDEX idx_categories_org            ON categories(organization_id);
    CREATE INDEX idx_categories_parent         ON categories(parent_id);
    CREATE INDEX idx_categories_active         ON categories(organization_id) WHERE is_active = true AND deleted_at IS NULL;

    -- suppliers
    CREATE INDEX idx_suppliers_org             ON suppliers(organization_id);
    CREATE INDEX idx_suppliers_active          ON suppliers(organization_id) WHERE is_active = true AND deleted_at IS NULL;

    -- products
    CREATE INDEX idx_products_org              ON products(organization_id);
    CREATE INDEX idx_products_category         ON products(category_id);
    CREATE INDEX idx_products_barcode          ON products(barcode) WHERE barcode IS NOT NULL;
    CREATE INDEX idx_products_sku              ON products(sku) WHERE sku IS NOT NULL;
    CREATE INDEX idx_products_active           ON products(organization_id) WHERE is_active = true AND deleted_at IS NULL;

    -- product_variants
    CREATE INDEX idx_variants_product          ON product_variants(product_id);
    CREATE INDEX idx_variants_org              ON product_variants(organization_id);
    CREATE INDEX idx_variants_barcode          ON product_variants(barcode) WHERE barcode IS NOT NULL;
    CREATE INDEX idx_variants_active           ON product_variants(product_id) WHERE is_active = true AND deleted_at IS NULL;

    -- product_prices
    CREATE INDEX idx_prices_variant            ON product_prices(variant_id);
    CREATE INDEX idx_prices_location           ON product_prices(location_id);
    CREATE INDEX idx_prices_effective          ON product_prices(variant_id, effective_from DESC) WHERE is_active = true;

    -- modifier_groups
    CREATE INDEX idx_modifier_groups_org       ON modifier_groups(organization_id);

    -- modifiers
    CREATE INDEX idx_modifiers_group           ON modifiers(group_id);

    -- product_modifier_groups
    CREATE INDEX idx_pmg_modifier_group        ON product_modifier_groups(modifier_group_id);

    -- recipes
    CREATE INDEX idx_recipes_product           ON recipes(product_id);
    CREATE INDEX idx_recipes_org               ON recipes(organization_id);

    -- recipe_lines
    CREATE INDEX idx_recipe_lines_recipe       ON recipe_lines(recipe_id);
    CREATE INDEX idx_recipe_lines_ingredient   ON recipe_lines(ingredient_product_id);

    -- customers
    CREATE INDEX idx_customers_org             ON customers(organization_id);
    CREATE INDEX idx_customers_email           ON customers(email) WHERE email IS NOT NULL;
    CREATE INDEX idx_customers_phone           ON customers(phone) WHERE phone IS NOT NULL;
    CREATE INDEX idx_customers_loyalty_tier    ON customers(loyalty_tier);
    CREATE INDEX idx_customers_active          ON customers(organization_id) WHERE deleted_at IS NULL;

    -- tables
    CREATE INDEX idx_tables_location           ON tables(location_id);
    CREATE INDEX idx_tables_org                ON tables(organization_id);

    -- inventory_levels
    CREATE INDEX idx_inv_levels_org            ON inventory_levels(organization_id);
    CREATE INDEX idx_inv_levels_location       ON inventory_levels(location_id);
    CREATE INDEX idx_inv_levels_product        ON inventory_levels(product_id);

    -- inventory_movements
    CREATE INDEX idx_inv_movements_org         ON inventory_movements(organization_id);
    CREATE INDEX idx_inv_movements_loc_prod    ON inventory_movements(location_id, product_id);
    CREATE INDEX idx_inv_movements_type        ON inventory_movements(movement_type);
    CREATE INDEX idx_inv_movements_created     ON inventory_movements(created_at DESC);
    CREATE INDEX idx_inv_movements_reference   ON inventory_movements(reference_id) WHERE reference_id IS NOT NULL;

    -- orders
    CREATE INDEX idx_orders_org                ON orders(organization_id);
    CREATE INDEX idx_orders_location           ON orders(location_id);
    CREATE INDEX idx_orders_customer           ON orders(customer_id) WHERE customer_id IS NOT NULL;
    CREATE INDEX idx_orders_status             ON orders(status);
    CREATE INDEX idx_orders_created            ON orders(created_at DESC);
    CREATE INDEX idx_orders_number             ON orders(order_number);
    CREATE INDEX idx_orders_employee           ON orders(employee_id);

    -- order_line_items
    CREATE INDEX idx_oli_order                 ON order_line_items(order_id);
    CREATE INDEX idx_oli_product               ON order_line_items(product_id);

    -- payments
    CREATE INDEX idx_payments_order            ON payments(order_id);
    CREATE INDEX idx_payments_status           ON payments(status);
    CREATE INDEX idx_payments_processor_id     ON payments(processor_payment_id) WHERE processor_payment_id IS NOT NULL;

    -- discounts
    CREATE INDEX idx_discounts_org             ON discounts(organization_id);
    CREATE INDEX idx_discounts_code            ON discounts(code) WHERE code IS NOT NULL;
    CREATE INDEX idx_discounts_active          ON discounts(organization_id) WHERE is_active = true AND deleted_at IS NULL;

    -- applied_discounts
    CREATE INDEX idx_applied_disc_order        ON applied_discounts(order_id);
    CREATE INDEX idx_applied_disc_discount     ON applied_discounts(discount_id);

    -- gift_cards
    CREATE INDEX idx_gift_cards_org            ON gift_cards(organization_id);
    CREATE INDEX idx_gift_cards_code           ON gift_cards(code);
    CREATE INDEX idx_gift_cards_customer       ON gift_cards(issued_to_customer_id);

    -- gift_card_transactions
    CREATE INDEX idx_gct_gift_card             ON gift_card_transactions(gift_card_id);
    CREATE INDEX idx_gct_order                 ON gift_card_transactions(order_id);

    -- purchase_orders
    CREATE INDEX idx_po_org                    ON purchase_orders(organization_id);
    CREATE INDEX idx_po_location               ON purchase_orders(location_id);
    CREATE INDEX idx_po_supplier               ON purchase_orders(supplier_id);
    CREATE INDEX idx_po_status                 ON purchase_orders(status);

    -- purchase_order_lines
    CREATE INDEX idx_pol_purchase_order        ON purchase_order_lines(purchase_order_id);
    CREATE INDEX idx_pol_product               ON purchase_order_lines(product_id);

    -- variance_reports
    CREATE INDEX idx_vr_org                    ON variance_reports(organization_id);
    CREATE INDEX idx_vr_location               ON variance_reports(location_id);
    CREATE INDEX idx_vr_period                 ON variance_reports(period_start);

    -- variance_report_lines
    CREATE INDEX idx_vrl_report                ON variance_report_lines(report_id);
    CREATE INDEX idx_vrl_product               ON variance_report_lines(product_id);
    CREATE INDEX idx_vrl_flagged               ON variance_report_lines(report_id) WHERE is_flagged = true;

    -- import_jobs
    CREATE INDEX idx_import_jobs_org           ON import_jobs(organization_id);
    CREATE INDEX idx_import_jobs_status        ON import_jobs(status);
    CREATE INDEX idx_import_jobs_type          ON import_jobs(import_type);

    -- audit_logs (on the parent — propagates to partitions)
    CREATE INDEX idx_audit_logs_org_created    ON audit_logs(organization_id, created_at DESC);
    CREATE INDEX idx_audit_logs_actor          ON audit_logs(actor_id) WHERE actor_id IS NOT NULL;
    CREATE INDEX idx_audit_logs_action         ON audit_logs(action);
    CREATE INDEX idx_audit_logs_resource       ON audit_logs(resource_id) WHERE resource_id IS NOT NULL;

    -- loyalty_transactions
    CREATE INDEX idx_loyalty_txn_customer      ON loyalty_transactions(customer_id);
    CREATE INDEX idx_loyalty_txn_order         ON loyalty_transactions(order_id);
    CREATE INDEX idx_loyalty_txn_org           ON loyalty_transactions(organization_id);
  `);

  // =========================================================================
  // TRIGGERS — updated_at
  // =========================================================================
  pgm.sql(`
    DO $$
    DECLARE
      tbl text;
    BEGIN
      FOREACH tbl IN ARRAY ARRAY[
        'organizations','locations','employees','categories','suppliers',
        'products','product_variants','product_prices','modifier_groups',
        'modifiers','recipes','recipe_lines','customers','tables',
        'inventory_levels','orders','order_line_items','payments',
        'discounts','gift_cards','purchase_orders','purchase_order_lines',
        'variance_reports','import_jobs'
      ] LOOP
        EXECUTE format(
          'CREATE TRIGGER trg_%I_updated_at
           BEFORE UPDATE ON %I
           FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at()',
          tbl, tbl
        );
      END LOOP;
    END $$;
  `);

  // =========================================================================
  // TRIGGER — order_number auto-generation
  // =========================================================================
  pgm.sql(`
    CREATE OR REPLACE FUNCTION fn_generate_order_number()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
    DECLARE
      v_year    integer;
      v_counter integer;
    BEGIN
      IF NEW.order_number IS NOT NULL AND NEW.order_number <> '' THEN
        RETURN NEW;
      END IF;

      v_year := EXTRACT(YEAR FROM now())::integer;

      INSERT INTO organization_order_sequences (organization_id, year, counter)
      VALUES (NEW.organization_id, v_year, 1)
      ON CONFLICT (organization_id, year) DO UPDATE
        SET counter = organization_order_sequences.counter + 1
      RETURNING counter INTO v_counter;

      NEW.order_number := 'T-' || v_year::text || '-' || LPAD(v_counter::text, 6, '0');
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER trg_orders_order_number
      BEFORE INSERT ON orders
      FOR EACH ROW EXECUTE FUNCTION fn_generate_order_number();
  `);

  // =========================================================================
  // TRIGGER — inventory_levels auto-upsert on movement insert
  // =========================================================================
  pgm.sql(`
    CREATE OR REPLACE FUNCTION fn_update_inventory_on_movement()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.variant_id IS NOT NULL THEN
        -- Variant-level inventory
        UPDATE inventory_levels
        SET
          quantity_on_hand = quantity_on_hand + NEW.quantity_delta,
          updated_at       = NOW()
        WHERE location_id = NEW.location_id
          AND product_id  = NEW.product_id
          AND variant_id  = NEW.variant_id;

        IF NOT FOUND THEN
          INSERT INTO inventory_levels
            (id, organization_id, location_id, product_id, variant_id,
             quantity_on_hand, created_at, updated_at)
          VALUES
            (gen_random_uuid(), NEW.organization_id, NEW.location_id,
             NEW.product_id, NEW.variant_id,
             NEW.quantity_delta, NOW(), NOW());
        END IF;
      ELSE
        -- Product-level inventory (no variant)
        UPDATE inventory_levels
        SET
          quantity_on_hand = quantity_on_hand + NEW.quantity_delta,
          updated_at       = NOW()
        WHERE location_id = NEW.location_id
          AND product_id  = NEW.product_id
          AND variant_id  IS NULL;

        IF NOT FOUND THEN
          INSERT INTO inventory_levels
            (id, organization_id, location_id, product_id, variant_id,
             quantity_on_hand, created_at, updated_at)
          VALUES
            (gen_random_uuid(), NEW.organization_id, NEW.location_id,
             NEW.product_id, NULL,
             NEW.quantity_delta, NOW(), NOW());
        END IF;
      END IF;

      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER trg_inventory_movement_upsert
      AFTER INSERT ON inventory_movements
      FOR EACH ROW EXECUTE FUNCTION fn_update_inventory_on_movement();
  `);

  // =========================================================================
  // ANALYTICAL FUNCTIONS
  // =========================================================================
  pgm.sql(`
    -- Returns theoretical usage of an ingredient product over a time window
    CREATE OR REPLACE FUNCTION get_theoretical_usage(
      p_product_id  uuid,
      p_location_id uuid,
      p_start       timestamptz,
      p_end         timestamptz
    )
    RETURNS numeric LANGUAGE sql STABLE AS $$
      SELECT COALESCE(SUM(
        oli.quantity
        * rl.quantity
        * (1 + rl.waste_factor)
        / NULLIF(r.yield_factor, 0)
      ), 0)
      FROM order_line_items   oli
      JOIN orders             o   ON o.id          = oli.order_id
      JOIN recipes            r   ON r.product_id  = oli.product_id
                                  AND r.is_active  = true
                                  AND r.deleted_at IS NULL
      JOIN recipe_lines       rl  ON rl.recipe_id  = r.id
                                  AND rl.ingredient_product_id = p_product_id
      WHERE o.location_id = p_location_id
        AND o.status      = 'completed'
        AND o.created_at >= p_start
        AND o.created_at <  p_end;
    $$;
  `);

  pgm.sql(`
    -- Returns average hourly depletion rate over the last N hours
    CREATE OR REPLACE FUNCTION get_burn_rate(
      p_product_id    uuid,
      p_location_id   uuid,
      p_window_hours  integer DEFAULT 24
    )
    RETURNS numeric LANGUAGE sql STABLE AS $$
      SELECT COALESCE(
        ABS(SUM(quantity_delta)) / NULLIF(p_window_hours, 0),
        0
      )
      FROM inventory_movements
      WHERE product_id    = p_product_id
        AND location_id   = p_location_id
        AND movement_type IN ('sale','waste','transfer_out')
        AND created_at   >= NOW() - (p_window_hours || ' hours')::interval;
    $$;
  `);

  pgm.sql(`
    -- Populates variance_report_lines for a given report
    CREATE OR REPLACE FUNCTION calculate_variance(p_report_id uuid)
    RETURNS void LANGUAGE plpgsql AS $$
    DECLARE
      v_report       variance_reports%ROWTYPE;
      v_rec          RECORD;
      v_theoretical  numeric;
      v_actual       numeric;
      v_delta        numeric;
      v_pct          numeric;
    BEGIN
      SELECT * INTO v_report FROM variance_reports WHERE id = p_report_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Variance report % not found', p_report_id;
      END IF;

      -- Delete existing lines (allows recalculation)
      DELETE FROM variance_report_lines WHERE report_id = p_report_id;

      FOR v_rec IN
        SELECT
          il.product_id,
          il.variant_id,
          -- Opening: quantity_on_hand minus net movements since period_start
          il.quantity_on_hand
            - COALESCE((
                SELECT SUM(im2.quantity_delta)
                FROM inventory_movements im2
                WHERE im2.product_id   = il.product_id
                  AND im2.variant_id IS NOT DISTINCT FROM il.variant_id
                  AND im2.location_id  = il.location_id
                  AND im2.created_at  >= v_report.period_start
                  AND im2.created_at  <  v_report.period_end
            ), 0) AS opening_qty,
          il.quantity_on_hand                                           AS closing_qty,
          COALESCE((
            SELECT SUM(im3.quantity_delta)
            FROM inventory_movements im3
            WHERE im3.product_id   = il.product_id
              AND im3.variant_id IS NOT DISTINCT FROM il.variant_id
              AND im3.location_id  = il.location_id
              AND im3.movement_type = 'po_receipt'
              AND im3.created_at  >= v_report.period_start
              AND im3.created_at  <  v_report.period_end
          ), 0) AS received_qty
        FROM inventory_levels il
        WHERE il.location_id = v_report.location_id
      LOOP
        v_theoretical := get_theoretical_usage(
          v_rec.product_id, v_report.location_id,
          v_report.period_start, v_report.period_end
        );

        v_actual := (v_rec.opening_qty + v_rec.received_qty) - v_rec.closing_qty;
        v_delta  := v_actual - v_theoretical;
        v_pct    := CASE
          WHEN v_theoretical = 0 THEN 0
          ELSE ROUND((v_delta / v_theoretical) * 100, 4)
        END;

        INSERT INTO variance_report_lines (
          id, report_id, product_id, variant_id,
          opening_quantity, closing_quantity, received_quantity,
          theoretical_usage, actual_usage,
          variance_delta, variance_pct,
          is_flagged, created_at
        ) VALUES (
          gen_random_uuid(), p_report_id, v_rec.product_id, v_rec.variant_id,
          v_rec.opening_qty, v_rec.closing_qty, v_rec.received_qty,
          v_theoretical, v_actual,
          v_delta, v_pct,
          ABS(v_pct) > 10, -- flag >10% variance by default
          NOW()
        );
      END LOOP;

      UPDATE variance_reports SET updated_at = NOW() WHERE id = p_report_id;
    END;
    $$;
  `);

  // =========================================================================
  // VIEWS
  // =========================================================================
  pgm.sql(`
    CREATE VIEW employees_safe AS
    SELECT
      id, organization_id, email, email_verified_at,
      first_name, last_name, phone, role, permissions,
      totp_enabled, last_login_at, failed_login_attempts, locked_until,
      commission_rate, location_ids,
      created_by, created_at, updated_at, deleted_at
    FROM employees;
  `);

  // =========================================================================
  // ROLES & LEAST-PRIVILEGE PERMISSIONS
  // =========================================================================
  pgm.sql(`
    DO $$
    BEGIN
      CREATE ROLE db_app_user NOLOGIN;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  pgm.sql(`
    -- Grant standard DML on all current tables
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON ALL TABLES IN SCHEMA public
      TO db_app_user;

    GRANT USAGE, SELECT
      ON ALL SEQUENCES IN SCHEMA public
      TO db_app_user;

    -- Prevent app from dropping or truncating core tables
    REVOKE TRUNCATE
      ON organizations, locations, employees, orders, order_line_items,
         payments, products, customers, inventory_movements, audit_logs
      FROM db_app_user;

    -- audit_logs: INSERT-only from app layer; no UPDATE or DELETE ever
    REVOKE UPDATE, DELETE
      ON audit_logs
      FROM db_app_user;

    -- employees: never expose sensitive columns from base table; use the view
    REVOKE SELECT ON employees FROM db_app_user;
    GRANT  SELECT ON employees_safe TO db_app_user;

    -- grant INSERT on employees for account creation (through stored procedure ideally)
    GRANT INSERT, UPDATE ON employees TO db_app_user;
  `);
};

// ---------------------------------------------------------------------------
// DOWN — reverse dependency order
// ---------------------------------------------------------------------------
exports.down = (pgm) => {
  // Functions & triggers
  pgm.sql(`
    DROP FUNCTION IF EXISTS calculate_variance(uuid) CASCADE;
    DROP FUNCTION IF EXISTS get_theoretical_usage(uuid,uuid,timestamptz,timestamptz) CASCADE;
    DROP FUNCTION IF EXISTS get_burn_rate(uuid,uuid,integer) CASCADE;
    DROP FUNCTION IF EXISTS fn_generate_order_number() CASCADE;
    DROP FUNCTION IF EXISTS fn_update_inventory_on_movement() CASCADE;
    DROP FUNCTION IF EXISTS trigger_set_updated_at() CASCADE;
  `);

  pgm.sql(`DROP VIEW IF EXISTS employees_safe;`);

  // Tables in reverse FK order
  pgm.sql(`
    DROP TABLE IF EXISTS loyalty_transactions          CASCADE;
    DROP TABLE IF EXISTS audit_logs                   CASCADE;
    DROP TABLE IF EXISTS import_jobs                  CASCADE;
    DROP TABLE IF EXISTS variance_report_lines        CASCADE;
    DROP TABLE IF EXISTS variance_reports             CASCADE;
    DROP TABLE IF EXISTS purchase_order_lines         CASCADE;
    DROP TABLE IF EXISTS purchase_orders              CASCADE;
    DROP TABLE IF EXISTS gift_card_transactions       CASCADE;
    DROP TABLE IF EXISTS gift_cards                   CASCADE;
    DROP TABLE IF EXISTS applied_discounts            CASCADE;
    DROP TABLE IF EXISTS discounts                    CASCADE;
    DROP TABLE IF EXISTS payments                     CASCADE;
    DROP TABLE IF EXISTS order_line_items             CASCADE;
    DROP TABLE IF EXISTS orders                       CASCADE;
    DROP TABLE IF EXISTS inventory_movements          CASCADE;
    DROP TABLE IF EXISTS inventory_levels             CASCADE;
    DROP TABLE IF EXISTS tables                       CASCADE;
    DROP TABLE IF EXISTS customers                    CASCADE;
    DROP TABLE IF EXISTS recipe_lines                 CASCADE;
    DROP TABLE IF EXISTS recipes                      CASCADE;
    DROP TABLE IF EXISTS product_modifier_groups      CASCADE;
    DROP TABLE IF EXISTS modifiers                    CASCADE;
    DROP TABLE IF EXISTS modifier_groups              CASCADE;
    DROP TABLE IF EXISTS product_prices               CASCADE;
    DROP TABLE IF EXISTS product_variants             CASCADE;
    DROP TABLE IF EXISTS products                     CASCADE;
    DROP TABLE IF EXISTS suppliers                    CASCADE;
    DROP TABLE IF EXISTS categories                   CASCADE;
    DROP TABLE IF EXISTS refresh_tokens               CASCADE;
    DROP TABLE IF EXISTS employees                    CASCADE;
    DROP TABLE IF EXISTS locations                    CASCADE;
    DROP TABLE IF EXISTS organization_order_sequences CASCADE;
    DROP TABLE IF EXISTS organizations                CASCADE;
  `);

  pgm.sql(`
    DROP EXTENSION IF EXISTS "btree_gin";
    DROP EXTENSION IF EXISTS "pgcrypto";
  `);
};
