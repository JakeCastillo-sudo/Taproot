/**
 * 017 — Franchise mode (S8-01)
 *
 * organizations:
 *   - parent_org_id   uuid → organizations(id)  (NULL = independent or franchisor)
 *   - org_type        independent | franchisor | franchisee
 *   - franchise_code  unique join code (franchisor orgs only)
 *
 * products:
 *   - corporate_source_id uuid → products(id)  Set on franchisee copies of
 *     corporate menu items pushed by the franchisor. Locked: franchisees cannot
 *     archive/delete products carrying this marker.
 */

exports.up = (pgm) => {
  pgm.addColumns('organizations', {
    parent_org_id: {
      type: 'uuid',
      notNull: false,
      default: null,
      references: 'organizations(id)',
      onDelete: 'SET NULL',
      comment: 'Set for franchise locations. NULL = independent or franchisor.',
    },
    org_type: {
      type: 'varchar(50)',
      notNull: true,
      default: 'independent',
      comment: 'independent | franchisor | franchisee',
    },
    franchise_code: {
      type: 'varchar(100)',
      notNull: false,
      default: null,
      comment: 'Unique code franchisees use to join',
    },
  });

  pgm.addConstraint('organizations', 'organizations_org_type_check',
    "CHECK (org_type IN ('independent','franchisor','franchisee'))");

  pgm.createIndex('organizations', 'parent_org_id', {
    name: 'idx_organizations_parent_org',
  });

  pgm.createIndex('organizations', 'franchise_code', {
    name: 'idx_organizations_franchise_code',
    unique: true,
    where: 'franchise_code IS NOT NULL',
  });

  pgm.addColumns('products', {
    corporate_source_id: {
      type: 'uuid',
      notNull: false,
      default: null,
      references: 'products(id)',
      onDelete: 'SET NULL',
      comment: 'Franchisor master product this item was pushed from (franchisee copies only)',
    },
  });

  pgm.createIndex('products', 'corporate_source_id', {
    name: 'idx_products_corporate_source',
    where: 'corporate_source_id IS NOT NULL',
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('products', [], { name: 'idx_products_corporate_source' });
  pgm.dropColumns('products', ['corporate_source_id']);
  pgm.dropIndex('organizations', [], { name: 'idx_organizations_franchise_code' });
  pgm.dropIndex('organizations', [], { name: 'idx_organizations_parent_org' });
  pgm.dropConstraint('organizations', 'organizations_org_type_check');
  pgm.dropColumns('organizations', ['parent_org_id', 'org_type', 'franchise_code']);
};
