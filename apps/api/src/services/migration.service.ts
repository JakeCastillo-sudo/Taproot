/**
 * Migration Service — imports data from Square, Shopify, Toast,
 * Lightspeed, and Clover into Taproot.
 *
 * Flow per provider:
 *   migrateFrom*() → fetches external data → normalises → stores as
 *   ImportJob (status: awaiting_confirmation) → returns job
 *
 *   applyMigration() → reads job payload → creates categories →
 *   products → customers → marks job completed
 */

import { query } from '../db/client';
import { createAuditLog } from '../auth/audit';
import { NotFoundError, ValidationError } from '../errors';
import { mapCsvColumns } from './documentParser.service';
import * as ProductSvc from './product.service';
import * as CustomerSvc from './customer.service';
import type { ImportJob, MigrationImportType } from './importJob.service';

// ─── Normalised intermediate types ───────────────────────────────────────────

export interface MigCategory {
  externalId: string;
  name:       string;
}

export interface MigVariant {
  externalId:  string;
  name:        string;
  priceCents:  number;
  sku?:        string;
  barcode?:    string;
}

export interface MigProduct {
  externalId:    string;
  name:          string;
  description?:  string;
  categoryName?: string;
  variants:      MigVariant[];
}

export interface MigCustomer {
  externalId:       string;
  firstName?:       string;
  lastName?:        string;
  email?:           string;
  phone?:           string;
  loyaltyPoints?:   number;
  totalSpentCents?: number;
  tags?:            string[];
}

export interface MigEmployee {
  externalId: string;
  name:       string;
  email?:     string;
}

export interface MigrationPayload {
  provider:   MigrationImportType;
  categories: MigCategory[];
  products:   MigProduct[];
  customers:  MigCustomer[];
  employees?: MigEmployee[];
}

export interface MigrationResult {
  categories: number;
  products:   number;
  customers:  number;
  employees:  number;
  failed:     number;
  errors:     string[];
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** Create an import_jobs record and return it */
async function createMigrationJob(
  orgId:          string,
  employeeId:     string,
  importType:     MigrationImportType,
  sourceFilename: string,
): Promise<ImportJob> {
  const { rows: [job] } = await query<ImportJob>(
    `INSERT INTO import_jobs
       (organization_id, import_type, status, source_filename, initiated_by)
     VALUES ($1, $2, 'pending', $3, $4)
     RETURNING *`,
    [orgId, importType, sourceFilename, employeeId],
  );
  return job;
}

/** Paginate a Square API endpoint following cursor pagination */
async function squareFetchAll<T>(
  url:         string,
  accessToken: string,
  bodyFn:      (cursor?: string) => Record<string, unknown>,
  extractFn:   (body: Record<string, unknown>) => T[],
): Promise<T[]> {
  const results: T[] = [];
  let cursor: string | undefined;

  do {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization':  `Bearer ${accessToken}`,
        'Content-Type':   'application/json',
        'Square-Version': '2024-01-17',
      },
      body: JSON.stringify(bodyFn(cursor)),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { errors?: Array<{ detail: string }> };
      const detail = body.errors?.[0]?.detail ?? `HTTP ${res.status}`;
      throw new ValidationError(`Square API error: ${detail}`);
    }

    const data = await res.json() as Record<string, unknown>;
    const items = extractFn(data);
    results.push(...items);
    cursor = data['cursor'] as string | undefined;
  } while (cursor);

  return results;
}

/** Simple Shopify paginated GET (link-header or page-based) */
async function shopifyFetchAll<T>(
  baseUrl:     string,
  accessToken: string,
  extractFn:   (body: Record<string, unknown>) => T[],
): Promise<T[]> {
  const results: T[] = [];
  let url: string | null = `${baseUrl}&limit=250`;

  while (url) {
    const res = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': accessToken },
    });

    if (!res.ok) {
      throw new ValidationError(`Shopify API error: HTTP ${res.status}`);
    }

    const data = await res.json() as Record<string, unknown>;
    results.push(...extractFn(data));

    // Follow Link header for next page
    const link = res.headers.get('Link') ?? '';
    const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch ? nextMatch[1] : null;
  }

  return results;
}

/** Simple paginated GET (offset-based) */
async function offsetFetchAll<T>(
  urlFn:      (offset: number) => string,
  headersMap: Record<string, string>,
  extractFn:  (body: unknown) => T[],
  pageSize = 100,
): Promise<T[]> {
  const results: T[] = [];
  let offset = 0;

  while (true) {
    const res = await fetch(urlFn(offset), { headers: headersMap });
    if (!res.ok) throw new ValidationError(`External API error: HTTP ${res.status}`);

    const data = await res.json();
    const page = extractFn(data);
    results.push(...page);

    if (page.length < pageSize) break;
    offset += pageSize;
  }

  return results;
}

