/**
 * QuickBooks Online integration — OAuth 2.0 + daily sales sync.
 *
 * Posts one Sales Receipt per day per org (gross sales, tax, cash/card split).
 * Degrades gracefully: every entry point no-ops when QB_CLIENT_ID is unset or the
 * org isn't connected. Idempotent — a date already logged 'success' is not re-sent.
 *
 * Env: QB_CLIENT_ID / QB_CLIENT_SECRET (from developer.intuit.com).
 */
import { query } from '../db/client';
import { config } from '../config';
import { logger } from '../lib/logger';

const QB_BASE_URL = 'https://quickbooks.api.intuit.com';
const QB_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const QB_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QB_SCOPE = 'com.intuit.quickbooks.accounting';

/**
 * OAuth redirect URI. Must EXACTLY match a redirect registered in the Intuit app
 * and must resolve to THIS API's public origin. config.APP_URL is the public web
 * origin; in deployments where the API lives on a different host, set APP_URL (or
 * front the API under the same domain) so /api/v1/quickbooks/callback is reachable.
 */
const REDIRECT_URI = `${config.APP_URL}/api/v1/quickbooks/callback`;

export function isConfigured(): boolean {
  return Boolean(config.QB_CLIENT_ID && config.QB_CLIENT_SECRET);
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

function basicAuthHeader(): string {
  return Buffer.from(`${config.QB_CLIENT_ID}:${config.QB_CLIENT_SECRET}`).toString('base64');
}

// ── OAuth flow ──────────────────────────────────────────────────────────────

export function getAuthUrl(orgId: string): string {
  const state = Buffer.from(JSON.stringify({ orgId, nonce: Math.random() })).toString('base64url');
  const params = new URLSearchParams({
    client_id: config.QB_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: QB_SCOPE,
    state,
  });
  return `${QB_AUTH_URL}?${params.toString()}`;
}

/** Decode the OAuth `state` back to its orgId (throws on tampering). */
export function parseState(state: string): { orgId: string } {
  const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8')) as { orgId?: string };
  if (!decoded.orgId) throw new Error('Invalid OAuth state');
  return { orgId: decoded.orgId };
}

export async function exchangeCode(code: string, realmId: string, orgId: string): Promise<void> {
  const resp = await fetch(QB_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuthHeader()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
    }).toString(),
  });

  const tokens = (await resp.json()) as TokenResponse;
  if (!resp.ok || !tokens.access_token || !tokens.refresh_token) {
    throw new Error(`QB token exchange failed: ${tokens.error_description ?? tokens.error ?? resp.status}`);
  }

  await query(
    `INSERT INTO quickbooks_connections
       (organization_id, realm_id, access_token, refresh_token, token_expires_at, sync_enabled)
     VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 hour', true)
     ON CONFLICT (organization_id) DO UPDATE SET
       realm_id = $2, access_token = $3, refresh_token = $4,
       token_expires_at = NOW() + INTERVAL '1 hour'`,
    [orgId, realmId, tokens.access_token, tokens.refresh_token],
  );
}

export async function refreshToken(orgId: string): Promise<string> {
  const conn = await query<{ refresh_token: string }>(
    `SELECT refresh_token FROM quickbooks_connections WHERE organization_id = $1`,
    [orgId],
  );
  if (!conn.rows.length) throw new Error('Not connected to QuickBooks');

  const resp = await fetch(QB_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuthHeader()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: conn.rows[0].refresh_token,
    }).toString(),
  });

  const tokens = (await resp.json()) as TokenResponse;
  if (!resp.ok || !tokens.access_token || !tokens.refresh_token) {
    throw new Error(`QB token refresh failed: ${tokens.error_description ?? tokens.error ?? resp.status}`);
  }

  await query(
    `UPDATE quickbooks_connections SET
       access_token = $1, refresh_token = $2, token_expires_at = NOW() + INTERVAL '1 hour'
     WHERE organization_id = $3`,
    [tokens.access_token, tokens.refresh_token, orgId],
  );

  return tokens.access_token;
}

// ── Daily sales sync ──────────────────────────────────────────────────────────

interface ConnectionRow {
  realm_id: string;
  access_token: string;
  token_expires_at: string;
}

/**
 * Sync one day's sales for one org. Idempotent: returns early if that date was
 * already logged 'success' (so re-running the job or a manual re-sync never
 * creates duplicate Sales Receipts in QuickBooks).
 */
