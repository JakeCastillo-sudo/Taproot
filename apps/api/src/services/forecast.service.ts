import { query } from '../db/client';
import type { StockoutForecast, UnitOfMeasure } from '@taproot/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BurnRateResult {
  productId: string;
  variantId: string | null;
  burnRatePerHour: number;   // units consumed per hour
  dataPoints: number;        // number of sale movements used
  windowHours: number;       // analysis window
  confidence: 'high' | 'medium' | 'low';
}

// ─── getBurnRate ──────────────────────────────────────────────────────────────
// Computes average hourly depletion from inventory_movements over a look-back window.

export async function getBurnRate(
  orgId: string,
  locationId: string,
  productId: string,
  variantId: string | null = null,
  windowHours = 168,          // default: 7 days
): Promise<BurnRateResult> {
  const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const { rows } = await query<{ total_depleted: string; data_points: string }>(
    `SELECT
       COALESCE(SUM(ABS(quantity_delta)), 0) AS total_depleted,
       COUNT(*) AS data_points
     FROM inventory_movements
     WHERE organization_id = $1
       AND location_id = $2
       AND product_id = $3
       AND (
         ($4::uuid IS NULL AND variant_id IS NULL)
         OR variant_id = $4
       )
       AND movement_type = 'sale'
       AND created_at >= $5`,
    [orgId, locationId, productId, variantId, windowStart],
  );

  const totalDepleted = parseFloat(rows[0]?.total_depleted ?? '0');
  const dataPoints = parseInt(rows[0]?.data_points ?? '0', 10);
  const burnRatePerHour = windowHours > 0 ? totalDepleted / windowHours : 0;

  // Confidence based on data point density (>=1/hour = high, >=1/4h = medium, else low)
  const pointsPerHour = dataPoints / windowHours;
  const confidence: 'high' | 'medium' | 'low' =
    pointsPerHour >= 1 ? 'high' :
    pointsPerHour >= 0.25 ? 'medium' : 'low';

  return { productId, variantId, burnRatePerHour, dataPoints, windowHours, confidence };
}

// ─── getTimeToStockout ────────────────────────────────────────────────────────

export async function getTimeToStockout(
  orgId: string,
  locationId: string,
  productId: string,
  variantId: string | null = null,
): Promise<{
  hoursUntilStockout: number | null;
  estimatedStockoutAt: Date | null;
  hoursUntilReorderPoint: number | null;
  reorderPointReached: boolean;
}> {
  // Get current inventory level
  const { rows: [level] } = await query<{
    quantity_on_hand: number;
    reorder_point: number | null;
  }>(
    `SELECT quantity_on_hand, reorder_point
     FROM inventory_levels
     WHERE organization_id = $1 AND location_id = $2 AND product_id = $3
       AND (
         ($4::uuid IS NULL AND variant_id IS NULL)
         OR variant_id = $4
       )`,
    [orgId, locationId, productId, variantId],
  );

  if (!level) {
    return { hoursUntilStockout: null, estimatedStockoutAt: null, hoursUntilReorderPoint: null, reorderPointReached: false };
  }

  const { burnRatePerHour } = await getBurnRate(orgId, locationId, productId, variantId);

  if (burnRatePerHour <= 0) {
    return {
      hoursUntilStockout: null,
      estimatedStockoutAt: null,
      hoursUntilReorderPoint: null,
      reorderPointReached: level.reorder_point !== null && level.quantity_on_hand <= level.reorder_point,
    };
  }

  const hoursUntilStockout = level.quantity_on_hand / burnRatePerHour;
  const estimatedStockoutAt = new Date(Date.now() + hoursUntilStockout * 60 * 60 * 1000);

  const reorderPointReached = level.reorder_point !== null && level.quantity_on_hand <= level.reorder_point;
  let hoursUntilReorderPoint: number | null = null;
  if (level.reorder_point !== null && level.quantity_on_hand > level.reorder_point) {
    hoursUntilReorderPoint = (level.quantity_on_hand - level.reorder_point) / burnRatePerHour;
  }

  return { hoursUntilStockout, estimatedStockoutAt, hoursUntilReorderPoint, reorderPointReached };
}

// ─── getForecastDashboard ─────────────────────────────────────────────────────
// Returns StockoutForecast for all actively tracked products at a location.
// Products with no inventory movement in windowHours are included but flagged low-confidence.

