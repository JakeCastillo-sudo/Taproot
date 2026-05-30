/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  // ── Organization & Location ──────────────────────────────────────────────
  pgm.sql(`
    INSERT INTO organizations (id, name, slug, plan, currency, timezone, locale, tax_inclusive)
    VALUES (
      'org_00000000-0000-0000-0000-000000000001',
      'Demo Restaurant',
      'demo-restaurant',
      'pro',
      'USD',
      'America/Chicago',
      'en-US',
      false
    );
  `);

  pgm.sql(`
    INSERT INTO locations (id, organization_id, name, slug, address, phone, timezone, is_active)
    VALUES (
      'loc_00000000-0000-0000-0000-000000000001',
      'org_00000000-0000-0000-0000-000000000001',
      'Main Street Location',
      'main-street',
      '{"line1":"123 Main St","city":"Austin","state":"TX","zip":"78701","country":"US"}',
      '+15125550100',
      'America/Chicago',
      true
    );
  `);

  // ── Owner Employee ────────────────────────────────────────────────────────
  // password: TaprootDemo2026!  (bcrypt cost 12)
  pgm.sql(`
    INSERT INTO employees (
      id, organization_id, email, password_hash,
      first_name, last_name, role, is_active
    ) VALUES (
      'emp_00000000-0000-0000-0000-000000000001',
      'org_00000000-0000-0000-0000-000000000001',
      'demo@taproot.pos',
      '$2b$12$W/yAW3jTGEuQY6en5eTNP.M6WBi0uArImgJA00OAKEwiLMQNViXwq',
      'Demo',
      'Owner',
      'owner',
      true
    );
  `);

  pgm.sql(`
    INSERT INTO employee_locations (employee_id, location_id)
    VALUES (
      'emp_00000000-0000-0000-0000-000000000001',
      'loc_00000000-0000-0000-0000-000000000001'
    );
  `);

  // ── Tax Rates ─────────────────────────────────────────────────────────────
  pgm.sql(`
    INSERT INTO tax_rates (id, organization_id, name, rate, applies_to, is_active)
    VALUES
      ('tax_00000000-0000-0000-0000-000000000001', 'org_00000000-0000-0000-0000-000000000001', 'Sales Tax',    0.0825, 'all',          true),
      ('tax_00000000-0000-0000-0000-000000000002', 'org_00000000-0000-0000-0000-000000000001', 'Alcohol Tax',  0.1400, 'alcohol',      true),
      ('tax_00000000-0000-0000-0000-000000000003', 'org_00000000-0000-0000-0000-000000000001', 'No Tax',       0.0000, 'non_taxable',  false);
  `);

  // ── Categories ────────────────────────────────────────────────────────────
  pgm.sql(`
    INSERT INTO categories (id, organization_id, name, slug, sort_order, is_active)
    VALUES
      ('cat_00000000-0000-0000-0000-000000000001', 'org_00000000-0000-0000-0000-000000000001', 'Food',        'food',        1, true),
      ('cat_00000000-0000-0000-0000-000000000002', 'org_00000000-0000-0000-0000-000000000001', 'Beverages',   'beverages',   2, true),
      ('cat_00000000-0000-0000-0000-000000000003', 'org_00000000-0000-0000-0000-000000000001', 'Alcohol',     'alcohol',     3, true),
      ('cat_00000000-0000-0000-0000-000000000004', 'org_00000000-0000-0000-0000-000000000001', 'Merchandise', 'merchandise', 4, true),
      ('cat_00000000-0000-0000-0000-000000000005', 'org_00000000-0000-0000-0000-000000000001', 'Modifiers',   'modifiers',   5, true);
  `);

  // ── Products ──────────────────────────────────────────────────────────────
  pgm.sql(`
    INSERT INTO products (
      id, organization_id, category_id, name, slug,
      description, track_inventory, is_active
    ) VALUES
      -- Food
      ('prd_00000000-0000-0000-0000-000000000001', 'org_00000000-0000-0000-0000-000000000001',
       'cat_00000000-0000-0000-0000-000000000001', 'Classic Burger', 'classic-burger',
       'Beef patty, lettuce, tomato, onion, pickles', true, true),

      ('prd_00000000-0000-0000-0000-000000000002', 'org_00000000-0000-0000-0000-000000000001',
       'cat_00000000-0000-0000-0000-000000000001', 'Caesar Salad', 'caesar-salad',
       'Romaine, croutons, parmesan, Caesar dressing', true, true),

      ('prd_00000000-0000-0000-0000-000000000003', 'org_00000000-0000-0000-0000-000000000001',
       'cat_00000000-0000-0000-0000-000000000001', 'Margherita Pizza', 'margherita-pizza',
       'San Marzano tomato, fresh mozzarella, basil', true, true),

      ('prd_00000000-0000-0000-0000-000000000004', 'org_00000000-0000-0000-0000-000000000001',
       'cat_00000000-0000-0000-0000-000000000001', 'French Fries', 'french-fries',
       'Crispy golden fries', true, true),

      -- Beverages
      ('prd_00000000-0000-0000-0000-000000000005', 'org_00000000-0000-0000-0000-000000000001',
       'cat_00000000-0000-0000-0000-000000000002', 'Fountain Soda', 'fountain-soda',
       'Pepsi, Diet Pepsi, Dr Pepper, Lemonade', false, true),

      ('prd_00000000-0000-0000-0000-000000000006', 'org_00000000-0000-0000-0000-000000000001',
       'cat_00000000-0000-0000-0000-000000000002', 'House Coffee', 'house-coffee',
       'Freshly brewed medium roast', false, true),

      -- Alcohol
      ('prd_00000000-0000-0000-0000-000000000007', 'org_00000000-0000-0000-0000-000000000001',
       'cat_00000000-0000-0000-0000-000000000003', 'Draft Beer', 'draft-beer',
       'Rotating local craft selection', false, true),

      ('prd_00000000-0000-0000-0000-000000000008', 'org_00000000-0000-0000-0000-000000000001',
       'cat_00000000-0000-0000-0000-000000000003', 'House Wine', 'house-wine',
       'Red or White — ask your server', false, true),

      -- Merchandise
      ('prd_00000000-0000-0000-0000-000000000009', 'org_00000000-0000-0000-0000-000000000001',
       'cat_00000000-0000-0000-0000-000000000004', 'Branded Tote Bag', 'branded-tote-bag',
       'Reusable canvas tote with restaurant logo', true, true),

      -- Modifiers (sold as add-ons, no inventory)
      ('prd_00000000-0000-0000-0000-000000000010', 'org_00000000-0000-0000-0000-000000000001',
       'cat_00000000-0000-0000-0000-000000000005', 'Extra Sauce', 'extra-sauce',
       'Any sauce — house, ranch, chipotle', false, true);
  `);

  // ── Product Variants & Prices ─────────────────────────────────────────────
  pgm.sql(`
    INSERT INTO product_variants (
      id, product_id, sku, name, options, sort_order, is_active
    ) VALUES
      -- Classic Burger: one default variant
      ('var_0000-0001-01', 'prd_00000000-0000-0000-0000-000000000001',
       'BURGER-STD', 'Standard', '{}', 1, true),

      -- Caesar Salad: half / full
      ('var_0000-0002-01', 'prd_00000000-0000-0000-0000-000000000002',
       'CAESAR-HALF', 'Half', '{"size":"half"}', 1, true),
      ('var_0000-0002-02', 'prd_00000000-0000-0000-0000-000000000002',
       'CAESAR-FULL', 'Full', '{"size":"full"}', 2, true),

      -- Margherita Pizza: 10-inch / 14-inch
      ('var_0000-0003-01', 'prd_00000000-0000-0000-0000-000000000003',
       'PIZZA-10', '10 inch', '{"size":"10"}', 1, true),
      ('var_0000-0003-02', 'prd_00000000-0000-0000-0000-000000000003',
       'PIZZA-14', '14 inch', '{"size":"14"}', 2, true),

      -- French Fries: one default variant
      ('var_0000-0004-01', 'prd_00000000-0000-0000-0000-000000000004',
       'FRIES-STD', 'Standard', '{}', 1, true),

      -- Fountain Soda: small / medium / large
      ('var_0000-0005-01', 'prd_00000000-0000-0000-0000-000000000005',
       'SODA-SM', 'Small',  '{"size":"small"}',  1, true),
      ('var_0000-0005-02', 'prd_00000000-0000-0000-0000-000000000005',
       'SODA-MD', 'Medium', '{"size":"medium"}', 2, true),
      ('var_0000-0005-03', 'prd_00000000-0000-0000-0000-000000000005',
       'SODA-LG', 'Large',  '{"size":"large"}',  3, true),

      -- House Coffee: one default variant
      ('var_0000-0006-01', 'prd_00000000-0000-0000-0000-000000000006',
       'COFFEE-STD', 'Standard', '{}', 1, true),

      -- Draft Beer: pint / pitcher
      ('var_0000-0007-01', 'prd_00000000-0000-0000-0000-000000000007',
       'BEER-PINT',    'Pint',    '{"size":"pint"}',    1, true),
      ('var_0000-0007-02', 'prd_00000000-0000-0000-0000-000000000007',
       'BEER-PITCHER', 'Pitcher', '{"size":"pitcher"}', 2, true),

      -- House Wine: glass / bottle
      ('var_0000-0008-01', 'prd_00000000-0000-0000-0000-000000000008',
       'WINE-GLASS',  'Glass',  '{"size":"glass"}',  1, true),
      ('var_0000-0008-02', 'prd_00000000-0000-0000-0000-000000000008',
       'WINE-BOTTLE', 'Bottle', '{"size":"bottle"}', 2, true),

      -- Branded Tote Bag: one default variant
      ('var_0000-0009-01', 'prd_00000000-0000-0000-0000-000000000009',
       'TOTE-STD', 'Standard', '{}', 1, true),

      -- Extra Sauce: one default variant
      ('var_0000-0010-01', 'prd_00000000-0000-0000-0000-000000000010',
       'SAUCE-ADD', 'Add-On', '{}', 1, true);
  `);

  pgm.sql(`
    INSERT INTO prices (
      id, organization_id, variant_id, location_id,
      amount, currency, is_active
    ) VALUES
      ('pri_0001', 'org_00000000-0000-0000-0000-000000000001', 'var_0000-0001-01', 'loc_00000000-0000-0000-0000-000000000001', 1299, 'USD', true),
      ('pri_0002', 'org_00000000-0000-0000-0000-000000000001', 'var_0000-0002-01', 'loc_00000000-0000-0000-0000-000000000001',  799, 'USD', true),
      ('pri_0003', 'org_00000000-0000-0000-0000-000000000001', 'var_0000-0002-02', 'loc_00000000-0000-0000-0000-000000000001', 1299, 'USD', true),
      ('pri_0004', 'org_00000000-0000-0000-0000-000000000001', 'var_0000-0003-01', 'loc_00000000-0000-0000-0000-000000000001', 1199, 'USD', true),
      ('pri_0005', 'org_00000000-0000-0000-0000-000000000001', 'var_0000-0003-02', 'loc_00000000-0000-0000-0000-000000000001', 1699, 'USD', true),
      ('pri_0006', 'org_00000000-0000-0000-0000-000000000001', 'var_0000-0004-01', 'loc_00000000-0000-0000-0000-000000000001',  449, 'USD', true),
      ('pri_0007', 'org_00000000-0000-0000-0000-000000000001', 'var_0000-0005-01', 'loc_00000000-0000-0000-0000-000000000001',  199, 'USD', true),
      ('pri_0008', 'org_00000000-0000-0000-0000-000000000001', 'var_0000-0005-02', 'loc_00000000-0000-0000-0000-000000000001',  249, 'USD', true),
      ('pri_0009', 'org_00000000-0000-0000-0000-000000000001', 'var_0000-0005-03', 'loc_00000000-0000-0000-0000-000000000001',  299, 'USD', true),
      ('pri_0010', 'org_00000000-0000-0000-0000-000000000001', 'var_0000-0006-01', 'loc_00000000-0000-0000-0000-000000000001',  349, 'USD', true),
      ('pri_0011', 'org_00000000-0000-0000-0000-000000000001', 'var_0000-0007-01', 'loc_00000000-0000-0000-0000-000000000001',  699, 'USD', true),
      ('pri_0012', 'org_00000000-0000-0000-0000-000000000001', 'var_0000-0007-02', 'loc_00000000-0000-0000-0000-000000000001', 1999, 'USD', true),
      ('pri_0013', 'org_00000000-0000-0000-0000-000000000001', 'var_0000-0008-01', 'loc_00000000-0000-0000-0000-000000000001',  899, 'USD', true),
      ('pri_0014', 'org_00000000-0000-0000-0000-000000000001', 'var_0000-0008-02', 'loc_00000000-0000-0000-0000-000000000001', 2999, 'USD', true),
      ('pri_0015', 'org_00000000-0000-0000-0000-000000000001', 'var_0000-0009-01', 'loc_00000000-0000-0000-0000-000000000001', 1499, 'USD', true),
      ('pri_0016', 'org_00000000-0000-0000-0000-000000000001', 'var_0000-0010-01', 'loc_00000000-0000-0000-0000-000000000001',   75, 'USD', true);
  `);

  // ── Ingredients (for recipe system) ──────────────────────────────────────
  pgm.sql(`
    INSERT INTO ingredients (id, organization_id, name, unit, cost_per_unit, is_active)
    VALUES
      ('ing_00000000-0000-0000-0000-000000000001', 'org_00000000-0000-0000-0000-000000000001', 'Ground Beef (8oz patty)', 'each',  195, true),
      ('ing_00000000-0000-0000-0000-000000000002', 'org_00000000-0000-0000-0000-000000000001', 'Burger Bun',              'each',   35, true),
      ('ing_00000000-0000-0000-0000-000000000003', 'org_00000000-0000-0000-0000-000000000001', 'Romaine Lettuce',         'oz',     12, true),
      ('ing_00000000-0000-0000-0000-000000000004', 'org_00000000-0000-0000-0000-000000000001', 'Caesar Dressing',         'oz',     18, true),
      ('ing_00000000-0000-0000-0000-000000000005', 'org_00000000-0000-0000-0000-000000000001', 'Pizza Dough (10in)',       'each',   85, true),
      ('ing_00000000-0000-0000-0000-000000000006', 'org_00000000-0000-0000-0000-000000000001', 'Pizza Dough (14in)',       'each',  130, true),
      ('ing_00000000-0000-0000-0000-000000000007', 'org_00000000-0000-0000-0000-000000000001', 'Mozzarella',              'oz',     22, true),
      ('ing_00000000-0000-0000-0000-000000000008', 'org_00000000-0000-0000-0000-000000000001', 'Tomato Sauce',            'oz',      8, true),
      ('ing_00000000-0000-0000-0000-000000000009', 'org_00000000-0000-0000-0000-000000000001', 'Russet Potato (portion)', 'each',   25, true),
      ('ing_00000000-0000-0000-0000-000000000010', 'org_00000000-0000-0000-0000-000000000001', 'Parmesan',                'oz',     28, true);
  `);

  // ── Recipes ───────────────────────────────────────────────────────────────
  pgm.sql(`
    INSERT INTO recipes (id, organization_id, variant_id, name, yield_quantity, yield_unit)
    VALUES
      ('rec_00000000-0000-0000-0000-000000000001',
       'org_00000000-0000-0000-0000-000000000001',
       'var_0000-0001-01',
       'Classic Burger Recipe', 1, 'each'),

      ('rec_00000000-0000-0000-0000-000000000002',
       'org_00000000-0000-0000-0000-000000000001',
       'var_0000-0002-02',
       'Caesar Salad (Full) Recipe', 1, 'each'),

      ('rec_00000000-0000-0000-0000-000000000003',
       'org_00000000-0000-0000-0000-000000000001',
       'var_0000-0003-01',
       'Margherita Pizza (10in) Recipe', 1, 'each');
  `);

  pgm.sql(`
    INSERT INTO recipe_lines (recipe_id, ingredient_id, quantity, unit)
    VALUES
      -- Classic Burger
      ('rec_00000000-0000-0000-0000-000000000001', 'ing_00000000-0000-0000-0000-000000000001', 1.00, 'each'),
      ('rec_00000000-0000-0000-0000-000000000001', 'ing_00000000-0000-0000-0000-000000000002', 1.00, 'each'),

      -- Caesar Salad (Full)
      ('rec_00000000-0000-0000-0000-000000000002', 'ing_00000000-0000-0000-0000-000000000003', 6.00, 'oz'),
      ('rec_00000000-0000-0000-0000-000000000002', 'ing_00000000-0000-0000-0000-000000000004', 2.00, 'oz'),
      ('rec_00000000-0000-0000-0000-000000000002', 'ing_00000000-0000-0000-0000-000000000010', 0.50, 'oz'),

      -- Margherita Pizza (10in)
      ('rec_00000000-0000-0000-0000-000000000003', 'ing_00000000-0000-0000-0000-000000000005', 1.00, 'each'),
      ('rec_00000000-0000-0000-0000-000000000003', 'ing_00000000-0000-0000-0000-000000000008', 3.00, 'oz'),
      ('rec_00000000-0000-0000-0000-000000000003', 'ing_00000000-0000-0000-0000-000000000007', 4.00, 'oz');
  `);

  // ── Inventory Levels (tracked products only) ─────────────────────────────
  pgm.sql(`
    INSERT INTO inventory_levels (
      location_id, product_id, variant_id,
      quantity_on_hand, quantity_reserved, reorder_point, reorder_quantity
    ) VALUES
      -- Classic Burger (var_0000-0001-01)
      ('loc_00000000-0000-0000-0000-000000000001',
       'prd_00000000-0000-0000-0000-000000000001',
       'var_0000-0001-01', 50, 0, 10, 25),

      -- Caesar Salad half
      ('loc_00000000-0000-0000-0000-000000000001',
       'prd_00000000-0000-0000-0000-000000000002',
       'var_0000-0002-01', 30, 0,  5, 15),

      -- Caesar Salad full
      ('loc_00000000-0000-0000-0000-000000000001',
       'prd_00000000-0000-0000-0000-000000000002',
       'var_0000-0002-02', 30, 0,  5, 15),

      -- Margherita 10in
      ('loc_00000000-0000-0000-0000-000000000001',
       'prd_00000000-0000-0000-0000-000000000003',
       'var_0000-0003-01', 20, 0,  5, 10),

      -- Margherita 14in
      ('loc_00000000-0000-0000-0000-000000000001',
       'prd_00000000-0000-0000-0000-000000000003',
       'var_0000-0003-02', 20, 0,  5, 10),

      -- French Fries
      ('loc_00000000-0000-0000-0000-000000000001',
       'prd_00000000-0000-0000-0000-000000000004',
       'var_0000-0004-01', 100, 0, 20, 50),

      -- Branded Tote Bag
      ('loc_00000000-0000-0000-0000-000000000001',
       'prd_00000000-0000-0000-0000-000000000009',
       'var_0000-0009-01', 25, 0,  5, 20);
  `);

  // ── Tables (floor plan) ───────────────────────────────────────────────────
  pgm.sql(`
    INSERT INTO tables (id, location_id, name, capacity, section, is_active)
    VALUES
      ('tbl_01', 'loc_00000000-0000-0000-0000-000000000001', 'Table 1',  4, 'Main',  true),
      ('tbl_02', 'loc_00000000-0000-0000-0000-000000000001', 'Table 2',  4, 'Main',  true),
      ('tbl_03', 'loc_00000000-0000-0000-0000-000000000001', 'Table 3',  6, 'Main',  true),
      ('tbl_04', 'loc_00000000-0000-0000-0000-000000000001', 'Table 4',  2, 'Bar',   true),
      ('tbl_05', 'loc_00000000-0000-0000-0000-000000000001', 'Table 5',  2, 'Bar',   true),
      ('tbl_06', 'loc_00000000-0000-0000-0000-000000000001', 'Patio 1',  4, 'Patio', true),
      ('tbl_07', 'loc_00000000-0000-0000-0000-000000000001', 'Patio 2',  4, 'Patio', true);
  `);

  // ── Printers ──────────────────────────────────────────────────────────────
  pgm.sql(`
    INSERT INTO printers (id, location_id, name, type, connection, is_active)
    VALUES
      ('prn_01', 'loc_00000000-0000-0000-0000-000000000001', 'Front Printer', 'receipt',  '{"type":"network","host":"192.168.1.100","port":9100}', true),
      ('prn_02', 'loc_00000000-0000-0000-0000-000000000001', 'Kitchen Ticket', 'kitchen', '{"type":"network","host":"192.168.1.101","port":9100}', true);
  `);
};

