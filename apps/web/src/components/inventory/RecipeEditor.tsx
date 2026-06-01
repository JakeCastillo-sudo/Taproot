/**
 * RecipeEditor — full-screen sheet for creating or editing a recipe for a product.
 * Loads ingredient products list, lets user add/remove lines, then saves.
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Plus, Trash2, Loader2, AlertCircle, CheckCircle, ChefHat } from 'lucide-react';
import { clsx } from 'clsx';
import { recipesApi, products as productsApi, type RecipeInput, type RecipeLineInput, type RecipeDetail } from '../../lib/api';
import { QK } from '../../lib/queryClient';
import { showToast } from '../ui/Toast';

// ─── Props ────────────────────────────────────────────────────────────────────

interface RecipeEditorProps {
  productId:   string;
  productName: string;
  onClose:     () => void;
}

// ─── UOM options ──────────────────────────────────────────────────────────────

const UNITS = ['each', 'g', 'kg', 'ml', 'l', 'oz', 'lb', 'm', 'ft'];

// ─── Empty line factory ───────────────────────────────────────────────────────

function emptyLine(): RecipeLineInput & { _key: string } {
  return {
    _key:                    crypto.randomUUID(),
    ingredientProductId:     '',
    ingredientVariantId:     null,
    quantity:                1,
    unit:                    'each',
    wasteFactor:             0,
    notes:                   '',
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RecipeEditor({ productId, productName, onClose }: RecipeEditorProps) {
  const qc = useQueryClient();

  const [name,        setName]        = useState('');
  const [yieldFactor, setYieldFactor] = useState(1);
  const [notes,       setNotes]       = useState('');
  const [lines,       setLines]       = useState<(RecipeLineInput & { _key: string })[]>([emptyLine()]);

  // Fetch existing recipe
  const { data: existing, isLoading: loadingRecipe } = useQuery({
    queryKey: QK.recipe(productId),
    queryFn:  () => recipesApi.get(productId),
    staleTime: 60_000,
  });

  // Pre-fill form when recipe loads
  useEffect(() => {
    if (!existing) return;
    setName(existing.name);
    setYieldFactor(existing.yield_factor);
    setNotes(existing.notes ?? '');
    if (existing.lines.length > 0) {
      setLines(existing.lines.map((l) => ({
        _key:                crypto.randomUUID(),
        ingredientProductId: l.ingredient_product_id,
        ingredientVariantId: l.ingredient_variant_id,
        quantity:            l.quantity,
        unit:                l.unit,
        wasteFactor:         l.waste_factor,
        notes:               l.notes ?? '',
      })));
    }
  }, [existing]);

  // Load ingredient product options
  const { data: productsData } = useQuery({
    queryKey: QK.products({ isActive: true }),
    queryFn:  () => productsApi.list({ isActive: true, perPage: 200 }),
    staleTime: 5 * 60_000,
  });
  const ingredientOptions = productsData?.products ?? [];

  const saveMutation = useMutation({
    mutationFn: () => {
      const body: RecipeInput = {
        name: name || `${productName} Recipe`,
        yieldFactor,
        notes: notes || undefined,
        lines: lines
          .filter((l) => l.ingredientProductId)
          .map(({ _key: _k, ...l }) => l),
      };
      return recipesApi.save(productId, body);
    },
    onSuccess: (saved: RecipeDetail) => {
      void qc.invalidateQueries({ queryKey: QK.recipe(productId) });
      showToast.success(`Recipe saved — ${saved.lines.length} ingredients`);
      onClose();
    },
    onError: (err) => {
      showToast.error(err instanceof Error ? err.message : 'Save failed');
    },
  });

  function addLine() {
    setLines((ls) => [...ls, emptyLine()]);
  }

  function removeLine(key: string) {
    setLines((ls) => ls.filter((l) => l._key !== key));
  }

  function updateLine<K extends keyof RecipeLineInput>(key: string, field: K, value: RecipeLineInput[K]) {
    setLines((ls) => ls.map((l) => l._key === key ? { ...l, [field]: value } : l));
  }

  const validLines = lines.filter((l) => l.ingredientProductId);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-stretch justify-end sm:items-center sm:justify-center">
      <div className="w-full sm:w-[680px] sm:max-h-[90vh] bg-white sm:rounded-xl flex flex-col shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ChefHat size={18} className="text-primary" />
            <div>
              <h2 className="text-base font-semibold text-gray-900">
                {existing ? 'Edit Recipe' : 'Create Recipe'}
              </h2>
              <p className="text-xs text-gray-500">{productName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400">
            <X size={16} />
          </button>
        </div>

        {loadingRecipe ? (
          <div className="flex items-center justify-center flex-1">
            <Loader2 size={20} className="animate-spin text-gray-400" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 space-y-5">

            {/* Basic fields */}
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 sm:col-span-1">
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Recipe name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={`${productName} Recipe`}
                  className="w-full py-2 px-3 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  Yield factor
                  <span className="text-gray-400 ml-1 font-normal">(e.g. 0.9 = 10% waste)</span>
                </label>
                <input
                  type="number"
                  min={0.01}
                  max={2}
                  step={0.01}
                  value={yieldFactor}
                  onChange={(e) => setYieldFactor(parseFloat(e.target.value) || 1)}
                  className="w-full py-2 px-3 border border-gray-200 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Notes</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Prep notes, allergens, etc."
                className="w-full py-2 px-3 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>

            {/* Ingredient lines */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Ingredients ({validLines.length})
                </h3>
                <button
                  onClick={addLine}
                  className="flex items-center gap-1.5 text-xs text-primary hover:text-primary-dark font-medium transition-colors"
                >
                  <Plus size={13} /> Add ingredient
                </button>
              </div>

              <div className="space-y-2">
                {lines.map((line, idx) => (
                  <div key={line._key} className="flex items-start gap-2 p-3 bg-gray-50 rounded-lg">
                    <div className="w-5 h-5 shrink-0 rounded-full bg-gray-200 flex items-center justify-center text-xs text-gray-500 mt-2">
                      {idx + 1}
                    </div>

                    {/* Ingredient select */}
                    <div className="flex-1 min-w-0">
                      <select
                        value={line.ingredientProductId}
                        onChange={(e) => updateLine(line._key, 'ingredientProductId', e.target.value)}
                        className="w-full py-2 px-3 border border-gray-200 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
                      >
                        <option value="">Select ingredient…</option>
                        {ingredientOptions.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>

                    {/* Qty */}
                    <div className="w-20 shrink-0">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={line.quantity}
                        onChange={(e) => updateLine(line._key, 'quantity', parseFloat(e.target.value) || 0)}
                        className="w-full py-2 px-2 text-center border border-gray-200 rounded-md text-sm font-mono bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
                        placeholder="Qty"
                      />
                    </div>

                    {/* Unit */}
                    <div className="w-20 shrink-0">
                      <select
                        value={line.unit}
                        onChange={(e) => updateLine(line._key, 'unit', e.target.value)}
                        className="w-full py-2 px-2 border border-gray-200 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
                      >
                        {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>

                    {/* Waste factor */}
                    <div className="w-16 shrink-0">
                      <input
                        type="number"
                        min={0}
                        max={1}
                        step={0.01}
                        value={line.wasteFactor ?? 0}
                        onChange={(e) => updateLine(line._key, 'wasteFactor', parseFloat(e.target.value) || 0)}
                        className="w-full py-2 px-2 text-center border border-gray-200 rounded-md text-sm font-mono bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
                        title="Waste factor (0–1)"
                        placeholder="0"
                      />
                    </div>

                    <button
                      onClick={() => removeLine(line._key)}
                      disabled={lines.length <= 1}
                      className="p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed mt-1 shrink-0"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Qty · Unit · Waste% — waste factor 0.1 means 10% of ingredient is discarded
              </p>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 shrink-0 flex items-center gap-3">
          <button
            onClick={onClose}
            className="flex-1 h-10 border border-gray-200 rounded-md text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={validLines.length === 0 || saveMutation.isPending}
            className={clsx(
              'flex-1 h-10 rounded-md text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2',
              saveMutation.isSuccess
                ? 'bg-green-600 text-white'
                : 'bg-primary text-white hover:bg-primary-dark',
            )}
          >
            {saveMutation.isSuccess ? (
              <><CheckCircle size={14} /> Saved!</>
            ) : saveMutation.isPending ? (
              <><Loader2 size={14} className="animate-spin" /> Saving…</>
            ) : (
              `Save recipe (${validLines.length} ingredients)`
            )}
          </button>
        </div>

        {saveMutation.isError && (
          <div className="px-5 pb-3 flex items-center gap-2 text-red-600 text-xs">
            <AlertCircle size={12} />
            {(saveMutation.error as Error)?.message ?? 'Error saving recipe'}
          </div>
        )}
      </div>
    </div>
  );
}
