/**
 * ApiSettingsPage — /settings/api (S8-04)
 *
 * API Keys tab: list / create (full key shown ONCE in a modal) / revoke.
 * Webhooks tab: list / add (secret shown ONCE) / test / delete, failure badge.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Webhook, Plus, Copy, Trash2, Loader2, X, Send, AlertTriangle } from 'lucide-react';
import { clsx } from 'clsx';
import { apiKeys, webhooksApi, API_KEY_SCOPES, type ApiKeyRow, type WebhookSubRow } from '../lib/api';
import { showToast } from '../components/ui/Toast';

type Tab = 'keys' | 'webhooks';

const field = 'w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40';

function copyText(text: string, label: string) {
  void navigator.clipboard.writeText(text)
    .then(() => showToast.success(`${label} copied`))
    .catch(() => showToast.error('Copy failed'));
}

export function ApiSettingsPage() {
  const [tab, setTab] = useState<Tab>('keys');

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="shrink-0 px-4 md:px-6 py-4 border-b border-gray-100 bg-white">
        <h1 className="text-lg font-bold text-gray-900">API &amp; Webhooks</h1>
        <p className="text-xs text-gray-400">Programmatic access to your Taproot data + event notifications</p>
        <div className="flex gap-1 mt-3 -mb-4">
          {([['keys', 'API Keys', <KeyRound key="k" size={14} />], ['webhooks', 'Webhooks', <Webhook key="w" size={14} />]] as Array<[Tab, string, React.ReactNode]>).map(([id, label, icon]) => (
            <button key={id} onClick={() => setTab(id)}
              className={clsx('flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors',
                tab === id ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700')}>
              {icon} {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 p-4 md:p-6 max-w-3xl">
        {tab === 'keys' ? <KeysTab /> : <WebhooksTab />}
      </div>
    </div>
  );
}

// ─── API Keys tab ─────────────────────────────────────────────────────────────

function KeysTab() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [newKey, setNewKey] = useState<{ key: string; name: string } | null>(null);

  const { data: keys, isLoading } = useQuery({ queryKey: ['api-keys'], queryFn: apiKeys.list });

  const revoke = useMutation({
    mutationFn: (id: string) => apiKeys.revoke(id),
    onSuccess: () => { showToast.success('Key revoked'); void queryClient.invalidateQueries({ queryKey: ['api-keys'] }); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Revoke failed'),
  });

  const active = (keys ?? []).filter((k) => !k.revoked_at);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">
          Use keys as <code className="bg-gray-100 px-1 rounded">Authorization: Bearer taproot_live_…</code> against the same /api/v1 endpoints.
        </p>
        <button onClick={() => setCreateOpen(true)}
          className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-dark shrink-0">
          <Plus size={14} /> Create API key
        </button>
      </div>

      {isLoading ? (
        <div className="h-24 bg-gray-100 rounded-xl animate-pulse" />
      ) : active.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
          <KeyRound size={28} className="text-gray-200 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No API keys yet</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-100 overflow-clip">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-surface-2 border-b border-gray-100 text-xs text-gray-400">
              <tr>
                <th className="text-left font-medium px-4 py-2">Name</th>
                <th className="text-left font-medium px-3 py-2">Key</th>
                <th className="text-left font-medium px-3 py-2 hidden md:table-cell">Scopes</th>
                <th className="text-left font-medium px-3 py-2 hidden sm:table-cell">Last used</th>
                <th className="text-right font-medium px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {active.map((k: ApiKeyRow) => (
                <tr key={k.id} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-2.5 font-medium text-gray-800">{k.name}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-gray-500">{k.key_prefix}••••</td>
                  <td className="px-3 py-2.5 hidden md:table-cell">
                    <span className="text-xs text-gray-400">{k.permissions.join(', ')}</span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-400 hidden sm:table-cell">
                    {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'never'}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => window.confirm(`Revoke "${k.name}"? Apps using it will stop working immediately.`) && revoke.mutate(k.id)}
                      className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600" title="Revoke">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <CreateKeyModal
          onClose={() => setCreateOpen(false)}
          onCreated={(k) => { setCreateOpen(false); setNewKey(k); void queryClient.invalidateQueries({ queryKey: ['api-keys'] }); }}
        />
      )}
      {newKey && <ShowKeyOnceModal newKey={newKey} onClose={() => setNewKey(null)} />}
    </div>
  );
}

function CreateKeyModal({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: (k: { key: string; name: string }) => void;
}) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Set<string>>(new Set());
  const [expiresAt, setExpiresAt] = useState('');

  const create = useMutation({
    mutationFn: () => apiKeys.create({
      name: name.trim(),
      permissions: Array.from(scopes),
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    }),
    onSuccess: (r) => onCreated({ key: r.key, name: r.name }),
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Create failed'),
  });

  const toggle = (s: string) => setScopes((prev) => {
    const n = new Set(prev);
    if (n.has(s)) n.delete(s); else n.add(s);
    return n;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Create API key</h2>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100"><X size={16} className="text-gray-500" /></button>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Name *</label>
            <input autoFocus className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Zapier integration" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Permissions *</label>
            <div className="grid grid-cols-2 gap-1.5">
              {API_KEY_SCOPES.map((s) => (
                <label key={s} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox" checked={scopes.has(s)} onChange={() => toggle(s)}
                    className="rounded border-gray-300 text-primary focus:ring-primary/30" />
                  <span className="text-sm text-gray-700 font-mono">{s}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Expires (optional)</label>
            <input type="date" className={field} value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </div>
        </div>
        <div className="shrink-0 px-5 py-4 border-t border-gray-100 flex gap-2">
          <button onClick={onClose} className="flex-1 h-10 border border-gray-200 rounded-md text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={() => create.mutate()} disabled={!name.trim() || scopes.size === 0 || create.isPending}
            className="flex-1 h-10 bg-primary text-white rounded-md text-sm font-semibold hover:bg-primary-dark disabled:opacity-50 flex items-center justify-center gap-2">
            {create.isPending && <Loader2 size={14} className="animate-spin" />} Create key
          </button>
        </div>
      </div>
    </div>
  );
}

function ShowKeyOnceModal({ newKey, onClose }: { newKey: { key: string; name: string }; onClose: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">“{newKey.name}” created</h2>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 flex gap-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            Copy this key now — it won&apos;t be shown again. Store it like a password.
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg font-mono text-xs break-all select-all">
              {newKey.key}
            </code>
            <button onClick={() => copyText(newKey.key, 'API key')}
              className="p-2.5 rounded-lg border border-gray-200 hover:bg-gray-50 shrink-0" title="Copy">
              <Copy size={14} className="text-gray-500" />
            </button>
          </div>
          <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-600">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)}
              className="rounded border-gray-300 text-primary focus:ring-primary/30" />
            I&apos;ve copied the key somewhere safe
          </label>
        </div>
        <div className="px-5 py-4 border-t border-gray-100">
          <button onClick={onClose} disabled={!confirmed}
            className="w-full h-10 bg-primary text-white rounded-md text-sm font-semibold hover:bg-primary-dark disabled:opacity-50">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Webhooks tab ─────────────────────────────────────────────────────────────

function WebhooksTab() {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['webhooks'], queryFn: webhooksApi.list });
  const hooks = data?.webhooks ?? [];
  const events = data?.availableEvents ?? [];

  const remove = useMutation({
    mutationFn: (id: string) => webhooksApi.remove(id),
    onSuccess: () => { showToast.success('Webhook deleted'); void queryClient.invalidateQueries({ queryKey: ['webhooks'] }); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Delete failed'),
  });

  const test = useMutation({
    mutationFn: (id: string) => webhooksApi.test(id),
    onSuccess: (r) => r.delivered
      ? showToast.success('Test payload delivered ✓')
      : showToast.error('Endpoint did not return 2xx'),
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Test failed'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">
          POST notifications signed with <code className="bg-gray-100 px-1 rounded">X-Taproot-Signature: sha256=…</code> (HMAC of the body).
        </p>
        <button onClick={() => setAddOpen(true)}
          className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-dark shrink-0">
          <Plus size={14} /> Add webhook
        </button>
      </div>

      {isLoading ? (
        <div className="h-24 bg-gray-100 rounded-xl animate-pulse" />
      ) : hooks.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
          <Webhook size={28} className="text-gray-200 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No webhooks configured</p>
        </div>
      ) : (
        <div className="space-y-2">
          {hooks.map((h: WebhookSubRow) => (
            <div key={h.id} className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex items-center gap-2 flex-wrap">
                <code className="text-sm font-medium text-gray-800 break-all flex-1 min-w-[200px]">{h.url}</code>
                <span className={clsx('text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase',
                  h.is_active ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700')}>
                  {h.is_active ? 'active' : 'disabled'}
                </span>
                {h.failure_count > 0 && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                    {h.failure_count} failure{h.failure_count === 1 ? '' : 's'}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <div className="flex-1 flex flex-wrap gap-1 min-w-[200px]">
                  {h.events.map((e) => (
                    <span key={e} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{e}</span>
                  ))}
                </div>
                <span className="text-[11px] text-gray-400">
                  {h.last_triggered_at ? `last fired ${new Date(h.last_triggered_at).toLocaleString()}` : 'never fired'}
                </span>
                <button onClick={() => test.mutate(h.id)} disabled={test.isPending}
                  className="flex items-center gap-1 px-2 py-1 rounded border border-gray-200 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-50">
                  <Send size={11} /> Test
                </button>
                <button onClick={() => window.confirm('Delete this webhook?') && remove.mutate(h.id)}
                  className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600" title="Delete">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {addOpen && (
        <AddWebhookModal
          events={events}
          onClose={() => setAddOpen(false)}
          onCreated={(secret) => { setAddOpen(false); setNewSecret(secret); void queryClient.invalidateQueries({ queryKey: ['webhooks'] }); }}
        />
      )}
      {newSecret && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="px-5 py-4 border-b border-gray-100"><h2 className="text-base font-bold text-gray-900">Webhook created</h2></div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-xs text-gray-500">Use this signing secret to verify <code>X-Taproot-Signature</code>. It won&apos;t be shown again.</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg font-mono text-xs break-all select-all">{newSecret}</code>
                <button onClick={() => copyText(newSecret, 'Secret')}
                  className="p-2.5 rounded-lg border border-gray-200 hover:bg-gray-50 shrink-0"><Copy size={14} className="text-gray-500" /></button>
              </div>
            </div>
            <div className="px-5 py-4 border-t border-gray-100">
              <button onClick={() => setNewSecret(null)} className="w-full h-10 bg-primary text-white rounded-md text-sm font-semibold hover:bg-primary-dark">Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AddWebhookModal({ events, onClose, onCreated }: {
  events: string[];
  onClose: () => void;
  onCreated: (secret: string) => void;
}) {
  const [url, setUrl] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const create = useMutation({
    mutationFn: () => webhooksApi.create({ url: url.trim(), events: Array.from(selected) }),
    onSuccess: (r) => onCreated(r.secret),
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Create failed'),
  });

  const toggle = (e: string) => setSelected((prev) => {
    const n = new Set(prev);
    if (n.has(e)) n.delete(e); else n.add(e);
    return n;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Add webhook</h2>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100"><X size={16} className="text-gray-500" /></button>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Endpoint URL *</label>
            <input autoFocus className={field} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/taproot-webhook" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Events *</label>
            <div className="space-y-1">
              {events.map((e) => (
                <label key={e} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox" checked={selected.has(e)} onChange={() => toggle(e)}
                    className="rounded border-gray-300 text-primary focus:ring-primary/30" />
                  <span className="text-sm text-gray-700 font-mono">{e}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="shrink-0 px-5 py-4 border-t border-gray-100 flex gap-2">
          <button onClick={onClose} className="flex-1 h-10 border border-gray-200 rounded-md text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={() => create.mutate()} disabled={!url.trim() || selected.size === 0 || create.isPending}
            className="flex-1 h-10 bg-primary text-white rounded-md text-sm font-semibold hover:bg-primary-dark disabled:opacity-50 flex items-center justify-center gap-2">
            {create.isPending && <Loader2 size={14} className="animate-spin" />} Add webhook
          </button>
        </div>
      </div>
    </div>
  );
}