/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.down = (pgm) => {
  pgm.sql(`DELETE FROM printers            WHERE location_id = 'loc_00000000-0000-0000-0000-000000000001';`);
  pgm.sql(`DELETE FROM tables              WHERE location_id = 'loc_00000000-0000-0000-0000-000000000001';`);
  pgm.sql(`DELETE FROM inventory_levels    WHERE location_id = 'loc_00000000-0000-0000-0000-000000000001';`);
  pgm.sql(`DELETE FROM recipe_lines        WHERE recipe_id   LIKE 'rec_%';`);
  pgm.sql(`DELETE FROM recipes             WHERE organization_id = 'org_00000000-0000-0000-0000-000000000001';`);
  pgm.sql(`DELETE FROM ingredients         WHERE organization_id = 'org_00000000-0000-0000-0000-000000000001';`);
  pgm.sql(`DELETE FROM prices              WHERE organization_id = 'org_00000000-0000-0000-0000-000000000001';`);
  pgm.sql(`DELETE FROM product_variants    WHERE sku LIKE 'BURGER-%' OR sku LIKE 'CAESAR-%' OR sku LIKE 'PIZZA-%' OR sku LIKE 'FRIES-%' OR sku LIKE 'SODA-%' OR sku LIKE 'COFFEE-%' OR sku LIKE 'BEER-%' OR sku LIKE 'WINE-%' OR sku LIKE 'TOTE-%' OR sku LIKE 'SAUCE-%';`);
  pgm.sql(`DELETE FROM products            WHERE organization_id = 'org_00000000-0000-0000-0000-000000000001';`);
  pgm.sql(`DELETE FROM categories          WHERE organization_id = 'org_00000000-0000-0000-0000-000000000001';`);
  pgm.sql(`DELETE FROM tax_rates           WHERE organization_id = 'org_00000000-0000-0000-0000-000000000001';`);
  pgm.sql(`DELETE FROM employee_locations  WHERE employee_id   = 'emp_00000000-0000-0000-0000-000000000001';`);
  pgm.sql(`DELETE FROM employees           WHERE organization_id = 'org_00000000-0000-0000-0000-000000000001';`);
  pgm.sql(`DELETE FROM locations           WHERE organization_id = 'org_00000000-0000-0000-0000-000000000001';`);
  pgm.sql(`DELETE FROM organizations       WHERE id = 'org_00000000-0000-0000-0000-000000000001';`);
};
