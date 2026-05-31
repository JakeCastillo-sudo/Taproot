import { getPublisher, getSubscriber, CHANNELS } from '../db/redis';
import type { OrderEvent, OrderEventType } from '@taproot/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

export type { OrderEvent };

// ─── publishOrderEvent ────────────────────────────────────────────────────────

export async function publishOrderEvent(event: OrderEvent): Promise<void> {
  const pub = getPublisher();
  const channel = CHANNELS.orders(event.locationId);
  const payload = JSON.stringify(event);

  try {
    await pub.publish(channel, payload);

    // Also publish to KDS channel for kitchen-relevant events
    const kdsEvents: OrderEventType[] = [
      'order:created', 'order:updated', 'order:item:added',
      'order:item:voided', 'order:fired',
    ];
    if (kdsEvents.includes(event.type)) {
      await pub.publish(CHANNELS.kds(event.locationId), payload);
    }

    // Inventory alerts go to inventory channel
    const inventoryEvents: OrderEventType[] = [
      'inventory:low_stock', 'inventory:stockout_imminent',
    ];
    if (inventoryEvents.includes(event.type)) {
      await pub.publish(CHANNELS.inventory(event.locationId), payload);
    }
  } catch (err) {
    // Redis publish failure is non-fatal — log and continue
    console.error('[realtime] Failed to publish event:', (err as Error).message);
  }
}

// ─── subscribeToLocation ──────────────────────────────────────────────────────
// Returns an unsubscribe function.

export function subscribeToLocation(
  locationId: string,
  callback: (event: OrderEvent) => void,
): () => void {
  const sub = getSubscriber();
  const channel = CHANNELS.orders(locationId);

  sub.subscribe(channel).catch((err) => {
    console.error('[realtime] Subscribe error:', (err as Error).message);
  });

  const handler = (chan: string, message: string) => {
    if (chan !== channel) return;
    try {
      callback(JSON.parse(message) as OrderEvent);
    } catch {
      // malformed message — ignore
    }
  };

  sub.on('message', handler);

  return () => {
    sub.unsubscribe(channel).catch(() => { /* ignore */ });
    sub.off('message', handler);
  };
}

// ─── subscribeToKDS ───────────────────────────────────────────────────────────

export function subscribeToKDS(
  locationId: string,
  callback: (event: OrderEvent) => void,
): () => void {
  const sub = getSubscriber();
  const channel = CHANNELS.kds(locationId);

  sub.subscribe(channel).catch((err) => {
    console.error('[realtime] KDS subscribe error:', (err as Error).message);
  });

  const handler = (chan: string, message: string) => {
    if (chan !== channel) return;
    try {
      callback(JSON.parse(message) as OrderEvent);
    } catch {
      // ignore
    }
  };

  sub.on('message', handler);

  return () => {
    sub.unsubscribe(channel).catch(() => { /* ignore */ });
    sub.off('message', handler);
  };
}

// ─── buildEvent ───────────────────────────────────────────────────────────────

export function buildEvent(
  type: OrderEventType,
  locationId: string,
  orderId?: string,
  payload: Record<string, unknown> = {},
): OrderEvent {
  return {
    type,
    locationId,
    orderId,
    payload,
    timestamp: new Date().toISOString(),
  };
}
