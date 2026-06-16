/**
 * 026 — Delivery integration (DoorDash / Uber Eats)
 *
 * - delivery_providers: per-org provider config (enable, webhook secret, store id)
 * - delivery + customer columns on orders
 * - RELAX order_line_items.product_id to NULLable: third-party delivery items are
 *   free-form (not Taproot catalog products), so a delivery line carries its own
 *   `name`/`unit_price` with no product_id. POS line items still always set it.
 */

exports.up = (pgm) => {
  pgm.createTable('delivery_providers', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    organization_id: {
      type: 'uuid',
      references: 'organizations(id)',
      onDelete: 'CASCADE',
      notNull: true,
    },
    provider: { type: 'varchar(50)', notNull: true, comment: 'doordash | ubereats | grubhub' },
    is_enabled: { type: 'boolean', notNull: true, default: false },
    webhook_secret: { type: 'varchar(255)' },
    api_key: { type: 'varchar(255)' },
    store_id: { type: 'varchar(255)', comment: 'Provider-assigned store ID' },
    settings: { type: 'jsonb', default: '{}' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addColumns('orders', {
    delivery_provider: { type: 'varchar(50)', notNull: false, comment: 'doordash | ubereats | grubhub | null' },
    delivery_order_id: { type: 'varchar(255)', notNull: false, comment: 'Provider-assigned order ID' },
    delivery_status: { type: 'varchar(50)', notNull: false, comment: 'pending | confirmed | picked_up | delivered' },
    estimated_pickup_time: { type: 'timestamptz', notNull: false },
    customer_name: { type: 'varchar(255)', notNull: false },
    customer_phone: { type: 'varchar(50)', notNull: false },
    delivery_address: { type: 'jsonb', notNull: false },
  });

  // Delivery line items have no catalog product — allow NULL product_id.
  pgm.alterColumn('order_line_items', 'product_id', { notNull: false });

  pgm.createIndex('delivery_providers', ['organization_id', 'provider'], { unique: true });
  pgm.createIndex('orders', 'delivery_provider');
  pgm.createIndex('orders', 'delivery_order_id');
};

exports.down = (pgm) => {
  pgm.dropIndex('orders', 'delivery_order_id');
  pgm.dropIndex('orders', 'delivery_provider');
  // NOTE: not restoring product_id NOT NULL on down — would fail if delivery rows exist.
  pgm.dropColumns('orders', [
    'delivery_provider', 'delivery_order_id', 'delivery_status',
    'estimated_pickup_time', 'customer_name', 'customer_phone', 'delivery_address',
  ]);
  pgm.dropTable('delivery_providers');
};
