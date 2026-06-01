/**
 * DonutChart — responsive Recharts PieChart wrapper with centre label.
 */
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
} from 'recharts';

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

export interface DonutChartProps {
  data:         DonutSlice[];
  height?:      number;
  showLegend?:  boolean;
  valueFormatter?: (v: number) => string;
  centerLabel?:    string;
}

const defaultFmt = (v: number) => String(v);

export function DonutChart({
  data,
  height = 240,
  showLegend = true,
  valueFormatter = defaultFmt,
  centerLabel,
}: DonutChartProps) {
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
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="label"
          cx="50%"
          cy="50%"
          innerRadius={height * 0.28}
          outerRadius={height * 0.4}
          paddingAngle={2}
        >
          {data.map((entry, i) => (
            <Cell key={`cell-${i}`} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value) => [valueFormatter(Number(value ?? 0))]}
          contentStyle={{
            background: '#fff',
            border: '1px solid #E2E8F0',
            borderRadius: 8,
            fontSize: 12,
          }}
        />
        {showLegend && (
          <Legend
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            formatter={(value) => value}
          />
        )}
        {centerLabel && (
          // SVG text trick — position at chart centre
          <text
            x="50%" y="50%"
            textAnchor="middle" dominantBaseline="middle"
            className="fill-gray-600 text-xs font-medium"
            fontSize={11}
          >
            {centerLabel}
          </text>
        )}
      </PieChart>
    </ResponsiveContainer>
  );
}
