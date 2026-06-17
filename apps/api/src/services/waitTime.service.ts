/**
 * waitTime.service — Smart, queue-aware wait-time engine (FEAT-WAIT-001).
 *
 * Estimates how long a new order will take RIGHT NOW from:
 *   (open kitchen queue item count × avg minutes per item) + base prep time
 *   + rush buffer (manual), capped at a configured maximum.
 *
 * The per-item average is learned from the last 7 days of completed orders,
 * preferring orders from a similar time of day (busy lunch ≠ quiet afternoon).
 *
 * Config lives in locations.settings.waitTime (jsonb) — NO migration, same
 * pattern as onlineOrdering / loyalty (see settings.routes.ts).
 *
 * Philosophy: accurate, honest, tunable. Round UP — a longer estimate is far
 * better than a customer/driver showing up to a not-ready order. calculateWaitTime
 * NEVER throws: on any failure it degrades to a base-prep estimate.
 *
 * Money is irrelevant here; all values are MINUTES.
 */

import { query } from '../db/client';

// ── Types ───────────────────────────────────────────────────────────────────────

export interface WaitTimeConfig {
  enabled: boolean;
  basePrepMinutes: number;       // minimum time for any order
  minutesPerItem: number;        // fallback per-item time when no history yet
  rushMode: boolean;
  rushExtraMinutes: number;
  rushModeExpiresAt: string | null; // ISO timestamp; auto-clears on read
  maxWaitMinutes: number;        // caps the displayed estimate
  showOnPublicMenu: boolean;
  autoPauseEnabled: boolean;
  autoPauseThreshold: number;    // queue item count (reserved for Phase 4)
}

export interface WaitTimeResult {
  estimatedMinutes: number;      // rounded UP to nearest 5 (display)
  estimatedMinutesRaw: number;   // exact, for calculations
  confidence: 'high' | 'medium' | 'low';
  queueDepth: number;            // open order count
  queueItemCount: number;        // total items across open orders
  avgItemMinutes: number;        // per-item minutes used in the estimate
  rushMode: boolean;
  rushExtraMinutes: number;
  dataPoints: number;            // completed orders the average is based on
  displayText: string;           // "~18 min" / "~15-25 min" / "~20 min (estimate)"
  lastUpdated: string;           // ISO timestamp
}

// ── Default config ───────────────────────────────────────────────────────────────

export const DEFAULT_WAIT_CONFIG: WaitTimeConfig = {
  enabled: true,
  basePrepMinutes: 10,
  minutesPerItem: 0.5,
  rushMode: false,
  rushExtraMinutes: 15,
  rushModeExpiresAt: null,
  maxWaitMinutes: 60,
  showOnPublicMenu: true,
  autoPauseEnabled: false,
  autoPauseThreshold: 20,
};

// ── Read config (auto-expires rush mode) ──────────────────────────────────────────

export async function getWaitTimeConfig(locationId: string): Promise<WaitTimeConfig> {
  const { rows } = await query<{ settings: { waitTime?: Partial<WaitTimeConfig> } | null }>(
    `SELECT settings FROM locations WHERE id = $1`,
    [locationId],
  );
  if (!rows.length) return { ...DEFAULT_WAIT_CONFIG };

  const saved = rows[0].settings?.waitTime ?? {};
  const cfg: WaitTimeConfig = { ...DEFAULT_WAIT_CONFIG, ...saved };

  // Auto-expire a stale rush mode and persist the reset.
  if (cfg.rushMode && cfg.rushModeExpiresAt && new Date(cfg.rushModeExpiresAt) < new Date()) {
    cfg.rushMode = false;
    cfg.rushModeExpiresAt = null;
    await saveWaitTimeConfig(locationId, { rushMode: false, rushModeExpiresAt: null });
  }

  return cfg;
}

// ── Save config (shallow-merge into settings.waitTime) ─────────────────────────────
//
// Matches settings.routes.ts: jsonb_set(COALESCE(settings,'{}') , '{waitTime}',
//   COALESCE(settings->'waitTime','{}') || $2::jsonb). Only the provided keys change.

export async function saveWaitTimeConfig(locationId: string, cfg: Partial<WaitTimeConfig>): Promise<void> {
  await query(
    `UPDATE locations
        SET settings = jsonb_set(
              COALESCE(settings, '{}'::jsonb),
              '{waitTime}',
              COALESCE(settings->'waitTime', '{}'::jsonb) || $2::jsonb
            ),
            updated_at = now()
      WHERE id = $1`,
    [locationId, JSON.stringify(cfg)],
  );
}

