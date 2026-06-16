/**
 * print.service — desktop (Tauri) native printing bridge + printer config.
 *
 * When the web app runs inside the Taproot desktop app, `window.taproot`
 * exposes native ESC/POS printing over USB-serial or network (TCP 9100). This
 * module:
 *   - persists the user's printer choice (mode / USB port / network host:port)
 *   - detects the desktop bridge (getDesktopApi)
 *   - offers non-hook native print helpers used by lib/thermalPrint.ts so the
 *     existing receipt flow routes to native automatically when configured.
 *
 * The real bridge contract is defined in apps/desktop/src/bridge.ts. Network
 * methods take a single host string ("ip" or "ip:port"); there is NO
 * (host, port, order) variant — we compose "host:port" here.
 *
 * Everything degrades gracefully: outside the desktop app getDesktopApi()
 * returns null and the native helpers return false, so callers fall back to the
 * print-server / browser path unchanged.
 */

import type { LastCompletedOrder } from '../store/pos.store';

// ─── Printer config (persisted) ────────────────────────────────────────────────

export type PrinterMode = 'browser' | 'usb' | 'network';

export interface PrinterConfig {
  mode:        PrinterMode;
  usbPort:     string; // e.g. "/dev/tty.usbserial" or "COM3"
  networkHost: string; // e.g. "192.168.1.100"
  networkPort: number; // usually 9100
}

const CONFIG_KEY = 'taproot_printer_config';
const DEFAULT_CONFIG: PrinterConfig = { mode: 'browser', usbPort: '', networkHost: '', networkPort: 9100 };

export function getPrinterConfig(): PrinterConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<PrinterConfig>) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function setPrinterConfig(cfg: PrinterConfig): void {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

// ─── Desktop bridge (window.taproot) ───────────────────────────────────────────

/** Mirrors apps/desktop/src/bridge.ts → window.taproot. */
export interface DesktopPrinterApi {
  isDesktop:              boolean;
  listPrinters:           () => Promise<string[]>;
  printReceipt:           (portName: string, order: object) => Promise<void>;
  printKitchen:           (portName: string, order: object) => Promise<void>;
  openCashDrawer:         (portName: string) => Promise<void>;
  printReceiptNetwork:    (host: string, order: object) => Promise<void>;
  printKitchenNetwork:    (host: string, order: object) => Promise<void>;
  openCashDrawerNetwork:  (host: string) => Promise<void>;
}

/** The native printing API when running inside the desktop app, else null. */
export function getDesktopApi(): DesktopPrinterApi | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { __TAURI__?: unknown; taproot?: DesktopPrinterApi };
  if (!w.__TAURI__) return null;
  if (!w.taproot?.isDesktop) return null;
  return w.taproot;
}

/** True when running inside the Taproot desktop app. */
export function isDesktopApp(): boolean {
  return getDesktopApi() !== null;
}

/** Compose the bridge's "ip:port" host string. */
function netHost(cfg: PrinterConfig): string {
  return cfg.networkPort ? `${cfg.networkHost}:${cfg.networkPort}` : cfg.networkHost;
}

// ─── Native print helpers (non-hook — used by thermalPrint.ts) ─────────────────
// Each returns true if the job was dispatched natively, false → caller falls back.

export async function printReceiptNative(order: LastCompletedOrder): Promise<boolean> {
  const api = getDesktopApi();
  if (!api) return false;
  const cfg = getPrinterConfig();
  try {
    if (cfg.mode === 'usb' && cfg.usbPort) { await api.printReceipt(cfg.usbPort, order); return true; }
    if (cfg.mode === 'network' && cfg.networkHost) { await api.printReceiptNetwork(netHost(cfg), order); return true; }
    return false;
  } catch {
    return false;
  }
}

export async function printKitchenNative(order: LastCompletedOrder): Promise<boolean> {
  const api = getDesktopApi();
  if (!api) return false;
  const cfg = getPrinterConfig();
  try {
    if (cfg.mode === 'usb' && cfg.usbPort) { await api.printKitchen(cfg.usbPort, order); return true; }
    if (cfg.mode === 'network' && cfg.networkHost) { await api.printKitchenNetwork(netHost(cfg), order); return true; }
    return false;
  } catch {
    return false;
  }
}

export async function openCashDrawerNative(): Promise<boolean> {
  const api = getDesktopApi();
  if (!api) return false;
  const cfg = getPrinterConfig();
  try {
    if (cfg.mode === 'usb' && cfg.usbPort) { await api.openCashDrawer(cfg.usbPort); return true; }
    if (cfg.mode === 'network' && cfg.networkHost) { await api.openCashDrawerNetwork(netHost(cfg)); return true; }
    return false;
  } catch {
    return false;
  }
}
