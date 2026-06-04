/**
 * Deterministic category color assignment.
 *
 * getCategoryColor(name) always returns the same hex color for the same name,
 * so tiles are visually consistent across page loads without storing colors in DB.
 * If the category has an explicit color in the DB, that takes precedence.
 */

export const CATEGORY_COLORS = [
  '#1D9E75', // Taproot green
  '#3B82F6', // blue
  '#8B5CF6', // purple
  '#EC4899', // pink
  '#F59E0B', // amber
  '#EF4444', // red
  '#10B981', // emerald
  '#06B6D4', // cyan
  '#6366F1', // indigo
  '#F97316', // orange
] as const;

/**
 * Returns a hex color for the given category name.
 * The same name always maps to the same color (hash-based, not random).
 */
export function getCategoryColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return CATEGORY_COLORS[Math.abs(hash) % CATEGORY_COLORS.length];
}

/** Returns the best display color, preferring an explicit DB color. */
export function resolveColor(name: string, dbColor: string | null | undefined): string {
  return dbColor || getCategoryColor(name);
}
