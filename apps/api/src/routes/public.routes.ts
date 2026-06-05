/**
 * Public storefront routes — NO authentication (QR-code ordering).
 * Route keys are added to PUBLIC_ROUTES in index.ts so the global auth hook skips them.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as PublicSvc from '../services/public.service';
import { AppError } from '../errors';

export default async function publicRoutes(fastify: FastifyInstance): Promise<void> {

  fastify.get('/public/:orgSlug/menu', { config: { rateLimit: { max: 120, timeWindow: 60_000 } } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { orgSlug } = req.params as { orgSlug: string };
      try {
        const menu = await PublicSvc.getPublicMenu(orgSlug);
        return reply.send(menu);
      } catch (err) {
        if (err instanceof AppError) return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        throw err;
      }
    });

  fastify.post('/public/:orgSlug/order', { config: { rateLimit: { max: 30, timeWindow: 60_000 } } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { orgSlug } = req.params as { orgSlug: string };
      try {
        const result = await PublicSvc.createPublicOrder(orgSlug, req.body as PublicSvc.PublicOrderInput);
        return reply.code(201).send(result);
      } catch (err) {
        if (err instanceof AppError) return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        throw err;
      }
    });

  fastify.get('/public/:orgSlug/order/:orderId/status',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { orgSlug, orderId } = req.params as { orgSlug: string; orderId: string };
      try {
        const status = await PublicSvc.getPublicOrderStatus(orgSlug, orderId);
        return reply.send(status);
      } catch (err) {
        if (err instanceof AppError) return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        throw err;
      }
    });
}
