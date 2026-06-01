/** @type {import('node-pg-migrate').MigrationBuilder} */
//
// Enriches the demo dataset for beta presentations:
//   - 12 additional products (total 22)
//   - 5 demo customers with loyalty tiers
//   - 3 modifier groups with 10 modifiers + product linkage
//   - 3 completed orders with payments (so reports show real revenue)
//
// All UUIDs use readable hex prefixes:
//   products 11-22  →  60…0011-0022
//   variants 17-29  →  70…0017-0029
//   prices   17-29  →  80…0017-0029
//   customers       →  a0…0001-0005
//   modifier groups →  b0…0001-0003
//   modifiers       →  b1…0001-000a
//   orders          →  c0…0001-0003
//   order lines     →  c1…0001-0008
//   payments        →  c2…0001-0003
//
const ORG   = '10000000-0000-0000-0000-000000000001';
const LOC   = '20000000-0000-0000-0000-000000000001';
const EMP   = '30000000-0000-0000-0000-000000000001';
const FOOD  = '50000000-0000-0000-0000-000000000001';
const BEV   = '50000000-0000-0000-0000-000000000002';
const ALC   = '50000000-0000-0000-0000-000000000003';
const MERCH = '50000000-0000-0000-0000-000000000004';

exports.up = (pgm) => {

  // ── 12 additional products ─────────────────────────────────────────────────
  pgm.sql(`
    INSERT INTO products (id, organization_id, category_id, name, description, track_inventory, is_active)
    VALUES
      -- Food (cont.)
      ('60000000-0000-0000-0000-000000000011', '${ORG}', '${FOOD}',
       'Double Burger',      'Two beef patties, double cheese, special sauce', true,  true),
      ('60000000-0000-0000-0000-000000000012', '${ORG}', '${FOOD}',
       'Pepperoni Pizza',    'Classic red sauce, mozzarella, pepperoni',       true,  true),
      ('60000000-0000-0000-0000-000000000013', '${ORG}', '${FOOD}',
       'Garden Salad',       'Mixed greens, cherry tomatoes, cucumber',        true,  true),
      ('60000000-0000-0000-0000-000000000014', '${ORG}', '${FOOD}',
       'Sweet Potato Fries', 'Crispy sweet potato with chipotle aioli',        true,  true),
      ('60000000-0000-0000-0000-000000000015', '${ORG}', '${FOOD}',
       'Chicken Wings',      '10 wings — BBQ, buffalo, or plain',              true,  true),
      ('60000000-0000-0000-0000-000000000016', '${ORG}', '${FOOD}',
       'Chocolate Cake',     'Rich triple-chocolate layer cake',               true,  true),
      ('60000000-0000-0000-0000-000000000017', '${ORG}', '${FOOD}',
       'Cheesecake',         'New York style with berry compote',              true,  true),
      -- Beverages (cont.)
      ('60000000-0000-0000-0000-000000000018', '${ORG}', '${BEV}',
       'Cappuccino',         'Double espresso with steamed milk foam',         false, true),
      ('60000000-0000-0000-0000-000000000019', '${ORG}', '${BEV}',
       'Fresh Juice',        'Orange, apple, or green — freshly pressed',      false, true),
      ('60000000-0000-0000-0000-000000000020', '${ORG}', '${BEV}',
       'Sparkling Water',    'San Pellegrino 500ml',                           false, true),
      -- Alcohol (cont.)
      ('60000000-0000-0000-0000-000000000021', '${ORG}', '${ALC}',
       'Craft Cocktail',     'Ask your bartender — rotating seasonal menu',    false, true),
      -- Merchandise (cont.)
      ('60000000-0000-0000-0000-000000000022', '${ORG}', '${MERCH}',
       'Gift Card',          'Reloadable — available in any amount',           false, true);
  `);

  // ── Variants for new products (one standard each, Pepperoni Pizza gets 2) ──
  pgm.sql(`
    INSERT INTO product_variants (id, product_id, organization_id, sku, name, options, sort_order, is_active)
    VALUES
      ('70000000-0000-0000-0000-000000000017', '60000000-0000-0000-0000-000000000011', '${ORG}',
       'DBLBURG-STD',  'Standard', '{}',               1, true),
      ('70000000-0000-0000-0000-000000000018', '60000000-0000-0000-0000-000000000012', '${ORG}',
       'PEPPI-10',     '10 inch',  '{"size":"10"}',    1, true),
      ('70000000-0000-0000-0000-000000000019', '60000000-0000-0000-0000-000000000012', '${ORG}',
       'PEPPI-14',     '14 inch',  '{"size":"14"}',    2, true),
      ('70000000-0000-0000-0000-000000000020', '60000000-0000-0000-0000-000000000013', '${ORG}',
       'GARDEN-STD',   'Standard', '{}',               1, true),
      ('70000000-0000-0000-0000-000000000021', '60000000-0000-0000-0000-000000000014', '${ORG}',
       'SWFRIES-STD',  'Standard', '{}',               1, true),
      ('70000000-0000-0000-0000-000000000022', '60000000-0000-0000-0000-000000000015', '${ORG}',
       'WINGS-STD',    'Standard', '{}',               1, true),
      ('70000000-0000-0000-0000-000000000023', '60000000-0000-0000-0000-000000000016', '${ORG}',
       'CHOCCAKE-STD', 'Standard', '{}',               1, true),
      ('70000000-0000-0000-0000-000000000024', '60000000-0000-0000-0000-000000000017', '${ORG}',
       'CHEESECAKE-STD','Standard','{}',               1, true),
      ('70000000-0000-0000-0000-000000000025', '60000000-0000-0000-0000-000000000018', '${ORG}',
       'CAPP-STD',     'Standard', '{}',               1, true),
      ('70000000-0000-0000-0000-000000000026', '60000000-0000-0000-0000-000000000019', '${ORG}',
       'JUICE-STD',    'Standard', '{}',               1, true),
      ('70000000-0000-0000-0000-000000000027', '60000000-0000-0000-0000-000000000020', '${ORG}',
       'SPARKWATER-STD','Standard','{}',               1, true),
      ('70000000-0000-0000-0000-000000000028', '60000000-0000-0000-0000-000000000021', '${ORG}',
       'COCKTAIL-STD', 'Standard', '{}',               1, true),
      ('70000000-0000-0000-0000-000000000029', '60000000-0000-0000-0000-000000000022', '${ORG}',
       'GIFTCARD-STD', 'Standard', '{}',               1, true);
  `);

  // ── Prices (cents) ─────────────────────────────────────────────────────────
  pgm.sql(`
    INSERT INTO product_prices (id, variant_id, location_id, price, currency, is_active)
    VALUES
      -- Double Burger $18.99
      ('80000000-0000-0000-0000-000000000017', '70000000-0000-0000-0000-000000000017', '${LOC}', 1899, 'USD', true),
      -- Pepperoni 10in $14.99 / 14in $18.99
      ('80000000-0000-0000-0000-000000000018', '70000000-0000-0000-0000-000000000018', '${LOC}', 1499, 'USD', true),
      ('80000000-0000-0000-0000-000000000019', '70000000-0000-0000-0000-000000000019', '${LOC}', 1899, 'USD', true),
      -- Garden Salad $9.99
      ('80000000-0000-0000-0000-000000000020', '70000000-0000-0000-0000-000000000020', '${LOC}',  999, 'USD', true),
      -- Sweet Potato Fries $6.99
      ('80000000-0000-0000-0000-000000000021', '70000000-0000-0000-0000-000000000021', '${LOC}',  699, 'USD', true),
      -- Chicken Wings $14.99
      ('80000000-0000-0000-0000-000000000022', '70000000-0000-0000-0000-000000000022', '${LOC}', 1499, 'USD', true),
      -- Chocolate Cake $6.99
      ('80000000-0000-0000-0000-000000000023', '70000000-0000-0000-0000-000000000023', '${LOC}',  699, 'USD', true),
      -- Cheesecake $7.99
      ('80000000-0000-0000-0000-000000000024', '70000000-0000-0000-0000-000000000024', '${LOC}',  799, 'USD', true),
      -- Cappuccino $5.50
      ('80000000-0000-0000-0000-000000000025', '70000000-0000-0000-0000-000000000025', '${LOC}',  550, 'USD', true),
      -- Fresh Juice $5.99
      ('80000000-0000-0000-0000-000000000026', '70000000-0000-0000-0000-000000000026', '${LOC}',  599, 'USD', true),
      -- Sparkling Water $3.99
      ('80000000-0000-0000-0000-000000000027', '70000000-0000-0000-0000-000000000027', '${LOC}',  399, 'USD', true),
      -- Craft Cocktail $13.00
      ('80000000-0000-0000-0000-000000000028', '70000000-0000-0000-0000-000000000028', '${LOC}', 1300, 'USD', true),
      -- Gift Card $25.00
      ('80000000-0000-0000-0000-000000000029', '70000000-0000-0000-0000-000000000029', '${LOC}', 2500, 'USD', true);
  `);

  // ── Inventory levels for tracked new products ──────────────────────────────
  pgm.sql(`
    INSERT INTO inventory_levels (
      organization_id, location_id, product_id, variant_id,
      quantity_on_hand, quantity_on_order, reorder_point, reorder_quantity
    ) VALUES
      ('${ORG}', '${LOC}', '60000000-0000-0000-0000-000000000011', '70000000-0000-0000-0000-000000000017', 30,  0, 8,  20),
      ('${ORG}', '${LOC}', '60000000-0000-0000-0000-000000000012', '70000000-0000-0000-0000-000000000018', 20,  0, 5,  10),
      ('${ORG}', '${LOC}', '60000000-0000-0000-0000-000000000012', '70000000-0000-0000-0000-000000000019', 20,  0, 5,  10),
      ('${ORG}', '${LOC}', '60000000-0000-0000-0000-000000000013', '70000000-0000-0000-0000-000000000020', 25,  0, 8,  15),
      ('${ORG}', '${LOC}', '60000000-0000-0000-0000-000000000014', '70000000-0000-0000-0000-000000000021', 60,  0, 15, 30),
      ('${ORG}', '${LOC}', '60000000-0000-0000-0000-000000000015', '70000000-0000-0000-0000-000000000022', 40,  0, 10, 20),
      ('${ORG}', '${LOC}', '60000000-0000-0000-0000-000000000016', '70000000-0000-0000-0000-000000000023', 15,  0, 4,  10),
      ('${ORG}', '${LOC}', '60000000-0000-0000-0000-000000000017', '70000000-0000-0000-0000-000000000024', 12,  0, 3,  8),
      ('${ORG}', '${LOC}', '60000000-0000-0000-0000-000000000022', '70000000-0000-0000-0000-000000000029', 999, 0, 10, 50);
  `);

  // ── 5 demo customers ────────────────────────────────────────────────────────
  pgm.sql(`
    INSERT INTO customers (
      id, organization_id, first_name, last_name, email, phone,
      loyalty_points, loyalty_tier, total_spend, visit_count, marketing_opt_in
    ) VALUES
      ('a0000000-0000-0000-0000-000000000001', '${ORG}',
       'John',  'Smith',   'john@example.com',  '+15125550101',
       1200, 'gold',     28500, 19, true),
      ('a0000000-0000-0000-0000-000000000002', '${ORG}',
       'Sarah', 'Johnson', 'sarah@example.com', '+15125550102',
        450, 'silver',   11200,  8, true),
      ('a0000000-0000-0000-0000-000000000003', '${ORG}',
       'Mike',  'Chen',    'mike@example.com',  '+15125550103',
       2800, 'platinum', 68900, 47, true),
      ('a0000000-0000-0000-0000-000000000004', '${ORG}',
       'Emma',  'Davis',   'emma@example.com',  '+15125550104',
         80, 'bronze',    2100,  2, false),
      ('a0000000-0000-0000-0000-000000000005', '${ORG}',
       'James', 'Wilson',  'james@example.com', '+15125550105',
          0, 'none',        0,   0, false);
  `);

  // ── 3 modifier groups ───────────────────────────────────────────────────────
  pgm.sql(`
    INSERT INTO modifier_groups (id, organization_id, name, selection_type, min_selections, max_selections, sort_order, is_active)
    VALUES
      ('b0000000-0000-0000-0000-000000000001', '${ORG}',
       'Burger Options', 'single',          0, 1, 1, true),
      ('b0000000-0000-0000-0000-000000000002', '${ORG}',
       'Choose Size',    'required_single', 1, 1, 2, true),
      ('b0000000-0000-0000-0000-000000000003', '${ORG}',
       'Extras',         'multiple',        0, 5, 3, true);
  `);

  // ── 10 modifiers ────────────────────────────────────────────────────────────
  pgm.sql(`
    INSERT INTO modifiers (id, group_id, name, price_delta, is_default, sort_order, is_active)
    VALUES
      -- Burger Options
      ('b1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Regular',     0,    true,  1, true),
      ('b1000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'Add Cheese', 150,   false, 2, true),
      ('b1000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'Add Bacon',  200,   false, 3, true),
      ('b1000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001', 'Add Avocado',250,  false, 4, true),
      -- Choose Size
      ('b1000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000002', 'Small',    -100,   false, 1, true),
      ('b1000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000002', 'Regular',     0,   true,  2, true),
      ('b1000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000002', 'Large',     150,   false, 3, true),
      -- Extras
      ('b1000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000003', 'Extra Sauce', 50,  false, 1, true),
      ('b1000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000003', 'Side Salad', 300,  false, 2, true),
      ('b1000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000003', 'No Onions',    0,  false, 3, true);
  `);

  // ── Link modifier groups to products ───────────────────────────────────────
  pgm.sql(`
    INSERT INTO product_modifier_groups (product_id, modifier_group_id, sort_order)
    VALUES
      -- Classic Burger → Burger Options + Extras
      ('60000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 1),
      ('60000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000003', 2),
      -- Double Burger → Burger Options + Extras
      ('60000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000001', 1),
      ('60000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000003', 2),
      -- Fountain Soda → Choose Size
      ('60000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000002', 1);
  `);

  // ── Org order sequence (2026, counter = 3 for the 3 demo orders below) ────
  pgm.sql(`
    INSERT INTO organization_order_sequences (organization_id, year, counter)
    VALUES ('${ORG}', 2026, 3)
    ON CONFLICT (organization_id, year) DO UPDATE SET counter = GREATEST(organization_order_sequences.counter, 3);
  `);

  // ── 3 completed demo orders ─────────────────────────────────────────────────
  //
  // Amounts are stored in CENTS (integer) matching the rest of the codebase.
  // No tax_rates table yet → tax_total = 0.
  //
  // Order 1: Classic Burger ($14.99) + French Fries ($5.99) + Draft Beer Pint ($7.50)
  //          subtotal = 2848 ¢   total = 2848 ¢   payment: card
  //
  // Order 2: Margherita Pizza 14in ($16.99) + House Wine glass×2 ($18.00)
  //          subtotal = 3499 ¢   total = 3499 ¢   payment: cash, tendered $40
  //
  // Order 3: Caesar Salad full ($11.99) + Cappuccino ($5.50)
  //          subtotal = 1749 ¢   total = 1749 ¢   payment: card

  pgm.sql(`
    INSERT INTO orders (
      id, organization_id, location_id, employee_id,
      order_number, status, order_type,
      subtotal, discount_total, tax_total, tip_total, total, amount_paid, change_due,
      fulfilled_at, created_at, updated_at
    ) VALUES
      -- Order 1
      ('c0000000-0000-0000-0000-000000000001',
       '${ORG}', '${LOC}', '${EMP}',
       'T-2026-000001', 'completed', 'in_store',
       2848, 0, 0, 0, 2848, 2848, 0,
       now() - interval '5 days', now() - interval '5 days', now() - interval '5 days'),
      -- Order 2
      ('c0000000-0000-0000-0000-000000000002',
       '${ORG}', '${LOC}', '${EMP}',
       'T-2026-000002', 'completed', 'in_store',
       3499, 0, 0, 0, 3499, 3499, 501,
       now() - interval '3 days', now() - interval '3 days', now() - interval '3 days'),
      -- Order 3
      ('c0000000-0000-0000-0000-000000000003',
       '${ORG}', '${LOC}', '${EMP}',
       'T-2026-000003', 'completed', 'in_store',
       1749, 0, 0, 0, 1749, 1749, 0,
       now() - interval '1 day', now() - interval '1 day', now() - interval '1 day');
  `);

  // ── Order line items ────────────────────────────────────────────────────────
  pgm.sql(`
    INSERT INTO order_line_items (
      id, order_id, product_id, variant_id, name, sku,
      quantity, unit_price, cost_price, tax_amount, total,
      created_at, updated_at
    ) VALUES
      -- Order 1 lines
      ('c1000000-0000-0000-0000-000000000001',
       'c0000000-0000-0000-0000-000000000001',
       '60000000-0000-0000-0000-000000000001',
       '70000000-0000-0000-0000-000000000001',
       'Classic Burger', 'BURGER-STD', 1, 1499, 600, 0, 1499,
       now() - interval '5 days', now() - interval '5 days'),

      ('c1000000-0000-0000-0000-000000000002',
       'c0000000-0000-0000-0000-000000000001',
       '60000000-0000-0000-0000-000000000004',
       '70000000-0000-0000-0000-000000000006',
       'French Fries', 'FRIES-STD', 1, 599, 120, 0, 599,
       now() - interval '5 days', now() - interval '5 days'),

      ('c1000000-0000-0000-0000-000000000003',
       'c0000000-0000-0000-0000-000000000001',
       '60000000-0000-0000-0000-000000000007',
       '70000000-0000-0000-0000-000000000011',
       'Draft Beer (Pint)', 'BEER-PINT', 1, 750, 200, 0, 750,
       now() - interval '5 days', now() - interval '5 days'),

      -- Order 2 lines
      ('c1000000-0000-0000-0000-000000000004',
       'c0000000-0000-0000-0000-000000000002',
       '60000000-0000-0000-0000-000000000003',
       '70000000-0000-0000-0000-000000000005',
       'Margherita Pizza (14 inch)', 'PIZZA-14', 1, 1699, 400, 0, 1699,
       now() - interval '3 days', now() - interval '3 days'),

      ('c1000000-0000-0000-0000-000000000005',
       'c0000000-0000-0000-0000-000000000002',
       '60000000-0000-0000-0000-000000000008',
       '70000000-0000-0000-0000-000000000013',
       'House Wine (Glass)', 'WINE-GLASS', 2, 900, 250, 0, 1800,
       now() - interval '3 days', now() - interval '3 days'),

      -- Order 3 lines
      ('c1000000-0000-0000-0000-000000000006',
       'c0000000-0000-0000-0000-000000000003',
       '60000000-0000-0000-0000-000000000002',
       '70000000-0000-0000-0000-000000000003',
       'Caesar Salad (Full)', 'CAESAR-FULL', 1, 1199, 300, 0, 1199,
       now() - interval '1 day', now() - interval '1 day'),

      ('c1000000-0000-0000-0000-000000000007',
       'c0000000-0000-0000-0000-000000000003',
       '60000000-0000-0000-0000-000000000018',
       '70000000-0000-0000-0000-000000000025',
       'Cappuccino', 'CAPP-STD', 1, 550, 80, 0, 550,
       now() - interval '1 day', now() - interval '1 day');
  `);

  // ── Payments ────────────────────────────────────────────────────────────────
  pgm.sql(`
    INSERT INTO payments (
      id, order_id, payment_method, amount, tip_amount, status,
      processor, card_last4, card_brand,
      created_at, updated_at
    ) VALUES
      -- Order 1: credit card
      ('c2000000-0000-0000-0000-000000000001',
       'c0000000-0000-0000-0000-000000000001',
       'credit_card', 2848, 0, 'completed', 'stripe', '4242', 'visa',
       now() - interval '5 days', now() - interval '5 days'),

      -- Order 2: cash
      ('c2000000-0000-0000-0000-000000000002',
       'c0000000-0000-0000-0000-000000000002',
       'cash', 3499, 0, 'completed', 'cash', NULL, NULL,
       now() - interval '3 days', now() - interval '3 days'),

      -- Order 3: credit card
      ('c2000000-0000-0000-0000-000000000003',
       'c0000000-0000-0000-0000-000000000003',
       'credit_card', 1749, 0, 'completed', 'stripe', '1234', 'mastercard',
       now() - interval '1 day', now() - interval '1 day');
  `);
};

