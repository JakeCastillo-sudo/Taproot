/**
 * QuickBooks daily sync job.
 *
 * Syncs the PREVIOUS day's sales for every connected + sync-enabled org. Run by
 * the scheduler in index.ts (hourly tick; acts when it's the 2am hour). Each org's
 * sync is idempotent (syncDailySales self-guards on quickbooks_sync_log), so a
 * repeated tick never produces duplicate Sales Receipts.
 *
 * NOTE: "yesterday" + the underlying DATE(created_at) use the server timezone
 * (UTC on Railway). Per-org timezone handling is a future refinement.
 */
import { query } from '../db/client';
import { logger } from '../lib/logger';
import { isConfigured, syncDailySales } from '../services/quickbooks.service';

function yesterdayISO(now: Date): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

export async function runDailySyncJob(now: Date = new Date()): Promise<void> {
  if (!isConfigured()) return;

  // No-op if the table hasn't been migrated yet (027 pending).
  let orgs: Array<{ organization_id: string }> = [];
  try {
    const res = await query<{ organization_id: string }>(
      `SELECT organization_id FROM quickbooks_connections WHERE sync_enabled = true`,
    );
    orgs = res.rows;
  } catch {
    logger.warn('[QuickBooks] quickbooks_connections missing — run migration 027');
    return;
  }
  if (!orgs.length) return;

  const date = yesterdayISO(now);
  logger.info('[QuickBooks] daily sync starting', { date, orgs: orgs.length });

  let synced = 0;
  let failed = 0;
  for (const { organization_id } of orgs) {
    try {
      await syncDailySales(organization_id, date);
      synced++;
    } catch (err) {
      failed++;
      logger.error('[QuickBooks] org sync failed', {
        orgId: organization_id,
        date,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  logger.info('[QuickBooks] daily sync done', { date, synced, failed });
}
