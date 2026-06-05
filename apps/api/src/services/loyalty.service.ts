import { query } from '../db/client';
import { ValidationError } from '../errors';
import type { LoyaltyTier, LoyaltyTransaction } from '@taproot/shared';

// ─── Tier configuration ───────────────────────────────────────────────────────

export interface TierConfig {
  none:     number;   // minimum points
  bronze:   number;
  silver:   number;
  gold:     number;
  platinum: number;
}

const DEFAULT_TIER_THRESHOLDS: TierConfig = {
  none:     0,
  bronze:   0,
  silver:   500,
  gold:     2000,
  platinum: 5000,
};

export function getTierThresholds(): TierConfig {
  return { ...DEFAULT_TIER_THRESHOLDS };
}

// ─── Config (organizations.settings.loyalty) ──────────────────────────────────

export interface LoyaltyConfig {
  enabled:           boolean;
  pointsPerDollar:   number;   // points earned per $1
  redeemRate:        number;   // dollars per point (e.g. 0.01 = 1¢/pt)
  minimumRedemption: number;   // min points to redeem
  tiers:             TierConfig;
}

export async function getLoyaltyConfig(orgId: string): Promise<LoyaltyConfig> {
  const { rows: [org] } = await query<{ settings: { loyalty?: Partial<LoyaltyConfig> } }>(
    `SELECT settings FROM organizations WHERE id = $1`, [orgId],
  );
  const c = org?.settings?.loyalty ?? {};
  return {
    enabled:           c.enabled ?? true,
    pointsPerDollar:   c.pointsPerDollar ?? 1,
    redeemRate:        c.redeemRate ?? 0.01,
    minimumRedemption: c.minimumRedemption ?? 100,
    tiers:             { ...DEFAULT_TIER_THRESHOLDS, ...(c.tiers ?? {}) },
  };
}

function pointsToTier(points: number, t: TierConfig): LoyaltyTier {
  if (points >= t.platinum) return 'platinum';
  if (points >= t.gold)     return 'gold';
  if (points >= t.silver)   return 'silver';
  if (points >= t.bronze)   return 'bronze';
  return 'none';
}

// ─── awardPoints ──────────────────────────────────────────────────────────────

export async function awardPoints(
  orgId: string,
  customerId: string,
  orderId: string,
  orderTotal: number,
  employeeId: string,
): Promise<LoyaltyTransaction> {
  // Load org loyalty config from settings.loyalty
  const cfg = await getLoyaltyConfig(orgId);
  if (!cfg.enabled) {
    return {
      id: '', organization_id: orgId, customer_id: customerId, order_id: orderId,
      transaction_type: 'earn', points_delta: 0, points_before: 0, points_after: 0,
      notes: 'Loyalty disabled', created_at: new Date().toISOString(),
    };
  }
  const pointsDelta = Math.floor(orderTotal * cfg.pointsPerDollar);

  if (pointsDelta <= 0) {
    // Zero-value orders — still return a no-op transaction placeholder
    return {
      id: '', organization_id: orgId, customer_id: customerId, order_id: orderId,
      transaction_type: 'earn', points_delta: 0, points_before: 0, points_after: 0,
      notes: 'No points earned (zero-value order)', created_at: new Date().toISOString(),
    };
  }

  const { rows: [txn] } = await query<LoyaltyTransaction>(
    `WITH updated AS (
       UPDATE customers
       SET loyalty_points = loyalty_points + $1,
           updated_at     = now()
       WHERE id = $2 AND organization_id = $3
       RETURNING loyalty_points - $1 AS points_before, loyalty_points AS points_after
     )
     INSERT INTO loyalty_transactions
       (organization_id, customer_id, order_id, transaction_type,
        points_delta, points_before, points_after, notes)
     SELECT $3, $2, $4, 'earn',
            $1,
            u.points_before,
            u.points_after,
            $5
     FROM updated u
     RETURNING *`,
    [pointsDelta, customerId, orgId, orderId, `Earned from order`],
  );

  // Check for tier upgrade
  await checkTierUpgrade(orgId, customerId);

  return txn;
}

