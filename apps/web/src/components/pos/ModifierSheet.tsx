/**
 * Bottom sheet for product modifiers + item notes.
 * Opens on long-press of a product tile, or tap on a cart item.
 *
 * Two modes (FEAT ingredients):
 *  - recipeMode=false (default, ALL existing products): renders product.modifierGroups
 *    exactly as before — zero behavioral change.
 *  - recipeMode=true: renders posModifierData.groups as a 3-section sheet
 *    (Remove anything? / Want extra? / Add anything?) with type-aware labels.
 * The selection/cart logic is shared across both modes.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { X, Plus, Minus, Archive } from 'lucide-react';
import { clsx } from 'clsx';
import { usePOSStore, type AppliedModifier } from '../../store/pos.store';
import type { POSModifierResponse } from '../../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ModifierGroupDef {
  id:             string;
  name:           string;
  selectionType:  'single' | 'multiple' | 'required_single' | 'required_multiple';
  minSelections:  number;
  maxSelections:  number | null;
  sortOrder:      number;
  modifiers:      ModifierDef[];
  /** Recipe mode only: 'omissions' | 'extras' | 'add_ons' | 'custom'. */
  groupType?:     string;
}

export interface ModifierDef {
  id:         string;
  name:       string;
  priceDelta: number; // cents
  isDefault:  boolean;
  sortOrder:  number;
  /** Recipe mode only: 'omission' | 'extra' | 'add_on' | 'custom'. */
  modifierType?: string;
}

