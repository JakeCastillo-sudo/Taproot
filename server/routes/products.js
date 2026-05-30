const express = require('express');
const router = express.Router();
const db = require('../db/database');

router.get('/', (req, res) => {
  const { category, active } = req.query;
  let query = `
    SELECT p.*, c.name as category_name, c.color as category_color
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE 1=1
  `;
  const params = [];
  if (category) { query += ' AND p.category_id = ?'; params.push(category); }
  if (active !== undefined) { query += ' AND p.active = ?'; params.push(active === 'true' ? 1 : 0); }
  else { query += ' AND p.active = 1'; }
  query += ' ORDER BY c.name, p.name';
  res.json(db.prepare(query).all(...params));
});

router.get('/:id', (req, res) => {
  const product = db.prepare(`
    SELECT p.*, c.name as category_name
    FROM products p LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.id = ?
  `).get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(product);
});

router.post('/', (req, res) => {
  const { name, price, category_id, sku, stock } = req.body;
  if (!name || price === undefined) return res.status(400).json({ error: 'name and price required' });
  const result = db.prepare(
    'INSERT INTO products (name, price, category_id, sku, stock) VALUES (?, ?, ?, ?, ?)'
  ).run(name, price, category_id || null, sku || null, stock ?? -1);
  res.status(201).json({ id: result.lastInsertRowid, ...req.body });
});

router.put('/:id', (req, res) => {
  const { name, price, category_id, sku, stock, active } = req.body;
  const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });
  db.prepare(
    'UPDATE products SET name=?, price=?, category_id=?, sku=?, stock=?, active=? WHERE id=?'
  ).run(name, price, category_id || null, sku || null, stock ?? -1, active ?? 1, req.params.id);
  res.json({ id: Number(req.params.id), ...req.body });
});

router.delete('/:id', (req, res) => {
  const result = db.prepare('UPDATE products SET active=0 WHERE id=?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Product not found' });
  res.json({ success: true });
});

module.exports = router;