/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.down = (pgm) => {
  pgm.sql(`DELETE FROM payments         WHERE id LIKE 'c2%'`);
  pgm.sql(`DELETE FROM order_line_items WHERE id LIKE 'c1%'`);
  pgm.sql(`DELETE FROM orders           WHERE id LIKE 'c0%'`);
  pgm.sql(`DELETE FROM product_modifier_groups WHERE product_id IN (
    SELECT id FROM products WHERE organization_id = '${ORG}' AND id >= '60000000-0000-0000-0000-000000000011'
  )`);
  pgm.sql(`DELETE FROM product_modifier_groups WHERE product_id = '60000000-0000-0000-0000-000000000001'`);
  pgm.sql(`DELETE FROM product_modifier_groups WHERE product_id = '60000000-0000-0000-0000-000000000005'`);
  pgm.sql(`DELETE FROM modifiers         WHERE id LIKE 'b1%'`);
  pgm.sql(`DELETE FROM modifier_groups   WHERE id LIKE 'b0%'`);
  pgm.sql(`DELETE FROM customers         WHERE organization_id = '${ORG}'`);
  pgm.sql(`DELETE FROM inventory_levels  WHERE product_id >= '60000000-0000-0000-0000-000000000011' AND organization_id = '${ORG}'`);
  pgm.sql(`DELETE FROM product_prices    WHERE variant_id IN (SELECT id FROM product_variants WHERE sku LIKE 'DBLBURG%' OR sku LIKE 'PEPPI%' OR sku LIKE 'GARDEN%' OR sku LIKE 'SWFRIES%' OR sku LIKE 'WINGS%' OR sku LIKE 'CHOCCAKE%' OR sku LIKE 'CHEESECAKE%' OR sku LIKE 'CAPP%' OR sku LIKE 'JUICE%' OR sku LIKE 'SPARKWATER%' OR sku LIKE 'COCKTAIL%' OR sku LIKE 'GIFTCARD%')`);
  pgm.sql(`DELETE FROM product_variants  WHERE organization_id = '${ORG}' AND id >= '70000000-0000-0000-0000-000000000017'`);
  pgm.sql(`DELETE FROM products          WHERE organization_id = '${ORG}' AND id >= '60000000-0000-0000-0000-000000000011'`);
  pgm.sql(`DELETE FROM organization_order_sequences WHERE organization_id = '${ORG}' AND year = 2026`);
};
