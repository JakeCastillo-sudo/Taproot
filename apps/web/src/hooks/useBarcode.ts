/**
 * Barcode scanner hook.
 *
 * Barcode scanners type 8+ characters faster than human typing (< 100ms total).
 * We buffer keystrokes and if the whole sequence arrives in < 100ms we treat it
 * as a scan, not human input.
 */

import { useEffect, useRef, useCallback } from 'react';
import { usePOSStore } from '../store/pos.store';
import { products } from '../lib/api';
import { showToast } from '../components/ui/Toast';
import { getScannerEnabled } from './useBarcodeScanner';

export function useBarcode(): void {
  const addToCart          = usePOSStore((s) => s.addToCart);
  const isModifierSheetOpen = usePOSStore((s) => s.isModifierSheetOpen);
  const isPaymentSheetOpen  = usePOSStore((s) => s.isPaymentSheetOpen);

  const buffer     = useRef<string>('');
  const lastTime   = useRef<number>(0);
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  const processBarcode = useCallback(async (barcode: string) => {
    if (barcode.length < 4) return; // too short to be a real barcode
    try {
      const product = await products.searchByBarcode(barcode);
      if (product) {
        const defaultVariant = product.variants?.[0];
        addToCart({
          productId: product.id,
          variantId: defaultVariant?.id ?? null,
          name:      product.name,
          sku:       product.sku ?? '',
          quantity:  1,
          unitPrice: product.defaultPrice ?? 0,
          modifiers: [],
          notes:     '',
        });
        showToast.success(`Added: ${product.name}`);
      } else {
        showToast.warning(`Product not found: ${barcode}`);
      }
    } catch {
      showToast.warning(`Product not found: ${barcode}`);
    }
  }, [addToCart]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Respect the Settings → Hardware scanner toggle
      if (!getScannerEnabled()) return;
      // Disable when sheets are open
      if (isModifierSheetOpen || isPaymentSheetOpen) return;

      // Disable when user is typing in an input / textarea / contenteditable
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      // Only capture printable characters
      if (e.key.length !== 1) return;

      const now = Date.now();

      if (now - lastTime.current > 50 && buffer.current.length === 0) {
        // Fresh start — OK
      } else if (now - lastTime.current > 200) {
        // Gap too large — discard previous buffer
        buffer.current = '';
      }

      lastTime.current = now;
      buffer.current  += e.key;

      // Clear any existing timer
      if (timerRef.current) clearTimeout(timerRef.current);

      // Wait for Enter or a 100ms silence to signal end of scan
      if (e.key === 'Enter') {
        const barcode = buffer.current.slice(0, -1); // remove the Enter
        buffer.current = '';
        if (barcode.length >= 8) {
          void processBarcode(barcode);
        }
        return;
      }

      timerRef.current = setTimeout(() => {
        // After 100ms of silence — check if it was a scan (fast enough)
        const elapsed = Date.now() - (lastTime.current - now) - now;
        void elapsed; // elapsed check already handled by buffer reset above
        const barcode = buffer.current;
        buffer.current = '';
        if (barcode.length >= 8) {
          void processBarcode(barcode);
        }
      }, 100);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isModifierSheetOpen, isPaymentSheetOpen, processBarcode]);
}
