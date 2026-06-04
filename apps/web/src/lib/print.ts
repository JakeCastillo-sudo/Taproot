/**
 * Print utilities for customer receipt and kitchen ticket.
 *
 * printReceipt()       — triggers window.print(); CSS hides everything except
 *                        .receipt-content so only the receipt is printed.
 *
 * printKitchenTicket() — opens a new popup window, injects the kitchen-ticket
 *                        HTML, triggers print, then closes the window.
 *                        This keeps the receipt page layout untouched.
 */

import type { LastCompletedOrder } from '../store/pos.store';

// ─── Customer receipt ─────────────────────────────────────────────────────────

export function printReceipt(): void {
  window.print();
}

// ─── Kitchen ticket ───────────────────────────────────────────────────────────

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour:   '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function orderTypeLabel(type: string): string {
  switch (type.toLowerCase()) {
    case 'in_store':    return 'DINE IN';
    case 'takeout':     return 'TAKEOUT';
    case 'delivery':    return 'DELIVERY';
    case 'table_service': return 'TABLE SERVICE';
    default:            return type.toUpperCase();
  }
}

function buildKitchenHtml(order: LastCompletedOrder): string {
  const divider = '─'.repeat(32);

  const itemsHtml = order.items.map((item) => {
    const modRows = item.modifiers.map(
      (m) => `<div class="mod">&gt;&gt; ${m.toUpperCase()}</div>`,
    ).join('');
    return `
      <div class="item">
        <div class="qty-name">${item.quantity} × ${item.name.toUpperCase()}</div>
        ${modRows}
      </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Kitchen Ticket #${order.orderNumber}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Courier New', Courier, monospace;
      font-size: 14px;
      width: 80mm;
      padding: 6px;
      color: #000;
    }
    .center { text-align: center; }
    .bold   { font-weight: bold; }
    .large  { font-size: 18px; }
    .xlarge { font-size: 22px; }
    .divider { border-top: 1px dashed #000; margin: 4px 0; }
    .item   { margin: 8px 0; }
    .qty-name { font-size: 16px; font-weight: bold; }
    .mod    { padding-left: 16px; font-size: 13px; }
    .footer { margin-top: 8px; font-size: 12px; }
    @media print {
      body { margin: 0; }
    }
  </style>
</head>
<body>
  <div class="center bold xlarge">*** KITCHEN ***</div>
  <div class="center bold large">#${order.orderNumber}</div>
  <div class="center bold">${orderTypeLabel(order.orderType)}</div>
  <div class="center">${fmtTime(order.completedAt)}</div>
  <div class="divider"></div>
  ${itemsHtml}
  <div class="divider"></div>
  <div class="footer">Server: ${order.employeeName || 'Staff'}</div>
  <div class="center bold">*** END OF TICKET ***</div>
</body>
</html>`;
}

export function printKitchenTicket(order: LastCompletedOrder): void {
  const win = window.open('', '_blank', 'width=320,height=500,menubar=no,toolbar=no');
  if (!win) {
    // Popup blocked — fall back to alert
    alert('Please allow pop-ups to print the kitchen ticket.');
    return;
  }
  win.document.open();
  win.document.write(buildKitchenHtml(order));
  win.document.close();
  win.focus();
  // Small delay so content renders before print dialog opens
  setTimeout(() => {
    win.print();
    win.close();
  }, 300);
}
