/**
 * audit — severity-aware security audit events + alerting
 * (Security Hardening, Layers 5 & 10 / PCI DSS Req 10).
 *
 * Thin layer over auth/audit.createAuditLog (the canonical insert-only
 * audit_logs writer, already wired through login/logout/payments/voids/
 * settings via the services). This module adds:
 *
 *   - a typed security-event taxonomy with severity levels
 *   - CRITICAL events mirrored to stderr immediately (Railway log capture)
 *   - raiseSecurityAlert() with Redis dedupe (max 1 alert/type/org/hour)
 *   - recordFailedLogin() — brute-force detector (5 failures / 5 min / org)
 *
 * Audit failures NEVER throw into business code (fail-open on logging,
 * fail-secure on access — the request itself was already denied upstream).
 */

import type { FastifyRequest } from 'fastify';
import { createAuditLog } from '../auth/audit';
import { getPublisher } from '../db/redis';
import { logger } from './logger';

// ─── Event taxonomy (PCI DSS Req 10.2) ────────────────────────────────────────

export type SecurityAuditAction =
  // Auth
  | 'auth.login.success'
  | 'auth.login.failure'
  | 'auth.logout'
  | 'auth.token.refresh'
  | 'auth.token.reuse_detected'
  | 'auth.password.change'
  | 'auth.password.reset.request'
  | 'auth.pin.failure'
  | 'auth.session.revoked'
  | 'auth.session.limit_enforced'
  | 'auth.account.locked'
  // Payments (all money movement — PCI Req 10.2.1)
  | 'payment.initiated'
  | 'payment.completed'
  | 'payment.failed'
  | 'payment.refunded'
  | 'payment.voided'
  // Security signals
  | 'security.suspicious.activity'
  | 'security.rate.limit.exceeded'
  | 'security.invalid.token';

export type AuditSeverity = 'info' | 'warning' | 'critical';

export interface SecurityEvent {
  orgId: string;
  actorId?: string | null;
  actorType?: 'employee' | 'system' | 'api';
  action: SecurityAuditAction;
  resourceType?: string | null;
  resourceId?: string | null;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  request?: FastifyRequest;
  metadata?: Record<string, unknown>;
  severity: AuditSeverity;
}

/** Write a security event to audit_logs (+stderr when critical). Never throws. */
export async function logSecurityEvent(event: SecurityEvent): Promise<void> {
  try {
    await createAuditLog({
      organizationId: event.orgId,
      actorId: event.actorId ?? undefined,
      actorType: event.actorType ?? 'employee',
      action: event.action,
      resourceType: event.resourceType ?? undefined,
      resourceId: event.resourceId ?? undefined,
      beforeState: event.beforeState ?? undefined,
      afterState: event.afterState ?? undefined,
      request: event.request,
      metadata: { ...(event.metadata ?? {}), severity: event.severity },
    });

    if (event.severity === 'critical') {
      logger.error('CRITICAL_AUDIT', {
        action: event.action,
        orgId: event.orgId,
        actorId: event.actorId ?? null,
        resourceId: event.resourceId ?? null,
      });
    }
  } catch (err) {
    // Audit failure must never crash the app — but it IS serious.
    logger.error('AUDIT FAILURE', { message: err instanceof Error ? err.message : 'unknown' });
  }
}

// ─── Security alerts (Layer 10 — PCI DSS Req 10.7) ────────────────────────────

export type SecurityAlertType =
  | 'brute_force_detected'
  | 'account_locked'
  | 'token_reuse_detected'
  | 'multiple_failed_payments'
  | 'unusual_void_pattern'
  | 'large_refund'
  | 'rate_limit_abuse'
  | 'api_key_invalid';

export interface SecurityAlert {
  type: SecurityAlertType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  orgId: string;
  details: Record<string, unknown>;
}

/**
 * Raise a security alert: structured stderr line (Railway captures) +
 * Redis dedupe so the same alert type fires at most once/org/hour.
 * Future seam: email/SMS notification goes where the dedupe passes.
 */
export async function raiseSecurityAlert(alert: SecurityAlert): Promise<void> {
  try {
    const alertKey = `alert:${alert.orgId}:${alert.type}`;
    const redis = getPublisher();
    const isNew = await redis.set(alertKey, '1', 'EX', 3600, 'NX'); // null if exists

    logger.error('SECURITY_ALERT', {
      type: alert.type,
      severity: alert.severity,
      orgId: alert.orgId,
      deduped: isNew === null,
      details: alert.details,
    });

    if (isNew !== null) {
      // Future: send email to owner / SMS via Twilio here.
      await logSecurityEvent({
        orgId: alert.orgId,
        actorId: null,
        actorType: 'system',
        action: 'security.suspicious.activity',
        metadata: { alertType: alert.type, ...alert.details },
        severity: 'critical',
      });
    }
  } catch (err) {
    logger.error('SECURITY_ALERT delivery failed', {
      message: err instanceof Error ? err.message : 'unknown',
    });
  }
}

// ─── Brute-force detection (sliding window in Redis) ──────────────────────────

const BRUTE_FORCE_THRESHOLD = 5;          // failures …
const BRUTE_FORCE_WINDOW_SECONDS = 300;   // … within 5 minutes per org

/**
 * Record a failed login for the org; raises `brute_force_detected` when the
 * threshold is crossed inside the window. Call alongside (not instead of)
 * the per-account lockout counter. Never throws.
 */
export async function recordFailedLogin(
  orgId: string,
  context: { email?: string; ip?: string },
): Promise<void> {
  try {
    const key = `bruteforce:${orgId}`;
    const redis = getPublisher();
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, BRUTE_FORCE_WINDOW_SECONDS);

    if (count >= BRUTE_FORCE_THRESHOLD) {
      await raiseSecurityAlert({
        type: 'brute_force_detected',
        severity: 'high',
        orgId,
        details: { failures: count, windowSeconds: BRUTE_FORCE_WINDOW_SECONDS, ...context },
      });
    }
  } catch { /* detection is best-effort */ }
}