// ─── Helper: save payload to DB, set awaiting_confirmation ────────────────────

async function savePayload(
  jobId:   string,
  payload: MigrationPayload,
): Promise<ImportJob> {
  const previewProducts = payload.products.slice(0, 10).map((p) => ({
    name:     p.name,
    category: p.categoryName ?? '—',
    price:    p.variants[0]?.priceCents ?? 0,
    variants: p.variants.length,
  }));

  const { rows: [updated] } = await query<ImportJob>(
    `UPDATE import_jobs
       SET status       = 'awaiting_confirmation',
           mapping_config = $2::jsonb,
           preview_data   = $3::jsonb,
           total_rows     = $4,
           updated_at     = now()
     WHERE id = $1
     RETURNING *`,
    [
      jobId,
      JSON.stringify(payload),
      JSON.stringify(previewProducts),
      payload.products.length + payload.customers.length,
    ],
  );
  return updated;
}

// ─── 1. Square ────────────────────────────────────────────────────────────────

export interface SquareMigrationInput {
  accessToken:      string;
  squareLocationId?: string;
}

export async function migrateFromSquare(
  orgId:      string,
  locationId: string,
  employeeId: string,
  input:      SquareMigrationInput,
): Promise<ImportJob> {
  const job = await createMigrationJob(orgId, employeeId, 'migration_square', 'square-catalog');

  try {
    await query(
      `UPDATE import_jobs SET status = 'processing', started_at = now(), updated_at = now() WHERE id = $1`,
      [job.id],
    );

    // Fetch catalog objects (ITEM, ITEM_VARIATION, CATEGORY)
    const catalogObjects = await squareFetchAll<Record<string, unknown>>(
      'https://connect.squareup.com/v2/catalog/list',
      input.accessToken,
      (cursor) => ({
        types: 'ITEM,ITEM_VARIATION,CATEGORY',
        ...(cursor ? { cursor } : {}),
      }),
      (body) => (body['objects'] as Record<string, unknown>[] | undefined) ?? [],
    );

    // Fetch customers
    const squareCustomers = await squareFetchAll<Record<string, unknown>>(
      'https://connect.squareup.com/v2/customers/search',
      input.accessToken,
      (cursor) => ({
        limit: 100,
        ...(cursor ? { cursor } : {}),
      }),
      (body) => (body['customers'] as Record<string, unknown>[] | undefined) ?? [],
    );

    // Normalise catalog
    type CatalogObj = Record<string, unknown>;
    const categoryMap = new Map<string, string>(); // id → name
    const categories:  MigCategory[] = [];
    const variationMap = new Map<string, MigVariant>(); // variation id → variant
    const itemMap      = new Map<string, MigProduct>();  // item id → product

    for (const obj of catalogObjects as CatalogObj[]) {
      const type = obj['type'] as string;
      const id   = obj['id']   as string;

      if (type === 'CATEGORY') {
        const d = obj['category_data'] as Record<string, unknown>;
        const name = d?.['name'] as string ?? 'Uncategorised';
        categoryMap.set(id, name);
        categories.push({ externalId: id, name });
      }

      if (type === 'ITEM_VARIATION') {
        const d = obj['item_variation_data'] as Record<string, unknown>;
        const priceMoney = d?.['price_money'] as Record<string, unknown> | undefined;
        variationMap.set(id, {
          externalId: id,
          name:       (d?.['name'] as string) ?? 'Default',
          priceCents: (priceMoney?.['amount'] as number) ?? 0,
          sku:        d?.['sku'] as string | undefined,
        });
      }

      if (type === 'ITEM') {
        const d = obj['item_data'] as Record<string, unknown>;
        const catId = d?.['category_id'] as string | undefined;
        const varIds = (d?.['variation_ids'] as string[] | undefined) ?? [];
        itemMap.set(id, {
          externalId:    id,
          name:          (d?.['name'] as string) ?? 'Unknown',
          description:   d?.['description'] as string | undefined,
          categoryName:  catId ? categoryMap.get(catId) : undefined,
          variants:      varIds.map((vid) => variationMap.get(vid)).filter(Boolean) as MigVariant[],
        });
      }
    }

    const products = Array.from(itemMap.values());

    const customers: MigCustomer[] = squareCustomers.map((c) => {
      const loyalty = (c['loyalty_points'] as number | undefined);
      return {
        externalId:       c['id'] as string,
        firstName:        c['given_name']  as string | undefined,
        lastName:         c['family_name'] as string | undefined,
        email:            (c['email_address'] as string | undefined),
        phone:            (c['phone_number']  as string | undefined),
        loyaltyPoints:    loyalty,
      };
    });

    const payload: MigrationPayload = {
      provider: 'migration_square',
      categories,
      products,
      customers,
    };

    await createAuditLog({
      organizationId: orgId,
      actorId:        employeeId,
      action:         'migration.square.started',
      resourceType:   'import_job',
      resourceId:     job.id,
      metadata: {
        products: products.length,
        customers: customers.length,
        categories: categories.length,
      },
    });

    return savePayload(job.id, payload);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await query(
      `UPDATE import_jobs SET status = 'failed', error_log = $2::jsonb,
       completed_at = now(), updated_at = now() WHERE id = $1`,
      [job.id, JSON.stringify([{ message }])],
    );
    throw err;
  }
}

