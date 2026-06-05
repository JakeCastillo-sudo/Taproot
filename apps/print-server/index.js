/**
 * Taproot Print Server — local ESC/POS bridge for thermal printers.
 *
 * Runs on the cashier's machine. The Taproot web app POSTs print jobs here; this
 * server formats ESC/POS and sends them to a network printer (TCP :9100) or logs
 * them when no printer is configured (dev mode). Node built-ins only — no deps.
 *
 * Env:
 *   PORT        (default 3333)
 *   PRINTER_IP  network printer IP (Epson TM-T88 / Star TSP100 in TCP mode)
 *   PRINTER_PORT(default 9100)
 *
 * Run:  PRINTER_IP=192.168.1.50 node index.js
 */

'use strict';
const http = require('http');
const net = require('net');

const PORT = Number(process.env.PORT || 3333);
const PRINTER_IP = process.env.PRINTER_IP || '';
const PRINTER_PORT = Number(process.env.PRINTER_PORT || 9100);

// ── ESC/POS helpers ───────────────────────────────────────────────────────────
const ESC = '\x1B', GS = '\x1D';
const INIT = ESC + '@';
const BOLD_ON = ESC + 'E\x01', BOLD_OFF = ESC + 'E\x00';
const CENTER = ESC + 'a\x01', LEFT = ESC + 'a\x00';
const CUT = GS + 'V\x42\x00';
const DRAWER_KICK = ESC + 'p\x00\x19\xFA';
const money = (c) => `$${(Number(c || 0) / 100).toFixed(2)}`;

function receiptBuffer(o) {
  let s = INIT + CENTER + BOLD_ON + (o.orgName || 'Taproot') + '\n' + BOLD_OFF;
  if (o.locationName) s += o.locationName + '\n';
  s += LEFT + '\n';
  s += `Order: ${o.orderNumber || ''}\n`;
  if (o.employeeName) s += `Served by: ${o.employeeName}\n`;
  s += '------------------------------\n';
  for (const it of o.items || []) {
    s += `${it.quantity}x ${it.name}\n`;
    for (const m of it.modifiers || []) s += `   + ${m}\n`;
    s += `${' '.repeat(22)}${money(it.total)}\n`;
  }
  s += '------------------------------\n';
  s += `Subtotal: ${money(o.subtotal)}\n`;
  if (o.taxTotal) s += `Tax: ${money(o.taxTotal)}\n`;
  if (o.tipTotal) s += `Tip: ${money(o.tipTotal)}\n`;
  s += BOLD_ON + `TOTAL: ${money(o.total)}\n` + BOLD_OFF;
  s += `Paid (${o.paymentMethod || ''}): ${money(o.amountPaid)}\n`;
  if (o.changeDue) s += `Change: ${money(o.changeDue)}\n`;
  s += CENTER + '\nThank you!\n\n\n' + CUT;
  return Buffer.from(s, 'binary');
}

function kitchenBuffer(o) {
  let s = INIT + CENTER + BOLD_ON + '*** KITCHEN ***\n' + BOLD_OFF + LEFT;
  s += `Order: ${o.orderNumber || ''}\n`;
  if (o.tableName) s += `Table: ${o.tableName}\n`;
  s += '------------------------------\n';
  for (const it of o.items || []) {
    s += BOLD_ON + `${it.quantity}x ${String(it.name || '').toUpperCase()}\n` + BOLD_OFF;
    for (const m of it.modifiers || []) s += `   >> ${m}\n`;
  }
  s += '\n\n\n' + CUT;
  return Buffer.from(s, 'binary');
}

function sendToPrinter(buf) {
  return new Promise((resolve) => {
    if (!PRINTER_IP) {
      console.log('[print] (no PRINTER_IP) would print %d bytes:\n%s', buf.length, buf.toString('binary').replace(/[\x00-\x1F]/g, ' '));
      return resolve(true);
    }
    const sock = net.createConnection(PRINTER_PORT, PRINTER_IP, () => { sock.write(buf, () => sock.end()); });
    sock.on('close', () => resolve(true));
    sock.on('error', (e) => { console.error('[print] printer error:', e.message); resolve(false); });
    sock.setTimeout(4000, () => { sock.destroy(); resolve(false); });
  });
}

function probePrinter() {
  return new Promise((resolve) => {
    if (!PRINTER_IP) return resolve('offline');
    const sock = net.createConnection(PRINTER_PORT, PRINTER_IP, () => { sock.end(); resolve('connected'); });
    sock.on('error', () => resolve('offline'));
    sock.setTimeout(1500, () => { sock.destroy(); resolve('offline'); });
  });
}

// ── HTTP server ─────────────────────────────────────────────────────────────
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function readJson(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = req.url || '/';
  res.setHeader('Content-Type', 'application/json');

  try {
    if (req.method === 'GET' && url === '/health') {
      const printer = await probePrinter();
      return res.end(JSON.stringify({ status: 'ok', printer, printerIp: PRINTER_IP || null }));
    }
    if (req.method === 'POST' && url === '/print/receipt') {
      const ok = await sendToPrinter(receiptBuffer(await readJson(req)));
      return res.end(JSON.stringify({ ok }));
    }
    if (req.method === 'POST' && url === '/print/kitchen') {
      const ok = await sendToPrinter(kitchenBuffer(await readJson(req)));
      return res.end(JSON.stringify({ ok }));
    }
    if (req.method === 'POST' && url === '/drawer/open') {
      const ok = await sendToPrinter(Buffer.from(DRAWER_KICK, 'binary'));
      return res.end(JSON.stringify({ ok }));
    }
    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    res.writeHead(500); res.end(JSON.stringify({ error: String(e && e.message || e) }));
  }
});

server.listen(PORT, () => {
  console.log(`Taproot print server on http://localhost:${PORT}  (printer: ${PRINTER_IP || 'none — log mode'})`);
});
