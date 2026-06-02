/**
 * CommandPalette — ⌘K quick-action launcher.
 *
 * Features:
 *  • Opens on Cmd+K (or Ctrl+K on Windows/Android)
 *  • Fuzzy search across registered actions
 *  • Arrow key navigation (↑↓) + Enter to execute
 *  • Esc to close
 *  • Each action has an icon, label, and description
 *
 * Usage:
 *   <CommandPalette open={open} onClose={() => setOpen(false)} actions={ACTIONS} />
 *
 * The action list is defined by the parent (POSLayout) so it can close sheets,
 * navigate, etc. without tight coupling.
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, ArrowRight } from 'lucide-react';
import { clsx } from 'clsx';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CommandAction {
  id:          string;
  label:       string;
  description?: string;
  /** Lucide icon component. */
  icon?:       React.ReactNode;
  /** Optional keyboard shortcut hint. */
  shortcut?:   string;
  /** Group label, e.g. "Navigate" or "Cart". */
  group?:      string;
  onSelect:    () => void;
}

interface CommandPaletteProps {
  open:     boolean;
  onClose:  () => void;
  actions:  CommandAction[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fuzzyMatch(query: string, text: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  // Simple substring match first (fast path)
  if (t.includes(q)) return true;
  // Character-by-character fuzzy
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

// ── CommandPalette ────────────────────────────────────────────────────────────

export function CommandPalette({ open, onClose, actions }: CommandPaletteProps) {
  const [query,    setQuery]    = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef  = useRef<HTMLInputElement>(null);
  const listRef   = useRef<HTMLDivElement>(null);

  // Reset when opening
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(0);
      // Focus input after mount animation
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Filtered + grouped actions
  const filtered = useMemo(() => {
    return actions.filter((a) =>
      fuzzyMatch(query, a.label) ||
      fuzzyMatch(query, a.description ?? '') ||
      fuzzyMatch(query, a.group ?? ''),
    );
  }, [query, actions]);

  // Clamp selected when list shrinks
  useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-selected="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, filtered.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
        return;
      }
      if (e.key === 'Enter' && filtered[selected]) {
        e.preventDefault();
        filtered[selected].onSelect();
        onClose();
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, filtered, selected, onClose]);

  // Build grouped sections — must be before early return to satisfy rules-of-hooks
  const groups = useMemo(() => {
    const map = new Map<string, CommandAction[]>();
    for (const action of filtered) {
      const g = action.group ?? 'Actions';
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(action);
    }
    return map;
  }, [filtered]);

  if (!open) return null;

  // Flat list index for selected highlighting
  let flatIdx = 0;

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-[150] flex items-start justify-center pt-[15vh] px-4"
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white rounded-xl shadow-2xl overflow-hidden animate-scale-in"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Command palette"
        aria-modal="true"
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-100">
          <Search size={16} className="text-gray-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
            placeholder="Search actions…"
            className="flex-1 text-sm text-gray-800 placeholder:text-gray-400 outline-none bg-transparent"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden sm:flex items-center gap-0.5 px-1.5 py-0.5 bg-gray-100 rounded text-[10px] font-mono text-gray-500 shrink-0">
            Esc
          </kbd>
        </div>

        {/* Action list */}
        <div ref={listRef} className="overflow-y-auto max-h-80">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              No actions match &ldquo;{query}&rdquo;
            </div>
          ) : (
            Array.from(groups.entries()).map(([groupName, groupActions]) => (
              <div key={groupName}>
                <div className="px-4 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider bg-gray-50 border-b border-gray-50">
                  {groupName}
                </div>
                {groupActions.map((action) => {
                  const isSelected = flatIdx === selected;
                  flatIdx++;
                  return (
                    <button
                      key={action.id}
                      data-selected={isSelected}
                      onClick={() => { action.onSelect(); onClose(); }}
                      onMouseEnter={() => setSelected(flatIdx - 1)}
                      className={clsx(
                        'w-full flex items-center gap-3 px-4 py-3 text-left transition-colors',
                        isSelected ? 'bg-primary/8 text-primary' : 'text-gray-700 hover:bg-gray-50',
                      )}
                    >
                      {action.icon && (
                        <span className={clsx('shrink-0', isSelected ? 'text-primary' : 'text-gray-400')}>
                          {action.icon}
                        </span>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{action.label}</p>
                        {action.description && (
                          <p className="text-xs text-gray-400 truncate">{action.description}</p>
                        )}
                      </div>
                      {action.shortcut && (
                        <kbd className="shrink-0 px-1.5 py-0.5 bg-gray-100 rounded text-[10px] font-mono text-gray-500">
                          {action.shortcut}
                        </kbd>
                      )}
                      {isSelected && (
                        <ArrowRight size={14} className="shrink-0 text-primary" />
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-gray-50 flex items-center gap-4 text-[11px] text-gray-400">
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">↵</kbd> select</span>
          <span><kbd className="font-mono">Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
