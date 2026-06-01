/**
 * Import Job Service — orchestrates AI document parsing and applies
 * the results to the Taproot database.
 *
 * Flow:
 *   upload → createImportJob → [queue] → processImportJob
 *   → (status: awaiting_confirmation) → confirmImportJob
 *   → apply* → (status: completed / partial / failed)
 */

import fs from 'fs';
import path from 'path';
import { parse as csvParse } from 'csv-parse/sync';
import { PDFParse } from 'pdf-parse';
import { query, withTransaction } from '../db/client';
import { createAuditLog } from '../auth/audit';
import { NotFoundError, ValidationError } from '../errors';
import { config } from '../config';
import {
  classifyDocument,
  parseMenu,
  parseInvoice,
  parseGoodsReceipt,
  parseInventoryList,
  parseRecipeSheet,
  mapCsvColumns,
  parseImageDocument,
  type DocumentType,
  type ColumnMapping,
  type ParsedMenu,
  type ParsedInvoice,
  type ParsedGoodsReceipt,
  type ParsedInventoryList,
  type ParsedRecipeSheet,
} from './documentParser.service';
import * as ProductSvc from './product.service';
import * as InventorySvc from './inventory.service';
import * as RecipeSvc from './recipe.service';
import * as POSvc from './purchaseOrder.service';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ImportType =
  | 'document_menu'
  | 'document_invoice'
  | 'document_goods_receipt'
  | 'document_inventory'
  | 'document_recipe'
  | 'generic_csv';

export interface ImportJob {
  id:              string;
  organization_id: string;
  import_type:     ImportType;
  status:          'pending' | 'processing' | 'awaiting_confirmation' | 'completed' | 'failed' | 'partial';
  source_filename: string | null;
  source_file_url: string | null;
  mapping_config:  ColumnMapping | null;
  total_rows:      number | null;
  processed_rows:  number;
  succeeded_rows:  number;
  failed_rows:     number;
  error_log:       Array<{ row?: number; message: string }>;
  preview_data:    unknown;
  started_at:      string | null;
  completed_at:    string | null;
  initiated_by:    string | null;
  created_at:      string;
  updated_at:      string;
}

export interface CreateImportJobInput {
  importType:      ImportType;
  sourceFilename:  string;
  sourceFileUrl:   string;
  mimeType:        string;
}

export interface ImportResult {
  created: number;
  updated: number;
  failed:  number;
  errors:  string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Fuzzy-ish product match by name (case-insensitive ILIKE) */
async function findProductByName(
  orgId: string,
  name: string,
): Promise<{ id: string; name: string } | null> {
  const { rows } = await query<{ id: string; name: string }>(
    `SELECT id, name FROM products
      WHERE organization_id = $1
        AND deleted_at IS NULL
        AND name ILIKE $2
      LIMIT 1`,
    [orgId, `%${name.trim()}%`],
  );
  return rows[0] ?? null;
}

/** Fuzzy product match by SKU or name */
async function findProductBySkuOrName(
  orgId: string,
  sku:   string | null | undefined,
  name:  string,
): Promise<{ id: string; name: string } | null> {
  if (sku) {
    const { rows } = await query<{ id: string; name: string }>(
      `SELECT id, name FROM products
        WHERE organization_id = $1 AND sku = $2 AND deleted_at IS NULL LIMIT 1`,
      [orgId, sku],
    );
    if (rows.length) return rows[0];
  }
  return findProductByName(orgId, name);
}

/** Get or create the default variant for a product */
async function getDefaultVariantId(productId: string): Promise<string | null> {
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM product_variants
      WHERE product_id = $1 AND deleted_at IS NULL
      ORDER BY sort_order ASC LIMIT 1`,
    [productId],
  );
  return rows[0]?.id ?? null;
}

/** Find or create a category by name */
async function findOrCreateCategory(
  orgId: string,
  name:  string,
): Promise<string> {
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM categories WHERE organization_id = $1 AND name ILIKE $2 AND deleted_at IS NULL LIMIT 1`,
    [orgId, name],
  );
  if (rows[0]) return rows[0].id;

