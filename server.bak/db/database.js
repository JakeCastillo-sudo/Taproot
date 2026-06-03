const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'taproot.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT DEFAULT '#6366f1',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    category_id INTEGER REFERENCES categories(id),
    sku TEXT UNIQUE,
    stock INTEGER DEFAULT -1,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT NOT NULL UNIQUE,
    subtotal REAL NOT NULL,
    tax REAL NOT NULL,
    discount REAL DEFAULT 0,
    total REAL NOT NULL,
    payment_method TEXT NOT NULL,
    amount_tendered REAL,
    change_due REAL,
    status TEXT DEFAULT 'completed',
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    product_id INTEGER REFERENCES products(id),
    product_name TEXT NOT NULL,
    unit_price REAL NOT NULL,
    quantity INTEGER NOT NULL,
    line_total REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Seed default settings
const insertSetting = db.prepare(
  'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
);
insertSetting.run('business_name', 'My Business');
insertSetting.run('tax_rate', '8.5');
insertSetting.run('currency_symbol', '$');
insertSetting.run('receipt_footer', 'Thank you for your business!');

// Seed sample categories and products
const catCount = db.prepare('SELECT COUNT(*) as n FROM categories').get();
if (catCount.n === 0) {
  const insertCat = db.prepare('INSERT INTO categories (name, color) VALUES (?, ?)');
  const insertProd = db.prepare(
    'INSERT INTO products (name, price, category_id, sku) VALUES (?, ?, ?, ?)'
  );

  const food = insertCat.run('Food', '#f59e0b').lastInsertRowid;
  const drinks = insertCat.run('Drinks', '#3b82f6').lastInsertRowid;
  const merch = insertCat.run('Merchandise', '#10b981').lastInsertRowid;

  insertProd.run('Burger', 9.99, food, 'FOOD-001');
  insertProd.run('Fries', 3.49, food, 'FOOD-002');
  insertProd.run('Salad', 7.99, food, 'FOOD-003');
  insertProd.run('Hot Dog', 5.49, food, 'FOOD-004');
  insertProd.run('Coffee', 2.99, drinks, 'DRK-001');
  insertProd.run('Soda', 1.99, drinks, 'DRK-002');
  insertProd.run('Water', 1.49, drinks, 'DRK-003');
  insertProd.run('Juice', 3.49, drinks, 'DRK-004');
  insertProd.run('T-Shirt', 24.99, merch, 'MRC-001');
  insertProd.run('Hat', 18.99, merch, 'MRC-002');
}

module.exports = db;
