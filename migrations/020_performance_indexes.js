/**
 * 020 — Performance composite indexes (S8-06)
 *
 * Targets the hottest query shapes:
 *   - POS product list:   org + deleted_at + archived_at (PRODUCT STATE RULE)
 *   - report queries:     org + location + created_at on orders
 *   - product reporting:  order_line_items by product + date
 *   - loyalty queries:    customers by org + tier (active only)
 *   - stock checks:       inventory_levels org/location/product
 */

exports.up = (pgm) => {
  // Products — most common POS query (partial: only live rows)
  pgm.createIndex('products',
    ['organization_id', 'deleted_at', 'archived_at'],
    { name: 'idx_products_org_active_composite' });

  // Orders — most common report query
  pgm.createIndex('orders',
    ['organization_id', 'location_id', 'created_at'],
    { name: 'idx_orders_org_loc_date_composite' });

  // Order line items — for product reports
  pgm.createIndex('order_line_items',
    ['product_id', 'created_at'],
    { name: 'idx_oli_product_date_composite' });

  // Customers — for loyalty queries
  pgm.createIndex('customers',
    ['organization_id', 'deleted_at', 'loyalty_tier'],
    { name: 'idx_customers_org_tier_composite' });

  // Inventory levels — for stock checks
  pgm.createIndex('inventory_levels',
    ['organization_id', 'location_id', 'product_id'],
    { name: 'idx_inv_levels_composite' });
};

exports.down = (pgm) => {
  pgm.dropIndex('products', [], { name: 'idx_products_org_active_composite' });
  pgm.dropIndex('orders', [], { name: 'idx_orders_org_loc_date_composite' });
  pgm.dropIndex('order_line_items', [], { name: 'idx_oli_product_date_composite' });
  pgm.dropIndex('customers', [], { name: 'idx_customers_org_tier_composite' });
  pgm.dropIndex('inventory_levels', [], { name: 'idx_inv_levels_composite' });
};
