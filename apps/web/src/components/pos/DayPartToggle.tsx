/**
 * DayPartToggle — compact meal-period filter for the POS header.
 *
 * Restaurants can restrict which products are visible based on time of day.
 * ADDITIVE rule: products with no day_parts assigned are ALWAYS shown.
 * Only products explicitly assigned to specific parts are hidden in other modes.
 */

import { clsx } from 'clsx';
import type { ActiveDayPart } from '../../store/ui.store';

// ─── Options ──────────────────────────────────────────────────────────────────

interface DayPartOption {
  id:    ActiveDayPart;
  emoji: string;
  label: string;
  short: string; // abbreviated for small screens
}

const OPTIONS: DayPartOption[] = [
  { id: 'all',       emoji: '☀️',  label: 'All',       short: 'All'  },
  { id: 'breakfast', emoji: '🌅',  label: 'Breakfast', short: 'Brkfst' },
  { id: 'brunch',    emoji: '🥂',  label: 'Brunch',    short: 'Brunch' },
  { id: 'lunch',     emoji: '🌤️', label: 'Lunch',     short: 'Lunch'  },
  { id: 'dinner',    emoji: '🌙',  label: 'Dinner',    short: 'Dinner' },
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface DayPartToggleProps {
  active:   ActiveDayPart;
  onChange: (part: ActiveDayPart) => void;
  /** When true, show only emoji + abbreviated label (narrow screens) */
  compact?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DayPartToggle({ active, onChange, compact }: DayPartToggleProps) {
  return (
    <div
      role="group"
      aria-label="Day part filter"
      className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5 shrink-0"
    >
      {OPTIONS.map((opt) => {
        const isActive = active === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            title={opt.label}
            aria-pressed={isActive}
            className={clsx(
              'flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition-all',
              'min-h-[36px] whitespace-nowrap select-none',
              isActive
                ? 'bg-primary text-white shadow-sm'
                : 'text-gray-600 hover:bg-white hover:text-gray-800 hover:shadow-sm',
            )}
          >
            <span className="text-sm leading-none">{opt.emoji}</span>
            {!compact && (
              <span className="hidden sm:inline">{opt.short}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