// ─── 2. Shopify ───────────────────────────────────────────────────────────────

export interface ShopifyMigrationInput {
  shopDomain:  string;
  accessToken: string;
}

export async function migrateFromShopify(
  orgId:      string,
  locationId: string,
  employeeId: string,
  input:      ShopifyMigrationInput,
): Promise<ImportJob> {
  const domain = input.shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const base   = `https://${domain}`;

  const job = await createMigrationJob(orgId, employeeId, 'migration_shopify', `shopify-${domain}`);

  try {
    await query(
      `UPDATE import_jobs SET status = 'processing', started_at = now(), updated_at = now() WHERE id = $1`,
      [job.id],
    );

    // Fetch products
    type ShopifyProduct = Record<string, unknown>;
    const shopifyProducts = await shopifyFetchAll<ShopifyProduct>(
      `${base}/admin/api/2024-01/products.json?fields=id,title,body_html,variants,product_type`,
      input.accessToken,
      (body) => (body['products'] as ShopifyProduct[]) ?? [],
    );

    // Fetch customers
    type ShopifyCustomer = Record<string, unknown>;
    const shopifyCustomers = await shopifyFetchAll<ShopifyCustomer>(
      `${base}/admin/api/2024-01/customers.json?fields=id,first_name,last_name,email,phone,tags,total_spent`,
      input.accessToken,
      (body) => (body['customers'] as ShopifyCustomer[]) ?? [],
    );

    // Fetch collections for categories
    type ShopifyCollection = Record<string, unknown>;
    const collections = await shopifyFetchAll<ShopifyCollection>(
      `${base}/admin/api/2024-01/custom_collections.json?fields=id,title`,
      input.accessToken,
      (body) => (body['custom_collections'] as ShopifyCollection[]) ?? [],
    );

    const categories: MigCategory[] = collections.map((c) => ({
      externalId: String(c['id']),
      name:       (c['title'] as string) ?? 'Uncategorised',
    }));

    const products: MigProduct[] = shopifyProducts.map((p) => {
      type ShopifyVariant = Record<string, unknown>;
      const variants = ((p['variants'] as ShopifyVariant[]) ?? []).map((v): MigVariant => ({
        externalId: String(v['id']),
        name:       (v['title'] as string) === 'Default Title' ? 'Default' : ((v['title'] as string) ?? 'Default'),
        priceCents: Math.round(parseFloat((v['price'] as string) ?? '0') * 100),
        sku:        v['sku'] as string | undefined,
        barcode:    v['barcode'] as string | undefined,
      }));

      return {
        externalId:   String(p['id']),
        name:         (p['title'] as string) ?? 'Unknown',
        description:  p['body_html'] as string | undefined,
        categoryName: p['product_type'] as string | undefined || undefined,
        variants:     variants.length > 0 ? variants : [{ externalId: String(p['id']), name: 'Default', priceCents: 0 }],
      };
    });

    const customers: MigCustomer[] = shopifyCustomers.map((c) => ({
      externalId:       String(c['id']),
      firstName:        c['first_name'] as string | undefined,
      lastName:         c['last_name']  as string | undefined,
      email:            c['email']      as string | undefined,
      phone:            c['phone']      as string | undefined,
      totalSpentCents:  Math.round(parseFloat((c['total_spent'] as string) ?? '0') * 100),
      tags:             ((c['tags'] as string) ?? '').split(',').map((t) => t.trim()).filter(Boolean),
    }));

    const payload: MigrationPayload = {
      provider: 'migration_shopify',
      categories,
      products,
      customers,
    };

    await createAuditLog({
      organizationId: orgId,
      actorId:        employeeId,
      action:         'migration.shopify.started',
      resourceType:   'import_job',
      resourceId:     job.id,
      metadata: { products: products.length, customers: customers.length },
    });

    return savePayload(job.id, payload);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await query(
      `UPDATE import_jobs SET status = 'failed', error_log = $2::jsonb,
       completed_at = now(), updated_at = now() WHERE id = $1`,
      [job.id, JSON.stringify([{ message }])],
    );
    throw err;
  }
}

