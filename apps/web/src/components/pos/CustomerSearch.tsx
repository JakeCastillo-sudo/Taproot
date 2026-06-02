import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, X, User, ChevronRight, Star, DollarSign } from 'lucide-react';
import { clsx } from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { usePOSStore } from '../../store/pos.store';
import { customers as customersApi } from '../../lib/api';
import { QK } from '../../lib/queryClient';
import type { Customer } from '@taproot/shared';

// ─── Loyalty tier colours ─────────────────────────────────────────────────────

const TIER_COLORS: Record<string, string> = {
  bronze:   'bg-amber-100  text-amber-800',
  silver:   'bg-gray-100   text-gray-700',
  gold:     'bg-yellow-100 text-yellow-800',
  platinum: 'bg-purple-100 text-purple-800',
};

function TierBadge({ tier }: { tier: string }) {
  return (
    <span className={clsx('text-[10px] font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-wide', TIER_COLORS[tier] ?? 'bg-gray-100 text-gray-700')}>
      {tier}
    </span>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CustomerSearch() {
  const customerId   = usePOSStore((s) => s.customerId);
  const customerName = usePOSStore((s) => s.customerName);
  const setCustomer  = usePOSStore((s) => s.setCustomer);

  const [query,     setQuery]     = useState('');
  const [open,      setOpen]      = useState(false);
  const [focusIdx,  setFocusIdx]  = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef  = useRef<HTMLDivElement>(null);

  // Debounced search query
  const [debouncedQ, setDebouncedQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data, isFetching } = useQuery({
    queryKey: QK.customers(debouncedQ),
    queryFn:  () => customersApi.search(debouncedQ),
    enabled:  debouncedQ.length >= 2,
    staleTime: 0,
  });

  const results = data?.customers ?? [];

  const selectCustomer = useCallback((c: Customer) => {
    setCustomer(c.id, `${c.first_name} ${c.last_name}`.trim());
    setQuery('');
    setOpen(false);
    setFocusIdx(-1);
  }, [setCustomer]);

  const clear = useCallback(() => {
    setCustomer(null, null);
    setQuery('');
    setOpen(false);
  }, [setCustomer]);

  // Close on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      const node = (e.target as HTMLElement);
      if (!node.closest('[data-customer-search]')) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // Keyboard navigation
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocusIdx((i) => Math.min(i + 1, results.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setFocusIdx((i) => Math.max(i - 1, -1)); }
    if (e.key === 'Enter' && focusIdx >= 0) { e.preventDefault(); selectCustomer(results[focusIdx]); }
    if (e.key === 'Escape') { setOpen(false); setFocusIdx(-1); }
  };

  // If a customer is already selected
  if (customerId) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-primary-light rounded-md border border-primary/20">
        <User size={14} className="text-primary shrink-0" />
        <span className="text-sm font-medium text-primary-dark flex-1 truncate">{customerName}</span>
        <button
          onClick={clear}
          className="p-0.5 rounded hover:bg-primary/20 transition-colors"
          aria-label="Remove customer"
        >
          <X size={13} className="text-primary-dark" />
        </button>
      </div>
    );
  }

  return (
    <div data-customer-search className="relative" onKeyDown={onKeyDown}>
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          id="customer-search"
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setFocusIdx(-1); }}
          onFocus={() => { if (query.length >= 2) setOpen(true); }}
          placeholder="Search customer…"
          className="w-full pl-8 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-colors"
          autoComplete="off"
        />
        {isFetching && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-3 h-3 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />
          </div>
        )}
      </div>

      {open && query.length >= 2 && (
        <div
          ref={listRef}
          className="absolute top-full left-0 right-0 mt-1 bg-white rounded-md shadow-lg border border-gray-100 overflow-hidden z-50 animate-fade-in"
        >
          {results.length === 0 && !isFetching && (
            <div className="px-4 py-3 text-xs text-gray-400 text-center">
              No customers found
            </div>
          )}

          {results.map((c, i) => (
            <button
              key={c.id}
              onMouseDown={() => selectCustomer(c)}
              className={clsx(
                'w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors',
                i === focusIdx && 'bg-primary-light',
              )}
            >
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <span className="text-xs font-semibold text-primary">
                  {c.first_name?.[0]?.toUpperCase() ?? '?'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-gray-800 truncate">
                    {c.first_name} {c.last_name}
                  </span>
                  {c.loyalty_tier && <TierBadge tier={c.loyalty_tier} />}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-gray-400 truncate">{c.email ?? c.phone}</span>
                  {c.loyalty_points > 0 && (
                    <span className="flex items-center gap-0.5 text-[10px] text-amber-600">
                      <Star size={9} /> {c.loyalty_points} pts
                    </span>
                  )}
                  {c.account_credit > 0 && (
                    <span className="flex items-center gap-0.5 text-[10px] text-green-600">
                      <DollarSign size={9} /> {(c.account_credit / 100).toFixed(2)}
                    </span>
                  )}
                </div>
              </div>
              <ChevronRight size={13} className="text-gray-300 shrink-0" />
            </button>
          ))}

          <button
            onMouseDown={() => {
              setOpen(false);
              // TODO: open create customer modal
            }}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-primary font-medium border-t border-gray-100 hover:bg-primary-light transition-colors"
          >
            <User size={12} />
            Create new customer for &ldquo;{query}&rdquo;
          </button>
        </div>
      )}
    </div>
  );
}
