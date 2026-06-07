/**
 * allergens — FDA Big 9 constants shared by product/customer forms and the
 * POS allergen alert (S8-05). Values match the API/DB representation.
 */

export const FDA_ALLERGENS = [
  'milk', 'eggs', 'fish', 'shellfish', 'tree_nuts',
  'peanuts', 'wheat', 'soybeans', 'sesame',
] as const;

export type Allergen = (typeof FDA_ALLERGENS)[number];

export const ALLERGEN_LABELS: Record<Allergen, string> = {
  milk:      'Milk',
  eggs:      'Eggs',
  fish:      'Fish',
  shellfish: 'Shellfish',
  tree_nuts: 'Tree Nuts',
  peanuts:   'Peanuts',
  wheat:     'Wheat',
  soybeans:  'Soybeans',
  sesame:    'Sesame',
};

export function allergenLabel(value: string): string {
  return ALLERGEN_LABELS[value as Allergen] ?? value;
}

/** Allergens present in BOTH lists (product contents × customer profile). */
export function allergenConflicts(
  productAllergens: string[] | null | undefined,
  customerAllergens: string[] | null | undefined,
): string[] {
  if (!productAllergens?.length || !customerAllergens?.length) return [];
  const set = new Set(customerAllergens);
  return productAllergens.filter((a) => set.has(a));
}

/** Marker prefix used on cart-item notes for allergen-confirmed adds. */
export const ALLERGEN_NOTE_PREFIX = '⚠ ALLERGEN';

export function buildAllergenNote(conflicts: string[]): string {
  return `${ALLERGEN_NOTE_PREFIX}: customer allergic to ${conflicts.map(allergenLabel).join(', ')} — confirmed OK by customer`;
}