// ─── 3. Toast ─────────────────────────────────────────────────────────────────

export interface ToastMigrationInput {
  clientId:       string;
  clientSecret:   string;
  restaurantGuid: string;
}

export async function migrateFromToast(
  orgId:      string,
  locationId: string,
  employeeId: string,
  input:      ToastMigrationInput,
): Promise<ImportJob> {
  const job = await createMigrationJob(orgId, employeeId, 'migration_toast', `toast-${input.restaurantGuid}`);

  try {
    await query(
      `UPDATE import_jobs SET status = 'processing', started_at = now(), updated_at = now() WHERE id = $1`,
      [job.id],
    );

    // Authenticate with Toast
    const authRes = await fetch('https://ws-api.toasttab.com/authentication/v1/authentication/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId:     input.clientId,
        clientSecret: input.clientSecret,
        userAccessType: 'TOAST_MACHINE_CLIENT',
      }),
    });
    if (!authRes.ok) throw new ValidationError(`Toast authentication failed: HTTP ${authRes.status}`);

    const authData = await authRes.json() as { token?: { accessToken: string } };
    const toastToken = authData.token?.accessToken;
    if (!toastToken) throw new ValidationError('Toast did not return an access token');

    // Fetch menus
    const menuRes = await fetch(
      `https://ws-api.toasttab.com/menus/v2/menus?restaurantGuid=${input.restaurantGuid}`,
      { headers: { 'Authorization': `Bearer ${toastToken}` } },
    );
    if (!menuRes.ok) throw new ValidationError(`Toast menus fetch failed: HTTP ${menuRes.status}`);

    const menuData = await menuRes.json() as { menus?: Array<Record<string, unknown>> };
    const menus = menuData.menus ?? [];

    const categories: MigCategory[] = [];
    const products:   MigProduct[]  = [];
    const catSeen = new Set<string>();

    for (const menu of menus) {
      const groups = (menu['menuGroups'] as Array<Record<string, unknown>>) ?? [];
      for (const group of groups) {
        const groupName = (group['name'] as string) ?? 'Menu Items';
        const groupGuid = (group['guid'] as string) ?? groupName;
        if (!catSeen.has(groupGuid)) {
          catSeen.add(groupGuid);
          categories.push({ externalId: groupGuid, name: groupName });
        }

        const items = (group['menuItems'] as Array<Record<string, unknown>>) ?? [];
        for (const item of items) {
          const priceCents = typeof item['price'] === 'number' ? item['price'] : 0;
          products.push({
            externalId:   (item['guid'] as string) ?? String(Math.random()),
            name:         (item['name'] as string) ?? 'Unknown',
            description:  item['description'] as string | undefined,
            categoryName: groupName,
            variants: [{
              externalId: (item['guid'] as string) ?? 'default',
              name:       'Default',
              priceCents,
            }],
          });
        }
      }
    }

    // Fetch employees
    const empRes = await fetch(
      `https://ws-api.toasttab.com/labor/v1/employees?restaurantGuid=${input.restaurantGuid}`,
      { headers: { 'Authorization': `Bearer ${toastToken}` } },
    );
    const employees: MigEmployee[] = [];
    if (empRes.ok) {
      const empData = await empRes.json() as Array<Record<string, unknown>>;
      for (const e of empData) {
        employees.push({
          externalId: (e['guid'] as string) ?? String(Math.random()),
          name:       `${e['firstName'] ?? ''} ${e['lastName'] ?? ''}`.trim(),
          email:      e['email'] as string | undefined,
        });
      }
    }

    const payload: MigrationPayload = {
      provider: 'migration_toast',
      categories,
      products,
      customers: [],
      employees,
    };

    return savePayload(job.id, payload);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await query(
      `UPDATE import_jobs SET status = 'failed', error_log = $2::jsonb,
       completed_at = now(), updated_at = now() WHERE id = $1`,
      [job.id, JSON.stringify([{ message }])],
    );
    throw err;
  }
}

// ─── 4. Lightspeed ───────────────────────────────────────────────────────────