// ─── redeemPoints ─────────────────────────────────────────────────────────────
// Returns dollar value of redeemed points.

export async function redeemPoints(
  orgId: string,
  customerId: string,
  points: number,
  orderId: string,
  employeeId: string,
): Promise<number> {
  if (points <= 0) throw new ValidationError('Points to redeem must be greater than 0');

  // Load org redemption rate + customer current points
  const [cfg, { rows: [customer] }] = await Promise.all([
    getLoyaltyConfig(orgId),
    query<{ loyalty_points: number }>(
      `SELECT loyalty_points FROM customers WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [customerId, orgId],
    ),
  ]);

  if (!customer) throw new ValidationError('Customer not found');
  if (customer.loyalty_points < points) {
    throw new ValidationError(
      `Insufficient loyalty points: ${customer.loyalty_points} available, ${points} requested`,
    );
  }

  const redemptionRate = cfg.redeemRate;
  const minRedemption  = cfg.minimumRedemption;

  if (points < minRedemption) {
    throw new ValidationError(`Minimum redemption is ${minRedemption} points`);
  }

  const dollarValue = points * redemptionRate;

  await query(
    `WITH updated AS (
       UPDATE customers
       SET loyalty_points = loyalty_points - $1,
           updated_at     = now()
       WHERE id = $2 AND organization_id = $3
       RETURNING loyalty_points + $1 AS points_before, loyalty_points AS points_after
     )
     INSERT INTO loyalty_transactions
       (organization_id, customer_id, order_id, transaction_type,
        points_delta, points_before, points_after, notes)
     SELECT $3, $2, $4, 'redeem',
            -$1,
            u.points_before,
            u.points_after,
            $5
     FROM updated u`,
    [points, customerId, orgId, orderId, `Redeemed ${points} points ($${dollarValue.toFixed(2)})`],
  );

  return dollarValue;
}

// ─── checkTierUpgrade ─────────────────────────────────────────────────────────

export async function checkTierUpgrade(
  orgId: string,
  customerId: string,
): Promise<boolean> {
  const { rows: [customer] } = await query<{ loyalty_points: number; loyalty_tier: LoyaltyTier }>(
    `SELECT loyalty_points, loyalty_tier FROM customers WHERE id = $1 AND organization_id = $2`,
    [customerId, orgId],
  );
  if (!customer) return false;

  const cfg = await getLoyaltyConfig(orgId);
  const newTier = pointsToTier(customer.loyalty_points, cfg.tiers);
  if (newTier === customer.loyalty_tier) return false;

  await query(
    `UPDATE customers SET loyalty_tier = $1, updated_at = now() WHERE id = $2`,
    [newTier, customerId],
  );
  return true;
}

// ─── adjustPoints (manual adjustment) ────────────────────────────────────────

export async function adjustPoints(
  orgId: string,
  customerId: string,
  delta: number,
  notes: string,
  employeeId: string,
): Promise<LoyaltyTransaction> {
  const { rows: [txn] } = await query<LoyaltyTransaction>(
    `WITH updated AS (
       UPDATE customers
       SET loyalty_points = GREATEST(0, loyalty_points + $1),
           updated_at = now()
       WHERE id = $2 AND organization_id = $3
       RETURNING
         CASE WHEN loyalty_points + $1 < 0 THEN loyalty_points
              ELSE loyalty_points - $1
         END AS points_before,
         GREATEST(0, loyalty_points) AS points_after
     )
     INSERT INTO loyalty_transactions
       (organization_id, customer_id, order_id, transaction_type,
        points_delta, points_before, points_after, notes)
     SELECT $3, $2, NULL, 'adjust',
            $1, u.points_before, u.points_after, $4
     FROM updated u
     RETURNING *`,
    [delta, customerId, orgId, notes],
  );

  await checkTierUpgrade(orgId, customerId);
  return txn;
}
