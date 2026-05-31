import Redis from 'ioredis';
import { config } from '../config';

// ─── Singleton clients ────────────────────────────────────────────────────────
// Publisher and subscriber clients must be separate (SUBSCRIBE puts a client
// into subscriber mode, blocking it from sending other commands).

let _publisher: Redis | null = null;
let _subscriber: Redis | null = null;

function createClient(): Redis {
  const client = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    enableOfflineQueue: true,
    retryStrategy: (times) => Math.min(times * 100, 3000),
  });

  client.on('error', (err) => {
    // Non-fatal: Redis outage degrades real-time features but doesn't break ordering
    console.error('[redis] Connection error:', err.message);
  });

  return client;
}

export function getPublisher(): Redis {
  if (!_publisher) _publisher = createClient();
  return _publisher;
}

export function getSubscriber(): Redis {
  if (!_subscriber) _subscriber = createClient();
  return _subscriber;
}

// ─── Channel helpers ──────────────────────────────────────────────────────────

export const CHANNELS = {
  orders: (locationId: string) => `orders:${locationId}`,
  kds:    (locationId: string) => `kds:${locationId}`,
  inventory: (locationId: string) => `inventory:${locationId}`,
  offlineQueue: 'taproot:offline_payments',
} as const;

// ─── Graceful shutdown ────────────────────────────────────────────────────────

export async function closeRedis(): Promise<void> {
  await Promise.all([
    _publisher?.quit(),
    _subscriber?.quit(),
  ]);
  _publisher = null;
  _subscriber = null;
}
