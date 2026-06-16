/**
 * thermalPrint — Tier-2 printing via a local ESC/POS print server.
 *
 * The print server (apps/print-server) runs on the cashier's machine and talks
 * to a USB/network thermal printer. If it's reachable we POST jobs to it;
 * otherwise callers fall back to Tier-1 browser printing (lib/print.ts).
 *
 * Server URL is configurable in Settings → Hardware (localStorage).
 */

import type { LastCompletedOrder } from '../store/pos.store';
import { printReceiptNative, printKitchenNative, openCashDrawerNative } from '../services/print.service';

const URL_KEY = 'taproot_print_server_url';
const DEFAULT_URL = 'http://localhost:3333';

export function getPrintServerUrl(): string {
  try { return localStorage.getItem(URL_KEY) || DEFAULT_URL; } catch { return DEFAULT_URL; }
}
export function setPrintServerUrl(url: string): void {
  try { localStorage.setItem(URL_KEY, url || DEFAULT_URL); } catch { /* ignore */ }
}

export interface PrintServerStatus { available: boolean; printer: 'connected' | 'offline' | 'unknown' }

/** Probe the print server with a short timeout. */
export async function checkPrintServer(): Promise<PrintServerStatus> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`${getPrintServerUrl()}/health`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return { available: false, printer: 'unknown' };
    const body = await res.json().catch(() => ({})) as { printer?: string };
    return { available: true, printer: (body.printer as PrintServerStatus['printer']) ?? 'unknown' };
  } catch {
    return { available: false, printer: 'unknown' };
  }
}

async function post(path: string, payload: unknown): Promise<boolean> {
  try {
    const res = await fetch(`${getPrintServerUrl()}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Returns true if the job was sent to the thermal printer; false → caller should fall back. */
export async function printReceiptThermal(order: LastCompletedOrder): Promise<boolean> {
  // Desktop app (Tauri) native ESC/POS first, when a USB/network printer is configured.
  if (await printReceiptNative(order)) return true;
  const { available } = await checkPrintServer();
  if (!available) return false;
  return post('/print/receipt', order);
}

export async function printKitchenThermal(order: LastCompletedOrder): Promise<boolean> {
  if (await printKitchenNative(order)) return true;
  const { available } = await checkPrintServer();
  if (!available) return false;
  return post('/print/kitchen', order);
}

export async function openCashDrawer(): Promise<boolean> {
  if (await openCashDrawerNative()) return true;
  const { available } = await checkPrintServer();
  if (!available) return false;
  return post('/drawer/open', {});
}