// ── Toggle rush mode (auto-expires after durationMinutes) ──────────────────────────

export async function setRushMode(
  locationId: string,
  enabled: boolean,
  extraMinutes?: number,
  durationMinutes?: number,
): Promise<void> {
  const expiresAt = enabled && durationMinutes
    ? new Date(Date.now() + durationMinutes * 60 * 1000).toISOString()
    : null;
  const patch: Partial<WaitTimeConfig> = {
    rushMode: enabled,
    rushModeExpiresAt: expiresAt,
  };
  if (extraMinutes != null) patch.rushExtraMinutes = extraMinutes;
  await saveWaitTimeConfig(locationId, patch);
}

// ── Current queue load (open, unbumped tickets) ────────────────────────────────────

export async function getQueueLoad(
  orgId: string,
  locationId: string,
): Promise<{ orderCount: number; itemCount: number; oldestTicketAgeMinutes: number }> {
  const { rows } = await query<{ order_count: string; item_count: string; oldest_age_minutes: string }>(
    `SELECT
        COUNT(DISTINCT o.id)                                            AS order_count,
        COALESCE(SUM(
          (SELECT COUNT(*) FROM order_line_items li
            WHERE li.order_id = o.id AND li.voided_at IS NULL)
        ), 0)                                                           AS item_count,
        COALESCE(EXTRACT(EPOCH FROM (now() - MIN(o.created_at))) / 60, 0) AS oldest_age_minutes
       FROM orders o
      WHERE o.organization_id = $1
        AND o.location_id = $2
        AND o.status IN ('open', 'in_progress')
        AND (o.metadata->'kitchen'->>'bumpedAt') IS NULL
        AND o.voided_at IS NULL`,
    [orgId, locationId],
  );
  const r = rows[0];
  return {
    orderCount: parseInt(r?.order_count ?? '0', 10) || 0,
    itemCount: parseInt(r?.item_count ?? '0', 10) || 0,
    oldestTicketAgeMinutes: parseFloat(r?.oldest_age_minutes ?? '0') || 0,
  };
}

// ── Historical average minutes per item (time-of-day weighted, 7-day window) ───────

export async function getAvgItemMinutes(
  orgId: string,
  locationId: string,
): Promise<{ avgMinutes: number; dataPoints: number }> {
  const currentHour = new Date().getHours();

  const perItemAvgSql = (todWindow: boolean) => `
    SELECT
      COUNT(*) AS data_points,
      AVG(
        EXTRACT(EPOCH FROM (o.fulfilled_at - o.created_at)) / 60
        / NULLIF((
            SELECT COUNT(*) FROM order_line_items li
             WHERE li.order_id = o.id AND li.voided_at IS NULL
          ), 0)
      ) AS avg_minutes_per_item
     FROM orders o
    WHERE o.organization_id = $1
      AND o.location_id = $2
      AND o.status = 'completed'
      AND o.fulfilled_at IS NOT NULL
      AND o.fulfilled_at > o.created_at
      AND o.created_at > now() - INTERVAL '7 days'
      ${todWindow ? 'AND ABS(EXTRACT(hour FROM o.created_at) - $3) <= 2' : ''}`;

  const tod = await query<{ data_points: string; avg_minutes_per_item: string | null }>(
    perItemAvgSql(true),
    [orgId, locationId, currentHour],
  );
  const todPoints = parseInt(tod.rows[0]?.data_points ?? '0', 10) || 0;

  if (todPoints >= 3) {
    return {
      avgMinutes: parseFloat(tod.rows[0]?.avg_minutes_per_item ?? '0') || 0,
      dataPoints: todPoints,
    };
  }

  // Not enough time-of-day data — fall back to the all-day 7-day average.
  const all = await query<{ data_points: string; avg_minutes_per_item: string | null }>(
    perItemAvgSql(false),
    [orgId, locationId],
  );
  return {
    avgMinutes: parseFloat(all.rows[0]?.avg_minutes_per_item ?? '0') || 0,
    dataPoints: parseInt(all.rows[0]?.data_points ?? '0', 10) || 0,
  };
}

// ── MAIN: calculate the current wait time (never throws) ───────────────────────────

