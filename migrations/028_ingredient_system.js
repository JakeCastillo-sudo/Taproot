/**
 * 028 — Ingredient system (Session 1, FEATURE-FLAGGED, additive).
 *
 * Adds a full ingredient/recipe/inventory layer that is OFF by default:
 *   - products.recipe_mode defaults false → existing modifier system untouched.
 *   - New columns on modifiers / modifier_groups are all nullable / defaulted so
 *     existing rows are unaffected.
 *
 * Pattern matches 001_initial_schema.js (raw pgm.sql). All new tables use
 * IF NOT EXISTS; the down migration only drops what this migration created.
 *
 * Money: cost_per_unit / *_price columns are INTEGER CENTS.
 */

exports.up = (pgm) => {
  // ── ingredients (master library) ─────────────────────────────────────────────
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS ingredients (
      id                     uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id        uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name                   varchar(255)  NOT NULL,

      unit                   varchar(50)   NOT NULL DEFAULT 'qty',
      unit_label             varchar(50),

      cost_per_unit          integer       NOT NULL DEFAULT 0,

      current_stock          numeric(12,4) NOT NULL DEFAULT 0,
      par_level              numeric(12,4) NOT NULL DEFAULT 0,
      reorder_point          numeric(12,4) NOT NULL DEFAULT 0,

      is_universal_addon     boolean       NOT NULL DEFAULT false,
      universal_addon_price  integer       NOT NULL DEFAULT 0,
      universal_addon_label  varchar(255),

      category               varchar(100),

      deleted_at             timestamptz,
      created_at             timestamptz   NOT NULL DEFAULT now(),
      updated_at             timestamptz   NOT NULL DEFAULT now()
    );
  `);

  // ── product_ingredients (recipe) ─────────────────────────────────────────────
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS product_ingredients (
      id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id            uuid          NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      ingredient_id         uuid          NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
      organization_id       uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

      quantity              numeric(12,4) NOT NULL DEFAULT 1,
      unit                  varchar(50)   NOT NULL DEFAULT 'qty',

      is_optional           boolean       NOT NULL DEFAULT true,
      omission_price_delta  integer       NOT NULL DEFAULT 0,
      extra_price_delta     integer       NOT NULL DEFAULT 0,
      extra_quantity        numeric(12,4) NOT NULL DEFAULT 1,
      display_order         integer       NOT NULL DEFAULT 0,

      created_at            timestamptz   NOT NULL DEFAULT now(),

      UNIQUE (product_id, ingredient_id)
    );
  `);

  // ── product_ingredient_exclusions (universal add-on opt-out) ──────────────────
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS product_ingredient_exclusions (
      product_id       uuid        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      ingredient_id    uuid        NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
      organization_id  uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      created_at       timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (product_id, ingredient_id)
    );
  `);

  // ── stock_movements (audit log) ──────────────────────────────────────────────
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS stock_movements (
      id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id      uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      ingredient_id        uuid          NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,

      movement_type        varchar(50)   NOT NULL,

      quantity_change      numeric(12,4) NOT NULL,
      quantity_before      numeric(12,4) NOT NULL,
      quantity_after       numeric(12,4) NOT NULL,

      order_id             uuid          REFERENCES orders(id) ON DELETE SET NULL,
      order_line_item_id   uuid,

      notes                text,
      created_by           uuid          REFERENCES employees(id) ON DELETE SET NULL,
      created_at           timestamptz   NOT NULL DEFAULT now()
    );
  `);

  // ── products.recipe_mode flag ────────────────────────────────────────────────
  pgm.sql(`
    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS recipe_mode boolean NOT NULL DEFAULT false;
  `);

  // ── modifiers: ingredient awareness (all nullable / defaulted) ───────────────
  pgm.sql(`
    ALTER TABLE modifiers
      ADD COLUMN IF NOT EXISTS modifier_type     varchar(50) DEFAULT 'custom',
      ADD COLUMN IF NOT EXISTS ingredient_id     uuid REFERENCES ingredients(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS ingredient_qty    numeric(12,4),
      ADD COLUMN IF NOT EXISTS is_auto_generated boolean NOT NULL DEFAULT false;
  `);

  // ── modifier_groups: auto-generation tracking ────────────────────────────────
  pgm.sql(`
    ALTER TABLE modifier_groups
      ADD COLUMN IF NOT EXISTS group_type        varchar(50) DEFAULT 'custom',
      ADD COLUMN IF NOT EXISTS is_auto_generated boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS source_product_id uuid REFERENCES products(id) ON DELETE CASCADE;
  `);

  // ── indexes ──────────────────────────────────────────────────────────────────
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_ingredients_org
             ON ingredients (organization_id) WHERE deleted_at IS NULL;`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_ingredients_universal
             ON ingredients (organization_id, is_universal_addon)
             WHERE deleted_at IS NULL AND is_universal_addon = true;`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_product_ingredients_product
             ON product_ingredients (product_id);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_product_ingredients_org
             ON product_ingredients (organization_id);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_stock_movements_ingredient
             ON stock_movements (ingredient_id, created_at DESC);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_stock_movements_order
             ON stock_movements (order_id) WHERE order_id IS NOT NULL;`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_modifiers_ingredient
             ON modifiers (ingredient_id) WHERE ingredient_id IS NOT NULL;`);
};

exports.down = (pgm) => {
  // Remove added columns (existing tables stay intact otherwise).
  pgm.sql(`
    ALTER TABLE modifier_groups
      DROP COLUMN IF EXISTS group_type,
      DROP COLUMN IF EXISTS is_auto_generated,
      DROP COLUMN IF EXISTS source_product_id;
  `);
  pgm.sql(`
    ALTER TABLE modifiers
      DROP COLUMN IF EXISTS modifier_type,
      DROP COLUMN IF EXISTS ingredient_id,
      DROP COLUMN IF EXISTS ingredient_qty,
      DROP COLUMN IF EXISTS is_auto_generated;
  `);
  pgm.sql(`ALTER TABLE products DROP COLUMN IF EXISTS recipe_mode;`);

  // Drop new tables (children first).
  pgm.sql(`DROP TABLE IF EXISTS stock_movements;`);
  pgm.sql(`DROP TABLE IF EXISTS product_ingredient_exclusions;`);
  pgm.sql(`DROP TABLE IF EXISTS product_ingredients;`);
  pgm.sql(`DROP TABLE IF EXISTS ingredients;`);
};
