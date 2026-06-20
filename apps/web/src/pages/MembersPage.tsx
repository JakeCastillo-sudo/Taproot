/**
 * MembersPage — studio member management (v2.1). List + search + create/edit modal +
 * a detail drawer (profile, credit balance, manual subscriptions, waiver) — mirrors
 * the CustomersPage drawer+modal pattern.
 *
 * STUDIO-GATED: useRequireStudio() bounces non-studio orgs to the register, and the
 * nav item that links here is hidden unless capabilities.studio is on. Restaurants
 * never see this page.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Users, Search, Plus, X, Pencil, Trash2, CheckCircle2, ScrollText, Ticket } from 'lucide-react';
import { clsx } from 'clsx';
import { members as membersApi } from '../lib/api';
import { showToast } from '../components/ui/Toast';
import { useRequireStudio } from '../hooks/useCapabilities';
import type { Member, MemberStatus } from '@taproot/shared';

const STATUS_BADGE: Record<string, string> = {
  prospect:  'bg-gray-100 text-gray-600',
  active:    'bg-green-100 text-green-700',
  frozen:    'bg-blue-100 text-blue-700',
  cancelled: 'bg-red-100 text-red-700',
  lead:      'bg-amber-100 text-amber-700',
};
const STATUSES: MemberStatus[] = ['prospect', 'active', 'frozen', 'cancelled', 'lead'];

const memberName = (m: Member): string => m.display_name || m.email || m.phone || 'Member';

export function MembersPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { ready, allowed } = useRequireStudio();
  const [search, setSearch] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<Member> | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['members', search],
    queryFn: () => membersApi.list({ search: search || undefined, perPage: 200 }),
    enabled: ready && allowed,
    retry: false,
  });

  if (!ready) return <div className="h-screen flex items-center justify-center text-sm text-gray-400">Loading…</div>;
  if (!allowed) return null; // redirect handled by the guard

  const refresh = (): void => void qc.invalidateQueries({ queryKey: ['members'] });
  const list = data?.members ?? [];

  return (
    <div className="h-screen bg-surface-2 flex flex-col overflow-hidden">
      <header className="bg-white border-b border-gray-100 shrink-0">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <button onClick={() => navigate('/')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800"><ArrowLeft size={14} /> POS</button>
          <div className="flex items-center gap-2 ml-2">
            <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center"><Users size={15} className="text-primary" /></div>
            <h1 className="text-base font-bold text-gray-900">Members</h1>
          </div>
          <div className="flex-1" />
          <button onClick={() => setEditing({})} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-md text-sm font-semibold hover:bg-primary-dark"><Plus size={14} /> Add member</button>
        </div>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-3">
          <div className="relative max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, phone…"
              className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4">
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />)}</div>
          ) : list.length === 0 ? (
            <div className="text-center py-16"><Users size={36} className="text-gray-200 mx-auto mb-3" /><p className="text-sm text-gray-400">No members yet</p></div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-100 overflow-clip">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 border-b border-gray-100 text-xs text-gray-400">
                  <tr>
                    <th className="text-left font-medium px-4 py-2">Name</th>
                    <th className="text-left font-medium px-3 py-2 hidden sm:table-cell">Contact</th>
                    <th className="text-left font-medium px-3 py-2">Status</th>
                    <th className="text-left font-medium px-3 py-2 hidden md:table-cell">Waiver</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((m) => (
                    <tr key={m.id} onClick={() => setDetailId(m.id)} className="border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer">
                      <td className="px-4 py-3 font-medium text-gray-800">{memberName(m)}</td>
                      <td className="px-3 py-3 hidden sm:table-cell text-gray-500 text-xs">{m.email ?? m.phone ?? '—'}</td>
                      <td className="px-3 py-3"><span className={clsx('text-xs px-2 py-0.5 rounded-full capitalize', STATUS_BADGE[m.status] ?? 'bg-gray-100 text-gray-500')}>{m.status}</span></td>
                      <td className="px-3 py-3 hidden md:table-cell text-gray-500">{m.waiver_signed_at ? <span className="inline-flex items-center gap-1 text-green-600 text-xs"><CheckCircle2 size={13} /> Signed</span> : <span className="text-xs text-gray-400">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {detailId && <MemberDrawer id={detailId} member={list.find((m) => m.id === detailId) ?? null} onClose={() => setDetailId(null)} onEdit={(m) => { setEditing(m); setDetailId(null); }} onChanged={refresh} />}
      {editing && <MemberModal member={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
    </div>
  );
}

function MemberDrawer({ id, member, onClose, onEdit, onChanged }: {
  id: string; member: Member | null; onClose: () => void; onEdit: (m: Member) => void; onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [grantCount, setGrantCount] = useState('5');
  const { data: balance } = useQuery({ queryKey: ['member', id, 'credits'], queryFn: () => membersApi.credits(id), retry: false });
  const { data: subs } = useQuery({ queryKey: ['member', id, 'subs'], queryFn: () => membersApi.subscriptions(id), retry: false });

  const refreshMember = (): void => {
    void qc.invalidateQueries({ queryKey: ['member', id] });
    onChanged();
  };

  const waiver = useMutation({
    mutationFn: () => membersApi.signWaiver(id),
    onSuccess: () => { showToast.success('Waiver signed'); refreshMember(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const grant = useMutation({
    mutationFn: () => membersApi.grantCredits(id, { count: Math.max(1, parseInt(grantCount, 10) || 0) }),
    onSuccess: () => { showToast.success('Credits granted'); refreshMember(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const recordSub = useMutation({
    mutationFn: () => membersApi.recordSubscription(id, { state: 'active', notes: 'Recorded manually' }),
    onSuccess: () => { showToast.success('Membership recorded'); refreshMember(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const remove = useMutation({
    mutationFn: () => membersApi.remove(id),
    onSuccess: () => { showToast.success('Member deleted'); onChanged(); onClose(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Failed'),
  });

  if (!member) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="w-full max-w-md bg-white h-full flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-base font-bold text-gray-900">{memberName(member)}</h2>
            <span className={clsx('text-xs px-2 py-0.5 rounded-full capitalize', STATUS_BADGE[member.status] ?? 'bg-gray-100 text-gray-500')}>{member.status}</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => onEdit(member)} className="p-1.5 rounded hover:bg-gray-100 text-gray-500"><Pencil size={14} /></button>
            <button onClick={() => window.confirm('Delete this member?') && remove.mutate()} className="p-1.5 rounded hover:bg-red-50 text-gray-500 hover:text-red-600"><Trash2 size={14} /></button>
            <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100"><X size={16} className="text-gray-500" /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 px-5 py-4 space-y-5">
          <div className="text-sm text-gray-600 space-y-1">
            {member.email && <div>{member.email}</div>}
            {member.phone && <div>{member.phone}</div>}
          </div>

          {/* Waiver */}
          <section>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5"><ScrollText size={13} /> Waiver</h3>
            {member.waiver_signed_at ? (
              <p className="text-sm text-green-600 inline-flex items-center gap-1"><CheckCircle2 size={14} /> Signed {new Date(member.waiver_signed_at).toLocaleDateString()}</p>
            ) : (
              <button onClick={() => waiver.mutate()} disabled={waiver.isPending} className="px-3 py-1.5 border border-gray-200 rounded-md text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">Sign waiver</button>
            )}
          </section>

          {/* Credits */}
          <section>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5"><Ticket size={13} /> Credits</h3>
            <p className="text-2xl font-bold text-gray-900">{balance?.total ?? 0}<span className="text-sm font-normal text-gray-400 ml-1">usable</span></p>
            {(balance?.packs ?? []).map((pk) => (
              <p key={pk.id} className="text-xs text-gray-500 mt-1">{pk.credits_remaining}/{pk.credits_total} · {pk.credit_type}{pk.expires_at ? ` · exp ${new Date(pk.expires_at).toLocaleDateString()}` : ''}</p>
            ))}
            <div className="flex items-center gap-2 mt-2">
              <input value={grantCount} onChange={(e) => setGrantCount(e.target.value)} inputMode="numeric" className="w-16 px-2 py-1.5 border border-gray-200 rounded-md text-sm" />
              <button onClick={() => grant.mutate()} disabled={grant.isPending} className="px-3 py-1.5 border border-gray-200 rounded-md text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">Grant credits</button>
            </div>
          </section>

          {/* Subscriptions (manual) */}
          <section>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Memberships <span className="normal-case text-gray-400">(manual)</span></h3>
            {(subs ?? []).length === 0 ? (
              <p className="text-sm text-gray-400">None recorded</p>
            ) : (
              (subs ?? []).map((s) => (
                <div key={s.id} className="flex items-center justify-between text-sm py-1">
                  <span className="capitalize text-gray-700">{s.state}{s.notes ? ` · ${s.notes}` : ''}</span>
                  {s.state !== 'cancelled' && <button onClick={() => membersApi.cancelSubscription(s.id).then(refreshMember)} className="text-xs text-red-500 hover:underline">Cancel</button>}
                </div>
              ))
            )}
            <button onClick={() => recordSub.mutate()} disabled={recordSub.isPending} className="mt-2 px-3 py-1.5 border border-gray-200 rounded-md text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">Record membership</button>
          </section>
        </div>
      </div>
    </div>
  );
}

