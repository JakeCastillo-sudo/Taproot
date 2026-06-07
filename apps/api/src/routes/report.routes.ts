/**
 * Reporting REST routes.
 *
 * Route summary
 * ─────────────
 * GET /api/v1/reports/dashboard            — getDashboardMetrics
 * GET /api/v1/reports/sales                — getSalesSummary
 * GET /api/v1/reports/top-products         — getTopProducts
 * GET /api/v1/reports/top-customers        — getTopCustomers
 * GET /api/v1/reports/payment-methods      — getPaymentMethodBreakdown
 * GET /api/v1/reports/employee-performance — getEmployeePerformance
 * GET /api/v1/reports/hourly-heatmap       — getHourlyHeatmap
 *
 * All endpoints require REPORTS_VIEW permission.
 * All accept common query params: from, to (ISO-8601), location_id?, timezone?.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AccessTokenPayload } from '../auth/jwt';
import { Permission, requirePermissions } from '../auth/permissions';
import { AppError, ValidationError } from '../errors';
import * as ReportSvc from '../services/reporting.service';
import { getCached } from '../lib/cache';
import type { ReportGranularity } from '@taproot/shared';

type AuthedRequest = FastifyRequest & { user: AccessTokenPayload };

function parseDateRange(q: Record<string, string>): ReportSvc.DateRangeParams {
  if (!q.from || !q.to) {
    throw new ValidationError('from and to query parameters are required (ISO-8601)');
  }
  return {
    from:       q.from,
    to:         q.to,
    locationId: q.location_id,
    timezone:   q.timezone ?? 'UTC',
  };
}

export default async function reportRoutes(fastify: FastifyInstance): Promise<void> {

  // ── GET /api/v1/reports/dashboard ──────────────────────────────────────────
  fastify.get(
    '/api/v1/reports/dashboard',
    { preHandler: [requirePermissions(Permission.REPORTS_VIEW)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const q = req.query as Record<string, string>;
      try {
        const metrics = await ReportSvc.getDashboardMetrics(
          user.orgId,
          q.location_id,
          q.timezone ?? 'UTC',
        );
        return reply.send(metrics);
      } catch (err) {
        if (err instanceof AppError) return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        throw err;
      }
    },
  );

  // ── GET /api/v1/reports/sales ───────────────────────────────────────────────
  // Redis-cached 5 min per parameter variant (S8-06); invalidated on order completion
  fastify.get(
    '/api/v1/reports/sales',
    { preHandler: [requirePermissions(Permission.REPORTS_VIEW)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const q = req.query as Record<string, string>;
      try {
        const params = parseDateRange(q);
        const granularity = (q.granularity ?? 'day') as ReportGranularity;
        const cacheKey = `org:${user.orgId}:reports:sales:${params.from}:${params.to}:${params.locationId ?? 'all'}:${granularity}:${params.timezone ?? 'UTC'}`;
        const rows = await getCached(cacheKey, 300, () =>
          ReportSvc.getSalesSummary(user.orgId, params, granularity));
        return reply.send({ rows });
      } catch (err) {
        if (err instanceof AppError) return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        throw err;
      }
    },
  );

  // ── GET /api/v1/reports/end-of-day ──────────────────────────────────────────
  fastify.get(
    '/api/v1/reports/end-of-day',
    { preHandler: [requirePermissions(Permission.REPORTS_VIEW)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const q = req.query as Record<string, string>;
      try {
        const date = q.date;
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          throw new ValidationError('date=YYYY-MM-DD is required');
        }
        const report = await ReportSvc.getEndOfDayReport(user.orgId, date, q.location_id ?? q.locationId, q.timezone ?? 'UTC');
        return reply.send(report);
      } catch (err) {
        if (err instanceof AppError) return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        throw err;
      }
    },
  );

  // ── GET /api/v1/reports/tips ────────────────────────────────────────────────
  fastify.get(
    '/api/v1/reports/tips',
    { preHandler: [requirePermissions(Permission.REPORTS_VIEW)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const q = req.query as Record<string, string>;
      try {
        const params = parseDateRange(q);
        const report = await ReportSvc.getTipsReport(user.orgId, params);
        return reply.send(report);
      } catch (err) {
        if (err instanceof AppError) return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        throw err;
      }
    },
  );

  // ── GET /api/v1/reports/top-products ────────────────────────────────────────
  fastify.get(
    '/api/v1/reports/top-products',
    { preHandler: [requirePermissions(Permission.REPORTS_VIEW)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const q = req.query as Record<string, string>;
      try {
        const params = parseDateRange(q);
        const rows = await ReportSvc.getTopProducts(
          user.orgId, params,
          q.limit ? parseInt(q.limit, 10) : 20,
        );
        return reply.send({ rows });
      } catch (err) {
        if (err instanceof AppError) return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        throw err;
      }
    },
  );

  // ── GET /api/v1/reports/top-customers ───────────────────────────────────────
  fastify.get(
    '/api/v1/reports/top-customers',
    { preHandler: [requirePermissions(Permission.REPORTS_VIEW)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const q = req.query as Record<string, string>;
      try {
        if (!q.from || !q.to) throw new ValidationError('from and to are required');
        const rows = await ReportSvc.getTopCustomers(
          user.orgId,
          { from: q.from, to: q.to, timezone: q.timezone },
          q.limit ? parseInt(q.limit, 10) : 20,
        );
        return reply.send({ rows });
      } catch (err) {
        if (err instanceof AppError) return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        throw err;
      }
    },
  );

  // ── GET /api/v1/reports/payment-methods ─────────────────────────────────────
  fastify.get(
    '/api/v1/reports/payment-methods',
    { preHandler: [requirePermissions(Permission.REPORTS_VIEW)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const q = req.query as Record<string, string>;
      try {
        const params = parseDateRange(q);
        const rows = await ReportSvc.getPaymentMethodBreakdown(user.orgId, params);
        return reply.send({ rows });
      } catch (err) {
        if (err instanceof AppError) return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        throw err;
      }
    },
  );

  // ── GET /api/v1/reports/employee-performance ────────────────────────────────
  fastify.get(
    '/api/v1/reports/employee-performance',
    { preHandler: [requirePermissions(Permission.REPORTS_VIEW)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const q = req.query as Record<string, string>;
      try {
        const params = parseDateRange(q);
        const rows = await ReportSvc.getEmployeePerformance(user.orgId, params);
        return reply.send({ rows });
      } catch (err) {
        if (err instanceof AppError) return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        throw err;
      }
    },
  );

  // ── GET /api/v1/reports/hourly-heatmap ──────────────────────────────────────
  fastify.get(
    '/api/v1/reports/hourly-heatmap',
    { preHandler: [requirePermissions(Permission.REPORTS_VIEW)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const q = req.query as Record<string, string>;
      try {
        const params = parseDateRange(q);
        const rows = await ReportSvc.getHourlyHeatmap(user.orgId, params);
        return reply.send({ rows });
      } catch (err) {
        if (err instanceof AppError) return reply.code(err.statusCode).send({ code: err.code, message: err.message });
        throw err;
      }
    },
  );
}
