/**
 * FranchisePage — /franchise (S8-01)
 *
 * Franchisor view: network overview (locations, 30d revenue/orders), franchisee
 * cards, invite modal, push-menu modal, corporate (master) menu list.
 *
 * Franchisee view: "Part of [Franchisor] network" banner + corporate items
 * (locked 🔒 — archive/delete blocked server-side).
 *
 * Independent view: explainer + enable-franchisor / join-with-code actions
 * (also available in /settings/franchise).
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft, Network, Store, DollarSign, ReceiptText, Mail, UploadCloud,
  Lock, Loader2, X, Building2,
} from 'lucide-react';
import { clsx } from 'clsx';
import { franchise, products as productsApi } from '../lib/api';
import type { NetworkLocation } from '../lib/api';
import { showToast } from '../components/ui/Toast';

const fmt = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

export function FranchisePage() {
  const navigate = useNavigate();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);

  const { data: info, isLoading } = useQuery({ queryKey: ['franchise', 'info'], queryFn: franchise.info });

  return (
    <div className="h-screen bg-surface-2 flex flex-col overflow-hidden">
      {/* ── Header ── */}
      <header className="bg-white border-b border-gray-100 shrink-0">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <button onClick={() => navigate('/')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
            <ChevronLeft size={14} /> Register
          </button>
          <Network size={18} className="text-primary ml-2" />
          <h1 className="text-base font-bold text-gray-900">Franchise</h1>
          {info?.orgType === 'franchisor' && (
            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => setInviteOpen(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50">
                <Mail size={14} /> Invite franchisee
              </button>
              <button onClick={() => setPushOpen(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-dark">
                <UploadCloud size={14} /> Push menu update
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ── Body ── */}
      <main className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
          {isLoading ? (
            <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}</div>
          ) : !info?.ready ? (
            <EmptyCard
              title="Franchise mode isn't available yet"
              body="The database migration for franchise mode (017) hasn't been applied. Ask your administrator to run pending migrations."
            />
          ) : info.orgType === 'franchisor' ? (
            <FranchisorDashboard />
          ) : info.orgType === 'franchisee' ? (
            <FranchiseeView parentName={info.parentOrg?.name ?? 'your franchisor'} />
          ) : (
            <IndependentView />
          )}
        </div>
      </main>

      {inviteOpen && <InviteModal onClose={() => setInviteOpen(false)} />}
      {pushOpen && <PushMenuModal onClose={() => setPushOpen(false)} />}
    </div>
  );
}

// ─── Franchisor dashboard ─────────────────────────────────────────────────────

function FranchisorDashboard() {
  const { data, isLoading } = useQuery({ queryKey: ['franchise', 'network'], queryFn: franchise.network });
  const { data: menu } = useQuery({ queryKey: ['franchise', 'menu'], queryFn: franchise.menu });

  const locations = data?.locations ?? [];
  const totalRevenue = locations.reduce((s, l) => s + l.revenue_30d, 0);
  const totalOrders = locations.reduce((s, l) => s + l.order_count_30d, 0);

  return (
    <div className="space-y-6">
      {/* Network overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon={<Store size={18} />} label="Franchise locations" value={String(locations.length)} />
        <StatCard icon={<DollarSign size={18} />} label="Network revenue (30d)" value={fmt(totalRevenue)} />
        <StatCard icon={<ReceiptText size={18} />} label="Network orders (30d)" value={totalOrders.toLocaleString()} />
      </div>

      {/* Franchisee cards */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Network locations</h2>
        {isLoading ? (
          <div className="h-24 bg-gray-100 rounded-xl animate-pulse" />
        ) : locations.length === 0 ? (
          <EmptyCard
            title="No franchisees yet"
            body="Invite your first franchisee — they'll join with your franchise code and your corporate menu can sync to their register."
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {locations.map((l) => <FranchiseeCard key={l.id} loc={l} />)}
          </div>
        )}
      </section>

      {/* Corporate (master) menu */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Corporate menu ({menu?.items.length ?? 0} items)</h2>
        <p className="text-xs text-gray-400 mb-3">
          This is your master menu. Use “Push menu update” to sync selected items to every franchisee —
          pushed items are locked on their registers.
        </p>
        <CorporateMenuTable items={menu?.items ?? []} showLock={false} />
      </section>
    </div>
  );
}

function FranchiseeCard({ loc }: { loc: NetworkLocation }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
            <Building2 size={16} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{loc.name}</p>
            <p className="text-xs text-gray-400">Joined {new Date(loc.joined_at).toLocaleDateString()}</p>
          </div>
        </div>
        <span className={clsx('text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase',
          loc.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500')}>
          {loc.status}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div><p className="text-sm font-bold text-gray-900">{loc.location_count}</p><p className="text-[10px] text-gray-400">Locations</p></div>
        <div><p className="text-sm font-bold text-gray-900">{fmt(loc.revenue_30d)}</p><p className="text-[10px] text-gray-400">Revenue 30d</p></div>
        <div><p className="text-sm font-bold text-gray-900">{loc.order_count_30d}</p><p className="text-[10px] text-gray-400">Orders 30d</p></div>
      </div>
    </div>
  );
}

// ─── Franchisee view ──────────────────────────────────────────────────────────

function FranchiseeView({ parentName }: { parentName: string }) {
  const { data: menu, isLoading } = useQuery({ queryKey: ['franchise', 'menu'], queryFn: franchise.menu });

  return (
    <div className="space-y-6">
      <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex items-center gap-3">
        <Network size={20} className="text-primary shrink-0" />
        <div>
          <p className="text-sm font-semibold text-gray-900">Part of the {parentName} network</p>
          <p className="text-xs text-gray-500">
            Corporate menu items are managed by your franchisor and locked on your register.
            You can add your own items on top in Settings → Products.
          </p>
        </div>
      </div>

      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          Corporate menu ({menu?.items.length ?? 0} items)
        </h2>
        {isLoading ? (
          <div className="h-24 bg-gray-100 rounded-xl animate-pulse" />
        ) : (menu?.items.length ?? 0) === 0 ? (
          <EmptyCard title="No corporate items yet" body={`${parentName} hasn't pushed any menu items to your register yet.`} />
        ) : (
          <CorporateMenuTable items={menu?.items ?? []} showLock />
        )}
      </section>
    </div>
  );
}

// ─── Independent view ─────────────────────────────────────────────────────────

function IndependentView() {
  const navigate = useNavigate();
  return (
    <div className="max-w-xl mx-auto text-center py-12">
      <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center text-primary mx-auto mb-4">
        <Network size={28} />
      </div>
      <h2 className="text-lg font-bold text-gray-900 mb-2">Run a chain on Taproot</h2>
      <p className="text-sm text-gray-500 mb-6 leading-relaxed">
        Franchise mode lets a parent brand manage a network of locations: push corporate menu updates
        to every franchisee, see roll-up revenue, and invite new operators with a join code.
      </p>
      <button
        onClick={() => navigate('/settings/franchise')}
        className="px-5 py-2.5 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-dark"
      >
        Set up in Settings → Franchise
      </button>
    </div>
  );
}

// ─── Shared bits ──────────────────────────────────────────────────────────────

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="text-lg font-bold text-gray-900 truncate">{value}</p>
        <p className="text-xs text-gray-400">{label}</p>
      </div>
    </div>
  );
}

function EmptyCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
      <p className="text-sm font-semibold text-gray-700 mb-1">{title}</p>
      <p className="text-xs text-gray-400 max-w-md mx-auto leading-relaxed">{body}</p>
    </div>
  );
}

function CorporateMenuTable({ items, showLock }: {
  items: Array<{ id: string; name: string; description: string | null; price: number | null; category_name: string | null }>;
  showLock: boolean;
}) {
  if (!items.length) return null;
  return (
    <div className="bg-white rounded-lg border border-gray-100 overflow-clip">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-surface-2 border-b border-gray-100 text-xs text-gray-400">
          <tr>
            <th className="text-left font-medium px-4 py-2">Item</th>
            <th className="text-left font-medium px-3 py-2 hidden sm:table-cell">Category</th>
            <th className="text-right font-medium px-4 py-2">Price</th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.id} className="border-b border-gray-50 last:border-0">
              <td className="px-4 py-2.5">
                <span className="flex items-center gap-1.5 font-medium text-gray-800">
                  {showLock && <Lock size={12} className="text-amber-500 shrink-0" />}
                  {p.name}
                </span>
                {p.description && <p className="text-xs text-gray-400 line-clamp-2">{p.description}</p>}
              </td>
              <td className="px-3 py-2.5 text-gray-500 hidden sm:table-cell">{p.category_name ?? '—'}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-gray-800">{p.price != null ? fmt(p.price) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Invite modal ─────────────────────────────────────────────────────────────

function InviteModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [locationName, setLocationName] = useState('');

  const invite = useMutation({
    mutationFn: () => franchise.invite(email.trim(), locationName.trim()),
    onSuccess: (r) => {
      showToast.success(`Invite sent — code ${r.franchiseCode}`);
      onClose();
    },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Invite failed'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Invite franchisee</h2>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100"><X size={16} className="text-gray-500" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Email *</label>
            <input autoFocus type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="operator@example.com"
              className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Location name</label>
            <input value={locationName} onChange={(e) => setLocationName(e.target.value)}
              placeholder="Downtown"
              className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </div>
          <p className="text-xs text-gray-400">They&apos;ll get an email with your franchise code and join instructions.</p>
        </div>
        <div className="px-5 py-4 border-t border-gray-100 flex gap-2">
          <button onClick={onClose} className="flex-1 h-10 border border-gray-200 rounded-md text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
          <button
            onClick={() => invite.mutate()}
            disabled={!email.trim() || invite.isPending}
            className="flex-1 h-10 bg-primary text-white rounded-md text-sm font-semibold hover:bg-primary-dark disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {invite.isPending && <Loader2 size={14} className="animate-spin" />} Send invite
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Push menu modal ──────────────────────────────────────────────────────────

function PushMenuModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ['products', 'push-picker'],
    queryFn: () => productsApi.list({ perPage: 200 }),
  });
  const items = data?.products ?? [];

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const push = useMutation({
    mutationFn: () => franchise.pushMenu(Array.from(selected)),
    onSuccess: (r) => {
      const note = r.errors.length ? ` (${r.errors.length} errors — see console)` : '';
      if (r.errors.length) console.warn('[franchise push] errors:', r.errors);
      showToast.success(`Pushed to ${r.franchisees} franchisee${r.franchisees === 1 ? '' : 's'}: ${r.created} created, ${r.updated} updated${note}`);
      void queryClient.invalidateQueries({ queryKey: ['franchise'] });
      onClose();
    },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Push failed'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Push menu update</h2>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100"><X size={16} className="text-gray-500" /></button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 px-5 py-3">
          <p className="text-xs text-gray-400 mb-3">
            Selected items are created or updated in every franchisee&apos;s register and locked there.
          </p>
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-9 bg-gray-100 rounded animate-pulse" />)}</div>
          ) : items.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No products to push.</p>
          ) : (
            <div className="space-y-1">
              {items.map((p) => (
                <label key={p.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)}
                    className="rounded border-gray-300 text-primary focus:ring-primary/30" />
                  <span className="flex-1 text-sm text-gray-700 truncate">{p.name}</span>
                  <span className="text-xs text-gray-400 tabular-nums">{fmt(p.defaultPrice ?? 0)}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="shrink-0 px-5 py-4 border-t border-gray-100 flex items-center gap-2">
          <span className="text-xs text-gray-400 mr-auto">{selected.size} selected</span>
          <button onClick={onClose} className="h-10 px-4 border border-gray-200 rounded-md text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
          <button
            onClick={() => push.mutate()}
            disabled={selected.size === 0 || push.isPending}
            className="h-10 px-4 bg-primary text-white rounded-md text-sm font-semibold hover:bg-primary-dark disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {push.isPending ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />} Push to network
          </button>
        </div>
      </div>
    </div>
  );
}