function MemberModal({ member, onClose, onSaved }: { member: Partial<Member>; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    displayName: member.display_name ?? '',
    email: member.email ?? '',
    phone: member.phone ?? '',
    status: (member.status ?? 'prospect') as MemberStatus,
  });
  const save = useMutation({
    mutationFn: async () => {
      const body = {
        displayName: form.displayName.trim() || undefined,
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        status: form.status,
      };
      if (!body.displayName && !body.email && !body.phone) throw new Error('Enter a name, email, or phone');
      if (member.id) return membersApi.update(member.id, body);
      return membersApi.create(body);
    },
    onSuccess: () => { showToast.success(member.id ? 'Member updated' : 'Member created'); onSaved(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Save failed'),
  });
  const field = 'w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100"><h2 className="text-base font-bold text-gray-900">{member.id ? 'Edit Member' : 'Add Member'}</h2><button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100"><X size={16} className="text-gray-500" /></button></div>
        <div className="px-5 py-4 space-y-3">
          <input className={field} value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} placeholder="Display name" />
          <input className={field} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="Email" type="email" />
          <input className={field} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="Phone" inputMode="tel" />
          <select className={field} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as MemberStatus }))}>
            {STATUSES.map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
          </select>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100"><button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md">Cancel</button><button onClick={() => save.mutate()} disabled={save.isPending} className="px-4 py-2 text-sm font-semibold bg-primary text-white rounded-md hover:bg-primary-dark disabled:opacity-50">Save</button></div>
      </div>
    </div>
  );
}
