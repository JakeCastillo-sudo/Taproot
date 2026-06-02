/**
 * ManualEntryStep — spreadsheet-like quick entry fallback
 *
 * Tab between cells, Enter to add row, paste from clipboard (Excel-friendly).
 */

import { useState, useRef, useCallback } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import type { MenuReviewItem } from '../../store/onboarding.store';

interface ManualRow {
  id:          string;
  name:        string;
  price:       string;  // string during editing
  category:    string;
  description: string;
}

function emptyRow(): ManualRow {
  return { id: crypto.randomUUID(), name: '', price: '', category: '', description: '' };
}

function rowsToItems(rows: ManualRow[]): MenuReviewItem[] {
  return rows
    .filter((r) => r.name.trim())
    .map((r) => ({
      id:          r.id,
      name:        r.name.trim(),
      price:       Math.round((parseFloat(r.price) || 0) * 100),
      category:    r.category.trim() || 'Uncategorized',
      description: r.description.trim(),
      confidence:  1.0,
    }));
}

const COLUMNS = [
  { key: 'name',        label: 'Name',        width: 'flex-[2]', placeholder: 'Espresso'      },
  { key: 'price',       label: 'Price ($)',   width: 'w-24',     placeholder: '4.50'          },
  { key: 'category',    label: 'Category',    width: 'flex-1',   placeholder: 'Beverages'     },
  { key: 'description', label: 'Description', width: 'flex-[2]', placeholder: 'Double shot…'  },
] as const;

interface ManualEntryStepProps {
  onConfirm: (items: MenuReviewItem[]) => void;
  onBack:    () => void;
}

export function ManualEntryStep({ onConfirm, onBack }: ManualEntryStepProps) {
  const [rows, setRows] = useState<ManualRow[]>(() => Array.from({ length: 5 }, emptyRow));
  const tableRef = useRef<HTMLTableElement>(null);

  const updateCell = useCallback((id: string, key: keyof Omit<ManualRow, 'id'>, value: string) => {
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, [key]: value } : r));
  }, []);

  const addRows = (n = 5) => {
    setRows((prev) => [...prev, ...Array.from({ length: n }, emptyRow)]);
  };

  const deleteRow = (id: string) => {
    setRows((prev) => {
      const next = prev.filter((r) => r.id !== id);
      return next.length ? next : [emptyRow()];
    });
  };

  // Handle Tab (move right/wrap) and Enter (add row)
  const handleKeyDown = (
    e:       React.KeyboardEvent<HTMLInputElement>,
    rowIdx:  number,
    colIdx:  number,
  ) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // If on last row, add a new one
      if (rowIdx === rows.length - 1) {
        setRows((prev) => [...prev, emptyRow()]);
        // Focus first cell of new row after render
        setTimeout(() => {
          const cells = tableRef.current?.querySelectorAll<HTMLInputElement>('input[data-row]');
          if (cells) {
            const newRowCells = Array.from(cells).filter(
              (c) => Number(c.dataset.row) === rows.length
            );
            newRowCells[0]?.focus();
          }
        }, 0);
      } else {
        // Move to next row, same column
        const cells = tableRef.current?.querySelectorAll<HTMLInputElement>('input[data-row]');
        if (cells) {
          const next = Array.from(cells).find(
            (c) => Number(c.dataset.row) === rowIdx + 1 && Number(c.dataset.col) === colIdx
          );
          next?.focus();
        }
      }
    }
  };

  // Handle clipboard paste (Excel-style: tab-separated columns, newline rows)
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>, rowIdx: number, colIdx: number) => {
    const text = e.clipboardData.getData('text');
    if (!text.includes('\t') && !text.includes('\n')) return; // simple paste, let it go
    e.preventDefault();

    const pastedRows = text.trim().split('\n').map((line) => line.split('\t'));
    setRows((prev) => {
      const next = [...prev];
      pastedRows.forEach((cells, ri) => {
        const targetRow = rowIdx + ri;
        if (targetRow >= next.length) next.push(emptyRow());
        cells.forEach((val, ci) => {
          const col = COLUMNS[colIdx + ci];
          if (col) {
            next[targetRow] = { ...next[targetRow], [col.key]: val.trim() };
          }
        });
      });
      return next;
    });
  };

  const filledCount = rows.filter((r) => r.name.trim()).length;
  const items       = rowsToItems(rows);

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-1">Enter your menu manually</h2>
      <p className="text-sm text-gray-500 mb-4">
        Tab between cells · Enter for new row · Paste from Excel works too
      </p>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table ref={tableRef} className="w-full text-sm border-collapse">
          {/* Header */}
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={clsx('text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide', col.width)}
                >
                  {col.label}
                </th>
              ))}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={row.id} className="border-b border-gray-100 last:border-0 group">
                {COLUMNS.map((col, ci) => (
                  <td key={col.key} className={clsx('px-1 py-0.5', col.width)}>
                    <input
                      type={col.key === 'price' ? 'number' : 'text'}
                      value={row[col.key]}
                      placeholder={col.placeholder}
                      data-row={ri}
                      data-col={ci}
                      onChange={(e) => updateCell(row.id, col.key, e.target.value)}
                      onKeyDown={(e) => handleKeyDown(e, ri, ci)}
                      onPaste={(e) => handlePaste(e, ri, ci)}
                      className={clsx(
                        'w-full px-2 py-1.5 text-sm bg-transparent rounded border border-transparent',
                        'focus:outline-none focus:border-primary/50 focus:bg-primary/5 transition-colors',
                        'placeholder:text-gray-300',
                      )}
                    />
                  </td>
                ))}
                <td className="px-1 py-0.5 text-right">
                  <button
                    type="button"
                    onClick={() => deleteRow(row.id)}
                    className="p-1 rounded text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                    tabIndex={-1}
                    aria-label="Delete row"
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer controls */}
      <div className="flex items-center justify-between mt-3">
        <button
          type="button"
          onClick={() => addRows(10)}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-primary transition-colors"
        >
          <Plus size={14} />
          Add 10 rows
        </button>
        <span className="text-xs text-gray-400">
          {filledCount} item{filledCount !== 1 ? 's' : ''} added
        </span>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3 mt-6">
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2.5 border border-gray-200 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={() => onConfirm(items)}
          disabled={filledCount === 0}
          className="flex-1 py-2.5 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Done, continue →
        </button>
      </div>
    </div>
  );
}
