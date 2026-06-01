/**
 * VarianceReports — list of generated variance reports with generation form.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileBarChart2, Plus, RefreshCw, CheckCircle, Clock,
  AlertTriangle, Loader2, ChevronRight,
} from 'lucide-react';
import { clsx } from 'clsx';
import { varianceApi, type VarianceReportSummary } from '../../lib/api';
import { QK } from '../../lib/queryClient';
import { showToast } from '../ui/Toast';
import { VarianceReportDetail } from './VarianceReportDetail';

// ─── Props ────────────────────────────────────────────────────────────────────

interface VarianceReportsProps {
  locationId: string;
}

// ─── Generate form ────────────────────────────────────────────────────────────

function getTodayStr()     { return new Date().toISOString().slice(0, 10); }
function getSevenDaysAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function VarianceReports({ locationId }: VarianceReportsProps) {
  const qc = useQueryClient();

  const [showForm,       setShowForm]       = useState(false);
  const [periodStart,    setPeriodStart]    = useState(getSevenDaysAgo);
  const [periodEnd,      setPeriodEnd]      = useState(getTodayStr);
  const [flagThreshold,  setFlagThreshold]  = useState(10);
  const [selectedReport, setSelectedReport] = useState<string | null>(null);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: QK.varianceReports({ locationId }),
    queryFn:  () => varianceApi.list(locationId, undefined, 20),
    staleTime: 60_000,
  });

  const reports = data?.reports ?? [];

  const generateMutation = useMutation({
    mutationFn: () =>
      varianceApi.generate(locationId, periodStart, periodEnd, flagThreshold),
    onSuccess: (report) => {
      void qc.invalidateQueries({ queryKey: ['varianceReports'] });
      showToast.success('Variance report generated');
      setShowForm(false);
      setSelectedReport(report.id);
    },
    onError: (err) => {
      showToast.error(err instanceof Error ? err.message : 'Generation failed');
    },
  });

  if (selectedReport) {
    return (
      <VarianceReportDetail
        reportId={selectedReport}
        locationId={locationId}
        onBack={() => setSelectedReport(null)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white rounded-md text-sm font-semibold hover:bg-primary-dark transition-colors"
        >
          <Plus size={14} /> Generate report
        </button>
        <button
          onClick={() => void refetch()}
          disabled={isFetching}
          className="p-2 rounded-md border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw size={14} className={clsx(isFetching && 'animate-spin')} />
        </button>
      </div>

      {/* Generate form */}
      {showForm && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <FileBarChart2 size={15} className="text-primary" />
            Generate Variance Report
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Period start</label>
              <input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className="w-full py-2 px-3 border border-gray-200 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Period end</label>
              <input
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className="w-full py-2 px-3 border border-gray-200 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Flag threshold %</label>
              <input
                type="number"
                min={1}
                max={100}
                value={flagThreshold}
                onChange={(e) => setFlagThreshold(parseInt(e.target.value, 10) || 10)}
                className="w-full py-2 px-3 border border-gray-200 rounded-md text-sm font-mono bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending || !periodStart || !periodEnd}
                className="w-full h-10 bg-primary text-white rounded-md text-sm font-semibold hover:bg-primary-dark transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {generateMutation.isPending
                  ? <><Loader2 size={13} className="animate-spin" /> Generating…</>
                  : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reports list */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : reports.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <FileBarChart2 size={32} className="text-gray-200 mb-3" />
          <p className="text-sm font-medium text-gray-500">No variance reports yet</p>
          <p className="text-xs text-gray-400 mt-1">Generate a report to compare theoretical vs actual stock usage</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-50">
          {reports.map((r: VarianceReportSummary) => (
            <button
              key={r.id}
              onClick={() => setSelectedReport(r.id)}
              className="w-full flex items-center gap-4 px-4 py-3.5 hover:bg-gray-50 transition-colors text-left"
            >
              <div className="shrink-0">
                {r.status === 'finalized'
                  ? <CheckCircle size={18} className="text-green-500" />
                  : <Clock size={18} className="text-amber-500" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-gray-800">
                    {new Date(r.period_start).toLocaleDateString()} — {new Date(r.period_end).toLocaleDateString()}
                  </p>
                  <span className={clsx(
                    'px-2 py-0.5 rounded-full text-xs font-medium capitalize',
                    r.status === 'finalized'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-amber-100 text-amber-700',
                  )}>
                    {r.status}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  Generated {new Date(r.created_at).toLocaleDateString()}
                  {r.flagged_count > 0 && (
                    <span className="ml-2 text-amber-600 font-medium flex-inline items-center gap-1">
                      <AlertTriangle size={10} className="inline -mt-px" /> {r.flagged_count} flagged
                    </span>
                  )}
                </p>
              </div>
              <ChevronRight size={14} className="text-gray-400 shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