export interface LightspeedMigrationInput {
  apiKey:    string;
  accountId: string;
}

export async function migrateFromLightspeed(
  orgId:      string,
  locationId: string,
  employeeId: string,
  input:      LightspeedMigrationInput,
): Promise<ImportJob> {
  const job = await createMigrationJob(orgId, employeeId, 'migration_lightspeed', `lightspeed-${input.accountId}`);
  const base = `https://api.lightspeedapp.com/API/V3/Account/${input.accountId}`;
  const headers = { 'Authorization': `Bearer ${input.apiKey}` };

  try {
    await query(
      `UPDATE import_jobs SET status = 'processing', started_at = now(), updated_at = now() WHERE id = $1`,
      [job.id],
    );

    type LsItem = Record<string, unknown>;
    const lsItems = await offsetFetchAll<LsItem>(
      (offset) => `${base}/Item.json?limit=100&offset=${offset}&load_relations=["Category","Prices"]`,
      headers,
      (body) => {
        const data = body as Record<string, unknown>;
        const item = data['Item'];
        if (!item) return [];
        return Array.isArray(item) ? item : [item];
      },
    );

    type LsCustomer = Record<string, unknown>;
    const lsCustomers = await offsetFetchAll<LsCustomer>(
      (offset) => `${base}/Customer.json?limit=100&offset=${offset}`,
      headers,
      (body) => {
        const data = body as Record<string, unknown>;
        const item = data['Customer'];
        if (!item) return [];
        return Array.isArray(item) ? item : [item];
      },
    );

    // Extract unique categories from items
    const catMap = new Map<string, string>();
    for (const item of lsItems) {
      const cat = item['Category'] as Record<string, unknown> | undefined;
      if (cat?.['categoryID'] && cat?.['name']) {
        catMap.set(String(cat['categoryID']), String(cat['name']));
      }
    }
    const categories: MigCategory[] = Array.from(catMap.entries()).map(([id, name]) => ({
      externalId: id, name,
    }));

    const products: MigProduct[] = lsItems.map((item) => {
      const prices  = item['Prices'] as Record<string, unknown> | undefined;
      const priceArr = prices?.['ItemPrice'];
      const defPrice = Array.isArray(priceArr)
        ? priceArr.find((p: Record<string, unknown>) => p['useType'] === 'Default') ?? priceArr[0]
        : priceArr;
      const priceAmount = defPrice
        ? Math.round(parseFloat(String((defPrice as Record<string, unknown>)['amount'] ?? '0')) * 100)
        : 0;

      const cat = item['Category'] as Record<string, unknown> | undefined;

      return {
        externalId:   String(item['itemID']),
        name:         (item['description'] as string) ?? 'Unknown',
        categoryName: cat?.['name'] as string | undefined,
        variants: [{
          externalId: String(item['itemID']),
          name:       'Default',
          priceCents: priceAmount,
          sku:        item['customSku'] as string | undefined,
          barcode:    item['upc'] as string | undefined,
        }],
      };
    });

    const customers: MigCustomer[] = lsCustomers.map((c) => {
      const contact = c['Contact'] as Record<string, unknown> | undefined;
      return {
        externalId: String(c['customerID']),
        firstName:  c['firstName'] as string | undefined,
        lastName:   c['lastName']  as string | undefined,
        email:      contact?.['email'] as string | undefined,
        phone:      contact?.['phone'] as string | undefined,
      };
    });

    const payload: MigrationPayload = {
      provider: 'migration_lightspeed',
      categories,
      products,
      customers,
    };

    return savePayload(job.id, payload);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await query(
      `UPDATE import_jobs SET status = 'failed', error_log = $2::jsonb,
       completed_at = now(), updated_at = now() WHERE id = $1`,
      [job.id, JSON.stringify([{ message }])],
    );
    throw err;
  }
}

// ─── 5. Clover ────────────────────────────────────────────────────────────────

export interface CloverMigrationInput {
  accessToken: string;
  merchantId:  string;
}

