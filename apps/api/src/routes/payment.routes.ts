/**
 * Payment REST routes — Stripe Connect, Terminal, and offline queue.
 *
 * Route summary
 * ─────────────
 * Connect onboarding
 *   POST   /api/v1/payments/connect/account        — createConnectAccount
 *   GET    /api/v1/payments/connect/status         — getConnectAccountStatus
 *   POST   /api/v1/payments/connect/refresh-link   — refreshOnboardingLink
 *
 * Terminal readers
 *   GET    /api/v1/locations/:locationId/terminal/readers   — listReaders
 *   POST   /api/v1/locations/:locationId/terminal/readers   — registerReader
 *
 * Terminal payment flow
 *   POST   /api/v1/terminal/connection-token   — createConnectionToken
 *   POST   /api/v1/terminal/payment-intent     — createPaymentIntent
 *   POST   /api/v1/terminal/collect            — collectPayment
 *   POST   /api/v1/terminal/capture            — capturePaymentIntent
 *   POST   /api/v1/terminal/cancel             — cancelPaymentIntent
 *   POST   /api/v1/terminal/simulate           — simulatePayment (test mode)
 *
 * Offline queue
 *   POST   /api/v1/payments/offline/queue      — queueOfflinePayment
 *   POST   /api/v1/payments/offline/process    — processOfflineQueue
 *   GET    /api/v1/payments/offline/status     — getOfflineQueueStatus
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AccessTokenPayload } from '../auth/jwt';
import { Permission, requirePermissions } from '../auth/permissions';
import { AppError } from '../errors';
import * as ConnectSvc  from '../payments/connect.service';
import * as TerminalSvc from '../payments/terminal.service';
import * as OfflineSvc  from '../payments/offline.service';

type AuthedRequest = FastifyRequest & { user: AccessTokenPayload };

export default async function paymentRoutes(fastify: FastifyInstance): Promise<void> {

  // ════════════════════════════════════════════════════════════════════════════
  // CONNECT ONBOARDING
  // ════════════════════════════════════════════════════════════════════════════

  // ── POST /api/v1/payments/connect/account ───────────────────────────────────
  // Initiate Stripe Express onboarding for this organisation.
  fastify.post(
    '/api/v1/payments/connect/account',
    { preHandler: [requirePermissions(Permission.SETTINGS_EDIT)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const body = req.body as {
        businessType:  'individual' | 'company';
        email:         string;
        country:       string;
        businessName?: string;
      };

      if (!body.businessType || !body.email || !body.country) {
        return reply.code(422).send({
          code:    'VALIDATION_ERROR',
          message: 'businessType, email, and country are required',
        });
      }

      try {
        const result = await ConnectSvc.createConnectAccount(user.orgId, user.sub, {
          businessType: body.businessType,
          email:        body.email,
          country:      body.country,
          businessName: body.businessName,
        });
        return reply.code(201).send(result);
      } catch (err) {
        if (err instanceof AppError) {
          return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        }
        throw err;
      }
    },
  );

  // ── GET /api/v1/payments/connect/status ────────────────────────────────────
  // Fetch live Connect account status from Stripe and sync it to the DB.
  fastify.get(
    '/api/v1/payments/connect/status',
    { preHandler: [requirePermissions(Permission.SETTINGS_EDIT)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      try {
        const status = await ConnectSvc.getConnectAccountStatus(user.orgId);
        return reply.send(status);
      } catch (err) {
        if (err instanceof AppError) {
          return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        }
        throw err;
      }
    },
  );

  // ── POST /api/v1/payments/connect/refresh-link ─────────────────────────────
  // Generate a new onboarding URL when the previous link has expired.
  fastify.post(
    '/api/v1/payments/connect/refresh-link',
    { preHandler: [requirePermissions(Permission.SETTINGS_EDIT)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      try {
        const url = await ConnectSvc.refreshOnboardingLink(user.orgId);
        return reply.send({ onboardingUrl: url });
      } catch (err) {
        if (err instanceof AppError) {
          return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        }
        throw err;
      }
    },
  );

  // ════════════════════════════════════════════════════════════════════════════
  // TERMINAL READERS
  // ════════════════════════════════════════════════════════════════════════════

  // ── GET /api/v1/locations/:locationId/terminal/readers ─────────────────────
  fastify.get(
    '/api/v1/locations/:locationId/terminal/readers',
    { preHandler: [requirePermissions(Permission.SETTINGS_EDIT)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user }       = req as AuthedRequest;
      const { locationId } = req.params as { locationId: string };
      try {
        const readers = await TerminalSvc.listReaders(user.orgId, locationId);
        return reply.send({ readers });
      } catch (err) {
        if (err instanceof AppError) {
          return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        }
        throw err;
      }
    },
  );

  // ── POST /api/v1/locations/:locationId/terminal/readers ────────────────────
  fastify.post(
    '/api/v1/locations/:locationId/terminal/readers',
    { preHandler: [requirePermissions(Permission.SETTINGS_EDIT)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user }       = req as AuthedRequest;
      const { locationId } = req.params as { locationId: string };
      const body = req.body as {
        registrationCode: string;
        label:            string;
        readerModel:      'bbpos_wisepos_e' | 'stripe_m2' | 'stripe_s700';
      };

      if (!body.registrationCode || !body.label || !body.readerModel) {
        return reply.code(422).send({
          code:    'VALIDATION_ERROR',
          message: 'registrationCode, label, and readerModel are required',
        });
      }

      try {
        const reader = await TerminalSvc.registerReader(user.orgId, locationId, user.sub, body);
        return reply.code(201).send(reader);
      } catch (err) {
        if (err instanceof AppError) {
          return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        }
        throw err;
      }
    },
  );

  // ════════════════════════════════════════════════════════════════════════════
  // TERMINAL PAYMENT FLOW
  // ════════════════════════════════════════════════════════════════════════════

  // ── POST /api/v1/terminal/connection-token ──────────────────────────────────
  // Short-lived token for Terminal SDK initialisation on the POS device.
  fastify.post(
    '/api/v1/terminal/connection-token',
    { preHandler: [requirePermissions(Permission.ORDER_CREATE)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      try {
        const secret = await TerminalSvc.createConnectionToken(user.orgId);
        return reply.send({ secret });
      } catch (err) {
        if (err instanceof AppError) {
          return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        }
        throw err;
      }
    },
  );

  // ── POST /api/v1/terminal/payment-intent ───────────────────────────────────
  fastify.post(
    '/api/v1/terminal/payment-intent',
    { preHandler: [requirePermissions(Permission.ORDER_CREATE)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const body = req.body as {
        orderId:   string;
        amount:    number;
        currency?: string;
      };

      if (!body.orderId || !body.amount) {
        return reply.code(422).send({
          code:    'VALIDATION_ERROR',
          message: 'orderId and amount are required',
        });
      }

      try {
        const pi = await TerminalSvc.createPaymentIntent(
          user.orgId,
          body.orderId,
          body.amount,
          body.currency,
        );
        return reply.code(201).send(pi);
      } catch (err) {
        if (err instanceof AppError) {
          return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        }
        throw err;
      }
    },
  );

  // ── POST /api/v1/terminal/collect ──────────────────────────────────────────
  fastify.post(
    '/api/v1/terminal/collect',
    { preHandler: [requirePermissions(Permission.ORDER_CREATE)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const body = req.body as {
        readerId:        string;
        paymentIntentId: string;
      };

      if (!body.readerId || !body.paymentIntentId) {
        return reply.code(422).send({
          code:    'VALIDATION_ERROR',
          message: 'readerId and paymentIntentId are required',
        });
      }

      try {
        const result = await TerminalSvc.collectPayment(
          user.orgId,
          body.readerId,
          body.paymentIntentId,
        );
        return reply.send(result);
      } catch (err) {
        if (err instanceof AppError) {
          return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        }
        throw err;
      }
    },
  );

  // ── POST /api/v1/terminal/capture ──────────────────────────────────────────
  fastify.post(
    '/api/v1/terminal/capture',
    { preHandler: [requirePermissions(Permission.ORDER_CREATE)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const body = req.body as {
        paymentIntentId:  string;
        amountToCapture?: number;
      };

      if (!body.paymentIntentId) {
        return reply.code(422).send({
          code:    'VALIDATION_ERROR',
          message: 'paymentIntentId is required',
        });
      }

      try {
        const result = await TerminalSvc.capturePaymentIntent(
          user.orgId,
          body.paymentIntentId,
          body.amountToCapture,
        );
        return reply.send(result);
      } catch (err) {
        if (err instanceof AppError) {
          return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        }
        throw err;
      }
    },
  );

  // ── POST /api/v1/terminal/cancel ───────────────────────────────────────────
  fastify.post(
    '/api/v1/terminal/cancel',
    { preHandler: [requirePermissions(Permission.ORDER_CREATE)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const body = req.body as { paymentIntentId: string };

      if (!body.paymentIntentId) {
        return reply.code(422).send({
          code:    'VALIDATION_ERROR',
          message: 'paymentIntentId is required',
        });
      }

      try {
        await TerminalSvc.cancelPaymentIntent(user.orgId, body.paymentIntentId);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof AppError) {
          return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        }
        throw err;
      }
    },
  );

  // ── POST /api/v1/terminal/simulate ─────────────────────────────────────────
  // Test mode only — simulate a card tap on a simulated reader.
  fastify.post(
    '/api/v1/terminal/simulate',
    { preHandler: [requirePermissions(Permission.SETTINGS_EDIT)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const body = req.body as {
        readerId:  string;
        testCard?: 'visa' | 'mastercard' | 'amex' | 'declined';
      };

      if (!body.readerId) {
        return reply.code(422).send({
          code:    'VALIDATION_ERROR',
          message: 'readerId is required',
        });
      }

      try {
        await TerminalSvc.simulatePayment(user.orgId, body.readerId, body.testCard);
        return reply.send({ simulated: true });
      } catch (err) {
        if (err instanceof AppError) {
          return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        }
        throw err;
      }
    },
  );

  // ════════════════════════════════════════════════════════════════════════════
  // OFFLINE PAYMENT QUEUE
  // ════════════════════════════════════════════════════════════════════════════

  // ── POST /api/v1/payments/offline/queue ────────────────────────────────────
  // Enqueue an offline payment for later submission to Stripe.
  fastify.post(
    '/api/v1/payments/offline/queue',
    { preHandler: [requirePermissions(Permission.ORDER_CREATE)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const body = req.body as {
        orderId:  string;
        amount:   number;
        currency?: string;
        last4:    string;
        brand:    string;
      };

      if (!body.orderId || !body.amount || !body.last4 || !body.brand) {
        return reply.code(422).send({
          code:    'VALIDATION_ERROR',
          message: 'orderId, amount, last4, and brand are required',
        });
      }

      try {
        const paymentId = await OfflineSvc.queueOfflinePayment(
          user.orgId,
          body.orderId,
          body.amount,
          body.currency ?? 'usd',
          body.last4,
          body.brand,
        );
        return reply.code(202).send({ paymentId, status: 'offline_queued' });
      } catch (err) {
        if (err instanceof AppError) {
          return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        }
        throw err;
      }
    },
  );

  // ── POST /api/v1/payments/offline/process ──────────────────────────────────
  // Trigger immediate drain of the offline queue for this org.
  // Called automatically when connectivity is restored; also callable manually.
  fastify.post(
    '/api/v1/payments/offline/process',
    { preHandler: [requirePermissions(Permission.ORDER_CREATE)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      try {
        const results = await OfflineSvc.processOfflineQueue(user.orgId);
        const summary = {
          total:       results.length,
          processed:   results.filter((r) => r.status === 'processed').length,
          failed:      results.filter((r) => r.status === 'failed').length,
          deadLettered: results.filter((r) => r.status === 'dead_lettered').length,
          results,
        };
        return reply.send(summary);
      } catch (err) {
        if (err instanceof AppError) {
          return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        }
        throw err;
      }
    },
  );

  // ── GET /api/v1/payments/offline/status ────────────────────────────────────
  // Return queue depth and oldest entry timestamp — useful for POS status bar.
  fastify.get(
    '/api/v1/payments/offline/status',
    { preHandler: [requirePermissions(Permission.ORDER_CREATE)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      try {
        const status = await OfflineSvc.getOfflineQueueStatus(user.orgId);
        return reply.send(status);
      } catch (err) {
        if (err instanceof AppError) {
          return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        }
        throw err;
      }
    },
  );
}
