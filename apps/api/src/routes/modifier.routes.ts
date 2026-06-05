/**
 * Modifier routes — modifier groups + modifiers CRUD and product assignment.
 * All routes authenticated via the global preHandler; org scope from JWT.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AccessTokenPayload } from '../auth/jwt';
import * as ModifierSvc from '../services/modifier.service';

type AuthedRequest = FastifyRequest & { user: AccessTokenPayload };

export default async function modifierRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /api/v1/modifier-groups — list with modifiers + assigned product ids
  fastify.get('/api/v1/modifier-groups', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const groups = await ModifierSvc.listModifierGroups(user.orgId);
    return reply.send({ groups });
  });

  // POST /api/v1/modifier-groups
  fastify.post('/api/v1/modifier-groups', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const body = req.body as ModifierSvc.CreateGroupData;
    const group = await ModifierSvc.createModifierGroup(user.orgId, body, user.sub);
    return reply.code(201).send(group);
  });

  // PATCH /api/v1/modifier-groups/:id
  fastify.patch('/api/v1/modifier-groups/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    await ModifierSvc.updateModifierGroup(user.orgId, id, req.body as ModifierSvc.UpdateGroupData, user.sub);
    return reply.send({ success: true });
  });

  // DELETE /api/v1/modifier-groups/:id
  fastify.delete('/api/v1/modifier-groups/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    await ModifierSvc.deleteModifierGroup(user.orgId, id, user.sub);
    return reply.code(204).send();
  });

  // POST /api/v1/modifier-groups/:id/modifiers
  fastify.post('/api/v1/modifier-groups/:id/modifiers', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    const modifier = await ModifierSvc.addModifier(user.orgId, id, req.body as ModifierSvc.CreateModifierData, user.sub);
    return reply.code(201).send(modifier);
  });

  // POST /api/v1/modifier-groups/:id/products — replace assigned products
  fastify.post('/api/v1/modifier-groups/:id/products', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    const { productIds } = req.body as { productIds: string[] };
    await ModifierSvc.setGroupProducts(user.orgId, id, productIds ?? []);
    return reply.send({ success: true });
  });

  // PATCH /api/v1/modifiers/:id
  fastify.patch('/api/v1/modifiers/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    await ModifierSvc.updateModifier(user.orgId, id, req.body as ModifierSvc.UpdateModifierData, user.sub);
    return reply.send({ success: true });
  });

  // DELETE /api/v1/modifiers/:id
  fastify.delete('/api/v1/modifiers/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    await ModifierSvc.deleteModifier(user.orgId, id, user.sub);
    return reply.code(204).send();
  });

  // POST /api/v1/products/:id/modifier-groups — replace product's group assignments
  fastify.post('/api/v1/products/:id/modifier-groups', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    const { modifierGroupIds } = req.body as { modifierGroupIds: string[] };
    await ModifierSvc.setProductGroups(user.orgId, id, modifierGroupIds ?? []);
    return reply.send({ success: true });
  });
}
