/**
 * VarianceReportDetail — view a single variance report with line items
 * and a finalize button.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, CheckCircle, AlertTriangle, Lock, Loader2,
  TrendingUp, TrendingDown, Minus,
} from 'lucide-react';
import { clsx } from 'clsx';
import { varianceApi } from '../../lib/api';
import { QK } from '../../lib/queryClient';
import { showToast } from '../ui/Toast';

// ─── Props ────────────────────────────────────────────────────────────────────

interface VarianceReportDetailProps {
  reportId:   string;
  locationId: string;
  onBack:     () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function VarianceReportDetail({ reportId, locationId, onBack }: VarianceReportDetailProps) {
  const qc = useQueryClient();

  const { data: report, isLoading } = useQuery({
    queryKey: QK.varianceReport(reportId),
    queryFn:  () => varianceApi.get(reportId),
    staleTime: 60_000,
  });

  const finalizeMutation = useMutation({
    mutationFn: () => varianceApi.finalize(reportId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK.varianceReport(reportId) });
      void qc.invalidateQueries({ queryKey: ['varianceReports'] });
      showToast.success('Report finalized');
    },
    onError: (err) => {
      showToast.error(err instanceof Error ? err.message : 'Finalize failed');
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={20} className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="text-center py-16 text-gray-400">
        <p>Report not found</p>
        <button onClick={onBack} className="mt-2 text-sm text-primary hover:underline">Go back</button>
      </div>
    );
  }

  const flaggedLines  = report.lines.filter((l) => l.is_flagged);
  const normalLines   = report.lines.filter((l) => !l.is_flagged);

  function varianceColor(pct: number) {
    const abs = Math.abs(pct);
    if (abs >= 20) return 'text-red-600';
    if (abs >= 10) return 'text-amber-600';
    return 'text-gray-600';
  }

  function varianceIcon(delta: number) {
    if (delta > 0) return <TrendingUp size={14} className="text-green-500" />;
    if (delta < 0) return <TrendingDown size={14} className="text-red-500" />;
    return <Minus size={14} className="text-gray-400" />;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ArrowLeft size={14} /> Back to reports
        </button>
        <div className="flex-1" />
        {report.status === 'draft' && (
          <button
            onClick={() => finalizeMutation.mutate()}
            disabled={finalizeMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-2 bg-green-600 text-white rounded-md text-sm font-semibold hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            {finalizeMutation.isPending
              ? <><Loader2 size={13} className="animate-spin" /> Finalizing…</>
              : <><Lock size={13} /> Finalize report</>}
          </button>
        )}
      </div>

      {/* Meta */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex items-center gap-3 mb-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              Variance Report: {new Date(report.period_start).toLocaleDateString()} — {new Date(report.period_end).toLocaleDateString()}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Generated {new Date(report.created_at).toLocaleDateString()}
            </p>
          </div>
          <span className={clsx(
            'ml-auto px-2 py-0.5 rounded-full text-xs font-medium capitalize',
            report.status === 'finalized'
              ? 'bg-green-100 text-green-700'
              : 'bg-amber-100 text-amber-700',
          )}>
            {report.status}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-2xl font-bold text-gray-800">{report.lines.length}</p>
            <p className="text-xs text-gray-500">Products</p>
          </div>
          <div className="bg-amber-50 rounded-lg p-3">
            <p className="text-2xl font-bold text-amber-700">{flaggedLines.length}</p>
            <p className="text-xs text-amber-600">Flagged</p>
          </div>
          <div className="bg-green-50 rounded-lg p-3">
            <p className="text-2xl font-bold text-green-700">{normalLines.length}</p>
            <p className="text-xs text-green-600">Normal</p>
          </div>
        </div>
      </div>

      {/* Flagged lines */}
      {flaggedLines.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <AlertTriangle size={12} /> Flagged items ({flaggedLines.length})
          </h3>
          <LineTable lines={flaggedLines} varianceColor={varianceColor} varianceIcon={varianceIcon} />
        </div>
      )}

      {/* Normal lines */}
      {normalLines.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <CheckCircle size={12} /> Within tolerance ({normalLines.length})
          </h3>
          <LineTable lines={normalLines} varianceColor={varianceColor} varianceIcon={varianceIcon} />
        </div>
      )}
    </div>
  );
}

// ─── Line table sub-component ─────────────────────────────────────────────────

interface LineTableProps {
  lines:          ReturnType<typeof extractLines>;
  varianceColor:  (pct: number) => string;
  varianceIcon:   (delta: number) => React.ReactNode;
}

type ExtractedLine = {
  id: string;
  product_name: string;
  variant_name: string | null;
  opening_quantity: number;
  closing_quantity: number;
  received_quantity: number;
  theoretical_usage: number;
  actual_usage: number;
  variance_delta: number;
  variance_pct: number;
  is_flagged: boolean;
};

function extractLines(arr: ExtractedLine[]) { return arr; }

function LineTable({ lines, varianceColor, varianceIcon }: LineTableProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-2.5 font-medium text-gray-500">Product</th>
              <th className="text-right px-4 py-2.5 font-medium text-gray-500">Opening</th>
              <th className="text-right px-4 py-2.5 font-medium text-gray-500">Received</th>
              <th className="text-right px-4 py-2.5 font-medium text-gray-500">Closing</th>
              <th className="text-right px-4 py-2.5 font-medium text-gray-500">Theoretical</th>
              <th className="text-right px-4 py-2.5 font-medium text-gray-500">Actual</th>
              <th className="text-right px-4 py-2.5 font-medium text-gray-500">Variance</th>
              <th className="text-right px-4 py-2.5 font-medium text-gray-500">%</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id} className={clsx(
                'border-b border-gray-50 hover:bg-gray-50/60 transition-colors',
                line.is_flagged && 'bg-amber-50/30',
              )}>
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-800">{line.product_name}</div>
                  {line.variant_name && (
                    <div className="text-xs text-gray-400">{line.variant_name}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-mono text-gray-600">
                  {line.opening_quantity.toFixed(2)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-gray-600">
                  {line.received_quantity.toFixed(2)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-gray-600">
                  {line.closing_quantity.toFixed(2)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-gray-500">
                  {line.theoretical_usage.toFixed(2)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-gray-500">
                  {line.actual_usage.toFixed(2)}
                </td>
                <td className="px-4 py-3 text-right">
                  <span className={clsx('flex items-center justify-end gap-1 font-mono font-semibold', varianceColor(line.variance_pct))}>
                    {varianceIcon(line.variance_delta)}
                    {line.variance_delta > 0 ? '+' : ''}{line.variance_delta.toFixed(2)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className={clsx('font-semibold', varianceColor(line.variance_pct))}>
                    {line.variance_pct > 0 ? '+' : ''}{line.variance_pct.toFixed(1)}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
