/**
 * Discount CRUD + validation + reporting. Authenticated globally; org from JWT.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AccessTokenPayload } from '../auth/jwt';
import * as DiscountSvc from '../services/discount.service';
import { AppError } from '../errors';

type AuthedRequest = FastifyRequest & { user: AccessTokenPayload };

export default async function discountRoutes(fastify: FastifyInstance): Promise<void> {

  fastify.get('/api/v1/discounts', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const discounts = await DiscountSvc.listDiscounts(user.orgId);
    return reply.send({ discounts });
  });

  fastify.get('/api/v1/discounts/report', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const report = await DiscountSvc.getDiscountReport(user.orgId);
    return reply.send({ report });
  });

  fastify.post('/api/v1/discounts', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const d = await DiscountSvc.createDiscount(user.orgId, req.body as DiscountSvc.CreateDiscountData, user.sub);
    return reply.code(201).send(d);
  });

  fastify.post('/api/v1/discounts/validate', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { code, subtotal } = req.body as { code: string; subtotal: number };
    try {
      const result = await DiscountSvc.validateDiscount(user.orgId, code ?? '', Math.round(subtotal ?? 0));
      return reply.send(result);
    } catch (err) {
      if (err instanceof AppError) return reply.code(err.statusCode).send({ code: err.code, message: err.message });
      throw err;
    }
  });

  fastify.patch('/api/v1/discounts/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    const d = await DiscountSvc.updateDiscount(user.orgId, id, req.body as Partial<DiscountSvc.CreateDiscountData>, user.sub);
    return reply.send(d);
  });

  fastify.delete('/api/v1/discounts/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    await DiscountSvc.deleteDiscount(user.orgId, id, user.sub);
    return reply.code(204).send();
  });
}
