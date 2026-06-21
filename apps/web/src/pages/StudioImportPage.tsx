/**
 * StudioImportPage — Mindbody / Mariana Tek migration (v2.2). Paste a CSV export,
 * pick provider + kind, DRY-RUN to see the diff (adds / already-present / invalid),
 * then commit. No blind writes. Studio-gated via useRequireStudio.
 *
 * Card/payment vaults are intentionally NOT importable here (PCI/contractual).
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, Upload } from 'lucide-react';
import { clsx } from 'clsx';
import { studioImport as importApi, type StudioImportDryRun } from '../lib/api';
import { showToast } from '../components/ui/Toast';
import { useRequireStudio } from '../hooks/useCapabilities';

export function StudioImportPage() {
  const navigate = useNavigate();
  const { ready, allowed } = useRequireStudio();
  const [provider, setProvider] = useState('mindbody');
  const [kind, setKind] = useState('members');
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<StudioImportDryRun | null>(null);

  const dry = useMutation({
    mutationFn: () => importApi.dryRun(provider, kind, csv),
    onSuccess: (r) => setPreview(r),
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Dry-run failed'),
  });
  const commit = useMutation({
    mutationFn: () => importApi.commit(provider, kind, csv),
    onSuccess: (r) => { showToast.success(`Imported ${r.created}, skipped ${r.skipped}, failed ${r.failed}`); setPreview(null); setCsv(''); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Import failed'),
  });

  if (!ready) return <div className="h-screen flex items-center justify-center text-sm text-gray-400">Loading…</div>;
  if (!allowed) return null;

  const sel = 'px-3 py-2 border border-gray-200 rounded-md text-sm capitalize';
  return (
    <div className="h-screen bg-surface-2 flex flex-col overflow-hidden">
      <header className="bg-white border-b border-gray-100 shrink-0">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <button onClick={() => navigate('/studio/schedule')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800"><ArrowLeft size={14} /> Schedule</button>
          <div className="flex items-center gap-2 ml-2">
            <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center"><Upload size={15} className="text-primary" /></div>
            <h1 className="text-base font-bold text-gray-900">Migrate from Mindbody / Mariana Tek</h1>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 space-y-4">
          <div className="flex gap-2">
            <select className={sel} value={provider} onChange={(e) => { setProvider(e.target.value); setPreview(null); }}>
              <option value="mindbody">Mindbody</option>
              <option value="mariana_tek">Mariana Tek</option>
            </select>
            <select className={sel} value={kind} onChange={(e) => { setKind(e.target.value); setPreview(null); }}>
              <option value="members">Members</option>
              <option value="schedule">Schedule</option>
            </select>
          </div>
          <textarea
            value={csv}
            onChange={(e) => { setCsv(e.target.value); setPreview(null); }}
            placeholder="Paste the CSV export here (first row = headers)…"
            className="w-full h-44 px-3 py-2 border border-gray-200 rounded-md text-xs font-mono resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <div className="flex items-center gap-2">
            <button onClick={() => dry.mutate()} disabled={!csv.trim() || dry.isPending} className="px-4 py-2 border border-gray-200 rounded-md text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">{dry.isPending ? 'Checking…' : 'Dry run'}</button>
            {preview && <button onClick={() => commit.mutate()} disabled={commit.isPending || preview.toCreate === 0} className="px-4 py-2 bg-primary text-white rounded-md text-sm font-semibold hover:bg-primary-dark disabled:opacity-50">{commit.isPending ? 'Importing…' : `Import ${preview.toCreate}`}</button>}
          </div>

          {preview && (
            <div className="bg-white rounded-lg border border-gray-100 p-4 space-y-3">
              <div className="flex gap-4 text-sm">
                <Stat label="To create" value={preview.toCreate} tone="text-green-700" />
                <Stat label="Already present" value={preview.alreadyPresent} tone="text-gray-500" />
                <Stat label="Invalid" value={preview.invalid} tone="text-amber-600" />
                <Stat label="Total rows" value={preview.total} tone="text-gray-700" />
              </div>
              {preview.notes.map((n, i) => <p key={i} className="text-xs text-gray-400">• {n}</p>)}
              {preview.sample.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-gray-400"><tr>{Object.keys(preview.sample[0]).map((h) => <th key={h} className="text-left font-medium px-2 py-1 capitalize">{h}</th>)}</tr></thead>
                    <tbody>{preview.sample.map((r, i) => (
                      <tr key={i} className="border-t border-gray-50">{Object.keys(preview.sample[0]).map((h) => (
                        <td key={h} className={clsx('px-2 py-1', h === 'action' && String(r[h]).startsWith('create') ? 'text-green-600' : 'text-gray-600')}>{String(r[h] ?? '—')}</td>
                      ))}</tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <div><p className={clsx('text-lg font-bold', tone)}>{value}</p><p className="text-xs text-gray-400">{label}</p></div>;
}
