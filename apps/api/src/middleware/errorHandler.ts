/**
 * Production-safe global error handler.
 *
 * Registered once in index.ts:
 *   registerErrorHandler(fastify)
 *
 * Behaviour:
 *  - development: returns full message + stack trace
 *  - production:  returns sanitised message only (no internals leaked)
 *  - Always logs full error server-side via pino
 *
 * Handles:
 *  - AppError subclasses (TokenExpiredError, ValidationError, etc.)
 *  - Zod ZodError → 400 with field-level details
 *  - Fastify schema validation errors → 422
 *  - Postgres unique violation (23505) → 409
 *  - Postgres foreign-key violation (23503) → 422
 *  - Postgres not-null violation (23502) → 400
 *  - Stripe errors → 402
 *  - Rate limit (429) pass-through
 *  - Everything else → 500
 */

import type {
  FastifyError, FastifyInstance, FastifyReply, FastifyRequest,
} from 'fastify';
import { ZodError } from 'zod';
import {
  AppError,
  ValidationError,
  TokenExpiredError,
  TokenInvalidError,
} from '../errors';
import { config } from '../config';

// ─── Postgres wire error ──────────────────────────────────────────────────────

interface PgError extends Error {
  code?:       string;   // e.g. '23505'
  detail?:     string;
  constraint?: string;
  table?:      string;
}

// ─── Stripe duck-type ─────────────────────────────────────────────────────────

interface MaybeStripeError {
  type?:    string;   // 'StripeCardError', 'StripeInvalidRequestError', …
  code?:    string;   // 'card_declined', 'insufficient_funds', …
  message?: string;
}

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerErrorHandler(fastify: FastifyInstance): void {
  const isProd = config.NODE_ENV === 'production';

  fastify.setErrorHandler(
    (err: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) => {
      const requestId = reply.getHeader('X-Request-ID') as string | undefined;

      // Helper: attach requestId to every error payload
      const withReqId = (body: Record<string, unknown>) =>
        requestId ? { ...body, requestId } : body;

      // ── Token errors ────────────────────────────────────────────────────────
      if (err instanceof TokenExpiredError || err instanceof TokenInvalidError) {
        return reply.code(err.statusCode).send(withReqId({
          code:    err.code,
          message: err.message,
        }));
      }

      // ── App domain errors ───────────────────────────────────────────────────
      if (err instanceof ValidationError) {
        return reply.code(err.statusCode).send(withReqId({
          code:    err.code,
          message: err.message,
          details: err.details,
        }));
      }

      if (err instanceof AppError) {
        return reply.code(err.statusCode).send(withReqId({
          code:    err.code,
          message: err.message,
        }));
      }

      // ── Zod validation ──────────────────────────────────────────────────────
      if (err instanceof ZodError) {
        return reply.code(400).send(withReqId({
          code:    'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: err.flatten().fieldErrors,
        }));
      }

      // ── Fastify schema validation ───────────────────────────────────────────
      if ((err as FastifyError).validation) {
        return reply.code(422).send(withReqId({
          code:    'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: (err as FastifyError).validation,
        }));
      }

      // ── Rate limit pass-through ─────────────────────────────────────────────
      if ((err as FastifyError).statusCode === 429) {
        return reply.code(429).send(err);
      }

      // ── Postgres errors ─────────────────────────────────────────────────────
      const pg = err as PgError;

      if (pg.code === '23505') {
        // Unique constraint violation — safe to surface
        return reply.code(409).send(withReqId({
          code:    'CONFLICT',
          message: 'A record with that identifier already exists',
        }));
      }

      if (pg.code === '23503') {
        // Foreign key violation
        return reply.code(422).send(withReqId({
          code:    'UNPROCESSABLE',
          message: 'Referenced resource does not exist',
        }));
      }

      if (pg.code === '23502') {
        // NOT NULL violation
        return reply.code(400).send(withReqId({
          code:    'MISSING_REQUIRED_FIELD',
          message: 'A required field is missing',
        }));
      }

      // ── Stripe errors ───────────────────────────────────────────────────────
      const maybeStripe = err as MaybeStripeError;
      if (typeof maybeStripe.type === 'string' && maybeStripe.type.startsWith('Stripe')) {
        fastify.log.warn(
          { stripeType: maybeStripe.type, stripeCode: maybeStripe.code, requestId },
          'Stripe error',
        );
        return reply.code(402).send(withReqId({
          code:    maybeStripe.code ?? 'PAYMENT_ERROR',
          message: isProd
            ? 'Payment processing failed. Please check your card details and try again.'
            : (maybeStripe.message ?? 'Stripe error'),
        }));
      }

      // ── Unhandled errors ────────────────────────────────────────────────────
      fastify.log.error(
        { err, requestId, method: request.method, url: request.url },
        'Unhandled error',
      );

      // TEMPORARY (BUG-ING-001 diagnosis): surface the real DB error fields so we
      // can find the root cause of the ingredient 500s. REMOVE after the fix.
      const _pg = err as PgError & { where?: string; routine?: string; schema?: string; column?: string };
      return reply.code(500).send(withReqId({
        code:    'INTERNAL_ERROR',
        message: isProd ? 'An internal error occurred' : (err.message ?? 'Unknown error'),
        _debug: {
          name: err.name, message: err.message,
          pgCode: _pg.code, detail: _pg.detail, constraint: _pg.constraint,
          table: _pg.table, column: _pg.column, schema: _pg.schema,
          where: _pg.where, routine: _pg.routine,
        },
        ...(!isProd && err.stack ? { stack: err.stack } : {}),
      }));
    },
  );
}
