/**
 * Bottom sheet for product modifiers + item notes.
 * Opens on long-press of a product tile, or tap on a cart item.
 */

import { useState, useEffect, useCallback } from 'react';
import { X, Plus, Minus, Archive } from 'lucide-react';
import { clsx } from 'clsx';
import { usePOSStore, type AppliedModifier } from '../../store/pos.store';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ModifierGroupDef {
  id:             string;
  name:           string;
  selectionType:  'single' | 'multiple' | 'required_single' | 'required_multiple';
  minSelections:  number;
  maxSelections:  number | null;
  sortOrder:      number;
  modifiers:      ModifierDef[];
}

export interface ModifierDef {
  id:         string;
  name:       string;
  priceDelta: number; // cents
  isDefault:  boolean;
  sortOrder:  number;
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
}

export function ModifierSheet({
  product, cartItemId, initialModifiers, initialNotes, initialQuantity, onClose, onArchive,
}: Props) {
  const addToCart       = usePOSStore((s) => s.addToCart);
  const updateCartItem  = usePOSStore((s) => s.updateCartItem);
  const setSheetOpen    = usePOSStore((s) => s.setModifierSheetOpen);

  const [selections, setSelections] = useState<Record<string, Set<string>>>({});
  const [qty,        setQty]        = useState(1);
  const [notes,      setNotes]      = useState('');

  // Initialise selections: when editing, pre-check the line's current modifiers;
  // otherwise pre-select any modifiers flagged isDefault. Also seed notes/qty when
  // editing. Keyed on the product so it re-seeds when the sheet opens for a new item.
  useEffect(() => {
    const initialIds = initialModifiers ? new Set(initialModifiers.map((m) => m.modifierId)) : null;
    const init: Record<string, Set<string>> = {};
    for (const g of product.modifierGroups) {
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
  }, [product.modifierGroups]);

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

  const requiredSatisfied = product.modifierGroups
    .filter((g) => isRequired(g.selectionType))
    .every((g) => (selections[g.id]?.size ?? 0) > 0);

  const appliedModifiers: AppliedModifier[] = product.modifierGroups.flatMap((g) =>
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
          {product.modifierGroups.map((group) => (
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
          ))}

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
