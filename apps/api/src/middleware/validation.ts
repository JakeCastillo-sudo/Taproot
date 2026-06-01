/**
 * Global input validation hooks.
 *
 * Registered once in index.ts:
 *   registerValidationHooks(fastify)
 *
 * Provides:
 *  - X-Request-ID generation + response header on every request
 *  - 413 rejection for bodies > 1 MB (multipart uploads exempt)
 *  - HTML tag stripping from all JSON string values
 *  - UUID format validation on route params named *Id or exactly "id"
 *    (excludes: readerId — Stripe uses tmr_… format)
 */

import crypto from 'crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MB

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Params whose names end with `id` but whose values are NOT Taproot UUIDs */
const NON_UUID_ID_PARAMS = new Set(['readerId']);

// ─── HTML sanitiser ───────────────────────────────────────────────────────────

function stripHtml(value: unknown, depth = 0): unknown {
  if (depth > 12) return value; // guard against extreme nesting
  if (typeof value === 'string') {
    return value
      .replace(/<[^>]*>/g, '')          // strip HTML/XML tags
      .replace(/javascript:/gi, '')     // remove JS-URI scheme
      .replace(/on\w+\s*=/gi, '')       // remove inline event handlers
      .slice(0, 50_000);                // hard cap per string field
  }
  if (Array.isArray(value)) return value.map((v) => stripHtml(v, depth + 1));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = stripHtml(v, depth + 1);
    }
    return out;
  }
  return value;
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export async function registerValidationHooks(
  fastify: FastifyInstance,
): Promise<void> {

  // ── 1. Attach / propagate X-Request-ID ─────────────────────────────────────
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const incoming = request.headers['x-request-id'] as string | undefined;
    const requestId = incoming?.match(/^[\w\-]{1,64}$/) ? incoming : crypto.randomUUID();

    // Make it available via header lookup for downstream code
    (request.headers as Record<string, string>)['x-request-id'] = requestId;
    reply.header('X-Request-ID', requestId);
  });

  // ── 2. Body size guard (skips multipart — handled by @fastify/multipart) ───
  fastify.addHook('preValidation', async (request: FastifyRequest, reply: FastifyReply) => {
    const ct = (request.headers['content-type'] ?? '').toLowerCase();
    if (ct.includes('multipart/form-data')) return; // file uploads exempt

    const cl = parseInt((request.headers['content-length'] ?? '0') as string, 10);
    if (!isNaN(cl) && cl > MAX_BODY_BYTES) {
      return reply.code(413).send({
        code:    'PAYLOAD_TOO_LARGE',
        message: 'Request body must not exceed 1 MB',
      });
    }
  });

  // ── 3. Strip HTML from JSON request bodies ──────────────────────────────────
  fastify.addHook('preHandler', async (request: FastifyRequest) => {
    if (request.body !== null && typeof request.body === 'object') {
      // Cast is safe — Fastify already parsed JSON into a plain object at this stage
      (request as FastifyRequest & { body: unknown }).body = stripHtml(request.body);
    }
  });

  // ── 4. UUID validation on route params ──────────────────────────────────────
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as Record<string, string> | undefined;
    if (!params) return;

    for (const [key, value] of Object.entries(params)) {
      const lk = key.toLowerCase();
      // Only check params ending in 'id' and not in the exclusion list
      if (!lk.endsWith('id')) continue;
      if (NON_UUID_ID_PARAMS.has(key)) continue;
      if (!value) continue; // empty / missing — let route handler decide

      if (!UUID_RE.test(value)) {
        return reply.code(400).send({
          code:    'INVALID_PARAM',
          message: `"${key}" must be a valid UUID`,
        });
      }
    }
  });
}
