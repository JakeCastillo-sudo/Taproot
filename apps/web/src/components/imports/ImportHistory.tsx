/**
 * ImportHistory — table of past import jobs with re-import action.
 */
import { useQuery } from '@tanstack/react-query';
import { FileText, FileSpreadsheet, Image, RotateCcw, CheckCircle2, AlertCircle, Clock, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { importsApi, type ImportJob, type ImportStatus, type ImportType } from '../../lib/api';
import { QK } from '../../lib/queryClient';

// ─── Label maps ───────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<ImportType, string> = {
  document_menu:          'Menu',
  document_invoice:       'Invoice',
  document_goods_receipt: 'Goods Receipt',
  document_inventory:     'Inventory List',
  document_recipe:        'Recipe Sheet',
  generic_csv:            'CSV Import',
};

const STATUS_CONFIG: Record<ImportStatus, {
  label: string;
  icon:  React.FC<{ size?: number; className?: string }>;
  cls:   string;
}> = {
  pending:               { label: 'Pending',     icon: Clock,         cls: 'text-gray-500'  },
  processing:            { label: 'Processing',  icon: Loader2,       cls: 'text-blue-500'  },
  awaiting_confirmation: { label: 'Needs Review',icon: AlertCircle,   cls: 'text-amber-500' },
  completed:             { label: 'Completed',   icon: CheckCircle2,  cls: 'text-green-600' },
  partial:               { label: 'Partial',     icon: AlertCircle,   cls: 'text-amber-500' },
  failed:                { label: 'Failed',      icon: AlertCircle,   cls: 'text-red-500'   },
};

function fileIcon(type: ImportType) {
  if (type === 'generic_csv') return FileSpreadsheet;
  if (type === 'document_menu' || type === 'document_recipe') return FileText;
  return Image;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ImportHistoryProps {
  onReview: (job: ImportJob) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ImportHistory({ onReview }: ImportHistoryProps) {
  const { data, isLoading } = useQuery({
    queryKey: QK.importJobs(),
    queryFn: () => importsApi.list({ limit: 50 }),
    refetchInterval: (query) => {
      const jobs = query.state.data?.jobs ?? [];
      const hasActive = jobs.some((j) => j.status === 'pending' || j.status === 'processing');
      return hasActive ? 5000 : false;
    },
  });

  const jobs = data?.jobs ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-gray-400" size={24} />
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <FileText size={36} className="text-gray-300 mb-3" />
        <p className="text-gray-500 text-sm">No imports yet</p>
        <p className="text-gray-400 text-xs mt-1">Upload a file to get started</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wide text-xs">File</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wide text-xs">Type</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wide text-xs">Date</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wide text-xs">Status</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wide text-xs">Results</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {jobs.map((job) => {
            const FileIcon = fileIcon(job.import_type);
            const sc = STATUS_CONFIG[job.status];
            const StatusIcon = sc.icon;

            return (
              <tr key={job.id} className="hover:bg-gray-50 transition-colors">
                {/* File */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <FileIcon size={15} className="shrink-0 text-gray-400" />
                    <span className="font-medium text-gray-800 truncate max-w-[180px]">
                      {job.source_filename ?? 'Unknown file'}
                    </span>
                  </div>
                </td>

                {/* Type */}
                <td className="px-4 py-3 text-gray-600">
                  {TYPE_LABELS[job.import_type]}
                </td>

                {/* Date */}
                <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                  {fmtDate(job.created_at)}
                </td>

                {/* Status */}
                <td className="px-4 py-3">
                  <span className={clsx('flex items-center gap-1 text-xs font-medium', sc.cls)}>
                    <StatusIcon
                      size={13}
                      className={clsx(job.status === 'processing' && 'animate-spin')}
                    />
                    {sc.label}
                  </span>
                </td>

                {/* Results */}
                <td className="px-4 py-3 text-xs text-gray-500">
                  {(job.status === 'completed' || job.status === 'partial') ? (
                    <span>
                      <span className="text-green-600 font-medium">{job.succeeded_rows}</span>
                      {' ok'}
                      {job.failed_rows > 0 && (
                        <>, <span className="text-red-500 font-medium">{job.failed_rows}</span> failed</>
                      )}
                    </span>
                  ) : job.total_rows != null ? (
                    <span>{job.total_rows} rows</span>
                  ) : '—'}
                </td>

                {/* Actions */}
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    {job.status === 'awaiting_confirmation' && (
                      <button
                        onClick={() => onReview(job)}
                        className="px-3 py-1 rounded text-xs bg-primary text-white hover:bg-primary/90 transition-colors font-medium"
                      >
                        Review
                      </button>
                    )}
                    <button
                      title="Re-import"
                      className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      <RotateCcw size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
