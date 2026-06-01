/**
 * HeatmapChart — custom SVG 7×24 revenue heatmap.
 * Rows = days of week (Sun–Sat), Columns = hours (0–23).
 */

import { useState } from 'react';
import type { HourlyHeatmapRow } from '@taproot/shared';

interface HeatmapChartProps {
  data:   HourlyHeatmapRow[];
  height?: number;
}

const DAYS   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS  = Array.from({ length: 24 }, (_, i) => i);

function fmtHour(h: number): string {
  if (h === 0)  return '12a';
  if (h === 12) return '12p';
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

function lerp(t: number, r1: number, g1: number, b1: number, r2: number, g2: number, b2: number) {
  return [
    Math.round(r1 + (r2 - r1) * t),
    Math.round(g1 + (g2 - g1) * t),
    Math.round(b1 + (b2 - b1) * t),
  ];
}

// Taproot green scale: very light → brand green
function heatColor(intensity: number): string {
  if (intensity <= 0) return '#F8FAFC';
  const [r, g, b] = lerp(intensity, 240, 253, 244, 22, 163, 74);
  return `rgb(${r},${g},${b})`;
}

export function HeatmapChart({ data, height = 160 }: HeatmapChartProps) {
  const [tooltip, setTooltip] = useState<{ day: number; hour: number; value: number; x: number; y: number } | null>(null);

  if (!data || data.length === 0) {
    return (
      <div
        className="flex items-center justify-center bg-gray-50 rounded-lg text-gray-400 text-sm"
        style={{ height }}
        aria-label="No heatmap data"
      >
        No data for this period
      </div>
    );
  }

  // Build lookup map
  const valueMap = new Map<string, number>();
  let maxVal = 0;
  for (const row of data) {
    const key = `${row.day_of_week}:${row.hour}`;
    valueMap.set(key, row.gross_sales);
    if (row.gross_sales > maxVal) maxVal = row.gross_sales;
  }

  const cellW = 100 / 24;  // percentage width per cell
  const cellH = height / 7;

  return (
    <div className="relative select-none" style={{ height }}>
      {/* Day labels (left side — overlaid as absolute) */}
      <div className="absolute left-0 top-0 h-full flex flex-col" style={{ width: 32 }}>
        {DAYS.map((d) => (
          <div
            key={d}
            className="flex items-center justify-end pr-1 text-[10px] text-gray-400 font-medium"
            style={{ height: cellH }}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Grid area */}
      <div className="absolute left-8 right-0 top-0" style={{ height }}>
        <svg
          width="100%"
          height={height}
          aria-label="Hourly revenue heatmap"
          onMouseLeave={() => setTooltip(null)}
        >
          {DAYS.map((_, dayIdx) =>
            HOURS.map((hour) => {
              const key = `${dayIdx}:${hour}`;
              const raw = valueMap.get(key) ?? 0;
              const intensity = maxVal > 0 ? raw / maxVal : 0;
              const xPct = (hour * cellW);
              const y   = dayIdx * cellH;
              return (
                <rect
                  key={key}
                  x={`${xPct}%`}
                  y={y}
                  width={`${cellW - 0.5}%`}
                  height={cellH - 1}
                  rx={2}
                  fill={heatColor(intensity)}
                  onMouseEnter={(e) => {
                    const rect = (e.target as SVGRectElement).getBoundingClientRect();
                    setTooltip({ day: dayIdx, hour, value: raw, x: rect.x, y: rect.y });
                  }}
                  style={{ cursor: 'default', transition: 'opacity 0.1s' }}
                  aria-label={`${DAYS[dayIdx]} ${fmtHour(hour)}: $${(raw / 100).toFixed(2)}`}
                />
              );
            }),
          )}
        </svg>

        {/* Hour axis */}
        <div className="flex mt-0.5">
          {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => (
            <div
              key={h}
              className="text-[9px] text-gray-400"
              style={{ width: `${cellW * 3}%`, textAlign: 'left' }}
            >
              {fmtHour(h)}
            </div>
          ))}
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 bg-gray-900 text-white text-xs px-2 py-1 rounded shadow-lg pointer-events-none"
          style={{ left: tooltip.x + 8, top: tooltip.y - 32 }}
        >
          {DAYS[tooltip.day]} {fmtHour(tooltip.hour)} — ${(tooltip.value / 100).toFixed(2)}
        </div>
      )}
    </div>
  );
}
