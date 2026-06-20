/**
 * studioCatalog.routes — manage sellable studio catalog items (v2.1).
 *
 * ┌─ SANDBOX SEAM ───────────────────────────────────────────────────────────────┐
 * │ NOT registered in index.ts (boot path untouched). To wire after review:        │
 * │   import studioCatalogRoutes from './routes/studioCatalog.routes';              │
 * │   await fastify.register(studioCatalogRoutes);                                 │
 * └───────────────────────────────────────────────────────────────────────────────┘
 *
 * Double-gated (requireManager + requireStudio). Studio items are normal products
 * (item_type + studio_meta) sold via the EXISTING checkout — no new payment path.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AccessTokenPayload } from '../auth/jwt';
import * as StudioCatalogSvc from '../services/studioCatalog.service';
import * as CapabilitySvc from '../services/capability.service';

type AuthedRequest = FastifyRequest & { user: AccessTokenPayload };

function requireManager(req: FastifyRequest, reply: FastifyReply): boolean {
  const { user } = req as AuthedRequest;
  if (user.role !== 'owner' && user.role !== 'manager') {
    reply.status(403).send({ code: 'FORBIDDEN', message: 'Owner or manager access required' });
    return false;
  }
  return true;
}

async function gate(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  if (!requireManager(req, reply)) return false;
  const { user } = req as AuthedRequest;
  if (!(await CapabilitySvc.hasCapability(user.orgId, 'studio'))) {
    reply.status(404).send({ code: 'NOT_FOUND', message: 'Studio features are not enabled for this organization' });
    return false;
  }
  return true;
}

export default async function studioCatalogRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/v1/studio/catalog', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    const q = req.query as { itemType?: string };
    const items = await StudioCatalogSvc.listStudioItems(user.orgId, q.itemType);
    return reply.send({ items });
  });

  fastify.post('/api/v1/studio/catalog', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    const item = await StudioCatalogSvc.createStudioItem(user.orgId, user.sub, req.body as StudioCatalogSvc.CreateStudioItemInput);
    return reply.status(201).send({ item });
  });

  fastify.get('/api/v1/studio/catalog/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    const item = await StudioCatalogSvc.getStudioItem(user.orgId, (req.params as { id: string }).id);
    return reply.send({ item });
  });

  fastify.patch('/api/v1/studio/catalog/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    const item = await StudioCatalogSvc.updateStudioItem(user.orgId, (req.params as { id: string }).id, user.sub, req.body as StudioCatalogSvc.UpdateStudioItemInput);
    return reply.send({ item });
  });

  fastify.delete('/api/v1/studio/catalog/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    await StudioCatalogSvc.deleteStudioItem(user.orgId, (req.params as { id: string }).id, user.sub);
    return reply.send({ success: true });
  });
}
