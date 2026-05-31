import { query, withTransaction } from '../db/client';
import { createAuditLog } from '../auth/audit';
import { ValidationError, NotFoundError } from '../errors';
import { getTheoreticalUsage } from './recipe.service';
import type { VarianceReport, VarianceReportLine } from '@taproot/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VarianceReportWithLines extends VarianceReport {
  lines: VarianceReportLine[];
}

export interface GenerateReportOptions {
  flagThresholdPct?: number;    // flag lines with abs(variance_pct) >= this value; default 10%
}

// ─── generateVarianceReport ───────────────────────────────────────────────────
// Creates a draft variance report for a period.
// opening_quantity = quantity_on_hand at period start (derived from movements)
// received_quantity = sum of po_receipt movements in period
// actual_usage = opening + received - closing
// theoretical_usage = from recipe depletion calculations
// variance_delta = actual_usage - theoretical_usage
// variance_pct = variance_delta / theoretical_usage * 100 (null when theoretical = 0)

export async function generateVarianceReport(
  orgId: string,
  locationId: string,
  periodStart: Date,
  periodEnd: Date,
  employeeId: string,
  options: GenerateReportOptions = {},
): Promise<VarianceReportWithLines> {
  if (periodEnd <= periodStart) {
    throw new ValidationError('periodEnd must be after periodStart');
  }
  if (periodEnd > new Date()) {
    throw new ValidationError('periodEnd cannot be in the future');
  }

  const flagThresholdPct = options.flagThresholdPct ?? 10;

  // Verify location belongs to org
  const { rows: [loc] } = await query(
    `SELECT id FROM locations WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [locationId, orgId],
  );
  if (!loc) throw new ValidationError('Location not found in this organization');

  // Get all products tracked at this location
  const { rows: trackedProducts } = await query<{
    product_id: string;
    variant_id: string | null;
    quantity_on_hand: number;  // current (closing) quantity
  }>(
    `SELECT il.product_id, il.variant_id, il.quantity_on_hand
     FROM inventory_levels il
     JOIN products p ON p.id = il.product_id
     WHERE il.organization_id = $1 AND il.location_id = $2
       AND p.track_inventory = true AND p.deleted_at IS NULL`,
    [orgId, locationId],
  );

  if (!trackedProducts.length) {
    throw new ValidationError('No tracked inventory found at this location');
  }

  const productIds = [...new Set(trackedProducts.map(tp => tp.product_id))];

  // ── 1. Get received quantities (po_receipt movements in period) ──
  const { rows: receiptRows } = await query<{
    product_id: string;
    variant_id: string | null;
    received_qty: string;
  }>(
    `SELECT product_id, variant_id, SUM(quantity_delta) AS received_qty
     FROM inventory_movements
     WHERE organization_id = $1 AND location_id = $2
       AND product_id = ANY($3::uuid[])
       AND movement_type = 'po_receipt'
       AND created_at >= $4 AND created_at < $5
     GROUP BY product_id, variant_id`,
    [orgId, locationId, productIds, periodStart, periodEnd],
  );

  const receivedMap = new Map<string, number>();
  for (const row of receiptRows) {
    receivedMap.set(`${row.product_id}:${row.variant_id ?? ''}`, parseFloat(row.received_qty));
  }

  // ── 2. Reconstruct opening quantity ──
  // opening = closing - (sum of all deltas during period)
  const { rows: deltaRows } = await query<{
    product_id: string;
    variant_id: string | null;
    period_delta: string;
  }>(
    `SELECT product_id, variant_id, SUM(quantity_delta) AS period_delta
     FROM inventory_movements
     WHERE organization_id = $1 AND location_id = $2
       AND product_id = ANY($3::uuid[])
       AND created_at >= $4 AND created_at < $5
     GROUP BY product_id, variant_id`,
    [orgId, locationId, productIds, periodStart, periodEnd],
  );

  const periodDeltaMap = new Map<string, number>();
  for (const row of deltaRows) {
    periodDeltaMap.set(`${row.product_id}:${row.variant_id ?? ''}`, parseFloat(row.period_delta));
  }

  // ── 3. Get theoretical usage for the period ──
  const theoretical = await getTheoreticalUsage(orgId, locationId, productIds, periodStart, periodEnd);
  const theoreticalMap = new Map<string, number>();
  for (const t of theoretical) {
    theoreticalMap.set(t.ingredientProductId, t.theoreticalQty);
  }

  // ── 4. Create report + lines in a transaction ──
  let reportId!: string;

  await withTransaction(async (client) => {
    const { rows: [report] } = await client.query<{ id: string }>(
      `INSERT INTO variance_reports
         (organization_id, location_id, period_start, period_end, status, generated_by)
       VALUES ($1,$2,$3,$4,'draft',$5)
       RETURNING id`,
      [orgId, locationId, periodStart, periodEnd, employeeId],
    );
    reportId = report.id;

    for (const tp of trackedProducts) {
      const key = `${tp.product_id}:${tp.variant_id ?? ''}`;
      const periodDelta = periodDeltaMap.get(key) ?? 0;
      const openingQuantity = tp.quantity_on_hand - periodDelta;
      const receivedQuantity = receivedMap.get(key) ?? 0;

      // actual_usage = opening + received - closing
      const actualUsage = openingQuantity + receivedQuantity - tp.quantity_on_hand;

      // theoretical_usage from recipe calculations (keyed by product_id only, no variant for now)
      const theoreticalUsage = theoreticalMap.get(tp.product_id) ?? 0;

      const varianceDelta = actualUsage - theoreticalUsage;
      const variancePct = theoreticalUsage !== 0
        ? (varianceDelta / theoreticalUsage) * 100
        : actualUsage !== 0 ? 100 : 0;

      const isFlagged = Math.abs(variancePct) >= flagThresholdPct;

      await client.query(
        `INSERT INTO variance_report_lines
           (report_id, product_id, variant_id,
            opening_quantity, closing_quantity, received_quantity,
            theoretical_usage, actual_usage,
            variance_delta, variance_pct,
            is_flagged, flag_threshold, ai_suggested_causes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          reportId, tp.product_id, tp.variant_id ?? null,
          openingQuantity, tp.quantity_on_hand, receivedQuantity,
          theoreticalUsage, actualUsage,
          varianceDelta, variancePct,
          isFlagged, isFlagged ? flagThresholdPct : null,
          JSON.stringify([]),
        ],
      );
    }
  });

  void createAuditLog({
    organizationId: orgId, actorId: employeeId,
    action: 'variance_report.generate', resourceType: 'variance_report', resourceId: reportId,
  });

  return getVarianceReport(orgId, reportId);
}