export async function migrateFromClover(
  orgId:      string,
  locationId: string,
  employeeId: string,
  input:      CloverMigrationInput,
): Promise<ImportJob> {
  const job = await createMigrationJob(orgId, employeeId, 'migration_clover', `clover-${input.merchantId}`);
  const base    = `https://api.clover.com/v3/merchants/${input.merchantId}`;
  const headers = { 'Authorization': `Bearer ${input.accessToken}` };

  try {
    await query(
      `UPDATE import_jobs SET status = 'processing', started_at = now(), updated_at = now() WHERE id = $1`,
      [job.id],
    );

    // Fetch items
    type CloverItem = Record<string, unknown>;
    const cloverItems = await offsetFetchAll<CloverItem>(
      (offset) => `${base}/items?expand=categories&limit=100&offset=${offset}`,
      headers,
      (body) => ((body as Record<string, unknown>)['elements'] as CloverItem[]) ?? [],
    );

    // Fetch categories
    type CloverCat = Record<string, unknown>;
    const cloverCats = await offsetFetchAll<CloverCat>(
      (offset) => `${base}/categories?limit=100&offset=${offset}`,
      headers,
      (body) => ((body as Record<string, unknown>)['elements'] as CloverCat[]) ?? [],
    );

    // Fetch customers
    type CloverCustomer = Record<string, unknown>;
    const cloverCustomers = await offsetFetchAll<CloverCustomer>(
      (offset) => `${base}/customers?limit=100&offset=${offset}`,
      headers,
      (body) => ((body as Record<string, unknown>)['elements'] as CloverCustomer[]) ?? [],
    );

    const categories: MigCategory[] = cloverCats.map((c) => ({
      externalId: c['id'] as string,
      name:       (c['name'] as string) ?? 'Uncategorised',
    }));

    const products: MigProduct[] = cloverItems.map((item) => {
      const cats = (item['categories'] as Record<string, unknown> | undefined);
      const firstCat = ((cats?.['elements'] as CloverCat[]) ?? [])[0];

      return {
        externalId:   item['id'] as string,
        name:         (item['name'] as string) ?? 'Unknown',
        categoryName: firstCat?.['name'] as string | undefined,
        variants: [{
          externalId: item['id'] as string,
          name:       'Default',
          priceCents: (item['price'] as number) ?? 0,
          sku:        item['sku'] as string | undefined,
        }],
      };
    });

    const customers: MigCustomer[] = cloverCustomers.map((c) => {
      const phones  = (c['phoneNumbers'] as Record<string, unknown> | undefined);
      const emails  = (c['emailAddresses'] as Record<string, unknown> | undefined);
      const firstPh = ((phones?.['elements'] as Array<Record<string, unknown>>) ?? [])[0];
      const firstEm = ((emails?.['elements'] as Array<Record<string, unknown>>) ?? [])[0];

      return {
        externalId: c['id'] as string,
        firstName:  c['firstName'] as string | undefined,
        lastName:   c['lastName']  as string | undefined,
        email:      firstEm?.['emailAddress'] as string | undefined,
        phone:      firstPh?.['phoneNumber']  as string | undefined,
      };
    });

    const payload: MigrationPayload = {
      provider: 'migration_clover',
      categories,
      products,
      customers,
    };

    return savePayload(job.id, payload);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await query(
      `UPDATE import_jobs SET status = 'failed', error_log = $2::jsonb,
       completed_at = now(), updated_at = now() WHERE id = $1`,
      [job.id, JSON.stringify([{ message }])],
    );
    throw err;
  }
}

// ─── 6. Generic CSV ──────────────────────────────────────────────────────────

export interface CsvMigrationInput {
  fileUrl:      string;
  targetSchema: 'products' | 'customers' | 'inventory';
  rawCsv:       string;  // CSV content as string (already uploaded)
}

export async function migrateFromCsv(
  orgId:      string,
  locationId: string,
  employeeId: string,
  input:      CsvMigrationInput,
): Promise<ImportJob> {
  const { parse: csvParse } = await import('csv-parse/sync');
  const records = csvParse(input.rawCsv, {
    columns:           true,
    skip_empty_lines:  true,
  }) as Array<Record<string, string>>;

  const headers    = records.length > 0 ? Object.keys(records[0]) : [];
  const sampleRows = records.slice(0, 5).map((r) => Object.values(r));

  const columnMapping = await mapCsvColumns(headers, sampleRows, input.targetSchema);

  const { rows: [job] } = await query<ImportJob>(
    `INSERT INTO import_jobs
       (organization_id, import_type, status, source_filename, source_file_url,
        mapping_config, preview_data, total_rows, initiated_by)
     VALUES ($1, 'generic_csv', 'awaiting_confirmation', $2, $3, $4::jsonb, $5::jsonb, $6, $7)
     RETURNING *`,
    [
      orgId,
      `csv-${input.targetSchema}.csv`,
      input.fileUrl,
      JSON.stringify(columnMapping),
      JSON.stringify(records.slice(0, 10)),
      records.length,
      employeeId,
    ],
  );

  return job;
}

// ─── 7. Apply migration ──────────────────────────────────────────────────────

