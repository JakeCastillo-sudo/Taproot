/**
 * Customer + Gift Card REST routes.
 *
 * Route summary
 * ─────────────
 * Customers
 *   GET    /api/v1/customers                          — listCustomers
 *   GET    /api/v1/customers/search                   — searchCustomers (POS lookup)
 *   POST   /api/v1/customers                          — createCustomer
 *   GET    /api/v1/customers/:id                      — getCustomer
 *   PATCH  /api/v1/customers/:id                      — updateCustomer
 *   DELETE /api/v1/customers/:id                      — deleteCustomer (soft)
 *   GET    /api/v1/customers/:id/orders               — getCustomerOrderHistory
 *   POST   /api/v1/customers/:id/merge                — mergeCustomers
 *   POST   /api/v1/customers/:id/credit               — addAccountCredit
 *
 * Gift cards
 *   GET    /api/v1/gift-cards                         — listGiftCards
 *   POST   /api/v1/gift-cards                         — issueGiftCard
 *   GET    /api/v1/gift-cards/lookup                  — getGiftCard (by code)
 *   GET    /api/v1/gift-cards/:id                     — getGiftCardById
 *   POST   /api/v1/gift-cards/:id/reload              — reloadGiftCard
 *   POST   /api/v1/gift-cards/:id/deactivate          — deactivateGiftCard
 *   GET    /api/v1/gift-cards/:id/transactions        — getGiftCardTransactions
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AccessTokenPayload } from '../auth/jwt';
import { Permission, requirePermissions } from '../auth/permissions';
import { AppError } from '../errors';
import * as CustomerSvc from '../services/customer.service';
import * as GiftCardSvc from '../services/giftcard.service';

type AuthedRequest = FastifyRequest & { user: AccessTokenPayload };

export default async function customerRoutes(fastify: FastifyInstance): Promise<void> {

  // ════════════════════════════════════════════════════════════════════════════
  // CUSTOMERS
  // ════════════════════════════════════════════════════════════════════════════

  // ── GET /api/v1/customers ───────────────────────────────────────────────────
  fastify.get(
    '/api/v1/customers',
    { preHandler: [requirePermissions(Permission.CUSTOMER_VIEW)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const q = req.query as Record<string, string>;
      try {
        const result = await CustomerSvc.listCustomers(user.orgId, {
          page:       q.page       ? parseInt(q.page, 10) : 1,
          perPage:    q.per_page   ? parseInt(q.per_page, 10) : 25,
          search:     q.search,
          loyaltyTier: q.loyalty_tier,
          tags:       q.tags ? q.tags.split(',') : undefined,
          orderBy:    q.order_by as CustomerSvc.ListCustomersParams['orderBy'],
          orderDir:   q.order_dir as 'asc' | 'desc',
        });
        return reply.send(result);
      } catch (err) {
        if (err instanceof AppError) return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        throw err;
      }
    },
  );

  // ── GET /api/v1/customers/search ────────────────────────────────────────────
  // Fast POS lookup — q param, returns up to 10 matches
  fastify.get(
    '/api/v1/customers/search',
    { preHandler: [requirePermissions(Permission.CUSTOMER_VIEW)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const { q, limit } = req.query as { q?: string; limit?: string };
      try {
        const customers = await CustomerSvc.searchCustomers(
          user.orgId,
          q ?? '',
          limit ? parseInt(limit, 10) : 10,
        );
        return reply.send({ customers });
      } catch (err) {
        if (err instanceof AppError) return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        throw err;
      }
    },
  );

  // ── POST /api/v1/customers ──────────────────────────────────────────────────
  fastify.post(
    '/api/v1/customers',
    { preHandler: [requirePermissions(Permission.CUSTOMER_CREATE)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      try {
        const customer = await CustomerSvc.createCustomer(
          user.orgId,
          user.sub,
          req.body as CustomerSvc.CreateCustomerInput,
        );
        return reply.code(201).send(customer);
      } catch (err) {
        if (err instanceof AppError) return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        throw err;
      }
    },
  );

  // ── GET /api/v1/customers/:id ───────────────────────────────────────────────
  fastify.get(
    '/api/v1/customers/:id',
    { preHandler: [requirePermissions(Permission.CUSTOMER_VIEW)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user }      = req as AuthedRequest;
      const { id }        = req.params as { id: string };
      try {
        const customer = await CustomerSvc.getCustomer(user.orgId, id);
        return reply.send(customer);
      } catch (err) {
        if (err instanceof AppError) return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        throw err;
      }
    },
  );

  // ── PATCH /api/v1/customers/:id ─────────────────────────────────────────────
  fastify.patch(
    '/api/v1/customers/:id',
    { preHandler: [requirePermissions(Permission.CUSTOMER_CREATE)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user }      = req as AuthedRequest;
      const { id }        = req.params as { id: string };
      try {
        const customer = await CustomerSvc.updateCustomer(
          user.orgId, id, user.sub,
          req.body as CustomerSvc.UpdateCustomerInput,
        );
        return reply.send(customer);
      } catch (err) {
        if (err instanceof AppError) return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        throw err;
      }
    },
  );

  // ── DELETE /api/v1/customers/:id ────────────────────────────────────────────
  fastify.delete(
    '/api/v1/customers/:id',
    { preHandler: [requirePermissions(Permission.CUSTOMER_DELETE)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user }      = req as AuthedRequest;
      const { id }        = req.params as { id: string };
      try {
        await CustomerSvc.deleteCustomer(user.orgId, id, user.sub);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof AppError) return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        throw err;
      }
    },
  );

  // ── GET /api/v1/customers/:id/orders ────────────────────────────────────────
  fastify.get(
    '/api/v1/customers/:id/orders',
    { preHandler: [requirePermissions(Permission.CUSTOMER_VIEW)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user }      = req as AuthedRequest;
      const { id }        = req.params as { id: string };
      const q = req.query as { page?: string; per_page?: string };
      try {
        const result = await CustomerSvc.getCustomerOrderHistory(
          user.orgId, id,
          q.page     ? parseInt(q.page, 10) : 1,
          q.per_page ? parseInt(q.per_page, 10) : 20,
        );
        return reply.send(result);
      } catch (err) {
        if (err instanceof AppError) return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        throw err;
      }
    },
  );

  // ── POST /api/v1/customers/:id/merge ────────────────────────────────────────
  fastify.post(
    '/api/v1/customers/:id/merge',
    { preHandler: [requirePermissions(Permission.CUSTOMER_DELETE)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user }      = req as AuthedRequest;
      const { id }        = req.params as { id: string };
      const { targetId }  = req.body as { targetId: string };
      if (!targetId) {
        return reply.code(422).send({ code: 'VALIDATION_ERROR', message: 'targetId is required' });
      }
      try {
        const customer = await CustomerSvc.mergeCustomers(user.orgId, id, targetId, user.sub);
        return reply.send(customer);
      } catch (err) {
        if (err instanceof AppError) return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        throw err;
      }
    },
  );

  // ── POST /api/v1/customers/:id/credit ───────────────────────────────────────
  fastify.post(
    '/api/v1/customers/:id/credit',
    { preHandler: [requirePermissions(Permission.CUSTOMER_CREATE)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user }         = req as AuthedRequest;
      const { id }           = req.params as { id: string };
      const { amount, reason } = req.body as { amount: number; reason?: string };
      if (!amount) {
        return reply.code(422).send({ code: 'VALIDATION_ERROR', message: 'amount is required' });
      }
      try {
        const customer = await CustomerSvc.addAccountCredit(
          user.orgId, id, amount, reason ?? '', user.sub,
        );
        return reply.send(customer);
      } catch (err) {
        if (err instanceof AppError) return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        throw err;
      }
    },
  );

  // ════════════════════════════════════════════════════════════════════════════
  // GIFT CARDS
  // ════════════════════════════════════════════════════════════════════════════

  // ── GET /api/v1/gift-cards ──────────────────────────────────────────────────
  fastify.get(
    '/api/v1/gift-cards',
    { preHandler: [requirePermissions(Permission.SETTINGS_EDIT)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const q = req.query as Record<string, string>;
      try {
        const result = await GiftCardSvc.listGiftCards(user.orgId, {
          customerId: q.customer_id,
          isActive:   q.is_active === undefined ? undefined : q.is_active === 'true',
          page:       q.page ? parseInt(q.page, 10) : 1,
          perPage:    q.per_page ? parseInt(q.per_page, 10) : 25,
        });
        return reply.send(result);
      } catch (err) {
        if (err instanceof AppError) return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        throw err;
      }
    },
  );

  // ── GET /api/v1/gift-cards/lookup ───────────────────────────────────────────
  fastify.get(
    '/api/v1/gift-cards/lookup',
    { preHandler: [requirePermissions(Permission.ORDER_CREATE)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const { code } = req.query as { code?: string };
      if (!code) {
        return reply.code(422).send({ code: 'VALIDATION_ERROR', message: 'code is required' });
      }
      try {
        const card = await GiftCardSvc.getGiftCard(user.orgId, code);
        return reply.send(card);
      } catch (err) {
        if (err instanceof AppError) return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        throw err;
      }
    },
  );

  // ── POST /api/v1/gift-cards ─────────────────────────────────────────────────
  fastify.post(
    '/api/v1/gift-cards',
    { preHandler: [requirePermissions(Permission.SETTINGS_EDIT)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      try {
        const card = await GiftCardSvc.issueGiftCard(
          user.orgId, user.sub,
          req.body as GiftCardSvc.IssueGiftCardInput,
        );
        return reply.code(201).send(card);
      } catch (err) {
        if (err instanceof AppError) return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        throw err;
      }
    },
  );

  // ── GET /api/v1/gift-cards/:id ──────────────────────────────────────────────
  fastify.get(
    '/api/v1/gift-cards/:id',
    { preHandler: [requirePermissions(Permission.SETTINGS_EDIT)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const { id }   = req.params as { id: string };
      try {
        const card = await GiftCardSvc.getGiftCardById(user.orgId, id);
        return reply.send(card);
      } catch (err) {
        if (err instanceof AppError) return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        throw err;
      }
    },
  );

  // ── POST /api/v1/gift-cards/:id/reload ──────────────────────────────────────
  fastify.post(
    '/api/v1/gift-cards/:id/reload',
    { preHandler: [requirePermissions(Permission.SETTINGS_EDIT)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const { id }   = req.params as { id: string };
      const { amount, orderId, notes } = req.body as { amount: number; orderId?: string; notes?: string };
      if (!amount) {
        return reply.code(422).send({ code: 'VALIDATION_ERROR', message: 'amount is required' });
      }
      try {
        const card = await GiftCardSvc.reloadGiftCard(user.orgId, user.sub, id, amount, orderId, notes);
        return reply.send(card);
      } catch (err) {
        if (err instanceof AppError) return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        throw err;
      }
    },
  );

  // ── POST /api/v1/gift-cards/:id/deactivate ──────────────────────────────────
  fastify.post(
    '/api/v1/gift-cards/:id/deactivate',
    { preHandler: [requirePermissions(Permission.SETTINGS_EDIT)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user }   = req as AuthedRequest;
      const { id }     = req.params as { id: string };
      const { reason } = (req.body ?? {}) as { reason?: string };
      try {
        await GiftCardSvc.deactivateGiftCard(user.orgId, id, user.sub, reason);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof AppError) return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        throw err;
      }
    },
  );

  // ── GET /api/v1/gift-cards/:id/transactions ──────────────────────────────────
  fastify.get(
    '/api/v1/gift-cards/:id/transactions',
    { preHandler: [requirePermissions(Permission.SETTINGS_EDIT)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const { id }   = req.params as { id: string };
      try {
        const transactions = await GiftCardSvc.getGiftCardTransactions(user.orgId, id);
        return reply.send({ transactions });
      } catch (err) {
        if (err instanceof AppError) return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        throw err;
      }
    },
  );
}
