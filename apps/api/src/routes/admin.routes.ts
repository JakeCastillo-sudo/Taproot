/**
 * Admin / Executive portal routes — Taproot internal only.
 *
 * Registered as a plain async function (not a Fastify plugin) from index.ts
 * AFTER all org routes. Every endpoint except login is gated by
 * authenticateAdmin; mutating/impersonation endpoints additionally require a role.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import crypto from 'crypto';
import * as AdminSvc from '../services/admin.service';
import * as HelpdeskSvc from '../services/helpdesk.service';
import { query } from '../db/client';
import {
  authenticateAdmin,
  requireAdminRole,
  type AdminRequest,
} from '../middleware/adminAuth';

export async function registerAdminRoutes(fastify: FastifyInstance): Promise<void> {
  // ── Auth ─────────────────────────────────────────────────────────────────

  fastify.post(
    '/api/v1/admin/auth/login',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const schema = z.object({
        email: z.string().email(),
        password: z.string().min(1),
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Email and password required',
        });
      }

      try {
        const result = await AdminSvc.adminLogin(
          parsed.data.email,
          parsed.data.password,
          req.ip,
          req.headers['user-agent'] ?? '',
        );
        return reply.send(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : '';
        if (message === 'INVALID_CREDENTIALS') {
          return reply.code(401).send({
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password',
          });
        }
        if (message.startsWith('ACCOUNT_LOCKED')) {
          const mins = message.split(':')[1];
          return reply.code(423).send({
            code: 'ACCOUNT_LOCKED',
            message: `Account locked. Try again in ${mins} minutes.`,
          });
        }
        throw err;
      }
    },
  );

  fastify.post(
    '/api/v1/admin/auth/logout',
    { preHandler: [authenticateAdmin] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const token = req.headers.authorization?.slice(7) ?? '';
      const hash = crypto.createHash('sha256').update(token).digest('hex');
      await query(
        `UPDATE admin_sessions SET revoked_at = NOW() WHERE token_hash = $1`,
        [hash],
      );
      return reply.send({ success: true });
    },
  );

  fastify.post(
    '/api/v1/admin/auth/change-password',
    { preHandler: [authenticateAdmin] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const schema = z.object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(10, 'New password must be at least 10 characters'),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message ?? 'currentPassword and newPassword are required',
        });
      }

      const admin = (req as AdminRequest).admin;
      try {
        await AdminSvc.changeAdminPassword(
          admin.sub,
          parsed.data.currentPassword,
          parsed.data.newPassword,
        );
        return reply.send({ success: true, message: 'Password changed. Please sign in again.' });
      } catch (err) {
        const m = err instanceof Error ? err.message : '';
        if (m === 'INVALID_CURRENT_PASSWORD') {
          return reply.code(401).send({ code: 'INVALID_CURRENT_PASSWORD', message: 'Current password is incorrect' });
        }
        if (m === 'WEAK_PASSWORD') {
          return reply.code(400).send({ code: 'WEAK_PASSWORD', message: 'New password must be at least 10 characters' });
        }
        if (m === 'SAME_PASSWORD') {
          return reply.code(400).send({ code: 'SAME_PASSWORD', message: 'New password must be different from your current one' });
        }
        if (m === 'NOT_FOUND') {
          return reply.code(404).send({ code: 'NOT_FOUND', message: 'Admin user not found' });
        }
        throw err;
      }
    },
  );

  // ── Organizations ─────────────────────────────────────────────────────────

  fastify.get(
    '/api/v1/admin/organizations',
    { preHandler: [authenticateAdmin] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const q = req.query as Record<string, string | undefined>;
      const result = await AdminSvc.listOrganizations({
        search: q.search,
        status: q.status,
        plan: q.plan,
        page: parseInt(q.page ?? '1', 10),
        limit: parseInt(q.limit ?? '50', 10),
      });
      return reply.send(result);
    },
  );

  fastify.get(
    '/api/v1/admin/organizations/:id',
    { preHandler: [authenticateAdmin] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      try {
        const org = await AdminSvc.getOrganizationDetail(id);
        return reply.send(org);
      } catch (err) {
        if (err instanceof Error && err.message === 'NOT_FOUND') {
          return reply.code(404).send({
            code: 'NOT_FOUND',
            message: 'Organization not found',
          });
        }
        throw err;
      }
    },
  );

  fastify.patch(
    '/api/v1/admin/organizations/:id',
    { preHandler: [authenticateAdmin, requireAdminRole(['super_admin', 'support'])] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const admin = (req as AdminRequest).admin;
      await AdminSvc.updateOrganization(
        id,
        req.body as AdminSvc.UpdateOrganizationInput,
        admin.sub,
      );
      return reply.send({ success: true });
    },
  );

  fastify.post(
    '/api/v1/admin/organizations/:id/impersonate',
    { preHandler: [authenticateAdmin, requireAdminRole(['super_admin'])] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const admin = (req as AdminRequest).admin;
      const body = req.body as { reason?: string };

      if (!body.reason) {
        return reply.code(400).send({
          code: 'REASON_REQUIRED',
          message: 'Impersonation reason is required',
        });
      }

      const token = await AdminSvc.impersonateOrganization(admin.sub, id, body.reason);

      return reply.send({
        impersonationToken: token,
        expiresIn: 3600,
        warning: 'This token grants full owner access. Use responsibly.',
      });
    },
  );

  // ── Platform Metrics ────────────────────────────────────────────────────

  fastify.get(
    '/api/v1/admin/metrics',
    { preHandler: [authenticateAdmin] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const metrics = await AdminSvc.getPlatformMetrics();
      return reply.send(metrics);
    },
  );

  // ── Helpdesk ──────────────────────────────────────────────────────────────

  fastify.post(
    '/api/v1/admin/helpdesk/query',
    { preHandler: [authenticateAdmin] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const admin = (req as AdminRequest).admin;
      const body = req.body as {
        query?: string;
        orgId?: string;
        history?: HelpdeskSvc.HelpdeskMessage[];
      };

      if (!body.query) {
        return reply.code(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Query is required',
        });
      }

      let context: HelpdeskSvc.HelpdeskContext | undefined;
      if (body.orgId) {
        context = await HelpdeskSvc.getOrgContextForHelpdesk(body.orgId);
      }

      const result = await HelpdeskSvc.processHelpdeskQuery({
        query: body.query,
        history: body.history,
        context,
        adminId: admin.sub,
      });

      return reply.send(result);
    },
  );

  fastify.get(
    '/api/v1/admin/helpdesk/tickets',
    { preHandler: [authenticateAdmin] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const q = req.query as Record<string, string | undefined>;
      const result = await query(
        `SELECT t.*, o.name AS org_name,
           a.first_name || ' ' || a.last_name AS assigned_to_name,
           COUNT(m.id) AS message_count
         FROM helpdesk_tickets t
         LEFT JOIN organizations o ON o.id = t.organization_id
         LEFT JOIN admin_users a ON a.id = t.assigned_to
         LEFT JOIN helpdesk_messages m ON m.ticket_id = t.id
         WHERE ($1::text IS NULL OR t.status = $1)
         GROUP BY t.id, o.name, a.first_name, a.last_name
         ORDER BY t.created_at DESC
         LIMIT 100`,
        [q.status ?? null],
      );
      return reply.send(result.rows);
    },
  );
}
