/**
 * ReceiptPage — full-screen customer receipt after payment.
 *
 * Reads lastCompletedOrder from pos.store (populated by PaymentSheet on success).
 * If null, redirects to / (user navigated here directly or refreshed).
 *
 * Also fetches enriched data from GET /orders/:id/receipt so the org and
 * location names are real; updates localStorage so the next receipt is instant.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Printer, Mail, ChevronLeft, UtensilsCrossed, CheckCircle2 } from 'lucide-react';
import { clsx } from 'clsx';
import { usePOSStore } from '../store/pos.store';
import type { LastCompletedOrder } from '../store/pos.store';
import { orders as ordersApi, type ReceiptData } from '../lib/api';
import { showToast } from '../components/ui/Toast';
import { printReceipt, printKitchenTicket } from '../lib/print';
import { printReceiptThermal, printKitchenThermal } from '../lib/thermalPrint';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  }) + ' • ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function orderTypeLabel(type: string): string {
  switch (type.toLowerCase()) {
    case 'in_store':      return 'Dine In';
    case 'takeout':       return 'Takeout';
    case 'delivery':      return 'Delivery';
    case 'table_service': return 'Table Service';
    case 'online':        return 'Online';
    case 'phone':         return 'Phone Order';
    default:              return type;
  }
}

function paymentLabel(order: LastCompletedOrder, apiReceipt: ReceiptData | null): string {
  // Prefer richer API data (has card brand + last4)
  if (apiReceipt?.payments?.length) {
    const p = apiReceipt.payments[0];
    if (p.last4) return `${p.brand ?? 'Card'} ••••${p.last4}`;
    return p.method.charAt(0).toUpperCase() + p.method.slice(1);
  }
  if (order.cardLast4) return `${order.cardBrand ?? 'Card'} ••••${order.cardLast4}`;
  switch (order.paymentMethod) {
    case 'cash':           return 'Cash';
    case 'card':           return 'Card';
    case 'gift_card':      return 'Gift Card';
    case 'account_credit': return 'Account Credit';
    default:               return order.paymentMethod;
  }
}

// ─── Receipt content (the element that window.print() captures) ───────────────

interface ReceiptContentProps {
  order:      LastCompletedOrder;
  apiReceipt: ReceiptData | null;
}

function ReceiptContent({ order, apiReceipt }: ReceiptContentProps) {
  const orgName      = apiReceipt?.orgName      ?? order.orgName;
  const locationName = apiReceipt?.locationName ?? order.locationName;
  const lineItems    = apiReceipt
    ? apiReceipt.lineItems.map((li) => ({
        name:      li.name,
        quantity:  li.quantity,
        modifiers: li.modifiers.map((m) => m.name),
        total:     li.total,
      }))
    : order.items;

  const subtotal  = apiReceipt?.subtotal  ?? order.subtotal;
  const taxTotal  = apiReceipt?.taxTotal  ?? order.taxTotal;
  const tipTotal  = apiReceipt?.tipTotal  ?? order.tipTotal;
  const total     = apiReceipt?.total     ?? order.total;
  const amtPaid   = apiReceipt?.amountPaid ?? order.amountPaid;
  const changeDue = apiReceipt?.changeDue  ?? order.changeDue;

  return (
    <div className="receipt-content font-mono text-xs text-gray-900 w-full">
      {/* Header */}
      <div className="text-center mb-4">
        <p className="text-base font-bold">{orgName}</p>
        <p className="text-gray-600">{locationName}</p>
        {apiReceipt?.locationPhone && (
          <p className="text-gray-500">{apiReceipt.locationPhone}</p>
        )}
        <p className="text-gray-500 mt-1">{fmtDate(order.completedAt)}</p>
        <p className="text-xl font-bold mt-2">Order #{order.orderNumber}</p>
        <span className="inline-block mt-1 px-2 py-0.5 bg-gray-100 rounded text-xs font-medium">
          {orderTypeLabel(order.orderType)}
        </span>
      </div>

      <div className="border-t border-dashed border-gray-300 my-2" />

      {/* Items */}
      <div className="space-y-2 mb-3">
        {lineItems.map((item, i) => (
          <div key={i}>
            <div className="flex justify-between">
              <span className="flex-1">{item.quantity} × {item.name}</span>
              <span className="ml-2 tabular-nums">{fmt(item.total)}</span>
            </div>
            {item.modifiers.map((mod, j) => (
              <div key={j} className="pl-4 text-gray-500">
                + {mod}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="border-t border-dashed border-gray-300 my-2" />

      {/* Totals */}
      <div className="space-y-1 mb-3">
        <div className="flex justify-between text-gray-600">
          <span>Subtotal</span><span className="tabular-nums">{fmt(subtotal)}</span>
        </div>
        {taxTotal > 0 && (
          <div className="flex justify-between text-gray-600">
            <span>Tax</span><span className="tabular-nums">{fmt(taxTotal)}</span>
          </div>
        )}
        {tipTotal > 0 && (
          <div className="flex justify-between text-gray-600">
            <span>Tip</span><span className="tabular-nums">{fmt(tipTotal)}</span>
          </div>
        )}
        <div className="border-t border-gray-400 my-1" />
        <div className="flex justify-between font-bold text-base">
          <span>TOTAL</span><span className="tabular-nums">{fmt(total)}</span>
        </div>
        <div className="flex justify-between text-gray-600">
          <span>Amount paid</span><span className="tabular-nums">{fmt(amtPaid)}</span>
        </div>
        {changeDue > 0 && (
          <div className="flex justify-between font-semibold text-green-700">
            <span>Change due</span><span className="tabular-nums">{fmt(changeDue)}</span>
          </div>
        )}
      </div>

      <div className="border-t border-dashed border-gray-300 my-2" />

      {/* Payment method + PAID stamp */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-gray-600">
          <span className="font-medium">{paymentLabel(order, apiReceipt)}</span>
        </div>
        <div className={clsx(
          'text-green-600 font-black text-lg border-2 border-green-600 px-2 py-0.5 rotate-[-8deg]',
          'inline-block select-none',
        )}>
          PAID
        </div>
      </div>

      {/* Footer */}
      <div className="text-center mt-4 text-gray-400">
        <p className="font-medium text-gray-600">Thank you for visiting {orgName}!</p>
        {apiReceipt?.footerText && (
          <p className="mt-1">{apiReceipt.footerText}</p>
        )}
        <p className="text-[10px] mt-2">taproot-pos.com</p>
        <p className="text-[10px]">Powered by Taproot POS</p>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function ReceiptPage() {
  const navigate = useNavigate();
  const { lastCompletedOrder, clearLastCompletedOrder } = usePOSStore();
  const [apiReceipt, setApiReceipt] = useState<ReceiptData | null>(null);

  // Redirect if there's no order (direct navigation or refresh)
  useEffect(() => {
    if (!lastCompletedOrder) {
      navigate('/', { replace: true });
    }
  }, [lastCompletedOrder, navigate]);

  // Enrich receipt with org/location names from API (best-effort)
  useEffect(() => {
    if (!lastCompletedOrder?.orderId) return;
    // Skip demo orders (they don't exist in the DB)
    if (lastCompletedOrder.orderId.startsWith('demo-')) return;

    ordersApi.getReceipt(lastCompletedOrder.orderId)
      .then((data) => {
        setApiReceipt(data);
        // Persist org / location name for instant future receipts
        if (data.orgName)      localStorage.setItem('taproot_org_name',      data.orgName);
        if (data.locationName) localStorage.setItem('taproot_location_name', data.locationName);
      })
      .catch(() => { /* non-fatal — store data is sufficient */ });
  }, [lastCompletedOrder?.orderId]);

  if (!lastCompletedOrder) return null; // redirect in flight

  const order = lastCompletedOrder;

  const handleNewOrder = () => {
    clearLastCompletedOrder();
    navigate('/', { replace: true });
  };

  return (
    <div className="h-screen overflow-hidden bg-gray-100 flex flex-col">
      {/* ── Toolbar (no-print) ─────────────────────────────────────────── */}
      <div className="no-print bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 shrink-0">
        <button
          onClick={handleNewOrder}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          title="New Order"
        >
          <ChevronLeft size={18} className="text-gray-600" />
        </button>
        <span className="text-sm font-semibold text-gray-800 flex-1">Receipt</span>
        <span className="text-xs text-gray-400">#{order.orderNumber}</span>
      </div>

      {/* ── Receipt card ───────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-h-0 p-4">
        <div className="max-w-sm mx-auto">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
            <ReceiptContent order={order} apiReceipt={apiReceipt} />
          </div>
        </div>
      </div>

      {/* ── Action buttons (no-print) ───────────────────────────────────── */}
      <div className="no-print bg-white border-t border-gray-200 px-4 py-4 space-y-2 shrink-0">
        <div className="max-w-sm mx-auto space-y-2">
          {/* Primary row */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => { void printReceiptThermal(order).then((sent) => { if (!sent) printReceipt(); }); }}
              className="flex items-center justify-center gap-2 py-2.5 bg-gray-800 text-white rounded-lg text-sm font-semibold hover:bg-gray-700 active:scale-[0.98] transition-all"
            >
              <Printer size={15} /> Print Receipt
            </button>
            <button
              onClick={() => showToast.info('Email receipt — coming soon')}
              className="flex items-center justify-center gap-2 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              <Mail size={15} /> Email Receipt
            </button>
          </div>

          {/* Secondary row */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => { void printKitchenThermal(order).then((sent) => { if (!sent) printKitchenTicket(order); }); }}
              className="flex items-center justify-center gap-2 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              <UtensilsCrossed size={15} /> Kitchen Ticket
            </button>
            <button
              onClick={handleNewOrder}
              className="flex items-center justify-center gap-2 py-2.5 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary/90 active:scale-[0.98] transition-all"
            >
              <CheckCircle2 size={15} /> New Order
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
