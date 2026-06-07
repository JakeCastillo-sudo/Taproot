/**
 * cache — Redis read-through caching for expensive endpoints (S8-06).
 *
 *   const data = await getCached(`org:${orgId}:categories`, 300, () => listCategories(orgId));
 *
 * Best-effort: any Redis failure falls through to fetchFn, never breaks the
 * request. Invalidation is prefix-based (SCAN + DEL) so list endpoints with
 * many filter variants can be cleared with one call:
 *
 *   await invalidatePrefix(`org:${orgId}:products`);
 *
 * Key convention: org:{orgId}:{domain}[:variant]
 */

import { getPublisher } from '../db/redis';

export async function getCached<T>(
  key: string,
  ttlSeconds: number,
  fetchFn: () => Promise<T>,
): Promise<T> {
  try {
    const raw = await getPublisher().get(key);
    if (raw) return JSON.parse(raw) as T;
  } catch { /* fall through to fetch */ }

  const value = await fetchFn();

  try {
    await getPublisher().set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch { /* cache write is best-effort */ }

  return value;
}

/** Delete every key starting with `prefix` (SCAN-based — safe for prod). */
export async function invalidatePrefix(prefix: string): Promise<void> {
  try {
    const redis = getPublisher();
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== '0');
  } catch { /* invalidation is best-effort — TTL is the backstop */ }
}

/** Org-scoped cache invalidation for product/category/report caches. */
export async function invalidateOrgCache(
  orgId: string,
  domains: Array<'products' | 'categories' | 'reports'>,
): Promise<void> {
  await Promise.all(domains.map((d) => invalidatePrefix(`org:${orgId}:${d}`)));
}
