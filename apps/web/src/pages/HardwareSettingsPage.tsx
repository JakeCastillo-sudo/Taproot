/**
 * HardwareSettingsPage — /settings/hardware
 * Thermal print server config/status/test (S6-03) + barcode scanner settings (S6-04).
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Printer, CheckCircle2, XCircle, ScanLine, Monitor, MonitorSmartphone, RefreshCw, Download } from 'lucide-react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  getPrintServerUrl, setPrintServerUrl, checkPrintServer, printReceiptThermal,
  type PrintServerStatus,
} from '../lib/thermalPrint';
import { useTauri } from '../hooks/useTauri';
import {
  getPrinterConfig, setPrinterConfig, openCashDrawerNative,
  type PrinterConfig, type PrinterMode,
} from '../services/print.service';
import { getScannerEnabled, setScannerEnabled } from '../hooks/useBarcodeScanner';
import { openCustomerDisplay, DISPLAY_IDLE_MSG_KEY } from '../lib/displayChannel';
import { showToast } from '../components/ui/Toast';
import type { LastCompletedOrder } from '../store/pos.store';

const SAMPLE: LastCompletedOrder = {
  orderId: 'test', orderNumber: 'TEST-0001',
  items: [{ name: 'Test Burger', quantity: 1, unitPrice: 1200, modifiers: ['Add cheese'], total: 1350 }],
  subtotal: 1350, taxTotal: 120, tipTotal: 0, total: 1470, amountPaid: 1470, changeDue: 0,
  paymentMethod: 'cash', employeeName: 'Test', locationName: 'Test Location', orgName: 'Taproot',
  orderType: 'in_store', completedAt: new Date().toISOString(),
};

const PRINTER_MODELS = ['Epson TM-T88', 'Star TSP100', 'Star TSP650', 'Generic ESC/POS'];

// ─── Desktop-only native printer setup (Tauri) ──────────────────────────────────
// USB/network ESC/POS, configured via print.service (localStorage). Only rendered
// inside the Taproot desktop app; the web build shows a download prompt instead.

function DesktopPrinterSection() {
  const { isDesktop, listPrinters, printReceipt } = useTauri();
  const [cfg, setCfg] = useState<PrinterConfig>(() => getPrinterConfig());
  const [ports, setPorts] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);

  const field = 'w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40';

  const refreshPorts = async () => {
    setScanning(true);
    const list = await listPrinters();
    setPorts(list);
    setScanning(false);
  };

  useEffect(() => {
    if (isDesktop && cfg.mode === 'usb') void refreshPorts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDesktop]);

  const update = (patch: Partial<PrinterConfig>) => {
    setCfg((prev) => { const next = { ...prev, ...patch }; setPrinterConfig(next); return next; });
  };

  const target = cfg.mode === 'usb'
    ? { portName: cfg.usbPort || undefined }
    : cfg.mode === 'network'
      ? { networkHost: cfg.networkHost || undefined, networkPort: cfg.networkPort }
      : {};

  const testPrint = async () => {
    if (cfg.mode === 'usb' && !cfg.usbPort) { showToast.error('Select a printer port first'); return; }
    if (cfg.mode === 'network' && !cfg.networkHost) { showToast.error('Enter the printer IP first'); return; }
    try { await printReceipt(SAMPLE, target); showToast.success('Test print sent'); }
    catch (e) { showToast.error(e instanceof Error ? e.message : 'Print failed'); }
  };

  const testDrawer = async () => {
    // openCashDrawerNative reads the saved printer config (USB port / network host).
    try {
      const sent = await openCashDrawerNative();
      if (sent) showToast.success('Cash drawer kicked');
      else showToast.error('Configure a USB/network printer first');
    } catch (e) { showToast.error(e instanceof Error ? e.message : 'Drawer failed'); }
  };

  if (!isDesktop) {
    return (
      <section className="border border-gray-100 rounded-lg p-4">
        <h2 className="flex items-center gap-2 text-sm font-bold text-gray-900 mb-1"><Printer size={16} /> Receipt Printer</h2>
        <p className="text-xs text-gray-500 mb-3">Connect a USB or network thermal printer.</p>
        <div className="bg-gray-50 border border-gray-100 rounded-md p-3">
          <p className="text-xs text-gray-600">
            Direct USB / network printer setup is available in the Taproot desktop app for Mac and Windows.
          </p>
          <Link to="/download" className="inline-flex items-center gap-1.5 mt-2 text-sm font-semibold text-primary hover:underline">
            <Download size={14} /> Download Desktop App →
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="border border-gray-100 rounded-lg p-4">
      <h2 className="flex items-center gap-2 text-sm font-bold text-gray-900 mb-1"><Printer size={16} /> Receipt Printer</h2>
      <p className="text-xs text-gray-500 mb-3">Connect a USB or network thermal printer.</p>

      {/* Mode selector */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit mb-4">
        {(['browser', 'usb', 'network'] as PrinterMode[]).map((m) => (
          <button
            key={m}
            onClick={() => update({ mode: m })}
            className={clsx(
              'px-3 py-1.5 rounded-md text-xs font-semibold capitalize transition-colors',
              cfg.mode === m ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700',
            )}
          >
            {m === 'browser' ? 'Browser' : m === 'usb' ? 'USB' : 'Network'}
          </button>
        ))}
      </div>

      {cfg.mode === 'browser' && (
        <p className="text-xs text-gray-500">Uses the system print dialog. No printer setup needed.</p>
      )}

      {cfg.mode === 'usb' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Printer port</label>
            <div className="flex gap-2">
              <select className={field + ' bg-white'} value={cfg.usbPort} onChange={(e) => update({ usbPort: e.target.value })}>
                <option value="">Select a port…</option>
                {ports.map((p) => <option key={p} value={p}>{p}</option>)}
                {cfg.usbPort && !ports.includes(cfg.usbPort) && <option value={cfg.usbPort}>{cfg.usbPort}</option>}
              </select>
              <button onClick={() => void refreshPorts()} disabled={scanning} className="px-3 py-2 border border-gray-200 rounded-md text-sm text-gray-600 hover:bg-gray-50 shrink-0 flex items-center gap-1.5">
                <RefreshCw size={13} className={clsx(scanning && 'animate-spin')} /> {scanning ? 'Scanning…' : 'Refresh'}
              </button>
            </div>
            {ports.length === 0 && !scanning && <p className="text-[11px] text-gray-400 mt-1">No ports found — make sure the printer is connected, then Refresh.</p>}
          </div>
          <div className="flex gap-2">
            <button onClick={() => void testPrint()} className="px-3 py-2 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary-dark">Test print</button>
            <button onClick={() => void testDrawer()} className="px-3 py-2 border border-gray-200 text-gray-600 text-sm font-medium rounded-md hover:bg-gray-50">Test cash drawer</button>
          </div>
        </div>
      )}

      {cfg.mode === 'network' && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-gray-600 mb-1">IP address</label>
              <input className={field} value={cfg.networkHost} onChange={(e) => update({ networkHost: e.target.value.trim() })} placeholder="192.168.1.100" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Port</label>
              <input className={field} type="number" value={cfg.networkPort} onChange={(e) => update({ networkPort: Number(e.target.value) || 9100 })} placeholder="9100" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => void testPrint()} className="px-3 py-2 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary-dark">Test print</button>
            <button onClick={() => void testDrawer()} className="px-3 py-2 border border-gray-200 text-gray-600 text-sm font-medium rounded-md hover:bg-gray-50">Test cash drawer</button>
          </div>
        </div>
      )}
    </section>
  );
}

