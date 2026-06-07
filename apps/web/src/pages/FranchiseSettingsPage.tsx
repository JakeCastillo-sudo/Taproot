/**
 * FranchiseSettingsPage — /settings/franchise (S8-01)
 *
 * - Independent: enable franchise mode (become franchisor + get code), or
 *   join an existing network with a code.
 * - Franchisor: shows the franchise code (copy), link to the network dashboard.
 * - Franchisee: shows network membership.
 * - Brand standards PDF upload: stub ("coming soon") — no asset storage yet.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Network, Copy, ExternalLink, Loader2, FileText } from 'lucide-react';
import { franchise } from '../lib/api';
import { showToast } from '../components/ui/Toast';
import { getCurrentRole } from '../lib/session';

export function FranchiseSettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isOwner = getCurrentRole() === 'owner';
  const [joinCode, setJoinCode] = useState('');

  const { data: info, isLoading } = useQuery({ queryKey: ['franchise', 'info'], queryFn: franchise.info });

  const enable = useMutation({
    mutationFn: franchise.enable,
    onSuccess: (r) => {
      showToast.success(`Franchise mode enabled — code ${r.franchiseCode}`);
      void queryClient.invalidateQueries({ queryKey: ['franchise'] });
    },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Failed to enable'),
  });

  const join = useMutation({
    mutationFn: () => franchise.join(joinCode.trim()),
    onSuccess: (r) => {
      showToast.success(`Joined the ${r.parentOrg?.name ?? ''} network`);
      void queryClient.invalidateQueries({ queryKey: ['franchise'] });
    },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Join failed'),
  });

  const copyCode = () => {
    if (!info?.franchiseCode) return;
    void navigator.clipboard.writeText(info.franchiseCode)
      .then(() => showToast.success('Code copied'))
      .catch(() => showToast.error('Copy failed'));
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="shrink-0 px-4 md:px-6 py-4 border-b border-gray-100 bg-white">
        <h1 className="text-lg font-bold text-gray-900">Franchise</h1>
        <p className="text-xs text-gray-400">Run a chain — corporate menu, network reporting, join codes</p>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 p-4 md:p-6 space-y-6 max-w-2xl">
        {isLoading ? (
          <div className="h-32 bg-gray-100 rounded-xl animate-pulse" />
        ) : !info?.ready ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
            Franchise mode requires database migration <strong>017_franchise</strong>. Ask your
            administrator to run pending migrations, then reload this page.
          </div>
        ) : (
          <>
            {/* ── Status / enable ── */}
            <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-3">
                <Network size={16} className="text-primary" />
                <h2 className="text-sm font-semibold text-gray-700">Franchise mode</h2>
              </div>

              {info.orgType === 'franchisor' ? (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">
                    This organization is a <strong>franchisor</strong>. Share the code below with
                    operators so they can join your network.
                  </p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg font-mono text-base font-bold tracking-widest text-primary-dark">
                      {info.franchiseCode}
                    </div>
                    <button onClick={copyCode} className="p-3 rounded-lg border border-gray-200 hover:bg-gray-50" title="Copy code">
                      <Copy size={15} className="text-gray-500" />
                    </button>
                  </div>
                  <button
                    onClick={() => navigate('/franchise')}
                    className="flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary-dark"
                  >
                    Open network dashboard <ExternalLink size={13} />
                  </button>
                </div>
              ) : info.orgType === 'franchisee' ? (
                <p className="text-sm text-gray-600">
                  This organization is a <strong>franchisee</strong> in the{' '}
                  <strong>{info.parentOrg?.name ?? 'parent'}</strong> network. Corporate menu items
                  are locked on your register —{' '}
                  <button onClick={() => navigate('/franchise')} className="text-primary hover:underline">view them here</button>.
                </p>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-gray-600">
                    Enable franchise mode to become a <strong>franchisor</strong>: you&apos;ll get a join
                    code, a network dashboard, and one-click corporate menu pushes to every franchisee.
                  </p>
                  <button
                    onClick={() => enable.mutate()}
                    disabled={!isOwner || enable.isPending}
                    className="px-4 py-2.5 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-dark disabled:opacity-50 flex items-center gap-2"
                  >
                    {enable.isPending && <Loader2 size={14} className="animate-spin" />}
                    Enable franchise mode
                  </button>
                  {!isOwner && <p className="text-xs text-gray-400">Only the owner can enable franchise mode.</p>}
                </div>
              )}
            </section>

            {/* ── Join a network (independent only) ── */}
            {info.orgType === 'independent' && (
              <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                <h2 className="text-sm font-semibold text-gray-700 mb-2">Join an existing network</h2>
                <p className="text-xs text-gray-400 mb-3">
                  Got a franchise code from your franchisor? Enter it here to link this organization
                  as a franchisee.
                </p>
                <div className="flex gap-2">
                  <input
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    placeholder="FR-XXXXXXXX"
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-md text-sm font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <button
                    onClick={() => join.mutate()}
                    disabled={!isOwner || !joinCode.trim() || join.isPending}
                    className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary-dark disabled:opacity-50 flex items-center gap-2"
                  >
                    {join.isPending && <Loader2 size={14} className="animate-spin" />} Join
                  </button>
                </div>
                {!isOwner && <p className="text-xs text-gray-400 mt-2">Only the owner can join a network.</p>}
              </section>
            )}

            {/* ── Brand standards (stub) ── */}
            {info.orgType === 'franchisor' && (
              <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-center gap-2 mb-2">
                  <FileText size={15} className="text-gray-400" />
                  <h2 className="text-sm font-semibold text-gray-700">Brand standards</h2>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 uppercase">Coming soon</span>
                </div>
                <p className="text-xs text-gray-400">
                  Upload a brand standards PDF that every franchisee can access from their dashboard.
                </p>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
