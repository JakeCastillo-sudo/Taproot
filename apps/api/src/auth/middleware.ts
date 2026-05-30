import type { FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../db/client';
import { extractBearerToken, verifyAccessToken, type AccessTokenPayload } from './jwt';
import { TokenExpiredError, TokenInvalidError, NotFoundError, ForbiddenError } from '../errors';

// ─── authenticate ─────────────────────────────────────────────────────────────

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  let token: string;
  try {
    token = extractBearerToken(request.headers.authorization);
  } catch (err) {
    return reply.code(401).send({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
  }

  try {
    const payload = verifyAccessToken(token);
    (request as FastifyRequest & { user: AccessTokenPayload }).user = payload;
  } catch (err) {
    if (err instanceof TokenExpiredError) {
      return reply.code(401).send({
        code: 'TOKEN_EXPIRED',
        message: 'Token has expired — please refresh',
      });
    }
    return reply.code(401).send({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
  }
}

// ─── authenticateOptional ──────────────────────────────────────────────────────

export async function authenticateOptional(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader) {
    (request as FastifyRequest & { user: null }).user = null;
    return;
  }

  try {
    const token = extractBearerToken(authHeader);
    const payload = verifyAccessToken(token);
    (request as FastifyRequest & { user: AccessTokenPayload }).user = payload;
  } catch {
    (request as FastifyRequest & { user: null }).user = null;
  }
}

// ─── requireOrganization ──────────────────────────────────────────────────────

export async function requireOrganization(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // Resolve org from header; subdomain resolution can be layered on top later
  const slug = (request.headers['x-organization-slug'] as string | undefined)?.trim();

  if (!slug) {
    return reply.code(400).send({
      code: 'ORG_REQUIRED',
      message: 'X-Organization-Slug header is required',
    });
  }

  const { rows } = await query<{
    id: string;
    name: string;
    slug: string;
    deleted_at: string | null;
  }>(
    `SELECT id, name, slug, deleted_at
     FROM organizations
     WHERE slug = $1
     LIMIT 1`,
    [slug],
  );

  if (rows.length === 0) {
    return reply.code(404).send({ code: 'NOT_FOUND', message: 'Organization not found' });
  }

  const org = rows[0];
  if (org.deleted_at) {
    return reply.code(403).send({ code: 'FORBIDDEN', message: 'Organization is inactive' });
  }

  (request as FastifyRequest & { organization: typeof org }).organization = org;
}

// ─── requireLocation ─────────────────────────────────────────────────────────

export function requireLocation(
  locationParamName = 'locationId',
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request, reply) => {
    const user = (request as FastifyRequest & { user?: AccessTokenPayload | null }).user;
    if (!user) {
      return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    }

    // Empty array means the employee has access to all locations
    if (user.locationIds.length === 0) return;

    const locationId =
      (request.params as Record<string, string>)[locationParamName] ??
      (request.body as Record<string, string>)?.[locationParamName];

    if (!locationId) {
      return reply.code(400).send({ code: 'LOCATION_REQUIRED', message: 'Location ID is required' });
    }

    if (!user.locationIds.includes(locationId)) {
      return reply.code(403).send({
        code: 'FORBIDDEN',
        message: 'Access to this location is not permitted',
      });
    }
  };
}
