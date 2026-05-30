import type { FastifyRequest } from 'fastify';
import { query } from '../db/client';

interface AuditParams {
  organizationId: string;
  actorId?: string;
  actorType?: 'employee' | 'system' | 'api';
  action: string;
  resourceType?: string;
  resourceId?: string;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  request?: FastifyRequest;
  metadata?: Record<string, unknown>;
}

function extractIp(request: FastifyRequest): string | null {
  // Respect X-Forwarded-For when behind a proxy; take the leftmost (original client) IP
  const forwarded = request.headers['x-forwarded-for'];
  if (forwarded) {
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
    return first.trim() ?? null;
  }
  return request.ip ?? null;
}

export async function createAuditLog(params: AuditParams): Promise<void> {
  const {
    organizationId,
    actorId,
    actorType = 'employee',
    action,
    resourceType,
    resourceId,
    beforeState,
    afterState,
    request,
    metadata = {},
  } = params;

  const ipAddress = request ? extractIp(request) : null;
  const userAgent = request?.headers['user-agent'] ?? null;

  try {
    await query(
      `INSERT INTO audit_logs
         (organization_id, actor_id, actor_type, action,
          resource_type, resource_id, before_state, after_state,
          ip_address, user_agent, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        organizationId,
        actorId ?? null,
        actorType,
        action,
        resourceType ?? null,
        resourceId ?? null,
        beforeState ? JSON.stringify(beforeState) : null,
        afterState ? JSON.stringify(afterState) : null,
        ipAddress,
        userAgent,
        JSON.stringify(metadata),
      ],
    );
  } catch (err) {
    // Audit failures must never crash the request. Log and continue.
    console.error('[audit] Failed to write audit log:', {
      action,
      organizationId,
      actorId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
