/**
 * QuickBooksSettingsPage — /settings/accounting
 *
 * Connect QuickBooks Online (OAuth), see sync status + recent log, toggle the
 * nightly sync, trigger a manual sync, and disconnect.
 */
import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Link2, RefreshCw } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { showToast } from '../components/ui/Toast';

interface SyncLogRow {
  sync_date: string;
  status: string;
  records_synced: number;
  error_message: string | null;
  created_at: string;
}
interface QBStatus {
  connected: boolean;
  configured: boolean;
  lastSynced?: string | null;
  syncEnabled?: boolean;
  log: SyncLogRow[];
}

function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function QuickBooksSettingsPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();

  // OAuth round-trip feedback (?connected / ?error from the callback redirect).
  useEffect(() => {
    if (params.get('connected') === 'true') {
      showToast.success('QuickBooks connected');
      setParams({}, { replace: true });
    } else if (params.get('error')) {
      showToast.error('QuickBooks connection failed — please try again');
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const statusQuery = useQuery({
    queryKey: ['quickbooks', 'status'],
    queryFn: () => apiFetch<QBStatus>('/quickbooks/status'),
  });
  const status = statusQuery.data;
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['quickbooks', 'status'] });

  const connect = useMutation({
    mutationFn: () => apiFetch<{ url: string }>('/quickbooks/connect'),
    onSuccess: (d) => { window.location.href = d.url; },
    onError: (e: unknown) =>
      showToast.error(e instanceof Error ? e.message : 'Could not start QuickBooks connect'),
  });

  const toggleSync = useMutation({
    mutationFn: (syncEnabled: boolean) =>
      apiFetch('/quickbooks/settings', { method: 'PATCH', body: JSON.stringify({ syncEnabled }) }),
    onSuccess: () => { showToast.success('Saved'); invalidate(); },
    onError: () => showToast.error('Could not update sync setting'),
  });

  const manualSync = useMutation({
    mutationFn: () => apiFetch('/quickbooks/sync', { method: 'POST', body: JSON.stringify({ date: todayISO() }) }),
    onSuccess: () => { showToast.success("Today's sales synced"); invalidate(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Sync failed'),
  });

  const disconnect = useMutation({
    mutationFn: () => apiFetch('/quickbooks/disconnect', { method: 'DELETE' }),
    onSuccess: () => { showToast.success('QuickBooks disconnected'); invalidate(); },
    onError: () => showToast.error('Could not disconnect'),
  });

  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      <div className="px-4 md:px-6 py-4 border-b border-gray-100 bg-white">
        <h1 className="text-lg font-bold text-gray-900">QuickBooks Integration</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Sync your daily sales to QuickBooks Online automatically.
        </p>
      </div>

      <div className="p-4 md:p-6 max-w-2xl space-y-5">
        {/* Connection status card */}
        <div className="bg-white border border-gray-100 rounded-lg p-5">
          {statusQuery.isLoading ? (
            <div className="h-12 bg-gray-100 rounded animate-shimmer" />
          ) : status?.connected ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={20} className="text-primary" />
                <span className="text-base font-bold text-gray-900">Connected</span>
              </div>
              <p className="text-sm text-gray-500">Last synced: {fmtDateTime(status.lastSynced)}</p>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-primary"
                  checked={status.syncEnabled ?? false}
                  onChange={(e) => toggleSync.mutate(e.target.checked)}
                  disabled={toggleSync.isPending}
                />
                <span className="text-sm text-gray-700">Automatic nightly sync enabled</span>
              </label>

              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={() => manualSync.mutate()}
                  disabled={manualSync.isPending}
                  className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary-dark disabled:opacity-50"
                >
                  <RefreshCw size={15} className={manualSync.isPending ? 'animate-spin' : ''} />
                  Sync today manually
                </button>
                <button
                  onClick={() => { if (window.confirm('Disconnect QuickBooks?')) disconnect.mutate(); }}
                  className="text-sm text-danger hover:underline"
                >
                  Disconnect
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                Connect your QuickBooks Online account to sync sales automatically.
              </p>
              {status && !status.configured && (
                <p className="text-xs text-amber-600">
                  Server not configured yet — set <code>QB_CLIENT_ID</code> / <code>QB_CLIENT_SECRET</code> (see setup below).
                </p>
              )}
              <button
                onClick={() => connect.mutate()}
                disabled={connect.isPending || (status ? !status.configured : false)}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary-dark disabled:opacity-50"
              >
                <Link2 size={16} /> Connect QuickBooks Online →
              </button>
            </div>
          )}
        </div>

        {/* How it works */}
        <div className="bg-gray-50 border border-gray-100 rounded-lg p-5">
          <h2 className="text-sm font-bold text-gray-800 mb-2">How it works</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            Every morning at 2am, Taproot automatically sends yesterday&apos;s sales summary to
            QuickBooks as a Sales Receipt. This includes:
          </p>
          <ul className="mt-2 text-sm text-gray-600 list-disc pl-5 space-y-0.5">
            <li>Total gross sales</li>
            <li>Tax collected</li>
            <li>Cash vs. card breakdown</li>
            <li>Order count</li>
          </ul>
          <p className="mt-2 text-sm text-gray-600">No manual data entry. No spreadsheets.</p>
        </div>

        {/* Sync log */}
        {status?.connected && (
          <div className="bg-white border border-gray-100 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="text-sm font-bold text-gray-800">Recent syncs</h2>
            </div>
            {status.log.length === 0 ? (
              <p className="text-sm text-gray-400 p-4">No syncs yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-50">
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Records</th>
                    <th className="px-4 py-2 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {status.log.map((r, i) => (
                    <tr key={i} className="border-b border-gray-50 last:border-0">
                      <td className="px-4 py-2 text-gray-700">{r.sync_date}</td>
                      <td className="px-4 py-2">
                        <span className={
                          r.status === 'success' ? 'text-primary'
                            : r.status === 'failed' ? 'text-danger' : 'text-amber-600'
                        }>
                          {r.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-gray-600">{r.records_synced}</td>
                      <td className="px-4 py-2 text-gray-400 truncate max-w-[200px]">
                        {r.error_message ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Setup instructions */}
        <div className="bg-white border border-gray-100 rounded-lg p-5">
          <h2 className="text-sm font-bold text-gray-800 mb-2">Before connecting</h2>
          <ol className="text-sm text-gray-600 list-decimal pl-5 space-y-1">
            <li>Create a free developer account at <code>developer.intuit.com</code></li>
            <li>Create an app → get Client ID + Secret</li>
            <li>Add to Railway: <code>QB_CLIENT_ID</code> and <code>QB_CLIENT_SECRET</code></li>
            <li>Register the redirect URI <code>&lt;api-origin&gt;/api/v1/quickbooks/callback</code> in the Intuit app</li>
            <li>Click <strong>Connect QuickBooks Online</strong> above</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