export interface ApplyOptions {
  importProducts: boolean;
  importCustomers: boolean;
  importLoyaltyPoints: boolean;
  overwriteExisting: boolean;
}

export async function applyMigration(
  orgId:      string,
  jobId:      string,
  locationId: string,
  employeeId: string,
  options: ApplyOptions = {
    importProducts:      true,
    importCustomers:     true,
    importLoyaltyPoints: true,
    overwriteExisting:   false,
  },
): Promise<MigrationResult> {
  const { rows: [job] } = await query<ImportJob>(
    `SELECT * FROM import_jobs WHERE id = $1 AND organization_id = $2`,
    [jobId, orgId],
  );
  if (!job) throw new NotFoundError('Migration job not found');
  if (job.status !== 'awaiting_confirmation') {
    throw new ValidationError(`Job is not ready to apply (status: ${job.status})`);
  }

  await query(
    `UPDATE import_jobs SET status = 'processing', updated_at = now() WHERE id = $1`,
    [jobId],
  );

  const result: MigrationResult = {
    categories: 0, products: 0, customers: 0, employees: 0, failed: 0, errors: [],
  };

  try {
    const payload = job.mapping_config as MigrationPayload;
    if (!payload?.provider) throw new ValidationError('Invalid migration payload');

    // ── A. Categories ─────────────────────────────────────────────────────────
    const categoryIdMap = new Map<string, string>(); // name → taproot ID

    for (const cat of payload.categories ?? []) {
      try {
        // Upsert category
        const { rows: [existing] } = await query<{ id: string }>(
          `SELECT id FROM categories WHERE organization_id = $1 AND name ILIKE $2 AND deleted_at IS NULL LIMIT 1`,
          [orgId, cat.name],
        );
        if (existing) {
          categoryIdMap.set(cat.name, existing.id);
        } else {
          const { rows: [created] } = await query<{ id: string }>(
            `INSERT INTO categories (organization_id, name, sort_order)
             VALUES ($1, $2, (SELECT COALESCE(MAX(sort_order),0)+1 FROM categories WHERE organization_id = $1))
             RETURNING id`,
            [orgId, cat.name],
          );
          categoryIdMap.set(cat.name, created.id);
          result.categories++;
        }
      } catch (err: unknown) {
        result.errors.push(`Category "${cat.name}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // ── B. Products ────────────────────────────────────────────────────────────
    if (options.importProducts) {
      for (const prod of payload.products ?? []) {
        try {
          const categoryId = prod.categoryName ? categoryIdMap.get(prod.categoryName) : undefined;

          // Check for existing product
          const { rows: [existing] } = await query<{ id: string }>(
            `SELECT id FROM products WHERE organization_id = $1 AND name ILIKE $2 AND deleted_at IS NULL LIMIT 1`,
            [orgId, prod.name],
          );

          let productId: string;

          if (existing && !options.overwriteExisting) {
            productId = existing.id;
          } else {
            const created = await ProductSvc.createProduct(orgId, locationId, {
              name:        prod.name,
              description: prod.description,
              categoryId,
              isActive:    true,
              trackInventory: true,
              // Store external ID in metadata
            }, employeeId);

            // Store external ID in metadata
            await query(
              `UPDATE products SET metadata = metadata || $2::jsonb WHERE id = $1`,
              [created.id, JSON.stringify({ externalId: { [payload.provider]: prod.externalId } })],
            );

            productId = created.id;
            result.products++;
          }

          // Create variants + prices
          for (const variant of prod.variants) {
            // Check if variant already exists
            const { rows: [existingVar] } = await query<{ id: string }>(
              `SELECT id FROM product_variants WHERE product_id = $1 AND name = $2 AND deleted_at IS NULL LIMIT 1`,
              [productId, variant.name],
            );

            let variantId: string;
            if (existingVar) {
              variantId = existingVar.id;
            } else {
              const { rows: [newVar] } = await query<{ id: string }>(
                `INSERT INTO product_variants (product_id, name, sku, barcode, sort_order, is_active)
                 VALUES ($1, $2, $3, $4, 0, true) RETURNING id`,
                [productId, variant.name, variant.sku ?? null, variant.barcode ?? null],
              );
              variantId = newVar.id;
            }

            // Upsert price
            if (variant.priceCents > 0) {
              await query(
                `UPDATE product_prices SET is_active = false WHERE variant_id = $1 AND is_active = true`,
                [variantId],
              );
              await query(
                `INSERT INTO product_prices (variant_id, price, currency, is_active, price_type)
                 VALUES ($1, $2, 'USD', true, 'fixed')`,
                [variantId, variant.priceCents],
              );
            }
          }
        } catch (err: unknown) {
          result.failed++;
          result.errors.push(`Product "${prod.name}": ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    // ── C. Customers ──────────────────────────────────────────────────────────
    if (options.importCustomers) {
      for (const cust of payload.customers ?? []) {
        try {
          // Skip if no identifying information
          if (!cust.email && !cust.phone && !cust.firstName && !cust.lastName) continue;

          const customer = await CustomerSvc.createCustomer(orgId, employeeId, {
            firstName:  cust.firstName,
            lastName:   cust.lastName,
            email:      cust.email,
            phone:      cust.phone,
            tags:       cust.tags,
            externalIds: { [payload.provider]: cust.externalId },
          });

          // Set loyalty points if applicable
          if (options.importLoyaltyPoints && cust.loyaltyPoints && cust.loyaltyPoints > 0) {
            await query(
              `UPDATE customers SET loyalty_points = $2 WHERE id = $1`,
              [customer.id, cust.loyaltyPoints],
            );
          }

          result.customers++;
        } catch (err: unknown) {
          // Duplicate email/phone is expected — count as a soft failure
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('already exists')) {
            result.errors.push(`Customer ${cust.email ?? cust.phone ?? cust.externalId}: skipped (duplicate)`);
          } else {
            result.failed++;
            result.errors.push(`Customer ${cust.email ?? cust.externalId}: ${msg}`);
          }
        }
      }
    }

    // ── D. Finalize ───────────────────────────────────────────────────────────
    const finalStatus = result.failed > 0 && result.products + result.customers === 0
      ? 'failed'
      : result.failed > 0 ? 'partial' : 'completed';

    await query(
      `UPDATE import_jobs
         SET status         = $2,
             succeeded_rows = $3,
             failed_rows    = $4,
             processed_rows = $5,
             error_log      = $6::jsonb,
             completed_at   = now(),
             updated_at     = now()
       WHERE id = $1`,
      [
        jobId, finalStatus,
        result.products + result.customers + result.categories,
        result.failed,
        result.products + result.customers + result.categories + result.failed,
        JSON.stringify(result.errors.map((m) => ({ message: m }))),
      ],
    );

    await createAuditLog({
      organizationId: orgId,
      actorId:        employeeId,
      action:         'migration.applied',
      resourceType:   'import_job',
      resourceId:     jobId,
      metadata:       { ...result, provider: payload.provider },
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await query(
      `UPDATE import_jobs SET status = 'failed', error_log = $2::jsonb,
       completed_at = now(), updated_at = now() WHERE id = $1`,
      [jobId, JSON.stringify([{ message }])],
    );
    throw err;
  }

  return result;
}

// ─── 8. List migration jobs ───────────────────────────────────────────────────

export async function listMigrationJobs(orgId: string): Promise<ImportJob[]> {
  const { rows } = await query<ImportJob>(
    `SELECT * FROM import_jobs
      WHERE organization_id = $1
        AND import_type LIKE 'migration_%'
      ORDER BY created_at DESC
      LIMIT 50`,
    [orgId],
  );
  return rows;
}

// ─── 9. Test connection helpers ───────────────────────────────────────────────

export async function testSquareConnection(accessToken: string): Promise<{ ok: boolean; locationCount: number }> {
  const res = await fetch('https://connect.squareup.com/v2/locations', {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Square-Version': '2024-01-17' },
  });
  if (!res.ok) throw new ValidationError(`Square connection failed: HTTP ${res.status}`);
  const data = await res.json() as { locations?: unknown[] };
  return { ok: true, locationCount: data.locations?.length ?? 0 };
}

export async function testShopifyConnection(shopDomain: string, accessToken: string): Promise<{ ok: boolean; shopName: string }> {
  const domain = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const res = await fetch(`https://${domain}/admin/api/2024-01/shop.json`, {
    headers: { 'X-Shopify-Access-Token': accessToken },
  });
  if (!res.ok) throw new ValidationError(`Shopify connection failed: HTTP ${res.status}`);
  const data = await res.json() as { shop?: { name: string } };
  return { ok: true, shopName: data.shop?.name ?? shopDomain };
}

export async function testCloverConnection(merchantId: string, accessToken: string): Promise<{ ok: boolean; merchantName: string }> {
  const res = await fetch(`https://api.clover.com/v3/merchants/${merchantId}`, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new ValidationError(`Clover connection failed: HTTP ${res.status}`);
  const data = await res.json() as { name?: string };
  return { ok: true, merchantName: data.name ?? merchantId };
}
