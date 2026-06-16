/**
 * useTauri — detect the Taproot desktop app and expose native printing.
 *
 * Outside the desktop app `isDesktop` is false and every method falls back to
 * the browser (window.print) or no-ops (cash drawer). Inside it, calls route to
 * native ESC/POS over USB-serial or network via window.taproot.
 *
 * The native contract lives in apps/desktop/src/bridge.ts. Note the network
 * methods take a single "ip"/"ip:port" host string (no separate port arg), so
 * we compose host:port here.
 */
import { useState } from 'react';
import { getDesktopApi } from '../services/print.service';
import type { LastCompletedOrder } from '../store/pos.store';

export interface PrintTarget {
  portName?:    string; // USB serial port
  networkHost?: string; // printer IP
  networkPort?: number; // TCP port (default 9100)
}

function host(t: PrintTarget): string {
  return `${t.networkHost}:${t.networkPort ?? 9100}`;
}

export function useTauri() {
  const [api] = useState(() => getDesktopApi());
  const isDesktop = !!api;

  return {
    isDesktop,
    api,

    /** List available USB/serial printer ports (empty outside desktop). */
    listPrinters: async (): Promise<string[]> => {
      if (!api) return [];
      try { return await api.listPrinters(); } catch { return []; }
    },

    /** Receipt — native USB/network when configured, else browser print. */
    printReceipt: async (order: LastCompletedOrder, config?: PrintTarget): Promise<void> => {
      if (api && config?.portName) {
        await api.printReceipt(config.portName, order);
      } else if (api && config?.networkHost) {
        await api.printReceiptNetwork(host(config), order);
      } else {
        window.print();
      }
    },

    /** Kitchen ticket — native USB/network when configured, else browser print. */
    printKitchen: async (order: LastCompletedOrder, config?: PrintTarget): Promise<void> => {
      if (api && config?.portName) {
        await api.printKitchen(config.portName, order);
      } else if (api && config?.networkHost) {
        await api.printKitchenNetwork(host(config), order);
      } else {
        window.print();
      }
    },

    /** Cash-drawer kick — native only (no browser equivalent). */
    openCashDrawer: async (config?: PrintTarget): Promise<void> => {
      if (!api) return;
      if (config?.portName) {
        await api.openCashDrawer(config.portName);
      } else if (config?.networkHost) {
        await api.openCashDrawerNetwork(host(config));
      }
    },
  };
}

export default useTauri;