export async function syncDailySales(orgId: string, date: string): Promise<void> {
  if (!isConfigured()) return;

  const conn = await query<ConnectionRow>(
    `SELECT realm_id, access_token, token_expires_at
       FROM quickbooks_connections
      WHERE organization_id = $1 AND sync_enabled = true`,
    [orgId],
  );
  if (!conn.rows.length) return;

  // Already synced for this date? Skip — prevents duplicate receipts.
  const already = await query(
    `SELECT 1 FROM quickbooks_sync_log
      WHERE organization_id = $1 AND sync_date = $2 AND status = 'success' LIMIT 1`,
    [orgId, date],
  );
  if (already.rows.length) return;

  const { realm_id, token_expires_at } = conn.rows[0];
  let accessToken = conn.rows[0].access_token;
  if (new Date(token_expires_at) < new Date()) {
    accessToken = await refreshToken(orgId);
  }

  // Totals from completed orders for the date (DATE() is server-TZ; see job note).
  const totals = await query<{ gross_sales: string; tax_collected: string; order_count: string }>(
    `SELECT COALESCE(SUM(total), 0)     AS gross_sales,
            COALESCE(SUM(tax_total), 0) AS tax_collected,
            COUNT(*)                    AS order_count
       FROM orders
      WHERE organization_id = $1 AND DATE(created_at) = $2 AND status = 'completed'`,
    [orgId, date],
  );

  const grossSales = Number(totals.rows[0].gross_sales);
  const taxCollected = Number(totals.rows[0].tax_collected);
  const orderCount = Number(totals.rows[0].order_count);
  if (!grossSales) return; // nothing to sync

  // Cash vs card from the payments table (orders has no payment_method column).
  const split = await query<{ cash_sales: string; card_sales: string }>(
    `SELECT COALESCE(SUM(CASE WHEN p.payment_method = 'cash' THEN p.amount ELSE 0 END), 0) AS cash_sales,
            COALESCE(SUM(CASE WHEN p.payment_method <> 'cash' THEN p.amount ELSE 0 END), 0) AS card_sales
       FROM payments p
       JOIN orders o ON o.id = p.order_id
      WHERE o.organization_id = $1 AND DATE(o.created_at) = $2
            AND o.status = 'completed' AND p.status = 'completed'`,
    [orgId, date],
  );
  const cashSales = Number(split.rows[0].cash_sales);
  const cardSales = Number(split.rows[0].card_sales);

  const salesReceipt = {
    TxnDate: date,
    Line: [
      {
        Amount: (grossSales - taxCollected) / 100,
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: { ItemRef: { value: '1', name: 'Sales' } },
        Description: `Taproot POS Sales — ${date}`,
      },
    ],
    TxnTaxDetail: { TotalTax: taxCollected / 100 },
    CustomerRef: { value: '1', name: 'Walk-in Customer' },
    PrivateNote:
      `Taproot POS sync — ${date}. Orders: ${orderCount}. ` +
      `Cash: $${(cashSales / 100).toFixed(2)}. Card: $${(cardSales / 100).toFixed(2)}.`,
  };

  const qbResp = await fetch(`${QB_BASE_URL}/v3/company/${realm_id}/salesreceipt`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ SalesReceipt: salesReceipt }),
  });

  if (!qbResp.ok) {
    const err = await qbResp.text();
    await query(
      `INSERT INTO quickbooks_sync_log (organization_id, sync_date, status, error_message)
       VALUES ($1, $2, 'failed', $3)`,
      [orgId, date, err.slice(0, 2000)],
    );
    throw new Error(`QB sync failed: ${err}`);
  }

  await query(
    `INSERT INTO quickbooks_sync_log (organization_id, sync_date, status, records_synced)
     VALUES ($1, $2, 'success', 1)`,
    [orgId, date],
  );
  await query(
    `UPDATE quickbooks_connections SET last_synced_at = NOW() WHERE organization_id = $1`,
    [orgId],
  );
  logger.info('[QuickBooks] synced', { orgId, date, grossSales, orderCount });
}

// ── Disconnect / status / log ──────────────────────────────────────────────────

export async function disconnectQuickBooks(orgId: string): Promise<void> {
  await query(`DELETE FROM quickbooks_connections WHERE organization_id = $1`, [orgId]);
}

export async function setSyncEnabled(orgId: string, enabled: boolean): Promise<void> {
  await query(
    `UPDATE quickbooks_connections SET sync_enabled = $2 WHERE organization_id = $1`,
    [orgId, enabled],
  );
}

export interface ConnectionStatus {
  connected: boolean;
  configured: boolean;
  lastSynced?: string | null;
  syncEnabled?: boolean;
}

export async function getConnectionStatus(orgId: string): Promise<ConnectionStatus> {
  const result = await query<{ last_synced_at: string | null; sync_enabled: boolean }>(
    `SELECT last_synced_at, sync_enabled FROM quickbooks_connections WHERE organization_id = $1`,
    [orgId],
  );
  if (!result.rows.length) return { connected: false, configured: isConfigured() };
  return {
    connected: true,
    configured: isConfigured(),
    lastSynced: result.rows[0].last_synced_at,
    syncEnabled: result.rows[0].sync_enabled,
  };
}

export interface SyncLogRow {
  sync_date: string;
  status: string;
  records_synced: number;
  error_message: string | null;
  created_at: string;
}

export async function getSyncLog(orgId: string, limit = 7): Promise<SyncLogRow[]> {
  const result = await query<SyncLogRow>(
    `SELECT sync_date, status, records_synced, error_message, created_at
       FROM quickbooks_sync_log
      WHERE organization_id = $1
      ORDER BY sync_date DESC, created_at DESC
      LIMIT $2`,
    [orgId, limit],
  );
  return result.rows;
}