export interface ModifierSheetProduct {
  id:             string;
  variantId:      string | null;
  name:           string;
  sku:            string;
  basePrice:      number;
  modifierGroups: ModifierGroupDef[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(cents: number): string {
  if (cents === 0)  return 'free';
  const sign = cents > 0 ? '+' : '';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function isRequired(type: ModifierGroupDef['selectionType']): boolean {
  return type === 'required_single' || type === 'required_multiple';
}

function isSingle(type: ModifierGroupDef['selectionType']): boolean {
  return type === 'single' || type === 'required_single';
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  product:     ModifierSheetProduct;
  /** Existing cart item ID when editing (undefined = add new) */
  cartItemId?:  string;
  /** When editing: the line's current modifiers (pre-checked instead of defaults) */
  initialModifiers?: AppliedModifier[];
  /** When editing: the line's current notes */
  initialNotes?:     string;
  /** When editing: the line's current quantity */
  initialQuantity?:  number;
  onClose:      () => void;
  /** If provided, shows an "Archive Item" button in the header for POS quick-archive. */
  onArchive?:   (productId: string, productName: string) => void;
  /** Recipe-aware mode (ingredient system). Default false → identical to before. */
  recipeMode?:  boolean;
  /** Recipe-aware modifier data (only used when recipeMode=true). */
  posModifierData?: POSModifierResponse;
}

export function ModifierSheet({
  product, cartItemId, initialModifiers, initialNotes, initialQuantity, onClose, onArchive,
  recipeMode = false, posModifierData,
}: Props) {
  const addToCart       = usePOSStore((s) => s.addToCart);
  const updateCartItem  = usePOSStore((s) => s.updateCartItem);
  const setSheetOpen    = usePOSStore((s) => s.setModifierSheetOpen);

  const [selections, setSelections] = useState<Record<string, Set<string>>>({});
  const [qty,        setQty]        = useState(1);
  const [notes,      setNotes]      = useState('');

  // The groups that drive selection + rendering. In recipe mode they come from the
  // dedicated POS endpoint (with groupType/modifierType); otherwise the product's
  // existing modifier groups (unchanged path).
  const effectiveGroups: ModifierGroupDef[] = useMemo(() => {
    if (recipeMode && posModifierData) {
      return posModifierData.groups.map((g) => ({
        id:            g.id,
        name:          g.name,
        selectionType: g.selectionType,
        minSelections: g.minSelections,
        maxSelections: g.maxSelections,
        sortOrder:     g.sortOrder,
        groupType:     g.groupType,
        modifiers:     g.modifiers.map((m) => ({
          id:           m.id,
          name:         m.name,
          priceDelta:   m.priceDelta,
          isDefault:    m.isDefault,
          sortOrder:    m.sortOrder,
          modifierType: m.modifierType,
        })),
      }));
    }
    return product.modifierGroups;
  }, [recipeMode, posModifierData, product.modifierGroups]);

  const recipeLoading = recipeMode && !posModifierData;

  // Initialise selections: when editing, pre-check the line's current modifiers;
  // otherwise pre-select any modifiers flagged isDefault. Also seed notes/qty when
  // editing. Re-seeds when the effective groups change (sheet opens / pos data loads).
  useEffect(() => {
    const initialIds = initialModifiers ? new Set(initialModifiers.map((m) => m.modifierId)) : null;
    const init: Record<string, Set<string>> = {};
    for (const g of effectiveGroups) {
      init[g.id] = new Set(
        g.modifiers
          .filter((m) => (initialIds ? initialIds.has(m.id) : m.isDefault))
          .map((m) => m.id),
      );
    }
    setSelections(init);
    if (initialNotes !== undefined) setNotes(initialNotes);
    if (initialQuantity !== undefined && initialQuantity > 0) setQty(initialQuantity);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveGroups]);

  const toggle = useCallback((groupId: string, modId: string, single: boolean) => {
    setSelections((prev) => {
      const next = { ...prev };
      const set  = new Set(prev[groupId] ?? []);
      if (set.has(modId)) {
        set.delete(modId);
      } else {
        if (single) set.clear();
        set.add(modId);
      }
      next[groupId] = set;
      return next;
    });
  }, []);

  const requiredSatisfied = effectiveGroups
    .filter((g) => isRequired(g.selectionType))
    .every((g) => (selections[g.id]?.size ?? 0) > 0);

  const appliedModifiers: AppliedModifier[] = effectiveGroups.flatMap((g) =>
    g.modifiers
      .filter((m) => selections[g.id]?.has(m.id))
      .map((m) => ({ modifierId: m.id, name: m.name, priceDelta: m.priceDelta })),
  );

  const modSum      = appliedModifiers.reduce((s, m) => s + m.priceDelta, 0);
  const linePrice   = (product.basePrice + modSum) * qty;
  const canConfirm  = requiredSatisfied;

  const handleConfirm = () => {
    if (cartItemId) {
      // Editing existing item — replace modifiers + qty + notes in place.
      updateCartItem(cartItemId, { modifiers: appliedModifiers, quantity: qty, notes });
    } else {
      addToCart({
        productId: product.id,
        variantId: product.variantId,
        name:      product.name,
        sku:       product.sku,
        quantity:  qty,
        unitPrice: product.basePrice,
        modifiers: appliedModifiers,
        notes,
      });
    }
    setSheetOpen(false);
    onClose();
  };

  // Close on backdrop click / Escape
  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) { setSheetOpen(false); onClose(); }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { setSheetOpen(false); onClose(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, setSheetOpen]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={handleBackdrop}
    >
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-lg overflow-hidden animate-slide-up sm:animate-fade-in max-h-[90dvh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{product.name}</h2>
            <p className="text-sm text-gray-400 mt-0.5">${(product.basePrice / 100).toFixed(2)}</p>
          </div>
          <div className="flex items-center gap-1">
            {onArchive && (
              <button
                onClick={() => onArchive(product.id, product.name)}
                title="Archive item (hide from register)"
                className="p-1.5 rounded-full hover:bg-amber-50 text-gray-300 hover:text-amber-600 transition-colors"
              >
                <Archive size={16} />
              </button>
            )}
            <button
              onClick={() => { setSheetOpen(false); onClose(); }}
              className="p-1.5 rounded-full hover:bg-gray-100 transition-colors"
            >
              <X size={18} className="text-gray-500" />
            </button>
          </div>
        </div>

        {/* Scrollable modifier groups */}
        <div className="flex-1 overflow-y-auto min-h-0 p-5 space-y-5">
          {recipeLoading ? (
            <p className="text-sm text-gray-400 text-center py-6">Loading options…</p>
          ) : recipeMode ? (
            <RecipeSections groups={effectiveGroups} selections={selections} onToggle={toggle} />
          ) : (
            effectiveGroups.map((group) => (
              <div key={group.id}>
                <div className="flex items-center gap-2 mb-2.5">
                  <h3 className="text-sm font-semibold text-gray-700">{group.name}</h3>
                  {isRequired(group.selectionType) ? (
                    <span className="text-[10px] bg-red-50 text-red-600 border border-red-200 px-1.5 py-0.5 rounded-full font-medium">
                      Required
                    </span>
                  ) : (
                    <span className="text-[10px] text-gray-400">Optional</span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  {group.modifiers.map((mod) => {
                    const selected = selections[group.id]?.has(mod.id) ?? false;
                    const single   = isSingle(group.selectionType);
                    return (
                      <button
                        key={mod.id}
                        onClick={() => toggle(group.id, mod.id, single)}
                        role={single ? 'radio' : 'checkbox'}
                        aria-checked={selected}
                        className={clsx(
                          // Large tap targets: name on top, price below, thick selected border.
                          'flex flex-col items-start gap-0.5 px-4 py-3 rounded-lg border-2 text-left transition-all min-h-tap',
                          selected
                            ? 'bg-primary-light border-primary text-primary-dark'
                            : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300',
                        )}
                      >
                        <span className="text-sm font-semibold">{mod.name}</span>
                        <span className={clsx(
                          'text-xs font-semibold',
                          mod.priceDelta === 0 ? 'text-gray-400' : 'text-green-600',
                        )}>
                          {mod.priceDelta === 0 ? 'included' : fmt(mod.priceDelta)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}

          {/* Special instructions */}
          <div>
            <label htmlFor="modifier-notes" className="text-sm font-semibold text-gray-700 block mb-2">
              Special instructions
            </label>
            <textarea
              id="modifier-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. no ice, extra hot…"
              rows={2}
              className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 bg-white">
          <div className="flex items-center gap-3 mb-3">
            {/* Quantity stepper */}
            <div className="flex items-center gap-2 bg-gray-100 rounded-md px-1">
              <button
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="w-8 h-8 flex items-center justify-center rounded text-gray-600 hover:bg-gray-200 transition-colors"
                aria-label="Decrease quantity"
              >
                <Minus size={14} />
              </button>
              <span className="w-6 text-center text-sm font-semibold text-gray-800">{qty}</span>
              <button
                onClick={() => setQty((q) => q + 1)}
                className="w-8 h-8 flex items-center justify-center rounded text-gray-600 hover:bg-gray-200 transition-colors"
                aria-label="Increase quantity"
              >
                <Plus size={14} />
              </button>
            </div>

            {/* Add button */}
            <button
              onClick={handleConfirm}
              disabled={!canConfirm}
              className={clsx(
                'flex-1 h-11 flex items-center justify-center gap-2 rounded-md text-sm font-semibold transition-all',
                canConfirm
                  ? 'bg-primary text-white hover:bg-primary-dark active:scale-[0.98]'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed',
              )}
            >
              {cartItemId ? 'Update item' : 'Add to Order'}
              <span className="opacity-80 font-medium">
                — ${(linePrice / 100).toFixed(2)}
              </span>
            </button>
          </div>

          {!requiredSatisfied && (
            <p className="text-xs text-red-500 text-center">
              Please make all required selections above
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Recipe-mode 3-section renderer ─────────────────────────────────────────────

/** Price label per modifier type (recipe mode). Returns null when nothing to show. */
function RecipePrice({ mod }: { mod: ModifierDef }) {
  const isOmission = mod.modifierType === 'omission';
  if (mod.priceDelta === 0) {
    // Omissions with no price delta show nothing; extras/add-ons show "free".
    if (isOmission) return null;
    return <span className="text-xs font-semibold text-gray-400">free</span>;
  }
  return (
    <span className={clsx('text-xs font-semibold', mod.priceDelta < 0 ? 'text-red-600' : 'text-green-600')}>
      {fmt(mod.priceDelta)}
    </span>
  );
}

function SectionOptions({
  groups, selections, onToggle,
}: {
  groups: ModifierGroupDef[];
  selections: Record<string, Set<string>>;
  onToggle: (groupId: string, modId: string, single: boolean) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {groups.flatMap((group) =>
        group.modifiers.map((mod) => {
          const selected = selections[group.id]?.has(mod.id) ?? false;
          const single   = isSingle(group.selectionType);
          return (
            <button
              key={`${group.id}:${mod.id}`}
              onClick={() => onToggle(group.id, mod.id, single)}
              role={single ? 'radio' : 'checkbox'}
              aria-checked={selected}
              className={clsx(
                'flex flex-col items-start gap-0.5 px-4 py-3 rounded-lg border-2 text-left transition-all min-h-tap',
                selected
                  ? 'bg-primary-light border-primary text-primary-dark'
                  : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300',
              )}
            >
              <span className="text-sm font-semibold">{mod.name}</span>
              <RecipePrice mod={mod} />
            </button>
          );
        }),
      )}
    </div>
  );
}

function RecipeSections({
  groups, selections, onToggle,
}: {
  groups: ModifierGroupDef[];
  selections: Record<string, Set<string>>;
  onToggle: (groupId: string, modId: string, single: boolean) => void;
}) {
  const sections: Array<{ key: string; title: string; groups: ModifierGroupDef[] }> = [
    { key: 'omissions', title: 'Remove anything?', groups: groups.filter((g) => g.groupType === 'omissions') },
    { key: 'extras',    title: 'Want extra?',      groups: groups.filter((g) => g.groupType === 'extras') },
    {
      key: 'addons',
      title: 'Add anything?',
      // Universal add-ons + any manual custom groups.
      groups: groups.filter((g) => g.groupType === 'add_ons' || g.groupType === 'custom' || !g.groupType),
    },
  ];

  const visible = sections.filter((s) => s.groups.some((g) => g.modifiers.length > 0));
  if (visible.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-2">No options for this item — add a note below.</p>;
  }

  return (
    <div className="space-y-5">
      {visible.map((section, i) => (
        <div key={section.key} className={clsx(i > 0 && 'pt-4 border-t border-gray-100')}>
          <h3 className="text-[15px] font-bold text-primary mb-3">{section.title}</h3>
          <SectionOptions groups={section.groups} selections={selections} onToggle={onToggle} />
        </div>
      ))}
    </div>
  );
}
