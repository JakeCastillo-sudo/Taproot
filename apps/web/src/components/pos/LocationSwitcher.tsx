/**
 * LocationSwitcher — switch the active location (multi-location orgs).
 * Persists to localStorage (session.setActiveLocationId) and reloads so every
 * query refetches against the new location.
 */

import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapPin, ChevronDown, Check } from 'lucide-react';
import { clsx } from 'clsx';
import { locations as locationsApi } from '../../lib/api';
import { getLocationId, setActiveLocationId } from '../../lib/session';

export function LocationSwitcher() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const activeId = getLocationId();

  const { data: locs } = useQuery({ queryKey: ['locations'], queryFn: () => locationsApi.list(), staleTime: 5 * 60_000 });
  const list = locs ?? [];
  const active = list.find((l) => l.id === activeId);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  // Single location → just show the name (no switcher).
  if (list.length <= 1) {
    return <p className="text-[11px] text-gray-400 truncate">{active?.name ?? 'Location 1'}</p>;
  }

  const select = (id: string) => {
    if (id !== activeId) { setActiveLocationId(id); window.location.reload(); }
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-800 transition-colors max-w-full">
        <MapPin size={11} className="shrink-0 text-gray-400" />
        <span className="truncate">{active?.name ?? 'Select location'}</span>
        <ChevronDown size={11} className="shrink-0" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 left-0 w-48 bg-white rounded-lg shadow-xl border border-gray-100 py-1">
          {list.map((l) => (
            <button key={l.id} onClick={() => select(l.id)}
              className={clsx('w-full flex items-center justify-between gap-2 px-3 py-2 text-xs text-left hover:bg-gray-50', l.id === activeId && 'text-primary font-medium')}>
              <span className="truncate">{l.name}</span>
              {l.id === activeId && <Check size={12} className="shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
