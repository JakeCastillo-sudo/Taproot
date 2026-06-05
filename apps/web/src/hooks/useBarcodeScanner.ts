/**
 * useBarcodeScanner — detect hardware barcode scanners (USB/Bluetooth act as
 * keyboards). Characters from a scanner arrive much faster than human typing;
 * we collect fast bursts ending in Enter and fire onScan.
 *
 * Disabled by default per setting (Settings → Hardware). Ignores input while a
 * text field is focused so it never hijacks normal typing.
 */

import { useEffect, useRef } from 'react';

const ENABLED_KEY = 'taproot_scanner_enabled';
const FAST_MS = 50;     // inter-key gap below this ⇒ machine input
const MIN_LEN = 3;

export function getScannerEnabled(): boolean {
  try { return localStorage.getItem(ENABLED_KEY) === 'true'; } catch { return false; }
}
export function setScannerEnabled(v: boolean): void {
  try { localStorage.setItem(ENABLED_KEY, String(v)); } catch { /* ignore */ }
}

export function useBarcodeScanner(onScan: (code: string) => void, enabled = true): void {
  const buf = useRef('');
  const last = useRef(0);

  useEffect(() => {
    if (!enabled || !getScannerEnabled()) return;

    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      const now = Date.now();
      const gap = now - last.current;
      last.current = now;

      if (e.key === 'Enter') {
        if (buf.current.length >= MIN_LEN && gap < FAST_MS * 4) {
          const code = buf.current;
          buf.current = '';
          if (!typing) { e.preventDefault(); onScan(code); }
        } else {
          buf.current = '';
        }
        return;
      }
      if (e.key.length !== 1) return;        // ignore Shift/Tab/etc.
      if (gap > FAST_MS) buf.current = '';    // human pause → reset
      buf.current += e.key;
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onScan, enabled]);
}
