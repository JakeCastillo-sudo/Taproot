/**
 * CategoryTileGrid — default landing view of the POS center zone.
 *
 * Shows uniform-size colorful category tiles. Tapping one drills into
 * that category's products. "All Items" is always the first tile.
 *
 * Layout config from useLayoutStore overrides defaults:
 * - Color: config.color (hex) or getCategoryColor(name) hash fallback
 * - Icon: config.icon (emoji/2-char) or category name initials fallback
 * - Order: config.displayOrder / isPinned (pinned first)
 * - Visibility: skip when config.isHidden = true
 * - Grid columns: layout.gridColumns (2 | 3 | 4)
 *
 * SAFE-DEFAULT RULE: if layout config is null/missing, falls back to
 * original behavior — category hash colors, DB sort_order, all visible.
 * Missing config NEVER breaks the POS.
 *
 * BUG-NAV-001 fix: all tiles are now aspect-square (uniform size).
 */

import { useEffect } from 'react';
import { Package } from 'lucide-react';
import { clsx } from 'clsx';
import { resolveColor } from '../../lib/categoryColors';
import { useLayoutStore } from '../../store/layout.store';
import type { CategoryWithCount } from '../../lib/api';

// ─── Tile ─────────────────────────────────────────────────────────────────────

interface TileProps {
  name:        string;
  color:       string;
  count:       number;
  icon:        string;          // emoji, initials, or 'pkg' sentinel
  isAllItems?: boolean;
  isPinned?:   boolean;
  onTap:       () => void;
}

function Tile({ name, color, count, icon, isAllItems, isPinned, onTap }: TileProps) {
  return (
    <button
      onClick={onTap}
      className={clsx(
        // BUG-NAV-001 fix: aspect-square ensures uniform tile size
        'relative aspect-square rounded-xl',
        'flex flex-col items-center justify-center p-3',
        'active:scale-[0.96] transition-transform duration-100 select-none',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
        'shadow-sm overflow-hidden text-white w-full',
      )}
      style={{ background: color }}
      aria-label={`${name} — ${count} items`}
    >
      {/* Faint overlay for depth */}
      <div className="absolute inset-0 bg-black/[0.06]" />

      {/* Pin indicator */}
      {isPinned && (
        <div className="absolute top-2 left-2 z-10 w-4 h-4 bg-white/20 rounded-full flex items-center justify-center">
          <span className="text-[9px]">📌</span>
        </div>
      )}

      {/* Icon area */}
      <div className="relative z-10 flex flex-col items-center gap-1.5">
        {isAllItems ? (
          <Package size={26} strokeWidth={1.8} className="text-white" />
        ) : (
          <div className="w-10 h-10 rounded-full bg-white/25 flex items-center justify-center shrink-0">
            <span className="text-lg font-black tracking-tight leading-none">{icon}</span>
          </div>
        )}

        <span className="text-xs font-bold text-white leading-tight text-center line-clamp-2 px-1 w-full">
          {name}
        </span>
      </div>

      {/* Item count badge */}
      <span className="absolute bottom-1.5 right-2 text-[10px] font-medium text-white/75">
        {count}
      </span>
    </button>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function TileSkeleton() {
  return (
    <div className="aspect-square rounded-xl bg-gray-200 animate-shimmer w-full" />
  );
}

// ─── Grid ─────────────────────────────────────────────────────────────────────

const GRID_COLS: Record<2 | 3 | 4, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-2 sm:grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-4',
};

interface CategoryTileGridProps {
  categories:        CategoryWithCount[];
  totalProductCount: number;
  loading:           boolean;
  onSelectAll:       () => void;
  onSelectCategory:  (id: string, name: string) => void;
  filteredCounts?:   Record<string, number>;
  filteredTotal?:    number;
  activeDayPart?:    string;
}

export function CategoryTileGrid({
  categories,
  totalProductCount,
  loading,
  onSelectAll,
  onSelectCategory,
  filteredCounts,
  filteredTotal,
  activeDayPart,
}: CategoryTileGridProps) {
  const { dashboardLayout, fetchLayout } = useLayoutStore();

  // Fetch layout on first mount (non-blocking — POS works with defaults)
  useEffect(() => {
    void fetchLayout();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isFiltered = !!activeDayPart && activeDayPart !== 'all';
  const layout     = dashboardLayout;

  // ── Apply layout config ───────────────────────────────────────────────────

  const configMap = new Map(
    (layout?.categoryConfigs ?? []).map((c) => [c.categoryId, c]),
  );

  // Filter hidden categories
  const visibleCategories = categories.filter((cat) => {
    const cfg = configMap.get(cat.id);
    return !cfg?.isHidden;
  });

  // Sort: pinned first, then by displayOrder (or DB sort_order as fallback)
  const sortedCategories = [...visibleCategories].sort((a, b) => {
    const ca = configMap.get(a.id);
    const cb = configMap.get(b.id);
    const pinA = ca?.isPinned ? 0 : 1;
    const pinB = cb?.isPinned ? 0 : 1;
    if (pinA !== pinB) return pinA - pinB;
    const orderA = ca?.displayOrder ?? a.sort_order ?? 999;
    const orderB = cb?.displayOrder ?? b.sort_order ?? 999;
    return orderA - orderB;
  });

  const gridColumns = (layout?.gridColumns ?? 3) as 2 | 3 | 4;
  const gridClass   = GRID_COLS[gridColumns] ?? GRID_COLS[3];
  const showAllItems = layout?.showAllItemsTile ?? true;
  const allItemsColor = layout?.allItemsTileColor ?? '#1D9E75';

  if (loading) {
    return (
      <div className={clsx('grid gap-3 p-4', gridClass)}>
        {Array.from({ length: gridColumns === 2 ? 6 : gridColumns === 4 ? 8 : 7 }).map((_, i) => (
          <TileSkeleton key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className={clsx('grid gap-3 p-4', gridClass)}>
      {/* All Items tile */}
      {showAllItems && (
        <Tile
          name="All Items"
          color={allItemsColor}
          count={isFiltered && filteredTotal !== undefined ? filteredTotal : totalProductCount}
          icon="AI"
          isAllItems
          onTap={onSelectAll}
        />
      )}

      {/* Category tiles */}
      {sortedCategories.map((cat) => {
        const cfg = configMap.get(cat.id);
        const displayCount = isFiltered && filteredCounts !== undefined
          ? (filteredCounts[cat.id] ?? 0)
          : cat.product_count;
        const dimmed = isFiltered && displayCount === 0;

        const color    = cfg?.color   ?? resolveColor(cat.name, cat.color);
        const icon     = cfg?.icon    ?? cat.name.slice(0, 2).toUpperCase();
        const isPinned = cfg?.isPinned ?? false;

        return (
          <div key={cat.id} className={clsx('transition-opacity', dimmed && 'opacity-40')}>
            <Tile
              name={cat.name}
              color={color}
              count={displayCount}
              icon={icon}
              isPinned={isPinned}
              onTap={() => onSelectCategory(cat.id, cat.name)}
            />
          </div>
        );
      })}

      {/* Empty state */}
      {sortedCategories.length === 0 && !showAllItems && (
        <div className="col-span-full flex flex-col items-center justify-center py-16 text-center">
          <Package size={36} className="text-gray-200 mb-3" />
          <p className="text-sm font-medium text-gray-400">No categories yet</p>
          <p className="text-xs text-gray-300 mt-1">
            Products without a category appear in All Items
          </p>
        </div>
      )}
    </div>
  );
}