export async function calculateWaitTime(orgId: string, locationId: string): Promise<WaitTimeResult> {
  let cfg: WaitTimeConfig = { ...DEFAULT_WAIT_CONFIG };
  let queue = { orderCount: 0, itemCount: 0, oldestTicketAgeMinutes: 0 };
  let historical = { avgMinutes: 0, dataPoints: 0 };

  try {
    [cfg, queue, historical] = await Promise.all([
      getWaitTimeConfig(locationId),
      getQueueLoad(orgId, locationId),
      getAvgItemMinutes(orgId, locationId),
    ]);
  } catch {
    // Degrade gracefully — keep the safe defaults above.
  }

  // Confidence from how much history backs the per-item average.
  const confidence: WaitTimeResult['confidence'] =
    historical.dataPoints >= 10 ? 'high' : historical.dataPoints >= 3 ? 'medium' : 'low';

  // Per-item minutes: learned average → configured fallback → base/5 heuristic.
  const effectiveAvgPerItem =
    historical.avgMinutes > 0
      ? historical.avgMinutes
      : cfg.minutesPerItem > 0
        ? cfg.minutesPerItem
        : cfg.basePrepMinutes / 5;

  const queueTime = queue.itemCount * effectiveAvgPerItem;
  const rushAdd = cfg.rushMode ? cfg.rushExtraMinutes : 0;
  // Never below base prep; add rush buffer; cap at the configured max.
  const rawMinutes = Math.max(queueTime + cfg.basePrepMinutes, cfg.basePrepMinutes) + rushAdd;
  const cappedMinutes = Math.min(rawMinutes, cfg.maxWaitMinutes);

  // Round UP to the nearest 5 (late is worse than a longer estimate), min 5.
  const roundedMinutes = Math.max(5, Math.ceil(cappedMinutes / 5) * 5);

  let displayText: string;
  if (confidence === 'high') {
    displayText = `~${roundedMinutes} min`;
  } else if (confidence === 'medium') {
    const lo = Math.max(roundedMinutes - 5, 5);
    const hi = roundedMinutes + 5;
    displayText = `~${lo}-${hi} min`;
  } else {
    displayText = `~${roundedMinutes} min (estimate)`;
  }

  return {
    estimatedMinutes: roundedMinutes,
    estimatedMinutesRaw: cappedMinutes,
    confidence,
    queueDepth: queue.orderCount,
    queueItemCount: queue.itemCount,
    avgItemMinutes: Math.round(effectiveAvgPerItem * 100) / 100,
    rushMode: cfg.rushMode,
    rushExtraMinutes: cfg.rushExtraMinutes,
    dataPoints: historical.dataPoints,
    displayText,
    lastUpdated: new Date().toISOString(),
  };
}

// ── Accuracy history — actual avg prep per day, last 7 days ────────────────────────
//
// We don't persist past *estimates*, so this reports the ACTUAL average prep time
// (fulfilled_at − created_at) per day plus order volume — the honest signal an owner
// uses to tune basePrepMinutes. Returns most-recent first.

export interface WaitAccuracyDay {
  date: string;        // YYYY-MM-DD
  actualAvgMinutes: number;
  orders: number;
}

export async function getAccuracyHistory(orgId: string, locationId: string): Promise<WaitAccuracyDay[]> {
  try {
    const { rows } = await query<{ day: string; actual_avg: string | null; orders: string }>(
      `SELECT to_char(date_trunc('day', o.created_at), 'YYYY-MM-DD') AS day,
              AVG(EXTRACT(EPOCH FROM (o.fulfilled_at - o.created_at)) / 60)  AS actual_avg,
              COUNT(*)                                                        AS orders
         FROM orders o
        WHERE o.organization_id = $1
          AND o.location_id = $2
          AND o.status = 'completed'
          AND o.fulfilled_at IS NOT NULL
          AND o.fulfilled_at > o.created_at
          AND o.created_at > now() - INTERVAL '7 days'
        GROUP BY 1
        ORDER BY 1 DESC`,
      [orgId, locationId],
    );
    return rows.map((r) => ({
      date: r.day,
      actualAvgMinutes: Math.round((parseFloat(r.actual_avg ?? '0') || 0) * 10) / 10,
      orders: parseInt(r.orders ?? '0', 10) || 0,
    }));
  } catch {
    return [];
  }
}
