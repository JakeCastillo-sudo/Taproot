/**
 * CategoryTileGrid — default landing view of the POS center zone.
 *
 * Shows large, colorful category tiles. Tapping one drills into that category's
 * products. "All Items" is always the first tile.
 */

import { Package } from 'lucide-react';
import { clsx } from 'clsx';
import { resolveColor } from '../../lib/categoryColors';
import type { CategoryWithCount } from '../../lib/api';

// ─── Tile ─────────────────────────────────────────────────────────────────────

interface TileProps {
  name:         string;
  color:        string;
  count:        number;
  initials:     string;
  isAllItems?:  boolean;
  onTap:        () => void;
}

function Tile({ name, color, count, initials, isAllItems, onTap }: TileProps) {
  return (
    <button
      onClick={onTap}
      className={clsx(
        'relative flex flex-col items-center justify-center rounded-xl min-h-[110px] p-4',
        'active:scale-[0.96] transition-transform duration-100 select-none',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
        'shadow-sm overflow-hidden text-white',
      )}
      style={{ background: color }}
      aria-label={`${name} — ${count} items`}
    >
      {/* Faint overlay for depth */}
      <div className="absolute inset-0 bg-black/[0.06]" />

      {/* Icon area */}
      <div className="relative z-10 flex flex-col items-center gap-2">
        {isAllItems ? (
          <Package size={28} strokeWidth={1.8} className="text-white" />
        ) : (
          <div className="w-12 h-12 rounded-full bg-white/25 flex items-center justify-center">
            <span className="text-xl font-black tracking-tight">{initials}</span>
          </div>
        )}

        <span className="text-sm font-bold text-white leading-snug text-center line-clamp-2">
          {name}
        </span>
      </div>

      {/* Item count badge */}
      <span className="absolute bottom-2 right-3 text-[11px] font-medium text-white/80">
        {count} item{count !== 1 ? 's' : ''}
      </span>
    </button>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function TileSkeleton() {
  return (
    <div className="min-h-[110px] rounded-xl bg-gray-200 animate-shimmer" />
  );
}

// ─── Grid ─────────────────────────────────────────────────────────────────────

interface CategoryTileGridProps {
  categories:        CategoryWithCount[];
  totalProductCount: number;
  loading:           boolean;
  onSelectAll:       () => void;
  onSelectCategory:  (id: string, name: string) => void;
}

export function CategoryTileGrid({
  categories,
  totalProductCount,
  loading,
  onSelectAll,
  onSelectCategory,
}: CategoryTileGridProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-3 p-4">
        {Array.from({ length: 8 }).map((_, i) => <TileSkeleton key={i} />)}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-3 p-4">
      {/* All Items — always first */}
      <Tile
        name="All Items"
        color="#1D9E75"
        count={totalProductCount}
        initials="AI"
        isAllItems
        onTap={onSelectAll}
      />

      {/* Category tiles */}
      {categories.map((cat) => (
        <Tile
          key={cat.id}
          name={cat.name}
          color={resolveColor(cat.name, cat.color)}
          count={cat.product_count}
          initials={cat.name.slice(0, 2).toUpperCase()}
          onTap={() => onSelectCategory(cat.id, cat.name)}
        />
      ))}

      {/* Empty state when no categories */}
      {categories.length === 0 && (
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
