/**
 * offlineQueue — IndexedDB-backed queue for orders placed while offline.
 *
 * When the network is down, the POS enqueues the full order + payment payload.
 * On reconnect, processQueue() replays each one (create order → process payment)
 * and marks it synced with the real order number.
 */

import { orders as ordersApi, payments as paymentsApi, type OrderCreateBody, type PaymentBody } from './api';

const DB_NAME = 'taproot-offline';
const STORE = 'orders';
const VERSION = 1;

export interface QueuedOrder {
  tempId:        string;
  locationId:    string;
  order:         Omit<OrderCreateBody, 'locationId'>;
  payment:       PaymentBody;
  createdAt:     string;
  syncStatus:    'pending' | 'syncing' | 'synced' | 'failed';
  realOrderNumber?: string;
  error?:        string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'tempId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueueOrder(locationId: string, order: Omit<OrderCreateBody, 'locationId'>, payment: PaymentBody): Promise<QueuedOrder> {
  const tempId = `TEMP-${Date.now().toString().slice(-8)}`;
  const entry: QueuedOrder = { tempId, locationId, order, payment, createdAt: new Date().toISOString(), syncStatus: 'pending' };
  await tx('readwrite', (s) => s.put(entry));
  return entry;
}

export async function getQueue(): Promise<QueuedOrder[]> {
  try {
    const all = await tx<QueuedOrder[]>('readonly', (s) => s.getAll());
    return all ?? [];
  } catch {
    return [];
  }
}

export async function pendingCount(): Promise<number> {
  return (await getQueue()).filter((q) => q.syncStatus === 'pending' || q.syncStatus === 'failed').length;
}

export async function clearSynced(): Promise<void> {
  const all = await getQueue();
  for (const q of all) if (q.syncStatus === 'synced') await tx('readwrite', (s) => s.delete(q.tempId));
}

/** Replay all pending/failed orders. Returns the number successfully synced. */
export async function processQueue(): Promise<number> {
  const all = await getQueue();
  let synced = 0;
  for (const q of all) {
    if (q.syncStatus === 'synced' || q.syncStatus === 'syncing') continue;
    try {
      await tx('readwrite', (s) => s.put({ ...q, syncStatus: 'syncing' }));
      const created = await ordersApi.create(q.locationId, q.order);
      await paymentsApi.process(q.locationId, created.id, q.payment);
      const realOrderNumber = (created as { order_number?: string }).order_number ?? created.id.slice(-6).toUpperCase();
      await tx('readwrite', (s) => s.put({ ...q, syncStatus: 'synced', realOrderNumber }));
      synced++;
    } catch (e) {
      await tx('readwrite', (s) => s.put({ ...q, syncStatus: 'failed', error: e instanceof Error ? e.message : 'sync failed' }));
    }
  }
  await clearSynced();
  return synced;
}
