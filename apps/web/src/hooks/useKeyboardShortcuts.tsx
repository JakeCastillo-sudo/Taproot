/**
 * Global keyboard shortcuts for the POS.
 * All shortcuts are disabled when focus is inside any input/textarea/select.
 */

import { useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { usePOSStore } from '../store/pos.store';
import { showToast } from '../components/ui/Toast';

export interface ShortcutMap {
  key:         string;
  ctrl?:       boolean;
  label:       string;
  description: string;
}

export const SHORTCUTS: ShortcutMap[] = [
  { key: '/',      label: '/',         description: 'Focus search bar' },
  { key: 'Escape', label: 'Esc',       description: 'Close any open sheet' },
  { key: 'Enter',  label: 'Enter',     description: 'Open payment (cart has items)' },
  { key: 'k', ctrl: true, label: '⌘K', description: 'Open command palette' },
  { key: 'F2',     label: 'F2',        description: 'Park current order' },
  { key: 'F3',     label: 'F3',        description: 'Resume parked order' },
  { key: 'F4',     label: 'F4',        description: 'Focus customer search' },
  { key: 'F8',     label: 'F8',        description: 'Open discount selector' },
  { key: 'z', ctrl: true, label: 'Ctrl+Z', description: 'Undo last add to cart' },
  { key: 'd', ctrl: true, label: 'Ctrl+D', description: 'Clear cart' },
  { key: 'p', ctrl: true, label: 'Ctrl+P', description: 'Print last receipt' },
  { key: '?',      label: '?',         description: 'Show this shortcuts overlay' },
];

export function useKeyboardShortcuts(opts?: {
  onOpenPayment?:       () => void;
  onParkOrder?:         () => void;
  onResumeOrder?:       () => void;
  onFocusSearch?:       () => void;
  onFocusCustomer?:     () => void;
  onOpenDiscounts?:     () => void;
  onPrintReceipt?:      () => void;
  onShowHelp?:          () => void;
  onOpenCommandPalette?: () => void;
}) {
  const {
    cart, clearCart, undoLastRemove,
    isPaymentSheetOpen, isModifierSheetOpen,
    setPaymentSheetOpen, setModifierSheetOpen,
  } = usePOSStore();

  const isInputFocused = useCallback(() => {
    const tag = (document.activeElement?.tagName ?? '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select';
  }, []);

  const isAnySheetOpen = isPaymentSheetOpen || isModifierSheetOpen;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isInputFocused()) return;

      const key  = e.key;
      const ctrl = e.ctrlKey || e.metaKey;

      // Escape — close any open sheet
      if (key === 'Escape') {
        if (isPaymentSheetOpen)  { setPaymentSheetOpen(false);  e.preventDefault(); return; }
        if (isModifierSheetOpen) { setModifierSheetOpen(false); e.preventDefault(); return; }
        return;
      }

      // ⌘K / Ctrl+K — command palette (works even when a sheet is open)
      if (key === 'k' && ctrl) {
        e.preventDefault();
        opts?.onOpenCommandPalette?.();
        return;
      }

      if (isAnySheetOpen) return;

      if (key === '/' && !ctrl) {
        e.preventDefault();
        opts?.onFocusSearch?.();
        (document.getElementById('pos-search') as HTMLInputElement | null)?.focus();
        return;
      }

      if (key === 'Enter' && !ctrl) {
        if (cart.length > 0) {
          e.preventDefault();
          opts?.onOpenPayment?.();
          setPaymentSheetOpen(true);
        }
        return;
      }

      if (key === 'F2') { e.preventDefault(); opts?.onParkOrder?.(); return; }
      if (key === 'F3') { e.preventDefault(); opts?.onResumeOrder?.(); return; }

      if (key === 'F4') {
        e.preventDefault();
        opts?.onFocusCustomer?.();
        (document.getElementById('customer-search') as HTMLInputElement | null)?.focus();
        return;
      }

      if (key === 'F8') { e.preventDefault(); opts?.onOpenDiscounts?.(); return; }

      if (key === 'z' && ctrl) {
        e.preventDefault();
        undoLastRemove();
        showToast.info('Undo: item restored');
        return;
      }

      if (key === 'd' && ctrl) {
        e.preventDefault();
        if (cart.length > 0 && window.confirm('Clear the current cart?')) {
          clearCart();
          showToast.info('Cart cleared');
        }
        return;
      }

      if (key === 'p' && ctrl) {
        e.preventDefault();
        opts?.onPrintReceipt?.();
        return;
      }

      if (key === '?') {
        e.preventDefault();
        opts?.onShowHelp?.();
        return;
      }

      // 1–9 quick-add
      if (!ctrl && key >= '1' && key <= '9') {
        const pos   = parseInt(key, 10) - 1;
        const tiles = document.querySelectorAll<HTMLButtonElement>('[data-product-tile]');
        if (tiles[pos]) { e.preventDefault(); tiles[pos].click(); }
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    cart.length, isInputFocused, isAnySheetOpen,
    isPaymentSheetOpen, isModifierSheetOpen,
    setPaymentSheetOpen, setModifierSheetOpen,
    clearCart, undoLastRemove, opts,
  ]);
}

// ─── Shortcuts overlay ────────────────────────────────────────────────────────

import { useEffect as useEffectOverlay } from 'react';

interface ShortcutsOverlayProps { onClose: () => void }

export function ShortcutsOverlay({ onClose }: ShortcutsOverlayProps) {
  useEffectOverlay(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-lg w-full max-w-md mx-4 overflow-hidden animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-800">Keyboard Shortcuts</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
          {SHORTCUTS.map((s) => (
            <div key={s.label} className="flex items-center justify-between px-5 py-2.5">
              <span className="text-xs text-gray-600">{s.description}</span>
              <kbd className="px-2 py-0.5 bg-gray-100 rounded text-xs font-mono font-medium text-gray-700 border border-gray-200 shrink-0 ml-4">
                {s.label}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
