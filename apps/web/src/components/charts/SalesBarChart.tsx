/**
 * SalesBarChart — responsive Recharts BarChart wrapper (stacked or grouped).
 */
import {
  ResponsiveContainer, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';

export interface SalesBarChartProps {
  data:        Array<Record<string, unknown>>;
  xKey:        string;
  bars:        Array<{ key: string; color: string; label: string }>;
  stacked?:    boolean;
  height?:     number;
  showGrid?:   boolean;
  showLegend?: boolean;
  yFormatter?: (v: number) => string;
  xFormatter?: (v: string) => string;
}

const defaultY = (v: number) => `$${(v / 100).toFixed(0)}`;

export function SalesBarChart({
  data, xKey, bars,
  stacked = false,
  height = 240,
  showGrid = true,
  showLegend = true,
  yFormatter = defaultY,
  xFormatter,
}: SalesBarChartProps) {
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
      <BarChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
        {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />}
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
        {bars.map((b) => (
          <Bar
            key={b.key}
            dataKey={b.key}
            name={b.label}
            fill={b.color}
            stackId={stacked ? 'stack' : undefined}
            radius={stacked ? undefined : [3, 3, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
