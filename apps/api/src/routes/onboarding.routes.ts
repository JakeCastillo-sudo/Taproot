/**
 * Onboarding routes
 *
 * GET  /api/v1/onboarding/status       — get current onboarding progress
 * POST /api/v1/onboarding/status       — save step progress (cross-device sync)
 * POST /api/v1/onboarding/complete     — mark onboarding complete
 * POST /api/v1/onboarding/menu-from-url — server-side URL fetch → document parser
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db/client';
import { createImportJob, processImportJob } from '../services/importJob.service';
import { queues } from '../queues/index';

// ─── Schemas ──────────────────────────────────────────────────────────────────

const SaveStatusBody = z.object({
  step:   z.string(),
  status: z.string(),
  data:   z.record(z.unknown()).optional(),
});

const MenuFromUrlBody = z.object({
  url: z.string().url(),
});

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default async function onboardingRoutes(fastify: FastifyInstance) {

  // ── GET /api/v1/onboarding/status ─────────────────────────────────────────

  fastify.get('/api/v1/onboarding/status', async (request, reply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (request as any).user as { organizationId: string } | undefined;
    if (!user) return reply.code(401).send({ code: 'UNAUTHORIZED' });

    const result = await query<{ metadata: Record<string, unknown> }>(
      'SELECT metadata FROM organizations WHERE id = $1',
      [user.organizationId],
    );

    const meta     = result.rows[0]?.metadata ?? {};
    const progress = (meta.onboarding_progress as Record<string, unknown>) ?? null;

    return { progress };
  });

  // ── POST /api/v1/onboarding/status ───────────────────────────────────────

  fastify.post('/api/v1/onboarding/status', async (request, reply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (request as any).user as { organizationId: string } | undefined;
    if (!user) return reply.code(401).send({ code: 'UNAUTHORIZED' });

    const parsed = SaveStatusBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const { step, status, data } = parsed.data;

    await query(
      `UPDATE organizations
       SET metadata   = metadata || jsonb_build_object(
           'onboarding_progress',
           COALESCE(metadata->'onboarding_progress', '{}'::jsonb) || $1::jsonb
         ),
           updated_at = now()
       WHERE id = $2`,
      [JSON.stringify({ [`${step}_status`]: status, ...data }), user.organizationId],
    );

    return { ok: true };
  });

  // ── POST /api/v1/onboarding/complete ─────────────────────────────────────

  fastify.post('/api/v1/onboarding/complete', async (request, reply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (request as any).user as {
      organizationId: string;
      sub: string;
      email?: string;
    } | undefined;
    if (!user) return reply.code(401).send({ code: 'UNAUTHORIZED' });

    await query(
      `UPDATE organizations
       SET metadata   = metadata || '{"onboarding_complete": true}'::jsonb,
           updated_at = now()
       WHERE id = $1`,
      [user.organizationId],
    );

    // Non-blocking: queue completion analytics/email
    queues.email.add({
      to:      user.email ?? '',
      subject: 'You\'re live on Taproot!',
      html:    '<p>Congratulations — your account is fully set up.</p>',
    }).catch(() => { /* non-blocking */ });

    return { ok: true, message: 'Onboarding complete' };
  });

  // ── POST /api/v1/onboarding/menu-from-url ────────────────────────────────

  fastify.post('/api/v1/onboarding/menu-from-url', async (request, reply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (request as any).user as {
      organizationId: string;
      sub: string;
    } | undefined;
    if (!user) return reply.code(401).send({ code: 'UNAUTHORIZED' });

    const parsed = MenuFromUrlBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const { url } = parsed.data;

    // Server-side fetch to avoid CORS
    let pageText: string;
    try {
      const controller = new AbortController();
      const timeout    = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(url, {
        headers: { 'User-Agent': 'TaprootBot/1.0 (+https://taprootpos.com)' },
        signal:  controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      // Strip HTML tags for plain text extraction
      pageText = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .slice(0, 50_000); // cap at 50k chars
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Fetch failed';
      return reply.code(422).send({ code: 'FETCH_ERROR', message: `Could not fetch URL: ${msg}` });
    }

    // Save fetched text as a file in uploads dir
    const fs     = await import('fs');
    const path   = await import('path');
    const crypto = await import('crypto');
    const { config } = await import('../config');

    const safe       = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.txt`;
    const uploadsDir = path.join(process.cwd(), config.UPLOADS_DIR ?? 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const dest    = path.join(uploadsDir, safe);
    fs.writeFileSync(dest, Buffer.from(pageText, 'utf-8'));
    const relPath = path.join(config.UPLOADS_DIR ?? 'uploads', safe);

    const job = await createImportJob(user.organizationId, user.sub, {
      importType:     'document_menu',
      sourceFilename: `menu-from-url-${Date.now()}.txt`,
      sourceFileUrl:  relPath,
      mimeType:       'text/plain',
    });

    // Queue async processing
    await queues.aiAnalysis.add({
      orgId:      user.organizationId,
      reportType: 'import_document',
      params:     { jobId: job.id },
    });

    // Kick off immediate processing in background
    processImportJob(job.id).catch(() => { /* processor handles errors */ });

    return reply.code(202).send({ jobId: job.id, status: 'processing' });
  });
}
