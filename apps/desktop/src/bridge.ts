import { invoke } from '@tauri-apps/api/core'

declare global {
  interface Window {
    taproot?: {
      isDesktop: boolean
      listPrinters: () => Promise<string[]>
      printReceipt: (
        portName: string, order: object
      ) => Promise<void>
      printKitchen: (
        portName: string, order: object
      ) => Promise<void>
      openCashDrawer: (portName: string) => Promise<void>
    }
  }
}

// Called once at app init when running in Tauri
export function initTauriBridge() {
  if (typeof window === 'undefined') return
  if (!(window as any).__TAURI__) return

  window.taproot = {
    isDesktop: true,

    listPrinters: () =>
      invoke<string[]>('list_serial_ports'),

    printReceipt: (portName, order) =>
      invoke('print_receipt_escpos', {
        portName,
        orderJson: JSON.stringify(order),
      }),

    printKitchen: (portName, order) =>
      invoke('print_kitchen_ticket', {
        portName,
        orderJson: JSON.stringify(order),
      }),

    openCashDrawer: (portName) =>
      invoke('open_cash_drawer', { portName }),
  }
}