export async function getForecastDashboard(
  orgId: string,
  locationId: string,
  windowHours = 168,
  urgencyFilter?: 'critical' | 'warning' | 'ok',
): Promise<StockoutForecast[]> {
  // Fetch all active tracked products at this location
  const { rows: levels } = await query<{
    product_id: string;
    variant_id: string | null;
    quantity_on_hand: number;
    reorder_point: number | null;
    product_name: string;
    product_sku: string | null;
    unit_of_measure: UnitOfMeasure;
  }>(
    `SELECT il.product_id, il.variant_id, il.quantity_on_hand, il.reorder_point,
            p.name AS product_name, p.sku AS product_sku, p.unit_of_measure
     FROM inventory_levels il
     JOIN products p ON p.id = il.product_id
     WHERE il.organization_id = $1 AND il.location_id = $2
       AND p.track_inventory = true AND p.is_active = true AND p.deleted_at IS NULL`,
    [orgId, locationId],
  );

  if (!levels.length) return [];

  // Batch fetch burn rates using a single aggregation query
  const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const productIds = [...new Set(levels.map(l => l.product_id))];

  const { rows: burnRows } = await query<{
    product_id: string;
    variant_id: string | null;
    total_depleted: string;
    data_points: string;
  }>(
    `SELECT product_id, variant_id,
            COALESCE(SUM(ABS(quantity_delta)), 0) AS total_depleted,
            COUNT(*) AS data_points
     FROM inventory_movements
     WHERE organization_id = $1
       AND location_id = $2
       AND product_id = ANY($3::uuid[])
       AND movement_type = 'sale'
       AND created_at >= $4
     GROUP BY product_id, variant_id`,
    [orgId, locationId, productIds, windowStart],
  );

  // Build a lookup map: "productId:variantId" -> burn data
  const burnMap = new Map<string, { totalDepleted: number; dataPoints: number }>();
  for (const row of burnRows) {
    const key = `${row.product_id}:${row.variant_id ?? ''}`;
    burnMap.set(key, {
      totalDepleted: parseFloat(row.total_depleted),
      dataPoints: parseInt(row.data_points, 10),
    });
  }

  const forecasts: StockoutForecast[] = [];

  for (const level of levels) {
    const key = `${level.product_id}:${level.variant_id ?? ''}`;
    const burnData = burnMap.get(key) ?? { totalDepleted: 0, dataPoints: 0 };
    const burnRatePerHour = burnData.totalDepleted / windowHours;
    const pointsPerHour = burnData.dataPoints / windowHours;

    const confidence: 'high' | 'medium' | 'low' =
      pointsPerHour >= 1 ? 'high' :
      pointsPerHour >= 0.25 ? 'medium' : 'low';

    let hoursUntilStockout: number | null = null;
    let estimatedStockoutAt: Date | null = null;
    let hoursUntilReorderPoint: number | null = null;

    if (burnRatePerHour > 0) {
      hoursUntilStockout = level.quantity_on_hand / burnRatePerHour;
      estimatedStockoutAt = new Date(Date.now() + hoursUntilStockout * 60 * 60 * 1000);

      if (level.reorder_point !== null && level.quantity_on_hand > level.reorder_point) {
        hoursUntilReorderPoint = (level.quantity_on_hand - level.reorder_point) / burnRatePerHour;
      }
    }

    const reorderPointReached =
      level.reorder_point !== null && level.quantity_on_hand <= level.reorder_point;

    // Urgency classification:
    // critical = stockout within 24h OR already at/below reorder point with no data
    // warning  = stockout within 72h OR reorder point reached
    // ok       = everything else
    let urgency: 'critical' | 'warning' | 'ok';
    if (level.quantity_on_hand <= 0 || (hoursUntilStockout !== null && hoursUntilStockout <= 24)) {
      urgency = 'critical';
    } else if (reorderPointReached || (hoursUntilStockout !== null && hoursUntilStockout <= 72)) {
      urgency = 'warning';
    } else {
      urgency = 'ok';
    }

    if (urgencyFilter && urgency !== urgencyFilter) continue;

    forecasts.push({
      productId: level.product_id,
      productName: level.product_name,
      sku: level.product_sku,
      currentOnHand: level.quantity_on_hand,
      unit: level.unit_of_measure,
      burnRatePerHour,
      hoursUntilStockout,
      estimatedStockoutAt,
      reorderPointReached,
      hoursUntilReorderPoint,
      urgency,
      confidence,
      dataPoints: burnData.dataPoints,
    });
  }

  // Sort: critical first, then warning, then ok; within group sort by hoursUntilStockout ASC
  const urgencyOrder = { critical: 0, warning: 1, ok: 2 };
  forecasts.sort((a, b) => {
    const ud = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
    if (ud !== 0) return ud;
    const ah = a.hoursUntilStockout ?? Infinity;
    const bh = b.hoursUntilStockout ?? Infinity;
    return ah - bh;
  });

  return forecasts;
}
