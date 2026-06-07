/**
 * API key routes (S8-04) — manage public API bearer keys.
 *
 * GET    /api/v1/api-keys       List keys (never exposes the full key)
 * POST   /api/v1/api-keys       Create — returns the full key ONCE
 * DELETE /api/v1/api-keys/:id   Revoke
 *
 * Owner/manager only (JWT sessions — API keys cannot manage API keys).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AccessTokenPayload } from '../auth/jwt';
import * as ApiKeySvc from '../services/apiKey.service';

type AuthedRequest = FastifyRequest & { user: AccessTokenPayload };

function requireManagerSession(req: FastifyRequest, reply: FastifyReply): boolean {
  const { user } = req as AuthedRequest;
  if (user.sub.startsWith('apikey:')) {
    reply.code(403).send({ code: 'FORBIDDEN', message: 'API keys cannot manage API keys' });
    return false;
  }
  if (user.role !== 'owner' && user.role !== 'manager') {
    reply.code(403).send({ code: 'FORBIDDEN', message: 'Manager or owner role required' });
    return false;
  }
  return true;
}

export default async function apiKeysRoutes(fastify: FastifyInstance): Promise<void> {

  fastify.get('/api/v1/api-keys', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireManagerSession(req, reply)) return;
    const { user } = req as AuthedRequest;
    return reply.send({ keys: await ApiKeySvc.listApiKeys(user.orgId) });
  });

  fastify.post('/api/v1/api-keys', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireManagerSession(req, reply)) return;
    const { user } = req as AuthedRequest;
    const body = (req.body ?? {}) as { name?: string; permissions?: string[]; expiresAt?: string | null };
    const created = await ApiKeySvc.createApiKey(user.orgId, user.sub, {
      name: body.name ?? '',
      permissions: body.permissions ?? [],
      expiresAt: body.expiresAt ?? null,
    });
    return reply.code(201).send(created);
  });

  fastify.delete('/api/v1/api-keys/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireManagerSession(req, reply)) return;
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    await ApiKeySvc.revokeApiKey(user.orgId, id);
    return reply.send({ success: true });
  });
}
