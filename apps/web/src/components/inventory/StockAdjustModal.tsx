/**
 * StockAdjustModal — quick stock adjustment used by the Inventory Dashboard.
 *
 * Either targets a fixed ingredient (passed in) or shows an ingredient picker
 * (for the "Record delivery / waste / count" quick actions). Calls the existing
 * ingredientsApi.adjustStock — same movement types as IngredientsSettingsPage.
 */

import { useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { X, Plus, Minus } from 'lucide-react';
import { clsx } from 'clsx';
import { ingredientsApi } from '../../lib/api';
import { showToast } from '../ui/Toast';

const MOVEMENT_TYPES = [
  { value: 'received_delivery', label: 'Received delivery' },
  { value: 'manual_count',      label: 'Manual count' },
  { value: 'waste',             label: 'Waste' },
  { value: 'other',             label: 'Other' },
];

export interface AdjustTarget { id: string; name: string; unit: string }

export function StockAdjustModal({
  ingredient, defaultType = 'received_delivery', defaultSign = 1, onClose, onSaved,
}: {
  ingredient?: AdjustTarget | null;
  defaultType?: string;
  defaultSign?: 1 | -1;
  onClose: () => void;
  onSaved: () => void;
}) {
  const fixed = ingredient ?? null;
  const [selectedId, setSelectedId] = useState<string>(fixed?.id ?? '');
  const [sign, setSign] = useState<1 | -1>(defaultSign);
  const [amount, setAmount] = useState('');
  const [movementType, setMovementType] = useState(defaultType);
  const [notes, setNotes] = useState('');

  // Only fetch the ingredient list when no fixed ingredient was provided.
  const { data: ingredients } = useQuery({
    queryKey: ['ingredients'],
    queryFn:  () => ingredientsApi.list(),
    enabled:  !fixed,
  });

  const target: AdjustTarget | null = useMemo(() => {
    if (fixed) return fixed;
    const found = (ingredients ?? []).find((i) => i.id === selectedId);
    return found ? { id: found.id, name: found.name, unit: found.unit } : null;
  }, [fixed, ingredients, selectedId]);

  const save = useMutation({
    mutationFn: () => {
      if (!target) throw new Error('Pick an ingredient');
      const qty = parseFloat(amount) || 0;
      if (qty <= 0) throw new Error('Enter an amount');
      return ingredientsApi.adjustStock(target.id, {
        quantityChange: sign * qty,
        movementType,
        notes: notes.trim() || undefined,
      });
    },
    onSuccess: () => { showToast.success('Stock adjusted'); onSaved(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Adjustment failed'),
  });

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">
            {fixed ? `Adjust stock · ${fixed.name}` : 'Adjust stock'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100"><X size={16} className="text-gray-500" /></button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {!fixed && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Ingredient</label>
              <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm bg-white">
                <option value="">Select an ingredient…</option>
                {(ingredients ?? []).map((i) => (
                  <option key={i.id} value={i.id}>{i.name} ({Number(i.current_stock)} {i.unit})</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center gap-2">
            <div className="flex rounded-md border border-gray-200 overflow-hidden">
              <button onClick={() => setSign(1)} className={clsx('px-3 py-2', sign === 1 ? 'bg-primary text-white' : 'text-gray-500')}><Plus size={14} /></button>
              <button onClick={() => setSign(-1)} className={clsx('px-3 py-2', sign === -1 ? 'bg-danger text-white' : 'text-gray-500')}><Minus size={14} /></button>
            </div>
            <input type="number" step="0.25" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus placeholder="0"
              className="flex-1 px-3 py-2 border border-gray-200 rounded-md text-sm" />
            <span className="text-sm text-gray-500 w-12 truncate">{target?.unit ?? ''}</span>
          </div>

          <select value={movementType} onChange={(e) => setMovementType(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm bg-white">
            {MOVEMENT_TYPES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>

          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)"
            className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm" />
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md">Cancel</button>
          <button onClick={() => save.mutate()} disabled={save.isPending || !amount || (!fixed && !selectedId)}
            className="px-4 py-2 text-sm font-semibold bg-primary text-white rounded-md hover:bg-primary-dark disabled:opacity-50">
            {save.isPending ? 'Saving…' : 'Save adjustment'}
          </button>
        </div>
      </div>
    </div>
  );
}
