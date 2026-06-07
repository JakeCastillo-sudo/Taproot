/**
 * 019 — Food allergen system (S8-05)
 *
 * products.allergens        FDA Big 9 present in the item
 * products.allergen_notes   free-text notes for staff/kitchen
 * customers.allergens       customer allergen profile (POS warns on conflicts)
 *
 * Allergen values: milk, eggs, fish, shellfish, tree_nuts, peanuts, wheat,
 * soybeans, sesame.
 */

exports.up = (pgm) => {
  pgm.addColumns('products', {
    allergens: {
      type: 'varchar(50)[]',
      notNull: false,
      default: null,
      comment: 'FDA Big 9 allergens present in this item',
    },
    allergen_notes: {
      type: 'text',
      notNull: false,
      default: null,
      comment: 'Free text allergen notes for staff',
    },
  });

  pgm.addColumns('customers', {
    allergens: {
      type: 'varchar(50)[]',
      notNull: false,
      default: null,
      comment: 'Customer allergen profile',
    },
  });

  pgm.createIndex('products', 'allergens', {
    name: 'idx_products_allergens',
    method: 'GIN',
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('products', [], { name: 'idx_products_allergens' });
  pgm.dropColumns('customers', ['allergens']);
  pgm.dropColumns('products', ['allergens', 'allergen_notes']);
};
