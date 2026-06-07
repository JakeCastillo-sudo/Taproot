import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AccessTokenPayload } from '../auth/jwt';
import { requireLocation } from '../auth/middleware';
import * as ProductSvc from '../services/product.service';
import * as CategorySvc from '../services/category.service';
import * as VariantSvc from '../services/variant.service';
import * as RecipeSvc from '../services/recipe.service';
import * as InventorySvc from '../services/inventory.service';
import * as ForecastSvc from '../services/forecast.service';
import * as VarianceSvc from '../services/variance.service';
import { getCached, invalidateOrgCache } from '../lib/cache';

const LIST_CACHE_TTL = 300; // 5 min — invalidated on product/category writes

// Convenience type — all authenticated routes have request.user set
type AuthedRequest = FastifyRequest & { user: AccessTokenPayload };

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default async function inventoryRoutes(fastify: FastifyInstance): Promise<void> {

  // ── Categories ────────────────────────────────────────────────────────────

  // GET /api/v1/categories — Redis-cached 5 min (S8-06), invalidated on writes
  fastify.get('/api/v1/categories', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const payload = await getCached(`org:${user.orgId}:categories`, LIST_CACHE_TTL, async () => {
      const { rows } = await (await import('../db/client')).query<{
        id: string; name: string; color: string | null; icon: string | null;
        sort_order: number; product_count: number;
      }>(
        `SELECT c.id, c.name, c.color, c.icon, c.sort_order,
                COUNT(p.id) FILTER (
                  WHERE p.deleted_at IS NULL AND p.is_active = true
                )::int AS product_count
           FROM categories c
           LEFT JOIN products p ON p.category_id = c.id AND p.organization_id = c.organization_id
          WHERE c.organization_id = $1 AND c.deleted_at IS NULL
          GROUP BY c.id
          ORDER BY c.sort_order ASC, c.name ASC`,
        [user.orgId],
      );
      return { categories: rows };
    });
    return reply.send(payload);
  });

  // POST /api/v1/categories
  fastify.post('/api/v1/categories', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const body = req.body as CategorySvc.CreateCategoryData;
    const category = await CategorySvc.createCategory(user.orgId, body, user.sub);
    return reply.code(201).send(category);
  });

  // PATCH /api/v1/categories/reorder — bulk sort_order update (declare before :id)
  fastify.patch('/api/v1/categories/reorder', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { positions } = req.body as { positions: Array<{ id: string; sortOrder: number }> };
    await CategorySvc.reorderCategories(user.orgId, positions ?? []);
    return reply.send({ success: true });
  });

  // PATCH /api/v1/categories/:id
  fastify.patch('/api/v1/categories/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    const body = req.body as CategorySvc.UpdateCategoryData;
    const category = await CategorySvc.updateCategory(user.orgId, id, body, user.sub);
    return reply.send(category);
  });

  // DELETE /api/v1/categories/:id — soft delete (detaches products)
  fastify.delete('/api/v1/categories/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    await CategorySvc.deleteCategory(user.orgId, id, user.sub);
    return reply.code(204).send();
  });

  // ── Products ──────────────────────────────────────────────────────────────

  // GET /api/v1/products — Redis-cached 5 min per filter variant (S8-06),
  // invalidated on product writes
  fastify.get('/api/v1/products', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const q = req.query as Record<string, string>;

    const variant = new URLSearchParams(
      Object.entries(q).filter(([, v]) => v !== undefined && v !== ''),
    );
    variant.sort();
    const cacheKey = `org:${user.orgId}:products:${variant.toString() || 'all'}`;

    const result = await getCached(cacheKey, LIST_CACHE_TTL, () =>
      ProductSvc.listProducts(user.orgId, {
        categoryId: q.categoryId,
        supplierId: q.supplierId,
        isActive: q.isActive !== undefined ? q.isActive === 'true' : undefined,
        search: q.search,
        productType: q.productType as ProductSvc.ListProductsFilters['productType'],
        locationId: q.locationId,
        page: q.page ? parseInt(q.page, 10) : undefined,
        limit: q.limit ? parseInt(q.limit, 10) : undefined,
        sortBy: q.sortBy as ProductSvc.ListProductsFilters['sortBy'],
        sortOrder: q.sortOrder as ProductSvc.ListProductsFilters['sortOrder'],
        // Additive day-part filter — products with no assignment are always visible
        dayPart: q.dayPart,
      }));

    return reply.send(result);
  });

  // GET /api/v1/products/barcode/:barcode
  fastify.get('/api/v1/products/barcode/:barcode', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { barcode } = req.params as { barcode: string };
    const product = await ProductSvc.searchByBarcode(user.orgId, barcode);
    if (!product) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Product not found' });
    return reply.send(product);
  });

  // GET /api/v1/products/:id
  fastify.get('/api/v1/products/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    const product = await ProductSvc.getProduct(user.orgId, id);
    return reply.send(product);
  });

  // POST /api/v1/products
  fastify.post('/api/v1/products', {
    preHandler: [requireLocation('locationId')],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const body = req.body as ProductSvc.CreateProductData & { locationId?: string };
    const locationId = body.locationId ?? '';
    const product = await ProductSvc.createProduct(user.orgId, locationId, body, user.sub);
    return reply.code(201).send(product);
  });

  // PATCH /api/v1/products/:id
  fastify.patch('/api/v1/products/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    const body = req.body as ProductSvc.UpdateProductData;
    const product = await ProductSvc.updateProduct(user.orgId, id, body, user.sub);
    return reply.send(product);
  });

  // DELETE /api/v1/products/:id
  fastify.delete('/api/v1/products/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    await ProductSvc.deleteProduct(user.orgId, id, user.sub);
    return reply.code(204).send();
  });

  // ── Archive / restore / list-archived ─────────────────────────────────────

  // GET /api/v1/products/archived — list archived products for admin
  fastify.get('/api/v1/products/archived', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const archived = await ProductSvc.listArchivedProducts(user.orgId);
    return reply.send({ products: archived });
  });

  // POST /api/v1/products/:id/archive — hide product from POS register
  fastify.post('/api/v1/products/:id/archive', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    const { reason } = (req.body ?? {}) as { reason?: string };
    await ProductSvc.archiveProduct(user.orgId, id, user.sub, reason);
    return reply.send({ success: true });
  });

  // POST /api/v1/products/:id/restore — restore archived product to active
  fastify.post('/api/v1/products/:id/restore', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    await ProductSvc.restoreProduct(user.orgId, id, user.sub);
    return reply.send({ success: true });
  });

  // ── Variants ──────────────────────────────────────────────────────────────

  // POST /api/v1/products/:productId/variants
  fastify.post('/api/v1/products/:productId/variants', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { productId } = req.params as { productId: string };
    const body = req.body as VariantSvc.CreateVariantData;
    const variant = await VariantSvc.createVariant(user.orgId, productId, body, user.sub);
    return reply.code(201).send(variant);
  });

  // PATCH /api/v1/variants/:id
  fastify.patch('/api/v1/variants/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    const body = req.body as VariantSvc.UpdateVariantData;
    const variant = await VariantSvc.updateVariant(user.orgId, id, body, user.sub);
    return reply.send(variant);
  });

  // DELETE /api/v1/variants/:id
  fastify.delete('/api/v1/variants/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    await VariantSvc.deleteVariant(user.orgId, id, user.sub);
    return reply.code(204).send();
  });

  // PUT /api/v1/variants/:id/prices
  fastify.put('/api/v1/variants/:id/prices', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    const { prices } = req.body as { prices: VariantSvc.PriceInput[] };
    await VariantSvc.setPrices(user.orgId, id, prices);
    return reply.code(204).send();
  });

  // GET /api/v1/variants/:id/price
  fastify.get('/api/v1/variants/:id/price', async (req: FastifyRequest, reply: FastifyReply) => {
    const q = req.query as { locationId?: string; currency?: string; asOf?: string };
    const { id } = req.params as { id: string };
    const price = await VariantSvc.getActivePrice(
      id,
      q.locationId ?? null,
      q.currency ?? 'USD',
      q.asOf ? new Date(q.asOf) : undefined,
    );
    return reply.send({ price });
  });

  // ── Recipes ───────────────────────────────────────────────────────────────

  // GET /api/v1/products/:productId/recipe
  fastify.get('/api/v1/products/:productId/recipe', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { productId } = req.params as { productId: string };
    const recipe = await RecipeSvc.getRecipe(user.orgId, productId);
    return reply.send(recipe);
  });

  // PUT /api/v1/products/:productId/recipe
  fastify.put('/api/v1/products/:productId/recipe', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { productId } = req.params as { productId: string };
    const body = req.body as RecipeSvc.CreateRecipeData;
    const recipe = await RecipeSvc.createOrUpdateRecipe(user.orgId, productId, body, user.sub);
    return reply.send(recipe);
  });

  // ── Inventory Levels ──────────────────────────────────────────────────────

  // GET /api/v1/locations/:locationId/inventory
  fastify.get('/api/v1/locations/:locationId/inventory', {
    preHandler: [requireLocation()],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { locationId } = req.params as { locationId: string };
    const q = req.query as Record<string, string>;

    const result = await InventorySvc.listInventoryLevels(user.orgId, locationId, {
      productId: q.productId,
      belowReorderPoint: q.belowReorderPoint === 'true',
      search: q.search,
      page: q.page ? parseInt(q.page, 10) : undefined,
      limit: q.limit ? parseInt(q.limit, 10) : undefined,
    });

    return reply.send(result);
  });

  // GET /api/v1/locations/:locationId/inventory/:productId
  fastify.get('/api/v1/locations/:locationId/inventory/:productId', {
    preHandler: [requireLocation()],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { locationId, productId } = req.params as { locationId: string; productId: string };
    const { variantId } = req.query as { variantId?: string };
    const level = await InventorySvc.getInventoryLevel(user.orgId, locationId, productId, variantId);
    return reply.send(level);
  });

  // GET /api/v1/locations/:locationId/inventory/:productId/movements
  fastify.get('/api/v1/locations/:locationId/inventory/:productId/movements', {
    preHandler: [requireLocation()],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { locationId, productId } = req.params as { locationId: string; productId: string };
    const q = req.query as { variantId?: string; limit?: string; offset?: string };
    const movements = await InventorySvc.getMovementHistory(
      user.orgId, locationId, productId,
      q.variantId ?? null,
      q.limit ? parseInt(q.limit, 10) : 50,
      q.offset ? parseInt(q.offset, 10) : 0,
    );
    return reply.send(movements);
  });

  // POST /api/v1/locations/:locationId/inventory/adjust
  fastify.post('/api/v1/locations/:locationId/inventory/adjust', {
    preHandler: [requireLocation()],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { locationId } = req.params as { locationId: string };
    const body = req.body as InventorySvc.AdjustmentInput;
    const level = await InventorySvc.adjustInventory(user.orgId, locationId, body, user.sub);
    return reply.send(level);
  });

  // POST /api/v1/locations/:locationId/inventory/transfer
  fastify.post('/api/v1/locations/:locationId/inventory/transfer', {
    preHandler: [requireLocation()],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { locationId } = req.params as { locationId: string };
    const body = req.body as {
      toLocationId: string;
      items: InventorySvc.TransferLineInput[];
    };
    await InventorySvc.transferStock(user.orgId, locationId, body.toLocationId, body.items, user.sub);
    return reply.code(204).send();
  });

  // POST /api/v1/locations/:locationId/inventory/receive
  fastify.post('/api/v1/locations/:locationId/inventory/receive', {
    preHandler: [requireLocation()],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { locationId } = req.params as { locationId: string };
    const body = req.body as {
      purchaseOrderId: string;
      lines: InventorySvc.ReceiveLineInput[];
    };
    await InventorySvc.receiveStock(user.orgId, locationId, body.purchaseOrderId, body.lines, user.sub);
    return reply.code(204).send();
  });

  // POST /api/v1/locations/:locationId/inventory/count
  fastify.post('/api/v1/locations/:locationId/inventory/count', {
    preHandler: [requireLocation()],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { locationId } = req.params as { locationId: string };
    const body = req.body as {
      counts: InventorySvc.StockCountInput[];
      isOpeningCount?: boolean;
    };
    const deltas = await InventorySvc.recordStockCount(
      user.orgId, locationId, body.counts, user.sub, body.isOpeningCount,
    );
    return reply.send({ deltas });
  });

  // ── Forecasts ─────────────────────────────────────────────────────────────

  // GET /api/v1/locations/:locationId/forecast
  fastify.get('/api/v1/locations/:locationId/forecast', {
    preHandler: [requireLocation()],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { locationId } = req.params as { locationId: string };
    const q = req.query as {
      windowHours?: string;
      urgency?: 'critical' | 'warning' | 'ok';
    };
    const forecasts = await ForecastSvc.getForecastDashboard(
      user.orgId, locationId,
      q.windowHours ? parseInt(q.windowHours, 10) : undefined,
      q.urgency,
    );
    return reply.send(forecasts);
  });

  // ── Variance Reports ──────────────────────────────────────────────────────

  // GET /api/v1/variance-reports
  fastify.get('/api/v1/variance-reports', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const q = req.query as {
      locationId?: string;
      status?: 'draft' | 'finalized';
      limit?: string;
      offset?: string;
    };
    const result = await VarianceSvc.listVarianceReports(
      user.orgId, q.locationId, q.status,
      q.limit ? parseInt(q.limit, 10) : 20,
      q.offset ? parseInt(q.offset, 10) : 0,
    );
    return reply.send(result);
  });

  // GET /api/v1/variance-reports/:id
  fastify.get('/api/v1/variance-reports/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    const report = await VarianceSvc.getVarianceReport(user.orgId, id);
    return reply.send(report);
  });

  // POST /api/v1/variance-reports
  fastify.post('/api/v1/variance-reports', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const body = req.body as {
      locationId: string;
      periodStart: string;
      periodEnd: string;
      flagThresholdPct?: number;
    };
    const report = await VarianceSvc.generateVarianceReport(
      user.orgId,
      body.locationId,
      new Date(body.periodStart),
      new Date(body.periodEnd),
      user.sub,
      { flagThresholdPct: body.flagThresholdPct },
    );
    return reply.code(201).send(report);
  });

  // POST /api/v1/variance-reports/:id/finalize
  fastify.post('/api/v1/variance-reports/:id/finalize', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    const report = await VarianceSvc.finalizeVarianceReport(user.orgId, id, user.sub);
    return reply.send(report);
  });
}
