/**
 * Ingredient system routes (Session 1). Authenticated via the global preHandler;
 * org scope from JWT. Owner/manager only (checked in-handler).
 *
 * NOTE: recipe endpoints are namespaced `/products/:id/ingredient-recipe` (+
 * `/recipe-mode/enable|disable`) because the LEGACY inventory.routes.ts already
 * owns `/products/:productId/recipe` for the recipes/recipe_lines system. Nothing
 * existing is changed.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AccessTokenPayload } from '../auth/jwt';
import * as IngredientSvc from '../services/ingredient.service';
import * as RecipeSvc from '../services/ingredientRecipe.service';
import * as InvSvc from '../services/ingredientInventory.service';

type AuthedRequest = FastifyRequest & { user: AccessTokenPayload };

function requireManager(req: FastifyRequest, reply: FastifyReply): boolean {
  const { user } = req as AuthedRequest;
  if (user.role !== 'owner' && user.role !== 'manager') {
    reply.status(403).send({ error: 'FORBIDDEN', code: 'FORBIDDEN', message: 'Owner or manager access required' });
    return false;
  }
  return true;
}

export async function registerIngredientRoutes(fastify: FastifyInstance): Promise<void> {

  // ── Ingredient CRUD ────────────────────────────────────────────────────────

  fastify.get('/api/v1/ingredients', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireManager(req, reply)) return;
    const { user } = req as AuthedRequest;
    const q = req.query as { category?: string; universalOnly?: string; search?: string };
    const ingredients = await IngredientSvc.listIngredients(user.orgId, {
      category: q.category,
      universalOnly: q.universalOnly === 'true',
      search: q.search,
    });
    return reply.send({ ingredients });
  });

  // Static segment BEFORE the :id route so "universal" isn't captured as an id.
  fastify.get('/api/v1/ingredients/universal/list', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireManager(req, reply)) return;
    const { user } = req as AuthedRequest;
    const addons = await IngredientSvc.listUniversalAddons(user.orgId);
    return reply.send({ addons });
  });

  fastify.get('/api/v1/ingredients/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireManager(req, reply)) return;
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    const ingredient = await IngredientSvc.getIngredient(user.orgId, id);
    return reply.send(ingredient);
  });

  fastify.post('/api/v1/ingredients', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireManager(req, reply)) return;
    const { user } = req as AuthedRequest;
    const ingredient = await IngredientSvc.createIngredient(user.orgId, req.body as IngredientSvc.CreateIngredientData);
    return reply.code(201).send(ingredient);
  });

  fastify.put('/api/v1/ingredients/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireManager(req, reply)) return;
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    const ingredient = await IngredientSvc.updateIngredient(user.orgId, id, req.body as IngredientSvc.UpdateIngredientData);
    return reply.send(ingredient);
  });

  fastify.delete('/api/v1/ingredients/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireManager(req, reply)) return;
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    const result = await IngredientSvc.deleteIngredient(user.orgId, id);
    return reply.send(result);
  });

  // ── Stock management ───────────────────────────────────────────────────────

  fastify.post('/api/v1/ingredients/:id/stock/adjust', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireManager(req, reply)) return;
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    const body = req.body as { quantityChange: number; movementType: string; notes?: string };
    const result = await IngredientSvc.adjustStock(user.orgId, id, {
      quantityChange: body.quantityChange,
      movementType: body.movementType,
      notes: body.notes,
      employeeId: user.sub,
    });
    return reply.send(result);
  });

  fastify.get('/api/v1/ingredients/:id/stock/movements', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireManager(req, reply)) return;
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string; since?: string };
    const movements = await IngredientSvc.getStockMovements(user.orgId, id, {
      limit: q.limit ? parseInt(q.limit, 10) : undefined,
      since: q.since,
    });
    return reply.send({ movements });
  });

  // ── Recipe management (namespaced to avoid legacy /products/:productId/recipe) ─

  fastify.get('/api/v1/products/:id/ingredient-recipe', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireManager(req, reply)) return;
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    const recipe = await RecipeSvc.getProductRecipe(user.orgId, id);
    return reply.send({ recipe });
  });

  fastify.put('/api/v1/products/:id/ingredient-recipe', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireManager(req, reply)) return;
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    const body = req.body as { ingredients?: RecipeSvc.RecipeIngredientInput[] };
    const recipe = await RecipeSvc.setProductRecipe(user.orgId, id, body.ingredients ?? []);
    return reply.send({ recipe });
  });

  fastify.post('/api/v1/products/:id/recipe-mode/enable', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireManager(req, reply)) return;
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    const result = await RecipeSvc.enableRecipeMode(user.orgId, id);
    return reply.send(result);
  });

  fastify.post('/api/v1/products/:id/recipe-mode/disable', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireManager(req, reply)) return;
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    const result = await RecipeSvc.disableRecipeMode(user.orgId, id);
    return reply.send(result);
  });

  // POS — recipe-aware modifier data (falls back to existing groups when recipe_mode=false)
  fastify.get('/api/v1/products/:id/modifiers/pos', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireManager(req, reply)) return;
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    const data = await RecipeSvc.getProductModifiersForPOS(user.orgId, id);
    return reply.send(data);
  });

  // ── Inventory status ───────────────────────────────────────────────────────

  fastify.get('/api/v1/inventory/status', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireManager(req, reply)) return;
    const { user } = req as AuthedRequest;
    const q = req.query as { locationId?: string };
    const status = await InvSvc.getInventoryStatus(user.orgId, q.locationId);
    return reply.send(status);
  });

  // ── Universal add-on exclusions ────────────────────────────────────────────

  fastify.post('/api/v1/products/:id/ingredient-exclusions', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireManager(req, reply)) return;
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    const { ingredientId } = req.body as { ingredientId: string };
    const result = await RecipeSvc.addIngredientExclusion(user.orgId, id, ingredientId);
    return reply.send(result);
  });

  fastify.delete('/api/v1/products/:id/ingredient-exclusions/:ingredientId', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireManager(req, reply)) return;
    const { user } = req as AuthedRequest;
    const { id, ingredientId } = req.params as { id: string; ingredientId: string };
    const result = await RecipeSvc.removeIngredientExclusion(user.orgId, id, ingredientId);
    return reply.send(result);
  });
}
