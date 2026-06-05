/**
 * HeatmapTab — 7×24 revenue heatmap (day-of-week × hour). Identifies peak hours.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reports, type ReportDateParams } from '../../lib/api';
import { fmtCurrency } from '../../lib/dateRanges';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function HeatmapTab({ params }: { params: ReportDateParams }) {
  const { data, isLoading } = useQuery({
    queryKey: ['report', 'heatmap', params],
    queryFn:  () => reports.getHourlyHeatmap(params),
    staleTime: 30_000,
  });

  const { grid, max, peak } = useMemo(() => {
    const g: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    let mx = 0; let pk = { dow: 0, hour: 0, val: 0 };
    for (const r of data ?? []) {
      const v = Math.round(Number(r.gross_sales));
      g[r.day_of_week][r.hour] = v;
      if (v > mx) mx = v;
      if (v > pk.val) pk = { dow: r.day_of_week, hour: r.hour, val: v };
    }
    return { grid: g, max: mx, peak: pk };
  }, [data]);

  if (isLoading) return <div className="h-64 bg-gray-100 rounded-lg animate-pulse" />;

  const color = (v: number) => {
    if (v === 0 || max === 0) return 'rgba(22,163,74,0.05)';
    const a = 0.12 + 0.78 * (v / max);
    return `rgba(22,163,74,${a.toFixed(2)})`;
  };
  const exportCsv = () => {
    const rows = [['Day', 'Hour', 'Revenue']];
    grid.forEach((row, d) => row.forEach((v, h) => { if (v > 0) rows.push([DOW[d], `${h}:00`, (v / 100).toFixed(2)]); }));
    const csv = rows.map((r) => r.join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'heatmap.csv'; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">Busiest hours</h3>
          {peak.val > 0 && <p className="text-xs text-gray-500 mt-0.5">Peak: <strong>{DOW[peak.dow]} {peak.hour}:00</strong> · {fmtCurrency(peak.val)}</p>}
        </div>
        <button onClick={exportCsv} className="text-xs text-primary hover:underline">Export CSV</button>
      </div>
      <div className="overflow-x-auto">
        <table className="border-collapse">
          <thead>
            <tr>
              <th className="w-10" />
              {Array.from({ length: 24 }).map((_, h) => (
                <th key={h} className="text-[9px] text-gray-400 font-normal px-0.5">{h % 3 === 0 ? h : ''}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row, d) => (
              <tr key={d}>
                <td className="text-[10px] text-gray-500 pr-1 text-right">{DOW[d]}</td>
                {row.map((v, h) => (
                  <td key={h} title={`${DOW[d]} ${h}:00 — ${fmtCurrency(v)}`}
                    style={{ background: color(v) }} className="w-4 h-5 border border-white" />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400 mt-3">Darker = busier. Hover a cell for exact revenue.</p>
    </div>
  );
}