export function HardwareSettingsPage() {
  const [url, setUrl] = useState(getPrintServerUrl());
  const [status, setStatus] = useState<PrintServerStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [model, setModel] = useState(() => { try { return localStorage.getItem('taproot_printer_model') || PRINTER_MODELS[0]; } catch { return PRINTER_MODELS[0]; } });
  const [scanner, setScanner] = useState(getScannerEnabled());
  const [idleMsg, setIdleMsg] = useState(() => {
    try { return localStorage.getItem(DISPLAY_IDLE_MSG_KEY) ?? ''; } catch { return ''; }
  });
  const navigate = useNavigate();

  const probe = async () => { setChecking(true); setStatus(await checkPrintServer()); setChecking(false); };
  useEffect(() => { void probe(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const saveUrl = () => { setPrintServerUrl(url); showToast.success('Print server URL saved'); void probe(); };
  const test = async () => {
    const sent = await printReceiptThermal(SAMPLE);
    if (sent) showToast.success('Test receipt sent to printer'); else showToast.error('Print server not reachable');
  };

  const field = 'w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40';

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 md:px-6 py-4 border-b border-gray-100 bg-white shrink-0">
        <h1 className="text-lg font-bold text-gray-900">Hardware</h1>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0 p-4 md:p-6 space-y-6 max-w-2xl">

        {/* Native receipt printer (desktop app) */}
        <DesktopPrinterSection />

        {/* Thermal printer */}
        <section className="border border-gray-100 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="flex items-center gap-2 text-sm font-bold text-gray-900"><Printer size={16} /> Thermal printer</h2>
            {checking ? <span className="text-xs text-gray-400">Checking…</span>
              : status?.available ? <span className="flex items-center gap-1 text-xs text-green-600 font-medium"><CheckCircle2 size={14} /> Server up · printer {status.printer}</span>
              : <span className="flex items-center gap-1 text-xs text-gray-400"><XCircle size={14} /> Not detected</span>}
          </div>
          <p className="text-xs text-gray-500 mb-3">Run the local print server (see <code>docs/PRINT_SERVER.md</code>). Without it, printing uses the browser dialog.</p>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Print server URL</label>
          <div className="flex gap-2">
            <input className={field} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://localhost:3333" />
            <button onClick={saveUrl} className="px-3 py-2 bg-gray-800 text-white text-sm rounded-md hover:bg-gray-900 shrink-0">Save</button>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Printer model</label>
              <select className={field + ' bg-white'} value={model} onChange={(e) => { setModel(e.target.value); try { localStorage.setItem('taproot_printer_model', e.target.value); } catch { /* ignore */ } }}>
                {PRINTER_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="flex items-end">
              <button onClick={() => void test()} className="w-full px-3 py-2 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary-dark">Test print</button>
            </div>
          </div>
          <p className="text-[11px] text-gray-400 mt-2">Network printer IP is set via the <code>PRINTER_IP</code> env var on the print server.</p>
        </section>

        {/* Barcode scanner */}
        <section className="border border-gray-100 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-bold text-gray-900"><ScanLine size={16} /> Barcode scanner</h2>
            <button onClick={() => { const v = !scanner; setScanner(v); setScannerEnabled(v); showToast.success(v ? 'Scanner enabled' : 'Scanner disabled'); }}
              className={clsx('relative w-10 h-6 rounded-full transition-colors', scanner ? 'bg-primary' : 'bg-gray-200')}>
              <span className={clsx('absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform', scanner && 'translate-x-4')} />
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2">USB/Bluetooth scanners work as keyboard input — no driver needed. When enabled, fast scans at the POS add products to the cart; in Inventory they jump to the item.</p>
        </section>

        {/* Kiosk mode */}
        <section className="border border-gray-100 rounded-lg p-4">
          <h2 className="flex items-center gap-2 text-sm font-bold text-gray-900 mb-2"><Monitor size={16} /> Self-serve kiosk</h2>
          <p className="text-xs text-gray-500 mb-3">Launch full-screen self-serve ordering on this device. Exit with a 3-tap on the top-right corner + manager PIN (default 1234).</p>
          <button onClick={() => navigate('/kiosk')} className="px-3 py-2 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary-dark">Open Kiosk Mode</button>
        </section>

        {/* Customer-facing display (S8-02) */}
        <section className="border border-gray-100 rounded-lg p-4">
          <h2 className="flex items-center gap-2 text-sm font-bold text-gray-900 mb-2"><MonitorSmartphone size={16} /> Customer display</h2>
          <p className="text-xs text-gray-500 mb-3">
            A second screen facing the customer that mirrors the cart in real time (items, totals,
            payment confirmation). Open it in a new window and drag it to the customer-facing monitor.
            Works in this browser only — no server needed.
          </p>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Idle welcome message</label>
          <div className="flex gap-2 mb-3">
            <input
              className={field}
              value={idleMsg}
              onChange={(e) => setIdleMsg(e.target.value)}
              placeholder="Earn loyalty points on every purchase"
            />
            <button
              onClick={() => {
                try { localStorage.setItem(DISPLAY_IDLE_MSG_KEY, idleMsg.trim()); } catch { /* ignore */ }
                showToast.success('Idle message saved');
              }}
              className="px-3 py-2 bg-gray-800 text-white text-sm rounded-md hover:bg-gray-900 shrink-0"
            >
              Save
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={openCustomerDisplay} className="px-3 py-2 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary-dark">
              Open display window
            </button>
            <button onClick={() => window.open('/display', '_blank')} className="px-3 py-2 border border-gray-200 text-gray-600 text-sm font-medium rounded-md hover:bg-gray-50">
              Preview in tab
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
