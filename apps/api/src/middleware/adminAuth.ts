/**
 * Admin authentication middleware — fully separate from organization auth.
 *
 * Admin tokens are signed with ADMIN_JWT_SECRET (NOT the org JWT_SECRET) and
 * carry a distinct issuer/audience. Every request is additionally checked
 * against admin_sessions so a token can be revoked before its 8h expiry.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { query } from '../db/client';

const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET
  ?? `${process.env.JWT_SECRET ?? ''}_admin`;

export type AdminRole = 'super_admin' | 'support' | 'read_only';

export interface AdminTokenPayload {
  sub: string; // admin_user_id
  email: string;
  role: AdminRole;
  sessionId: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

export interface AdminRequest extends FastifyRequest {
  admin: AdminTokenPayload;
}

export async function authenticateAdmin(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.code(401).send({
      code: 'ADMIN_UNAUTHORIZED',
      message: 'Admin authentication required',
    });
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, ADMIN_JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'taproot-admin',
      audience: 'taproot-admin-api',
    }) as AdminTokenPayload;

    // Verify the session has not been revoked / expired.
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const session = await query(
      `SELECT id FROM admin_sessions
       WHERE token_hash = $1
         AND revoked_at IS NULL
         AND expires_at > NOW()`,
      [tokenHash],
    );

    if (!session.rows[0]) {
      return reply.code(401).send({
        code: 'ADMIN_SESSION_EXPIRED',
        message: 'Admin session expired or revoked',
      });
    }

    (req as AdminRequest).admin = payload;
  } catch {
    return reply.code(401).send({
      code: 'ADMIN_TOKEN_INVALID',
      message: 'Invalid admin token',
    });
  }
}

export function requireAdminRole(allowedRoles: AdminRole[]) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const admin = (req as AdminRequest).admin;
    if (!admin || !allowedRoles.includes(admin.role)) {
      return reply.code(403).send({
        code: 'ADMIN_INSUFFICIENT_ROLE',
        message: `Requires one of: ${allowedRoles.join(', ')}`,
      });
    }
  };
}
