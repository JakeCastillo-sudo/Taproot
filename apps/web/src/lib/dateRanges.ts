/**
 * Date range utilities for the Reports page.
 * Uses plain Date math — no date-fns dependency needed for these.
 */

export type PresetId =
  | 'today' | 'yesterday' | 'last7' | 'last30'
  | 'thisMonth' | 'lastMonth' | 'custom';

export interface DateRange {
  from: Date;
  to:   Date;
}

export interface Preset {
  id:    PresetId;
  label: string;
}

export const PRESETS: Preset[] = [
  { id: 'today',     label: 'Today'       },
  { id: 'yesterday', label: 'Yesterday'   },
  { id: 'last7',     label: 'Last 7 days' },
  { id: 'last30',    label: 'Last 30 days'},
  { id: 'thisMonth', label: 'This month'  },
  { id: 'lastMonth', label: 'Last month'  },
  { id: 'custom',    label: 'Custom'      },
];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

export function presetToRange(preset: PresetId): DateRange {
  const now   = new Date();
  const today = startOfDay(now);

  switch (preset) {
    case 'today': return { from: today, to: endOfDay(now) };

    case 'yesterday': {
      const y = new Date(today);
      y.setDate(y.getDate() - 1);
      return { from: startOfDay(y), to: endOfDay(y) };
    }

    case 'last7': {
      const f = new Date(today);
      f.setDate(f.getDate() - 6);
      return { from: startOfDay(f), to: endOfDay(now) };
    }

    case 'last30': {
      const f = new Date(today);
      f.setDate(f.getDate() - 29);
      return { from: startOfDay(f), to: endOfDay(now) };
    }

    case 'thisMonth': {
      const f = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: startOfDay(f), to: endOfDay(now) };
    }

    case 'lastMonth': {
      const f = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const t = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: startOfDay(f), to: endOfDay(t) };
    }

    default: return { from: today, to: endOfDay(now) };
  }
}

export function toApiParams(range: DateRange) {
  return {
    from: range.from.toISOString(),
    to:   range.to.toISOString(),
  };
}

/** Compare range: previous period of the same length */
export function previousPeriod(range: DateRange): DateRange {
  const ms   = range.to.getTime() - range.from.getTime();
  return {
    from: new Date(range.from.getTime() - ms),
    to:   new Date(range.to.getTime()   - ms),
  };
}

export function fmtCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export function fmtShortCurrency(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000)     return `$${(dollars / 1_000).toFixed(1)}k`;
  return `$${dollars.toFixed(0)}`;
}

export function fmtPct(pct: number, decimals = 1): string {
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(decimals)}%`;
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function fmtDateRange(range: DateRange): string {
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(range.from)} – ${fmt(range.to)}`;
}

export function toInputDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