  const { rows: [created] } = await query<{ id: string }>(
    `INSERT INTO categories (organization_id, name, sort_order)
     VALUES ($1, $2, (SELECT COALESCE(MAX(sort_order),0)+1 FROM categories WHERE organization_id = $1))
     RETURNING id`,
    [orgId, name],
  );
  return created.id;
}

/** Find or create a supplier by name */
async function findOrCreateSupplier(
  orgId: string,
  name:  string,
): Promise<string> {
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM suppliers WHERE organization_id = $1 AND name ILIKE $2 AND deleted_at IS NULL LIMIT 1`,
    [orgId, name],
  );
  if (rows[0]) return rows[0].id;

  const { rows: [created] } = await query<{ id: string }>(
    `INSERT INTO suppliers (organization_id, name) VALUES ($1, $2) RETURNING id`,
    [orgId, name],
  );
  return created.id;
}

// ─── Extract text from file ───────────────────────────────────────────────────

async function extractTextContent(
  filePath: string,
  mimeType: string,
): Promise<string> {
  const buffer = fs.readFileSync(filePath);

  // PDF
  if (mimeType === 'application/pdf') {
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    return result.text;
  }

  // Images — use Claude vision
  if (mimeType.startsWith('image/')) {
    const supported = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
    const imgType = supported.find((t) => t === mimeType) ?? 'image/jpeg';
    return parseImageDocument(buffer, imgType);
  }

  // CSV
  if (mimeType === 'text/csv' || filePath.endsWith('.csv')) {
    return buffer.toString('utf8');
  }

  // Plain text / everything else
  return buffer.toString('utf8');
}

// ─── 1. Create import job ─────────────────────────────────────────────────────

export async function createImportJob(
  orgId:      string,
  employeeId: string,
  input:      CreateImportJobInput,
): Promise<ImportJob> {
  const { rows: [job] } = await query<ImportJob>(
    `INSERT INTO import_jobs
       (organization_id, import_type, status, source_filename, source_file_url, initiated_by)
     VALUES ($1, $2, 'pending', $3, $4, $5)
     RETURNING *`,
    [orgId, input.importType, input.sourceFilename, input.sourceFileUrl, employeeId],
  );
  return job;
}

// ─── 2. Process import job (runs in queue) ────────────────────────────────────

export async function processImportJob(jobId: string): Promise<void> {
  // Load job
  const { rows: [job] } = await query<ImportJob>(
    `SELECT * FROM import_jobs WHERE id = $1`,
    [jobId],
  );
  if (!job) throw new NotFoundError(`Import job ${jobId} not found`);

  // Mark processing
  await query(
    `UPDATE import_jobs SET status = 'processing', started_at = now(), updated_at = now() WHERE id = $1`,
    [jobId],
  );

  try {
    // Resolve file path (dev: local uploads dir)
    const filePath = job.source_file_url?.startsWith('uploads/')
      ? path.join(process.cwd(), job.source_file_url)
      : job.source_file_url ?? '';

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    // Detect mime from extension if not stored
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.pdf': 'application/pdf',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.csv': 'text/csv',
      '.txt': 'text/plain',
    };
    const mimeType = mimeMap[ext] ?? 'text/plain';

    // Extract text
    const textContent = await extractTextContent(filePath, mimeType);

    // Determine import type
    let importType = job.import_type;
    let previewData: unknown;
    let mappingConfig: ColumnMapping | null = null;
    let totalRows: number | null = null;

    if (importType === 'generic_csv') {
      // Parse headers + sample for column mapping
      const records = csvParse(textContent, { columns: true, skip_empty_lines: true }) as Array<Record<string, string>>;
      const headers = records.length > 0 ? Object.keys(records[0]) : [];
      const sampleRows = records.slice(0, 5).map((r) => Object.values(r));
      mappingConfig = await mapCsvColumns(headers, sampleRows, 'products');
      previewData = records.slice(0, 10);
      totalRows = records.length;
    } else {
      // AI-classify if needed, then parse
      const classify = await classifyDocument(textContent, job.source_filename ?? '');

      // Override import_type if classification is confident
      const TYPE_MAP: Record<DocumentType, ImportType | null> = {
        menu:           'document_menu',
        invoice:        'document_invoice',
        goods_receipt:  'document_goods_receipt',
        inventory_list: 'document_inventory',
        recipe_sheet:   'document_recipe',
        unknown:        null,
      };
      const detected = TYPE_MAP[classify.type];
      if (detected) importType = detected;

      // Parse based on type
      if (importType === 'document_menu') {
        const parsed = await parseMenu(textContent);
        previewData = parsed.items.slice(0, 10);
        totalRows = parsed.items.length;
        mappingConfig = { mappings: [], unmappedColumns: [], confidence: parsed.confidence };
        // Store full parsed data in mapping_config for apply step
        mappingConfig = { mappings: [], unmappedColumns: [], confidence: parsed.confidence, ...{ parsed } } as unknown as ColumnMapping;
      } else if (importType === 'document_invoice') {
        const parsed = await parseInvoice(textContent);
        previewData = parsed.lineItems.slice(0, 10);
        totalRows = parsed.lineItems.length;
        mappingConfig = { mappings: [], unmappedColumns: [], confidence: parsed.confidence, ...{ parsed } } as unknown as ColumnMapping;
      } else if (importType === 'document_goods_receipt') {
        const parsed = await parseGoodsReceipt(textContent);
        previewData = parsed.items.slice(0, 10);
        totalRows = parsed.items.length;
        mappingConfig = { mappings: [], unmappedColumns: [], confidence: parsed.confidence, ...{ parsed } } as unknown as ColumnMapping;
      } else if (importType === 'document_inventory') {
        const parsed = await parseInventoryList(textContent);
        previewData = parsed.items.slice(0, 10);
        totalRows = parsed.items.length;
        mappingConfig = { mappings: [], unmappedColumns: [], confidence: parsed.confidence, ...{ parsed } } as unknown as ColumnMapping;
      } else if (importType === 'document_recipe') {
        const parsed = await parseRecipeSheet(textContent);
        previewData = parsed.recipes.slice(0, 10);
        totalRows = parsed.recipes.length;
        mappingConfig = { mappings: [], unmappedColumns: [], confidence: parsed.confidence, ...{ parsed } } as unknown as ColumnMapping;
      } else {
        throw new Error(`Cannot parse document of type: ${importType}`);
      }
    }

    // Update job to awaiting_confirmation
    await query(
      `UPDATE import_jobs
         SET status = 'awaiting_confirmation',
             import_type = $2,
             preview_data = $3,
             mapping_config = $4,
             total_rows = $5,
             updated_at = now()
       WHERE id = $1`,
      [jobId, importType, JSON.stringify(previewData), JSON.stringify(mappingConfig), totalRows],
    );

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await query(
      `UPDATE import_jobs
         SET status = 'failed',
             error_log = $2::jsonb,
             completed_at = now(),
             updated_at = now()
       WHERE id = $1`,
      [jobId, JSON.stringify([{ message }])],
    );
    throw err;
  }
}

// ─── 3. Confirm and apply ─────────────────────────────────────────────────────

export async function confirmImportJob(
  orgId:             string,
  jobId:             string,
  employeeId:        string,
  locationId:        string,
  confirmedMapping?: ColumnMapping,
): Promise<ImportJob> {
  const { rows: [job] } = await query<ImportJob>(
    `SELECT * FROM import_jobs WHERE id = $1 AND organization_id = $2`,
    [jobId, orgId],
  );
  if (!job) throw new NotFoundError('Import job not found');
  if (job.status !== 'awaiting_confirmation') {
    throw new ValidationError('Import job is not awaiting confirmation');
  }

  const mapping = confirmedMapping ?? (job.mapping_config as ColumnMapping);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stored = mapping as any;

  await query(
    `UPDATE import_jobs SET status = 'processing', updated_at = now() WHERE id = $1`,
    [jobId],
  );

  let result: ImportResult;
  try {
    switch (job.import_type) {
      case 'document_menu':
        result = await applyMenuImport(orgId, locationId, stored.parsed as ParsedMenu, employeeId);
        break;
      case 'document_invoice':
        result = await applyInvoiceImport(orgId, locationId, stored.parsed as ParsedInvoice, employeeId);
        break;
      case 'document_goods_receipt':
        result = await applyGoodsReceiptImport(orgId, locationId, stored.parsed as ParsedGoodsReceipt, employeeId);
        break;
      case 'document_inventory':
        result = await applyInventoryListImport(orgId, locationId, stored.parsed as ParsedInventoryList, employeeId);
        break;
      case 'document_recipe':
        result = await applyRecipeSheetImport(orgId, stored.parsed as ParsedRecipeSheet, employeeId);
        break;
      default:
        throw new ValidationError(`Unsupported import type: ${job.import_type}`);
    }

    const finalStatus = result.failed > 0 && result.created + result.updated === 0
      ? 'failed'
      : result.failed > 0
        ? 'partial'
        : 'completed';

    await query(
      `UPDATE import_jobs
         SET status = $2,
             succeeded_rows = $3,
             failed_rows = $4,
             processed_rows = $5,
             error_log = $6::jsonb,
             completed_at = now(),
             updated_at = now()
       WHERE id = $1`,
      [
        jobId, finalStatus,
        result.created + result.updated,
        result.failed,
        result.created + result.updated + result.failed,
        JSON.stringify(result.errors.map((m) => ({ message: m }))),
      ],
    );

    await createAuditLog({
      organizationId: orgId,
      actorId:      employeeId,
      actorType:    'employee',
      action:       'import.completed',
      resourceType: 'import_job',
      resourceId:   jobId,
      metadata:     { importType: job.import_type, ...result },
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await query(
      `UPDATE import_jobs
         SET status = 'failed',
             error_log = $2::jsonb,
             completed_at = now(),
             updated_at = now()
       WHERE id = $1`,
      [jobId, JSON.stringify([{ message }])],
    );
    throw err;
  }

  const { rows: [updated] } = await query<ImportJob>(
    `SELECT * FROM import_jobs WHERE id = $1`,
    [jobId],
  );
  return updated;
}

// ─── Apply functions ──────────────────────────────────────────────────────────

export async function applyMenuImport(
  orgId:      string,
  locationId: string,
  parsed:     ParsedMenu,
  employeeId: string,
): Promise<ImportResult> {
  const result: ImportResult = { created: 0, updated: 0, failed: 0, errors: [] };

  for (const item of parsed.items) {
    try {
      const existing = await findProductByName(orgId, item.name);

      if (existing) {
        // Update price on default variant
        const variantId = await getDefaultVariantId(existing.id);
        if (variantId && item.price > 0) {
          await query(
            `UPDATE product_prices SET is_active = false
              WHERE variant_id = $1 AND is_active = true`,
            [variantId],
          );
          await query(
            `INSERT INTO product_prices (variant_id, price, currency, is_active, price_type)
             VALUES ($1, $2, 'USD', true, 'fixed')`,
            [variantId, item.price],
          );
        }
        result.updated++;
      } else {
        // Create product
        const categoryId = item.category
          ? await findOrCreateCategory(orgId, item.category)
          : undefined;

        const product = await ProductSvc.createProduct(orgId, locationId, {
          name: item.name,
          description: item.description,
          categoryId,
          isActive: true,
          trackInventory: false,
        }, employeeId);

        // Create default variant + price
        if (item.price > 0) {
          const { rows: [variant] } = await query<{ id: string }>(
            `INSERT INTO product_variants (product_id, name, sort_order, is_active)
             VALUES ($1, 'Default', 0, true) RETURNING id`,
            [product.id],
          );

          await query(
            `INSERT INTO product_prices (variant_id, price, currency, is_active, price_type)
             VALUES ($1, $2, 'USD', true, 'fixed')`,
            [variant.id, item.price],
          );

          // Create modifier groups
          if (item.modifiers?.length) {
            for (const mg of item.modifiers) {
              const { rows: [group] } = await query<{ id: string }>(
                `INSERT INTO modifier_groups (organization_id, name, selection_type, is_required)
                 VALUES ($1, $2, 'single', false) RETURNING id`,
                [orgId, mg.groupName],
              );
              for (const opt of mg.options) {
                await query(
                  `INSERT INTO modifier_options (modifier_group_id, name, price_delta)
                   VALUES ($1, $2, $3)`,
                  [group.id, opt.name, opt.priceDelta],
                );
              }
              await query(
                `INSERT INTO product_modifier_groups (product_id, modifier_group_id, sort_order)
                 VALUES ($1, $2, 0)`,
                [product.id, group.id],
              );
            }
          }
        }
        result.created++;
      }
    } catch (err: unknown) {
      result.failed++;
      result.errors.push(`"${item.name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

export async function applyInvoiceImport(
  orgId:      string,
  locationId: string,
  parsed:     ParsedInvoice,
  employeeId: string,
): Promise<ImportResult> {
  const result: ImportResult = { created: 0, updated: 0, failed: 0, errors: [] };

  try {
    // Find or create supplier
    const supplierId = parsed.supplierName
      ? await findOrCreateSupplier(orgId, parsed.supplierName)
      : undefined;

    // Build PO lines
    const lines: POSvc.CreatePOLineInput[] = [];

    for (const li of parsed.lineItems) {
      const product = await findProductBySkuOrName(orgId, li.sku, li.description);
      if (product) {
        lines.push({
          productId:       product.id,
          variantId:       null,
          quantityOrdered: li.quantity,
          unitCost:        li.unitCost,
        });
      }
    }

    if (lines.length > 0) {
      await POSvc.createPurchaseOrder(orgId, employeeId, {
        locationId,
        supplierId: supplierId ?? null,
        notes: parsed.invoiceNumber ? `Invoice: ${parsed.invoiceNumber}` : undefined,
        lines,
      });
      result.created++;
    }

    // Count matched / unmatched lines
    for (const li of parsed.lineItems) {
      const product = await findProductBySkuOrName(orgId, li.sku, li.description);
      if (product) {
        result.updated++;
      } else {
        result.failed++;
        result.errors.push(`Product not found: "${li.description}"`);
      }
    }
  } catch (err: unknown) {
    result.failed++;
    result.errors.push(err instanceof Error ? err.message : String(err));
  }

  return result;
}

export async function applyGoodsReceiptImport(
  orgId:      string,
  locationId: string,
  parsed:     ParsedGoodsReceipt,
  employeeId: string,
): Promise<ImportResult> {
  const result: ImportResult = { created: 0, updated: 0, failed: 0, errors: [] };

  for (const item of parsed.items) {
    try {
      const product = await findProductBySkuOrName(orgId, item.sku, item.description);
      if (!product) {
        result.failed++;
        result.errors.push(`Product not found: "${item.description}"`);
        continue;
      }

      await InventorySvc.adjustInventory(orgId, locationId, {
        productId:    product.id,
        variantId:    null,
        delta:        item.quantityDelivered,
        movementType: 'adjustment',
        reason:       `Goods receipt import${parsed.poNumber ? ` (PO: ${parsed.poNumber})` : ''}`,
      }, employeeId);
      result.updated++;
    } catch (err: unknown) {
      result.failed++;
      result.errors.push(`"${item.description}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

export async function applyInventoryListImport(
  orgId:      string,
  locationId: string,
  parsed:     ParsedInventoryList,
  employeeId: string,
): Promise<ImportResult> {
  const result: ImportResult = { created: 0, updated: 0, failed: 0, errors: [] };

  for (const item of parsed.items) {
    try {
      const product = await findProductBySkuOrName(orgId, item.sku, item.name);
      if (!product) {
        result.failed++;
        result.errors.push(`Product not found: "${item.name}"`);
        continue;
      }

      await InventorySvc.recordStockCount(orgId, locationId, [{
        productId:       product.id,
        variantId:       null,
        countedQuantity: item.quantity,
        notes:           'Imported from inventory list',
      }], employeeId);
      result.updated++;
    } catch (err: unknown) {
      result.failed++;
      result.errors.push(`"${item.name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

export async function applyRecipeSheetImport(
  orgId:      string,
  parsed:     ParsedRecipeSheet,
  employeeId: string,
): Promise<ImportResult> {
  const result: ImportResult = { created: 0, updated: 0, failed: 0, errors: [] };

  for (const recipe of parsed.recipes) {
    try {
      const product = await findProductByName(orgId, recipe.productName);
      if (!product) {
        result.failed++;
        result.errors.push(`Product not found: "${recipe.productName}"`);
        continue;
      }

      // Build ingredient lines
      const lines: RecipeSvc.RecipeLineInput[] = [];
      for (const ing of recipe.ingredients) {
        const ingProduct = await findProductByName(orgId, ing.name);
        if (!ingProduct) {
          result.errors.push(`Ingredient not found: "${ing.name}" (skipped)`);
          continue;
        }
        lines.push({
          ingredientProductId: ingProduct.id,
          ingredientVariantId: undefined,
          quantity:            ing.quantity,
          unit:                ing.unit,
          wasteFactor:         ing.wasteFactor ?? 0,
        });
      }

      if (lines.length === 0) {
        result.failed++;
        result.errors.push(`No ingredients matched for recipe "${recipe.productName}"`);
        continue;
      }

      await RecipeSvc.createOrUpdateRecipe(orgId, product.id, {
        name:        recipe.productName,
        yieldFactor: recipe.yieldFactor ?? 1,
        lines,
      }, employeeId);
      result.created++;
    } catch (err: unknown) {
      result.failed++;
      result.errors.push(`"${recipe.productName}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

// ─── Read helpers ─────────────────────────────────────────────────────────────

export async function getImportJob(orgId: string, jobId: string): Promise<ImportJob> {
  const { rows: [job] } = await query<ImportJob>(
    `SELECT * FROM import_jobs WHERE id = $1 AND organization_id = $2`,
    [jobId, orgId],
  );
  if (!job) throw new NotFoundError('Import job not found');
  return job;
}

export async function listImportJobs(
  orgId:   string,
  filters: { status?: string; importType?: string; limit?: number; offset?: number },
): Promise<{ jobs: ImportJob[]; total: number }> {
  const wheres: string[] = ['organization_id = $1'];
  const vals:   unknown[] = [orgId];
  let idx = 2;

  if (filters.status) {
    wheres.push(`status = $${idx++}`);
    vals.push(filters.status);
  }
  if (filters.importType) {
    wheres.push(`import_type = $${idx++}`);
    vals.push(filters.importType);
  }

  const where = wheres.join(' AND ');
  const limit  = filters.limit  ?? 20;
  const offset = filters.offset ?? 0;

  const [{ rows: jobs }, { rows: [{ total }] }] = await Promise.all([
    query<ImportJob>(
      `SELECT * FROM import_jobs WHERE ${where}
       ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...vals, limit, offset],
    ),
    query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM import_jobs WHERE ${where}`,
      vals,
    ),
  ]);

  return { jobs, total: parseInt(total, 10) };
}
