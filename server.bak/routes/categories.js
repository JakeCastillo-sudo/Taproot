const express = require('express');
const router = express.Router();
const db = require('../db/database');

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT c.*, COUNT(p.id) as product_count
    FROM categories c
    LEFT JOIN products p ON p.category_id = c.id AND p.active = 1
    GROUP BY c.id ORDER BY c.name
  `).all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const result = db.prepare('INSERT INTO categories (name, color) VALUES (?, ?)').run(name, color || '#6366f1');
    res.status(201).json({ id: result.lastInsertRowid, name, color: color || '#6366f1' });
  } catch {
    res.status(409).json({ error: 'Category already exists' });
  }
});

router.put('/:id', (req, res) => {
  const { name, color } = req.body;
  const result = db.prepare('UPDATE categories SET name=?, color=? WHERE id=?').run(name, color, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Category not found' });
  res.json({ id: Number(req.params.id), name, color });
});

router.delete('/:id', (req, res) => {
  db.prepare('UPDATE products SET category_id=NULL WHERE category_id=?').run(req.params.id);
  const result = db.prepare('DELETE FROM categories WHERE id=?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Category not found' });
  res.json({ success: true });
});

module.exports = router;
