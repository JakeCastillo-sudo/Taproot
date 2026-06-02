/**
 * Sentry error monitoring — API
 *
 * Initialise Sentry with org/user context for every request.
 * Filters: never capture PII (no card data, passwords, raw bodies).
 * Sample rate: 100% errors, 10% performance traces.
 *
 * Set SENTRY_DSN in environment to enable. Silent no-op when absent.
 */

import * as Sentry from '@sentry/node';
import type { FastifyInstance } from 'fastify';
import { config } from '../config';

let _initialized = false;

export function initSentry(): void {
  if (_initialized || !config.SENTRY_DSN) return;
  _initialized = true;

  Sentry.init({
    dsn:         config.SENTRY_DSN,
    environment: config.NODE_ENV,
    release:     process.env.npm_package_version,
    tracesSampleRate: 0.1,        // 10% of transactions
    // Never capture raw request bodies (may contain passwords / card data)
    beforeSend(event) {
      if (event.request?.data) {
        delete event.request.data;
      }
      // Strip auth headers
      if (event.request?.headers?.authorization) {
        event.request.headers.authorization = '[REDACTED]';
      }
      return event;
    },
  });
}

export function registerSentryHooks(fastify: FastifyInstance): void {
  if (!config.SENTRY_DSN) return;

  // Attach org + employee context on every authenticated request
  fastify.addHook('onRequest', async (request) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (request as any).user as { organizationId?: string; email?: string } | undefined;
    if (user) {
      Sentry.setUser({
        id:    user.organizationId,
        email: user.email,
      });
    }
  });

  // Capture unhandled errors
  fastify.addHook('onError', async (_request, _reply, error) => {
    // Skip operational errors (4xx, known AppErrors)
    if ((error as { statusCode?: number }).statusCode &&
        (error as { statusCode: number }).statusCode < 500) return;
    Sentry.captureException(error);
  });
}
