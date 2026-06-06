/**
 * ArchivedProducts — Inventory tab showing products hidden from the POS register.
 *
 * Archived products are NOT deleted — they can be restored at any time.
 * Use cases: seasonal items, 86'd dishes, products being reformulated.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, RotateCcw, Trash2, Package } from 'lucide-react';
import { clsx } from 'clsx';
import { products as productsApi } from '../../lib/api';
import { QK } from '../../lib/queryClient';
import { showToast } from '../ui/Toast';

// ─── Props ────────────────────────────────────────────────────────────────────

interface ArchivedProductsProps {
  locationId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ArchivedProducts({ locationId }: ArchivedProductsProps) {
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['archivedProducts'],
    queryFn:  () => productsApi.listArchived(),
    staleTime: 60_000,
  });

  const archived = data ?? [];

  // ── Restore mutation ───────────────────────────────────────────────────────

  const restore = useMutation({
    mutationFn: (productId: string) => productsApi.restore(productId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['archivedProducts'] });
      void qc.invalidateQueries({ queryKey: QK.products() });
      void qc.invalidateQueries({ queryKey: QK.inventory(locationId, {}) });
      showToast.success('Product restored — now visible on register');
    },
    onError: (err) => showToast.error(err instanceof Error ? err.message : 'Restore failed'),
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-2 animate-pulse">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 bg-gray-100 rounded-lg" />
        ))}
      </div>
    );
  }

  if (archived.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Archive size={36} className="text-gray-200 mb-3" />
        <p className="text-sm font-medium text-gray-500">No archived items</p>
        <p className="text-xs text-gray-400 mt-1">
          Archive items from the Stock Levels tab to hide them from the register.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header info */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Package size={14} className="text-amber-500" />
        <span>
          <strong className="text-gray-700">{archived.length}</strong> item{archived.length !== 1 ? 's' : ''} archived
          — hidden from register until restored
        </span>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-clip">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-2.5 font-medium text-gray-500">Product</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-500 hidden sm:table-cell">Category</th>
              <th className="text-right px-4 py-2.5 font-medium text-gray-500 hidden md:table-cell">Last price</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-500">Archived</th>
              <th className="text-right px-4 py-2.5 font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {archived.map((item) => (
              <tr key={item.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                {/* Name + SKU */}
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-800">{item.name}</div>
                  {item.sku && (
                    <div className="text-xs text-gray-400 font-mono">{item.sku}</div>
                  )}
                </td>

                {/* Category */}
                <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">
                  {item.category_name ?? '—'}
                </td>

                {/* Last price */}
                <td className="px-4 py-3 text-right font-mono text-gray-600 hidden md:table-cell">
                  {item.last_price > 0 ? fmt(item.last_price) : '—'}
                </td>

                {/* Archived date + reason */}
                <td className="px-4 py-3">
                  <div className="text-xs text-gray-500">{fmtDate(item.archived_at)}</div>
                  {item.archive_reason && (
                    <div className="text-xs text-gray-400 italic mt-0.5">{item.archive_reason}</div>
                  )}
                </td>

                {/* Actions */}
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    {/* Restore */}
                    <button
                      onClick={() => restore.mutate(item.id)}
                      disabled={restore.isPending}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 transition-colors disabled:opacity-50"
                    >
                      <RotateCcw size={11} />
                      Restore
                    </button>

                    {/* Permanent delete */}
                    {confirmDelete === item.id ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-red-600">Sure?</span>
                        <button
                          onClick={() => {
                            // TODO: wire permanent delete when needed
                            showToast.info('Permanent delete not yet implemented');
                            setConfirmDelete(null);
                          }}
                          className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setConfirmDelete(null)}
                          className="px-2 py-1 text-xs border border-gray-200 rounded hover:bg-gray-50 transition-colors text-gray-600"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDelete(item.id)}
                        className={clsx(
                          'p-1.5 rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50',
                          'transition-colors',
                        )}
                        title="Delete permanently"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
