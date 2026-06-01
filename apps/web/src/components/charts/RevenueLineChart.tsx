/**
 * RevenueLineChart — responsive Recharts LineChart wrapper.
 */
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';

export interface RevenueLineChartProps {
  data:        Array<Record<string, unknown>>;
  xKey:        string;
  lines:       Array<{ key: string; color: string; label: string }>;
  height?:     number;
  showGrid?:   boolean;
  showLegend?: boolean;
  yFormatter?: (v: number) => string;
  xFormatter?: (v: string) => string;
}

const defaultY = (v: number) => `$${(v / 100).toFixed(0)}`;

export function RevenueLineChart({
  data, xKey, lines,
  height = 260,
  showGrid = true,
  showLegend = false,
  yFormatter = defaultY,
  xFormatter,
}: RevenueLineChartProps) {
  if (!data || data.length === 0) {
    return (
      <div
        className="flex items-center justify-center bg-gray-50 rounded-lg text-gray-400 text-sm"
        style={{ height }}
        aria-label="No data"
      >
        No data for this period
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
        {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />}
        <XAxis
          dataKey={xKey}
          tickFormatter={xFormatter}
          tick={{ fontSize: 11, fill: '#94A3B8' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={yFormatter}
          tick={{ fontSize: 11, fill: '#94A3B8' }}
          axisLine={false}
          tickLine={false}
          width={56}
        />
        <Tooltip
          formatter={(value) => [yFormatter(Number(value ?? 0))]}
          labelFormatter={xFormatter ? (l) => xFormatter(String(l)) : undefined}
          contentStyle={{
            background: '#fff',
            border: '1px solid #E2E8F0',
            borderRadius: 8,
            fontSize: 12,
          }}
        />
        {showLegend && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {lines.map((l) => (
          <Line
            key={l.key}
            type="monotone"
            dataKey={l.key}
            name={l.label}
            stroke={l.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
