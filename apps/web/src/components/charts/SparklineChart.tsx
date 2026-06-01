/**
 * SparklineChart — tiny inline SVG sparkline. No axes, no labels.
 */

interface SparklineChartProps {
  data:    number[];
  width?:  number;
  height?: number;
  color?:  string;
}

export function SparklineChart({
  data,
  width  = 80,
  height = 32,
  color  = '#16a34a',
}: SparklineChartProps) {
  if (!data || data.length < 2) {
    return <div style={{ width, height }} className="bg-gray-50 rounded" />;
  }

  const min  = Math.min(...data);
  const max  = Math.max(...data);
  const range = max - min || 1;
  const pad   = 2;
  const w     = width  - pad * 2;
  const h     = height - pad * 2;

  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * w;
    const y = pad + (1 - (v - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const path = `M ${points.join(' L ')}`;

  // Area fill
  const first = points[0].split(',');
  const last  = points[points.length - 1].split(',');
  const area  = `${path} L ${last[0]},${pad + h} L ${first[0]},${pad + h} Z`;

  return (
    <svg
      width={width}
      height={height}
      aria-hidden="true"
      style={{ display: 'block', overflow: 'visible' }}
    >
      {/* Area */}
      <path d={area} fill={color} fillOpacity={0.12} stroke="none" />
      {/* Line */}
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
