/**
 * Import routes — file upload + AI document processing pipeline.
 *
 * POST /api/v1/imports/upload         — upload file, create job, enqueue
 * GET  /api/v1/imports/:jobId         — get job status + preview
 * POST /api/v1/imports/:jobId/confirm — confirm and apply
 * GET  /api/v1/imports                — list recent jobs
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import multipart from '@fastify/multipart';
import type { AccessTokenPayload } from '../auth/jwt';
import { requirePermissions, Permission } from '../auth/permissions';
import { ValidationError } from '../errors';
import { config } from '../config';
import * as ImportJobSvc from '../services/importJob.service';
import type { ImportType } from '../services/importJob.service';
import { queues } from '../queues';

type AuthedRequest = FastifyRequest & { user: AccessTokenPayload };

// Allowed MIME types (after extension-based resolution)
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'text/csv',
  'text/plain',
  'application/octet-stream',                                           // curl / some browsers
  'application/vnd.ms-excel',                                           // .xls
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
]);

/**
 * Extension-based MIME override.
 * Used when the browser/client sends 'application/octet-stream' instead of
 * the real type (common with curl, Windows file pickers, older browsers).
 */
const EXT_TO_MIME: Record<string, string> = {
  '.csv':  'text/csv',
  '.pdf':  'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls':  'application/vnd.ms-excel',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.txt':  'text/plain',
};

const MIME_TO_IMPORT_TYPE: Record<string, ImportType> = {
  'application/pdf':  'document_menu', // will be reclassified by AI
  'image/png':        'document_menu',
  'image/jpeg':       'document_menu',
  'image/jpg':        'document_menu',
  'text/csv':         'generic_csv',
  'text/plain':       'document_menu',
  'application/vnd.ms-excel':                                           'generic_csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'generic_csv',
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export default async function importRoutes(fastify: FastifyInstance): Promise<void> {
  // Register multipart plugin (scoped to this plugin)
  await fastify.register(multipart, {
    limits: {
      fileSize:  MAX_FILE_SIZE,
      files:     1,
      fieldSize: 1024,
    },
  });

  // Ensure uploads directory exists
  const uploadsDir = path.resolve(process.cwd(), config.UPLOADS_DIR);
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  // ── POST /api/v1/imports/upload ──────────────────────────────────────────────

  fastify.post(
    '/api/v1/imports/upload',
    {
      config:     { rateLimit: { max: 20, timeWindow: 60 * 60 * 1000 } }, // 20/hour
      preHandler: requirePermissions(Permission.IMPORT_RUN),
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;

      const data = await req.file();
      if (!data) {
        throw new ValidationError('No file uploaded');
      }

      const originalName = data.filename ?? 'upload';
      const rawMime      = (data.mimetype ?? 'application/octet-stream').toLowerCase();
      const ext          = path.extname(originalName).toLowerCase();

      // Resolve effective MIME: use the file extension as the source of truth
      // when the client sends the unhelpful 'application/octet-stream'.
      const effectiveMime = (rawMime === 'application/octet-stream' && EXT_TO_MIME[ext])
        ? EXT_TO_MIME[ext]
        : rawMime;

      if (!ALLOWED_TYPES.has(effectiveMime)) {
        throw new ValidationError(
          `File type "${effectiveMime}" is not supported. ` +
          `Allowed: PDF, PNG, JPG, CSV, XLSX, TXT`,
        );
      }

      // Save to disk
      const safe = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
      const dest = path.join(uploadsDir, safe);

      const fileBuffer = await data.toBuffer();
      if (fileBuffer.length > MAX_FILE_SIZE) {
        throw new ValidationError('File exceeds 10 MB limit');
      }
      fs.writeFileSync(dest, fileBuffer);

      // Determine import type from the resolved MIME (octet-stream → generic_csv fallback)
      const importType: ImportType = MIME_TO_IMPORT_TYPE[effectiveMime] ?? 'document_menu';
      const relPath = path.join(config.UPLOADS_DIR, safe);

      // Create job record
      const job = await ImportJobSvc.createImportJob(user.orgId, user.sub, {
        importType,
        sourceFilename: originalName,
        sourceFileUrl:  relPath,
        mimeType:       effectiveMime,
      });

      // Enqueue processing
      await queues.aiAnalysis.add(
        {
          orgId:      user.orgId,
          reportType: 'import_document',
          params:     { jobId: job.id },
        },
        {
          jobId:    `import-${job.id}`,
          attempts: 3,
          backoff:  { type: 'exponential', delay: 5_000 },
        },
      );

      return reply.code(202).send({
        jobId:  job.id,
        status: job.status,
      });
    },
  );

  // ── GET /api/v1/imports/:jobId ───────────────────────────────────────────────

  fastify.get(
    '/api/v1/imports/:jobId',
    {
      preHandler: requirePermissions(Permission.IMPORT_RUN),
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const { jobId } = req.params as { jobId: string };
      const job = await ImportJobSvc.getImportJob(user.orgId, jobId);
      return reply.send({ job });
    },
  );

  // ── POST /api/v1/imports/:jobId/confirm ─────────────────────────────────────

  fastify.post(
    '/api/v1/imports/:jobId/confirm',
    {
      preHandler: requirePermissions(Permission.IMPORT_RUN),
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const { jobId }  = req.params  as { jobId: string };
      const body       = req.body    as {
        locationId:        string;
        confirmedMapping?: import('../services/documentParser.service').ColumnMapping;
        // EDIT CHAIN: confirmedItems flows from UI through here
        confirmedItems?:   import('../services/importJob.service').ConfirmedItem[];
      };

      if (!body.locationId) throw new ValidationError('locationId is required');

      const job = await ImportJobSvc.confirmImportJob(
        user.orgId,
        jobId,
        user.sub,
        body.locationId,
        body.confirmedMapping,
        body.confirmedItems,   // EDIT CHAIN: pass user edits to service
      );

      return reply.send({ job });
    },
  );

  // ── GET /api/v1/imports ──────────────────────────────────────────────────────

  fastify.get(
    '/api/v1/imports',
    {
      preHandler: requirePermissions(Permission.IMPORT_RUN),
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const q = req.query as Record<string, string>;

      const { jobs, total } = await ImportJobSvc.listImportJobs(user.orgId, {
        status:     q.status,
        importType: q.importType,
        limit:      q.limit  ? parseInt(q.limit,  10) : 20,
        offset:     q.offset ? parseInt(q.offset, 10) : 0,
      });

      return reply.send({ jobs, total });
    },
  );
}