// ─── finalizeVarianceReport ───────────────────────────────────────────────────

export async function finalizeVarianceReport(
  orgId: string,
  reportId: string,
  employeeId: string,
): Promise<VarianceReportWithLines> {
  const { rows: [report] } = await query<VarianceReport>(
    `SELECT * FROM variance_reports WHERE id = $1 AND organization_id = $2`,
    [reportId, orgId],
  );
  if (!report) throw new NotFoundError('Variance report');
  if (report.status === 'finalized') {
    throw new ValidationError('Report is already finalized');
  }

  await query(
    `UPDATE variance_reports SET status = 'finalized', updated_at = now() WHERE id = $1`,
    [reportId],
  );

  void createAuditLog({
    organizationId: orgId, actorId: employeeId,
    action: 'variance_report.finalize', resourceType: 'variance_report', resourceId: reportId,
  });

  return getVarianceReport(orgId, reportId);
}

// ─── getVarianceReport ────────────────────────────────────────────────────────

export async function getVarianceReport(
  orgId: string,
  reportId: string,
): Promise<VarianceReportWithLines> {
  const { rows: [report] } = await query<VarianceReport>(
    `SELECT * FROM variance_reports WHERE id = $1 AND organization_id = $2`,
    [reportId, orgId],
  );
  if (!report) throw new NotFoundError('Variance report');

  const { rows: lines } = await query<VarianceReportLine>(
    `SELECT * FROM variance_report_lines WHERE report_id = $1 ORDER BY is_flagged DESC, ABS(variance_pct) DESC`,
    [reportId],
  );

  return { ...report, lines };
}

// ─── listVarianceReports ──────────────────────────────────────────────────────

export async function listVarianceReports(
  orgId: string,
  locationId?: string,
  status?: 'draft' | 'finalized',
  limit = 20,
  offset = 0,
): Promise<{ reports: VarianceReport[]; total: number }> {
  const conditions: string[] = ['organization_id = $1'];
  const params: unknown[] = [orgId];
  let p = 2;

  if (locationId) { conditions.push(`location_id = $${p++}`); params.push(locationId); }
  if (status) { conditions.push(`status = $${p++}`); params.push(status); }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  const [{ rows: countRows }, { rows: reports }] = await Promise.all([
    query<{ count: string }>(`SELECT COUNT(*) FROM variance_reports ${whereClause}`, params),
    query<VarianceReport>(
      `SELECT * FROM variance_reports ${whereClause}
       ORDER BY period_start DESC
       LIMIT $${p} OFFSET $${p + 1}`,
      [...params, Math.min(limit, 100), offset],
    ),
  ]);

  return { reports, total: parseInt(countRows[0]?.count ?? '0', 10) };
}
