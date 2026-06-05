/**
 * FloorPlanEditorPage — /settings/floor-plan
 *
 * Drag-and-drop floor plan canvas. Tables are absolutely positioned on a dotted
 * 20px grid; drag to move (snap), drag the corner to resize, click to select and
 * edit properties. Positions persist via PATCH /tables/bulk-positions; property
 * edits (name/seats/section/shape) PATCH immediately. Section colors are derived
 * deterministically from the section name.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Save, Undo2, Redo2 } from 'lucide-react';
import { clsx } from 'clsx';
import { tables as tablesApi, type TableRow, type TableShape } from '../lib/api';
import { getLocationId } from '../lib/session';
import { showToast } from '../components/ui/Toast';

const GRID = 20;
const snap = (n: number) => Math.round(n / GRID) * GRID;

const SECTION_COLORS = ['#3B82F6', '#F59E0B', '#10B981', '#8B5CF6', '#EC4899', '#14B8A6', '#EF4444', '#6366F1'];
function sectionColor(section: string | null): string {
  if (!section) return '#94A3B8';
  let h = 0;
  for (let i = 0; i < section.length; i++) h = section.charCodeAt(i) + ((h << 5) - h);
  return SECTION_COLORS[Math.abs(h) % SECTION_COLORS.length];
}

type LocalTable = TableRow & { _dirtyPos?: boolean };

export function FloorPlanEditorPage() {
  const qc = useQueryClient();
  const locationId = getLocationId();
  const canvasRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['tables', locationId],
    queryFn:  () => tablesApi.list(locationId),
  });

  const [items, setItems] = useState<LocalTable[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [history, setHistory] = useState<LocalTable[][]>([]);
  const [future, setFuture] = useState<LocalTable[][]>([]);
  const sig = useRef('');

  useEffect(() => {
    if (!data) return;
    const s = data.map((t) => t.id).join(',');
    if (s !== sig.current) { sig.current = s; setItems(data.map((t) => ({ ...t }))); }
  }, [data]);

  const pushHistory = useCallback(() => {
    setHistory((h) => [...h.slice(-19), items.map((t) => ({ ...t }))]);
    setFuture([]);
  }, [items]);

  const selected = items.find((t) => t.id === selectedId) ?? null;

  // ── Drag / resize ──────────────────────────────────────────────────────────
  const drag = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number; mode: 'move' | 'resize'; origW: number; origH: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent, t: LocalTable, mode: 'move' | 'resize') => {
    e.stopPropagation();
    setSelectedId(t.id);
    pushHistory();
    drag.current = { id: t.id, startX: e.clientX, startY: e.clientY, origX: Number(t.position_x), origY: Number(t.position_y), mode, origW: Number(t.width), origH: Number(t.height) };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
    setItems((its) => its.map((t) => {
      if (t.id !== d.id) return t;
      if (d.mode === 'move') {
        return { ...t, position_x: Math.max(0, snap(d.origX + dx)), position_y: Math.max(0, snap(d.origY + dy)), _dirtyPos: true };
      }
      return { ...t, width: Math.max(40, snap(d.origW + dx)), height: Math.max(40, snap(d.origH + dy)), _dirtyPos: true };
    }));
  };

  const onPointerUp = () => { drag.current = null; };

  // ── Mutations ──────────────────────────────────────────────────────────────
  const addTable = async () => {
    try {
      const n = items.length + 1;
      const created = await tablesApi.create({ name: `T${n}`, seats: 4, positionX: 40, positionY: 40, width: 80, height: 80, shape: 'rectangle', locationId });
      pushHistory();
      setItems((its) => [...its, { ...created }]);
      setSelectedId(created.id);
    } catch (e) { showToast.error(e instanceof Error ? e.message : 'Add failed'); }
  };

  const deleteTable = async (id: string) => {
    if (!window.confirm('Delete this table?')) return;
    try {
      await tablesApi.remove(id);
      setItems((its) => its.filter((t) => t.id !== id));
      if (selectedId === id) setSelectedId(null);
    } catch (e) { showToast.error(e instanceof Error ? e.message : 'Delete failed'); }
  };

  const patchProp = async (id: string, patch: Partial<TableRow>) => {
    setItems((its) => its.map((t) => t.id === id ? { ...t, ...patch } : t));
    try {
      await tablesApi.update(id, {
        name: patch.name, section: patch.section, seats: patch.seats, shape: patch.shape as TableShape | undefined,
      });
    } catch (e) { showToast.error(e instanceof Error ? e.message : 'Update failed'); }
  };

  const saveLayout = async () => {
    const dirty = items.filter((t) => t._dirtyPos);
    if (dirty.length === 0) { showToast.info('No position changes to save'); return; }
    try {
      await tablesApi.bulkPositions(dirty.map((t) => ({ id: t.id, positionX: Number(t.position_x), positionY: Number(t.position_y), width: Number(t.width), height: Number(t.height) })));
      setItems((its) => its.map((t) => ({ ...t, _dirtyPos: false })));
      void qc.invalidateQueries({ queryKey: ['tables', locationId] });
      showToast.success('Floor plan saved');
    } catch (e) { showToast.error(e instanceof Error ? e.message : 'Save failed'); }
  };

  const undo = () => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setFuture((f) => [items.map((t) => ({ ...t })), ...f]);
      setItems(prev.map((t) => ({ ...t, _dirtyPos: true })));
      return h.slice(0, -1);
    });
  };
  const redo = () => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[0];
      setHistory((h) => [...h, items.map((t) => ({ ...t }))]);
      setItems(next.map((t) => ({ ...t, _dirtyPos: true })));
      return f.slice(1);
    });
  };

  const sections = Array.from(new Set(items.map((t) => t.section).filter(Boolean))) as string[];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 md:px-6 py-3 border-b border-gray-100 bg-white shrink-0 flex items-center gap-2 flex-wrap">
        <h1 className="text-lg font-bold text-gray-900 mr-2">Floor Plan</h1>
        <button onClick={addTable} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary-dark"><Plus size={15} /> Add Table</button>
        <button onClick={undo} disabled={history.length === 0} className="p-2 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40"><Undo2 size={15} /></button>
        <button onClick={redo} disabled={future.length === 0} className="p-2 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40"><Redo2 size={15} /></button>
        <div className="flex-1" />
        {sections.length > 0 && (
          <div className="flex items-center gap-2 mr-2">
            {sections.map((s) => (
              <span key={s} className="flex items-center gap-1 text-xs text-gray-500">
                <span className="w-3 h-3 rounded-full" style={{ background: sectionColor(s) }} />{s}
              </span>
            ))}
          </div>
        )}
        <button onClick={saveLayout} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 text-white text-sm font-semibold rounded-md hover:bg-gray-900"><Save size={15} /> Save</button>
      </div>

      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Canvas */}
        <div className="flex-1 overflow-auto bg-gray-50 p-4" onClick={() => setSelectedId(null)}>
          <div
            ref={canvasRef}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            className="relative bg-white rounded-lg border border-gray-200 mx-auto"
            style={{
              width: 900, height: 600,
              backgroundImage: 'radial-gradient(#e5e7eb 1px, transparent 1px)',
              backgroundSize: `${GRID}px ${GRID}px`,
            }}
          >
            {isLoading ? (
              <p className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">Loading…</p>
            ) : items.length === 0 ? (
              <p className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">Add a table to get started</p>
            ) : items.map((t) => {
              const color = sectionColor(t.section);
              const isSel = t.id === selectedId;
              return (
                <div
                  key={t.id}
                  onPointerDown={(e) => onPointerDown(e, t, 'move')}
                  className={clsx('absolute flex flex-col items-center justify-center text-center cursor-move select-none touch-none transition-shadow',
                    t.shape === 'circle' ? 'rounded-full' : 'rounded-lg', isSel ? 'ring-2 ring-primary shadow-lg z-10' : 'shadow-sm')}
                  style={{ left: Number(t.position_x), top: Number(t.position_y), width: Number(t.width), height: Number(t.height), background: color + '22', border: `2px solid ${color}` }}
                >
                  <span className="text-xs font-bold" style={{ color }}>{t.name}</span>
                  <span className="text-[10px] text-gray-500">{t.seats} seats</span>
                  {isSel && (
                    <div
                      onPointerDown={(e) => onPointerDown(e, t, 'resize')}
                      className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-primary rounded-full cursor-nwse-resize border-2 border-white"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Properties panel */}
        <aside className="w-64 shrink-0 border-l border-gray-100 bg-white overflow-y-auto p-4">
          {selected ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-900">Table properties</h3>
                <button onClick={() => deleteTable(selected.id)} className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>
              </div>
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">Name</label>
                <input value={selected.name} onChange={(e) => patchProp(selected.id, { name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm" /></div>
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">Seats</label>
                <input type="number" min={1} value={selected.seats} onChange={(e) => patchProp(selected.id, { seats: parseInt(e.target.value, 10) || 1 })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm" /></div>
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">Section</label>
                <input list="sections" value={selected.section ?? ''} onChange={(e) => patchProp(selected.id, { section: e.target.value || null })}
                  placeholder="Main, Bar, Patio…" className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm" />
                <datalist id="sections">{sections.map((s) => <option key={s} value={s} />)}</datalist></div>
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">Shape</label>
                <select value={selected.shape} onChange={(e) => patchProp(selected.id, { shape: e.target.value as TableShape })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm bg-white">
                  <option value="rectangle">Rectangle</option><option value="square">Square</option><option value="circle">Circle</option>
                </select></div>
              <p className="text-[11px] text-gray-400 pt-2 border-t border-gray-100">Drag the table to move, drag the corner to resize, then Save.</p>
            </div>
          ) : (
            <p className="text-sm text-gray-400">Select a table to edit its properties, or add a new one.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
