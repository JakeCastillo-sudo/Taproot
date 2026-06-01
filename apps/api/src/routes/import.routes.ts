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

// Allowed MIME types and their extensions
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'text/csv',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
]);

const MIME_TO_IMPORT_TYPE: Record<string, ImportType> = {
  'application/pdf': 'document_menu', // will be reclassified by AI
  'image/png':       'document_menu',
  'image/jpeg':      'document_menu',
  'image/jpg':       'document_menu',
  'text/csv':        'generic_csv',
  'text/plain':      'document_menu',
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
      preHandler: requirePermissions(Permission.IMPORT_RUN),
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;

      const data = await req.file();
      if (!data) {
        throw new ValidationError('No file uploaded');
      }

      const originalName = data.filename ?? 'upload';
      const mimeType = data.mimetype ?? 'application/octet-stream';

      if (!ALLOWED_TYPES.has(mimeType)) {
        throw new ValidationError(
          `File type "${mimeType}" is not supported. Allowed: PDF, images, CSV, XLSX`,
        );
      }

      // Save to disk
      const ext  = path.extname(originalName) || '';
      const safe = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
      const dest = path.join(uploadsDir, safe);

      const fileBuffer = await data.toBuffer();
      if (fileBuffer.length > MAX_FILE_SIZE) {
        throw new ValidationError('File exceeds 10 MB limit');
      }
      fs.writeFileSync(dest, fileBuffer);

      // Determine import type
      const importType: ImportType = MIME_TO_IMPORT_TYPE[mimeType] ?? 'document_menu';
      const relPath = path.join(config.UPLOADS_DIR, safe);

      // Create job record
      const job = await ImportJobSvc.createImportJob(user.orgId, user.sub, {
        importType,
        sourceFilename: originalName,
        sourceFileUrl:  relPath,
        mimeType,
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
        locationId:       string;
        confirmedMapping?: import('../services/documentParser.service').ColumnMapping;
      };

      if (!body.locationId) throw new ValidationError('locationId is required');

      const job = await ImportJobSvc.confirmImportJob(
        user.orgId,
        jobId,
        user.sub,
        body.locationId,
        body.confirmedMapping,
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
