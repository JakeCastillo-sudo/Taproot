/**
 * Franchise service — chain/franchise network management (S8-01).
 *
 * Org model (migration 017):
 *   independent — default; no franchise relationship
 *   franchisor  — owns a franchise_code; franchisees link via parent_org_id
 *   franchisee  — parent_org_id points at the franchisor org
 *
 * Corporate menu push: franchisor products are copied into each franchisee org
 * with products.corporate_source_id set to the master product id. Franchisees
 * cannot archive/delete corporate items (guarded in product.service).
 *
 * RESILIENCE: migration 017 may not be applied yet in production. Every entry
 * point checks franchiseReady() (information_schema, cached) and degrades to
 * "independent / feature unavailable" instead of 500ing.
 */

import { randomBytes } from 'crypto';
import { query } from '../db/client';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import * as ProductSvc from './product.service';
import { sendFranchiseInviteEmail } from './email.service';

// ─── Migration-pending resilience ─────────────────────────────────────────────

let _franchiseReady: boolean | null = null;

export async function franchiseReady(): Promise<boolean> {
  if (_franchiseReady !== null) return _franchiseReady;
  const { rows } = await query<{ ready: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_name = 'organizations' AND column_name = 'org_type'
     ) AS ready`,
  );
  _franchiseReady = Boolean(rows[0]?.ready);
  return _franchiseReady;
}

const MIGRATION_MSG = 'Franchise mode requires migration 017 — ask your administrator to run pending migrations.';

// ─── Types ────────────────────────────────────────────────────────────────────

export type OrgType = 'independent' | 'franchisor' | 'franchisee';

export interface FranchiseInfo {
  ready: boolean;
  orgType: OrgType;
  franchiseCode: string | null;
  parentOrg: { id: string; name: string } | null;
}

export interface NetworkLocation {
  id: string;
  name: string;
  slug: string;
  location_count: number;
  revenue_30d: number;       // cents
  order_count_30d: number;
  joined_at: string;
  status: 'active' | 'inactive';
}

export interface CorporateMenuItem {
  id: string;
  name: string;
  description: string | null;
  price: number | null;      // cents (active default-variant price)
  category_name: string | null;
  corporate_source_id: string | null;
  is_corporate: boolean;
}

// ─── Info ─────────────────────────────────────────────────────────────────────

export async function getFranchiseInfo(orgId: string): Promise<FranchiseInfo> {
  if (!(await franchiseReady())) {
    return { ready: false, orgType: 'independent', franchiseCode: null, parentOrg: null };
  }

  const { rows: [org] } = await query<{
    org_type: OrgType; franchise_code: string | null;
    parent_id: string | null; parent_name: string | null;
  }>(
    `SELECT o.org_type, o.franchise_code, p.id AS parent_id, p.name AS parent_name
       FROM organizations o
       LEFT JOIN organizations p ON p.id = o.parent_org_id AND p.deleted_at IS NULL
      WHERE o.id = $1 AND o.deleted_at IS NULL`,
    [orgId],
  );
  if (!org) throw new NotFoundError('Organization not found');

  return {
    ready: true,
    orgType: org.org_type ?? 'independent',
    franchiseCode: org.franchise_code,
    parentOrg: org.parent_id ? { id: org.parent_id, name: org.parent_name ?? '' } : null,
  };
}

// ─── Enable franchisor mode ───────────────────────────────────────────────────

function generateFranchiseCode(): string {
  // FR-XXXXXXXX — unambiguous uppercase alphanumerics (not a secret — join-code alphabet)
  // eslint-disable-next-line no-secrets/no-secrets
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  let code = '';
  for (let i = 0; i < 8; i++) code += alphabet[bytes[i] % alphabet.length];
  return `FR-${code}`;
}

export async function enableFranchisor(orgId: string): Promise<{ franchiseCode: string }> {
  if (!(await franchiseReady())) throw new ValidationError(MIGRATION_MSG);

  const info = await getFranchiseInfo(orgId);
  if (info.orgType === 'franchisee') {
    throw new ConflictError('This organization is a franchisee — it cannot become a franchisor.');
  }
  if (info.orgType === 'franchisor' && info.franchiseCode) {
    return { franchiseCode: info.franchiseCode }; // idempotent
  }

  // Generate a unique code (retry on the partial unique index)
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateFranchiseCode();
    try {
      await query(
        `UPDATE organizations
            SET org_type = 'franchisor', franchise_code = $2, updated_at = NOW()
          WHERE id = $1`,
        [orgId, code],
      );
      return { franchiseCode: code };
    } catch (err) {
      const pgErr = err as { code?: string };
      if (pgErr.code !== '23505') throw err; // not a unique violation
    }
  }
  throw new ConflictError('Could not generate a unique franchise code — try again.');
}

// ─── Network (franchisor) ─────────────────────────────────────────────────────

async function assertFranchisor(orgId: string): Promise<void> {
  const info = await getFranchiseInfo(orgId);
  if (info.orgType !== 'franchisor') {
    throw new ForbiddenError('Franchisor organization required');
  }
}

export async function getNetwork(orgId: string): Promise<{ locations: NetworkLocation[] }> {
  if (!(await franchiseReady())) return { locations: [] };
  await assertFranchisor(orgId);

  const { rows } = await query<NetworkLocation & { revenue_30d: string | number; location_count: string | number; order_count_30d: string | number }>(
    `SELECT f.id, f.name, f.slug, f.created_at AS joined_at,
            CASE WHEN f.deleted_at IS NULL THEN 'active' ELSE 'inactive' END AS status,
            (SELECT COUNT(*) FROM locations l
              WHERE l.organization_id = f.id AND l.deleted_at IS NULL)::int AS location_count,
            COALESCE((SELECT SUM(o.total) FROM orders o
              WHERE o.organization_id = f.id
                AND o.status = 'completed'
                AND o.created_at >= NOW() - INTERVAL '30 days'), 0)::bigint AS revenue_30d,
            COALESCE((SELECT COUNT(*) FROM orders o
              WHERE o.organization_id = f.id
                AND o.status = 'completed'
                AND o.created_at >= NOW() - INTERVAL '30 days'), 0)::int AS order_count_30d
       FROM organizations f
      WHERE f.parent_org_id = $1 AND f.deleted_at IS NULL
      ORDER BY f.created_at ASC`,
    [orgId],
  );

  return {
    locations: rows.map((r) => ({
      ...r,
      location_count: Number(r.location_count ?? 0),
      revenue_30d: Number(r.revenue_30d ?? 0),
      order_count_30d: Number(r.order_count_30d ?? 0),
    })),
  };
}

// ─── Invite ───────────────────────────────────────────────────────────────────

export async function inviteFranchisee(
  orgId: string,
  email: string,
  locationName: string,
): Promise<{ sent: boolean; franchiseCode: string }> {
  if (!(await franchiseReady())) throw new ValidationError(MIGRATION_MSG);
  if (!email?.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
    throw new ValidationError('A valid email is required');
  }

  const info = await getFranchiseInfo(orgId);
  if (info.orgType !== 'franchisor' || !info.franchiseCode) {
    throw new ForbiddenError('Enable franchise mode first to invite franchisees');
  }

  const { rows: [org] } = await query<{ name: string }>(
    `SELECT name FROM organizations WHERE id = $1`, [orgId],
  );

  await sendFranchiseInviteEmail(
    email.trim(),
    org?.name ?? 'Your franchisor',
    info.franchiseCode,
    locationName?.trim() || 'your new location',
  );

  return { sent: true, franchiseCode: info.franchiseCode };
}

// ─── Join ─────────────────────────────────────────────────────────────────────

export async function joinNetwork(orgId: string, franchiseCode: string): Promise<FranchiseInfo> {
  if (!(await franchiseReady())) throw new ValidationError(MIGRATION_MSG);
  if (!franchiseCode?.trim()) throw new ValidationError('Franchise code is required');

  const info = await getFranchiseInfo(orgId);
  if (info.orgType === 'franchisor') {
    throw new ConflictError('A franchisor organization cannot join another network.');
  }
  if (info.orgType === 'franchisee') {
    throw new ConflictError('This organization already belongs to a franchise network.');
  }

  const { rows: [franchisor] } = await query<{ id: string; name: string }>(
    `SELECT id, name FROM organizations
      WHERE franchise_code = $1 AND org_type = 'franchisor' AND deleted_at IS NULL`,
    [franchiseCode.trim().toUpperCase()],
  );
  if (!franchisor) throw new NotFoundError('No franchise network found for that code');
  if (franchisor.id === orgId) throw new ValidationError('An organization cannot join itself');

  await query(
    `UPDATE organizations
        SET parent_org_id = $2, org_type = 'franchisee', updated_at = NOW()
      WHERE id = $1`,
    [orgId, franchisor.id],
  );

  return getFranchiseInfo(orgId);
}

// ─── Corporate menu ───────────────────────────────────────────────────────────

/**
 * Franchisee → their local corporate-sourced items (locked).
 * Franchisor → their own master menu (the push source).
 */
export async function getCorporateMenu(orgId: string): Promise<{ orgType: OrgType; items: CorporateMenuItem[] }> {
  if (!(await franchiseReady())) return { orgType: 'independent', items: [] };

  const info = await getFranchiseInfo(orgId);

  // Which org's products to list, and how to filter
  const isFranchisee = info.orgType === 'franchisee';
  const targetOrg = orgId;
  const corporateFilter = isFranchisee ? 'AND p.corporate_source_id IS NOT NULL' : '';

  const { rows } = await query<CorporateMenuItem & { price: string | number | null }>(
    `SELECT p.id, p.name, p.description, p.corporate_source_id,
            c.name AS category_name,
            (SELECT pp.price FROM product_variants v
               JOIN product_prices pp ON pp.variant_id = v.id AND pp.is_active = true
              WHERE v.product_id = p.id AND v.deleted_at IS NULL
              ORDER BY v.created_at ASC LIMIT 1) AS price
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id AND c.deleted_at IS NULL
      WHERE p.organization_id = $1
        AND p.deleted_at IS NULL AND p.archived_at IS NULL
        ${corporateFilter}
      ORDER BY p.name ASC`,
    [targetOrg],
  );

  return {
    orgType: info.orgType,
    items: rows.map((r) => ({
      ...r,
      price: r.price == null ? null : Number(r.price),
      is_corporate: r.corporate_source_id != null || info.orgType === 'franchisor',
    })),
  };
}

// ─── Menu push (franchisor → all franchisees) ─────────────────────────────────

export interface PushResult {
  franchisees: number;
  created: number;
  updated: number;
  errors: string[];
}

/** Pick an employee in the target org to attribute system writes to (prefer owner). */
async function systemEmployeeFor(orgId: string): Promise<string | null> {
  const { rows: [emp] } = await query<{ id: string }>(
    `SELECT id FROM employees
      WHERE organization_id = $1 AND deleted_at IS NULL
      ORDER BY (role = 'owner') DESC, created_at ASC
      LIMIT 1`,
    [orgId],
  );
  return emp?.id ?? null;
}

export async function pushMenu(orgId: string, productIds: string[]): Promise<PushResult> {
  if (!(await franchiseReady())) throw new ValidationError(MIGRATION_MSG);
  await assertFranchisor(orgId);
  if (!Array.isArray(productIds) || productIds.length === 0) {
    throw new ValidationError('productIds is required');
  }
  if (productIds.length > 200) throw new ValidationError('Push at most 200 products at a time');

  // Source products (franchisor master menu) with current default-variant price
  const { rows: sources } = await query<{
    id: string; name: string; description: string | null;
    product_type: string; unit_of_measure: string; cost_price: string | number | null;
    price: string | number | null;
  }>(
    `SELECT p.id, p.name, p.description, p.product_type, p.unit_of_measure, p.cost_price,
            (SELECT pp.price FROM product_variants v
               JOIN product_prices pp ON pp.variant_id = v.id AND pp.is_active = true
              WHERE v.product_id = p.id AND v.deleted_at IS NULL
              ORDER BY v.created_at ASC LIMIT 1) AS price
       FROM products p
      WHERE p.organization_id = $1 AND p.id = ANY($2::uuid[])
        AND p.deleted_at IS NULL AND p.archived_at IS NULL`,
    [orgId, productIds],
  );
  if (!sources.length) throw new NotFoundError('No matching products found to push');

  const { rows: franchisees } = await query<{ id: string }>(
    `SELECT id FROM organizations WHERE parent_org_id = $1 AND deleted_at IS NULL`,
    [orgId],
  );

  const result: PushResult = { franchisees: franchisees.length, created: 0, updated: 0, errors: [] };

  for (const fr of franchisees) {
    const employeeId = await systemEmployeeFor(fr.id);
    if (!employeeId) {
      result.errors.push(`org ${fr.id}: no employee to attribute writes to`);
      continue;
    }

    for (const src of sources) {
      try {
        const { rows: [existing] } = await query<{ id: string }>(
          `SELECT id FROM products
            WHERE organization_id = $1 AND corporate_source_id = $2 AND deleted_at IS NULL`,
          [fr.id, src.id],
        );

        const priceCents = src.price == null ? undefined : Number(src.price);

        if (existing) {
          await ProductSvc.updateProduct(fr.id, existing.id, {
            name: src.name,
            description: src.description ?? undefined,
            ...(priceCents && priceCents > 0 ? { price: priceCents } : {}),
          }, employeeId);
          // un-archive if a previous push was archived before the lock existed
          await query(
            `UPDATE products SET archived_at = NULL, archive_reason = NULL, updated_at = NOW()
              WHERE id = $1 AND archived_at IS NOT NULL`,
            [existing.id],
          );
          result.updated++;
        } else {
          const created = await ProductSvc.createProduct(fr.id, '', {
            name: src.name,
            description: src.description ?? undefined,
            productType: src.product_type as ProductSvc.CreateProductData['productType'],
            unitOfMeasure: src.unit_of_measure as ProductSvc.CreateProductData['unitOfMeasure'],
            costPrice: src.cost_price == null ? undefined : Number(src.cost_price),
            ...(priceCents && priceCents > 0 ? { price: priceCents } : {}),
          }, employeeId);
          await query(
            `UPDATE products SET corporate_source_id = $2 WHERE id = $1`,
            [created.id, src.id],
          );
          result.created++;
        }
      } catch (err) {
        result.errors.push(`org ${fr.id} / product ${src.name}: ${err instanceof Error ? err.message : 'failed'}`);
      }
    }
  }

  return result;
}

