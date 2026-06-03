const express = require('express');
const router = express.Router();
const db = require('../db/database');

function generateOrderNumber() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `ORD-${date}-${rand}`;
}

router.get('/', (req, res) => {
  const { limit = 50, offset = 0, date } = req.query;
  let query = 'SELECT * FROM orders WHERE 1=1';
  const params = [];
  if (date) { query += ' AND DATE(created_at) = ?'; params.push(date); }
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));
  const orders = db.prepare(query).all(...params);
  const total = db.prepare('SELECT COUNT(*) as n FROM orders' + (date ? ' WHERE DATE(created_at) = ?' : '')).get(...(date ? [date] : []));
  res.json({ orders, total: total.n });
});

router.get('/summary', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const todaySales = db.prepare(
    "SELECT COUNT(*) as count, COALESCE(SUM(total),0) as revenue FROM orders WHERE DATE(created_at)=? AND status='completed'"
  ).get(today);
  const weekSales = db.prepare(
    "SELECT COUNT(*) as count, COALESCE(SUM(total),0) as revenue FROM orders WHERE created_at >= datetime('now','-7 days') AND status='completed'"
  ).get();
  const monthSales = db.prepare(
    "SELECT COUNT(*) as count, COALESCE(SUM(total),0) as revenue FROM orders WHERE strftime('%Y-%m',created_at)=strftime('%Y-%m','now') AND status='completed'"
  ).get();
  const topProducts = db.prepare(`
    SELECT oi.product_name, SUM(oi.quantity) as qty, SUM(oi.line_total) as revenue
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    WHERE DATE(o.created_at) >= DATE('now','-30 days') AND o.status='completed'
    GROUP BY oi.product_name ORDER BY qty DESC LIMIT 5
  `).all();
  const recentOrders = db.prepare(
    'SELECT * FROM orders ORDER BY created_at DESC LIMIT 5'
  ).all();
  res.json({ today: todaySales, week: weekSales, month: monthSales, topProducts, recentOrders });
});

router.get('/:id', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(req.params.id);
  res.json({ ...order, items });
});

router.post('/', (req, res) => {
  const { items, payment_method, amount_tendered, discount = 0, note } = req.body;
  if (!items?.length) return res.status(400).json({ error: 'items required' });
  if (!payment_method) return res.status(400).json({ error: 'payment_method required' });

  const taxRate = parseFloat(
    db.prepare("SELECT value FROM settings WHERE key='tax_rate'").get()?.value || '8.5'
  );

  const subtotal = items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);
  const discountAmt = Math.min(discount, subtotal);
  const taxable = subtotal - discountAmt;
  const tax = parseFloat((taxable * taxRate / 100).toFixed(2));
  const total = parseFloat((taxable + tax).toFixed(2));
  const change_due = payment_method === 'cash' && amount_tendered
    ? parseFloat((amount_tendered - total).toFixed(2))
    : null;

  const orderNumber = generateOrderNumber();

  const insertOrder = db.prepare(`
    INSERT INTO orders (order_number, subtotal, tax, discount, total, payment_method, amount_tendered, change_due, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertItem = db.prepare(`
    INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, line_total)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const createOrder = db.transaction(() => {
    const { lastInsertRowid: orderId } = insertOrder.run(
      orderNumber, subtotal, tax, discountAmt, total,
      payment_method, amount_tendered || null, change_due, note || null
    );
    for (const item of items) {
      insertItem.run(orderId, item.product_id || null, item.product_name, item.unit_price, item.quantity, item.unit_price * item.quantity);
    }
    return orderId;
  });

  const orderId = createOrder();
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  const savedItems = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(orderId);
  res.status(201).json({ ...order, items: savedItems });
});

router.patch('/:id/void', (req, res) => {
  const result = db.prepare("UPDATE orders SET status='voided' WHERE id=?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Order not found' });
  res.json({ success: true });
});

module.exports = router;
