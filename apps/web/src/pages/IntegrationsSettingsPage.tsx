/**
 * IntegrationsSettingsPage — /settings/integrations
 * Accounting CSV export (QuickBooks / Xero) + "coming soon" integration stubs.
 */

import { useState } from 'react';
import { Download, Plug } from 'lucide-react';
import { integrations as intApi } from '../lib/api';
import { showToast } from '../components/ui/Toast';

function isoDaysAgo(n: number): string { return new Date(Date.now() - n * 864e5).toISOString().slice(0, 10); }

const COMING_SOON = ['Mailchimp', 'Gusto', 'OpenTable', 'DoorDash'];

export function IntegrationsSettingsPage() {
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [busy, setBusy] = useState<string | null>(null);

  const exportCsv = async (provider: 'quickbooks' | 'xero') => {
    setBusy(provider);
    try {
      const csv = await intApi.exportCsv(provider, new Date(from).toISOString(), new Date(to + 'T23:59:59').toISOString());
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      const a = document.createElement('a'); a.href = url; a.download = `taproot-${provider}-export.csv`; a.click(); URL.revokeObjectURL(url);
      showToast.success('Export downloaded');
    } catch (e) { showToast.error(e instanceof Error ? e.message : 'Export failed'); }
    finally { setBusy(null); }
  };

  const field = 'px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40';

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 md:px-6 py-4 border-b border-gray-100 bg-white shrink-0">
        <h1 className="text-lg font-bold text-gray-900">Integrations</h1>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0 p-4 md:p-6 space-y-6 max-w-2xl">
        <section className="border border-gray-100 rounded-lg p-4">
          <h2 className="text-sm font-bold text-gray-900 mb-1">Accounting export</h2>
          <p className="text-xs text-gray-500 mb-3">Download daily sales as a CSV ready for the QuickBooks or Xero import wizard.</p>
          <div className="flex flex-wrap items-end gap-3">
            <div><label className="block text-xs font-semibold text-gray-600 mb-1">From</label><input type="date" className={field} value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><label className="block text-xs font-semibold text-gray-600 mb-1">To</label><input type="date" className={field} value={to} onChange={(e) => setTo(e.target.value)} /></div>
            <button onClick={() => exportCsv('quickbooks')} disabled={!!busy}
              className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary-dark disabled:opacity-50">
              <Download size={14} /> {busy === 'quickbooks' ? 'Exporting…' : 'QuickBooks'}
            </button>
            <button onClick={() => exportCsv('xero')} disabled={!!busy}
              className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 text-gray-700 text-sm font-semibold rounded-md hover:bg-gray-50 disabled:opacity-50">
              <Download size={14} /> {busy === 'xero' ? 'Exporting…' : 'Xero'}
            </button>
          </div>
        </section>

        <section className="border border-gray-100 rounded-lg p-4">
          <h2 className="text-sm font-bold text-gray-900 mb-3">More integrations</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {COMING_SOON.map((name) => (
              <div key={name} className="flex flex-col items-center gap-2 p-4 rounded-lg bg-gray-50 text-center">
                <Plug size={20} className="text-gray-300" />
                <span className="text-sm font-medium text-gray-600">{name}</span>
                <span className="text-[10px] text-gray-400">Coming soon</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
