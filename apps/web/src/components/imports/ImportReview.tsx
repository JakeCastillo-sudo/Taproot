/**
 * ImportReview — shows parsed preview and lets the user confirm/apply.
 *
 * Shows when job.status === 'awaiting_confirmation'
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight, CheckCircle2, X, AlertTriangle, MapPin,
} from 'lucide-react';
import { clsx } from 'clsx';
import { importsApi, type ImportJob, type ImportType, type ColumnMapping } from '../../lib/api';
import { QK } from '../../lib/queryClient';
import { showToast } from '../ui/Toast';
import { USER_KEY } from '../../lib/api';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<ImportType, string> = {
  document_menu:          'Menu / Price List',
  document_invoice:       'Supplier Invoice',
  document_goods_receipt: 'Goods Receipt',
  document_inventory:     'Inventory List',
  document_recipe:        'Recipe Sheet',
  generic_csv:            'CSV Import',
};

const ALL_IMPORT_TYPES: ImportType[] = [
  'document_menu',
  'document_invoice',
  'document_goods_receipt',
  'document_inventory',
  'document_recipe',
  'generic_csv',
];

function getLocationId(): string {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return '';
    const user = JSON.parse(raw) as { locationIds?: string[] };
    return user.locationIds?.[0] ?? '';
  } catch {
    return '';
  }
}

function confidenceBadge(conf: number) {
  const pct = Math.round(conf * 100);
  const cls = pct >= 85 ? 'bg-green-100 text-green-700'
    : pct >= 65 ? 'bg-amber-100 text-amber-700'
    : 'bg-red-100 text-red-700';
  return (
    <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full', cls)}>
      {pct}% confidence
    </span>
  );
}

function renderPreviewTable(rows: unknown[]) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const first = rows[0] as Record<string, unknown>;
  const cols = Object.keys(first);
  const isLowConfidence = (row: Record<string, unknown>) => {
    const c = row['_confidence'];
    return typeof c === 'number' && c < 0.7;
  };

  return (
    <div className="overflow-auto rounded-lg border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200 text-xs">
        <thead className="bg-gray-50">
          <tr>
            {cols.filter((c) => !c.startsWith('_')).map((col) => (
              <th key={col} className="px-3 py-2 text-left text-gray-500 font-medium uppercase tracking-wide">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {(rows as Record<string, unknown>[]).map((row, i) => (
            <tr key={i} className={clsx(isLowConfidence(row) && 'bg-amber-50')}>
              {cols.filter((c) => !c.startsWith('_')).map((col) => (
                <td key={col} className="px-3 py-2 text-gray-700 max-w-[200px] truncate">
                  {row[col] !== null && row[col] !== undefined ? String(row[col]) : '—'}
                </td>
              ))}
              {isLowConfidence(row) && (
                <td className="px-3 py-2">
                  <AlertTriangle size={11} className="text-amber-500" />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Column mapping editor ────────────────────────────────────────────────────

function ColumnMappingEditor({
  mapping,
  onChange,
}: {
  mapping: ColumnMapping;
  onChange: (m: ColumnMapping) => void;
}) {
  const TARGET_FIELDS = [
    'name', 'sku', 'barcode', 'description', 'category',
    'price_cents', 'cost_price_cents', 'unit_of_measure',
    'quantity', 'location', 'reorder_point',
    'first_name', 'last_name', 'email', 'phone',
    '(skip)',
  ];

  return (
    <div className="space-y-2">
      {mapping.mappings.map((m, i) => (
        <div key={m.sourceColumn} className="flex items-center gap-3">
          <div className="w-40 text-sm font-medium text-gray-700 truncate">{m.sourceColumn}</div>
          <ChevronRight size={14} className="text-gray-400 shrink-0" />
          <select
            value={m.targetField}
            onChange={(e) => {
              const updated = { ...mapping };
              updated.mappings = mapping.mappings.map((mm, j) =>
                j === i ? { ...mm, targetField: e.target.value } : mm,
              );
              onChange(updated);
            }}
            className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {TARGET_FIELDS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
          <span className="text-xs">
            {confidenceBadge(m.confidence)}
          </span>
        </div>
      ))}
      {mapping.unmappedColumns.length > 0 && (
        <p className="text-xs text-gray-400 mt-2">
          Unmapped: {mapping.unmappedColumns.join(', ')}
        </p>
      )}
    </div>
  );
}

// ─── Steps indicator ──────────────────────────────────────────────────────────

const STEPS = ['Upload', 'Review', 'Apply', 'Done'];

function StepIndicator({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-0">
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center">
          <span className={clsx(
            'flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold',
            i < current  ? 'bg-primary text-white'
              : i === current ? 'bg-primary/20 text-primary border border-primary'
              : 'bg-gray-100 text-gray-400',
          )}>
            {i < current ? <CheckCircle2 size={12} /> : i + 1}
          </span>
          <span className={clsx(
            'ml-1 text-xs font-medium hidden sm:inline',
            i === current ? 'text-primary' : 'text-gray-400',
          )}>{s}</span>
          {i < STEPS.length - 1 && (
            <span className="mx-2 text-gray-300 text-sm">›</span>
          )}
        </li>
      ))}
    </ol>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ImportReviewProps {
  job:      ImportJob;
  onDone:   () => void;
  onCancel: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ImportReview({ job, onDone, onCancel }: ImportReviewProps) {
  const qc = useQueryClient();
  const [locationId, setLocationId] = useState(getLocationId);
  const [importType, setImportType] = useState<ImportType>(job.import_type);
  const [mapping, setMapping] = useState<ColumnMapping | null>(
    job.mapping_config ? (job.mapping_config as ColumnMapping) : null,
  );

  const parsedConf: number = mapping?.confidence ?? 0.8;
  const previewRows = Array.isArray(job.preview_data)
    ? (job.preview_data as unknown[])
    : [];

  // ── Confirm mutation ───────────────────────────────────────────────────────

  const confirm = useMutation({
    mutationFn: () => importsApi.confirm(job.id, locationId, mapping ?? undefined),
    onSuccess: (updatedJob) => {
      qc.setQueryData(QK.importJob(job.id), updatedJob);
      void qc.invalidateQueries({ queryKey: QK.importJobs() });
      showToast.success(`Import ${updatedJob.status === 'completed' ? 'completed' : 'partially applied'}`);
      onDone();
    },
    onError: (err: Error) => showToast.error(err.message),
  });

  const step = confirm.isPending ? 2 : confirm.isSuccess ? 3 : 1;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div className="flex items-center gap-4">
          <StepIndicator current={step} />
        </div>
        <button onClick={onCancel} className="p-1.5 rounded hover:bg-gray-100">
          <X size={16} className="text-gray-500" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">

        {/* Detected type */}
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <p className="text-xs text-gray-500 mb-1">Detected document type</p>
            <div className="flex items-center gap-2">
              <select
                value={importType}
                onChange={(e) => setImportType(e.target.value as ImportType)}
                className="rounded-md border border-gray-300 px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {ALL_IMPORT_TYPES.map((t) => (
                  <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                ))}
              </select>
              {confidenceBadge(parsedConf)}
            </div>
          </div>

          {/* Location selector */}
          <div>
            <p className="text-xs text-gray-500 mb-1">Apply to location</p>
            <div className="flex items-center gap-1.5 rounded-md border border-gray-300 px-2 py-1.5 text-sm bg-white">
              <MapPin size={13} className="text-gray-400" />
              <input
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                placeholder="Location ID"
                className="outline-none w-52 text-sm placeholder-gray-400"
              />
            </div>
          </div>
        </div>

        {/* Preview table */}
        {previewRows.length > 0 && (
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              Preview — first {previewRows.length} rows
            </p>
            {renderPreviewTable(previewRows)}
          </div>
        )}

        {/* Column mapping (CSV imports) */}
        {job.import_type === 'generic_csv' && mapping && (
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              Column Mapping
            </p>
            <div className="bg-gray-50 rounded-lg p-4">
              <ColumnMappingEditor mapping={mapping} onChange={setMapping} />
            </div>
          </div>
        )}

        {/* Summary */}
        {job.total_rows != null && (
          <div className="bg-blue-50 rounded-lg p-4 text-sm text-blue-700">
            <p className="font-medium">Ready to apply</p>
            <p className="text-xs text-blue-600 mt-1">
              {job.total_rows} {job.total_rows === 1 ? 'record' : 'records'} detected
              from &ldquo;{job.source_filename ?? 'uploaded file'}&rdquo;
            </p>
          </div>
        )}

        {/* Error log */}
        {job.error_log?.length > 0 && (
          <div className="bg-red-50 rounded-lg p-4">
            <p className="text-xs font-medium text-red-600 mb-2">Errors during processing</p>
            <ul className="space-y-1">
              {job.error_log.map((e, i) => (
                <li key={i} className="text-xs text-red-500 flex items-start gap-1">
                  <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                  {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-gray-200 flex items-center justify-between gap-3">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => confirm.mutate()}
          disabled={!locationId.trim() || confirm.isPending}
          className={clsx(
            'flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-colors',
            locationId.trim() && !confirm.isPending
              ? 'bg-primary text-white hover:bg-primary/90'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed',
          )}
        >
          {confirm.isPending && <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          {confirm.isPending ? 'Applying…' : 'Apply Import'}
        </button>
      </div>
    </div>
  );
}
