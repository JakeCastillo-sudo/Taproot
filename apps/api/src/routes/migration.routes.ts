/**
 * Migration routes — import data from external POS providers.
 *
 * POST /api/v1/migrations/square           → migrateFromSquare
 * POST /api/v1/migrations/shopify          → migrateFromShopify
 * POST /api/v1/migrations/toast            → migrateFromToast
 * POST /api/v1/migrations/lightspeed       → migrateFromLightspeed
 * POST /api/v1/migrations/clover           → migrateFromClover
 * POST /api/v1/migrations/csv              → migrateFromCsv
 * POST /api/v1/migrations/:jobId/apply     → applyMigration
 * GET  /api/v1/migrations                  → listMigrationJobs
 *
 * Test-connection helpers (never write to DB):
 * POST /api/v1/migrations/test/square      → testSquareConnection
 * POST /api/v1/migrations/test/shopify     → testShopifyConnection
 * POST /api/v1/migrations/test/clover      → testCloverConnection
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AccessTokenPayload } from '../auth/jwt';
import { requirePermissions, Permission } from '../auth/permissions';
import { ValidationError } from '../errors';
import * as MigrationSvc from '../services/migration.service';

type AuthedRequest = FastifyRequest & { user: AccessTokenPayload };

export default async function migrationRoutes(fastify: FastifyInstance): Promise<void> {

  // ── POST /api/v1/migrations/square ──────────────────────────────────────────

  fastify.post(
    '/api/v1/migrations/square',
    { preHandler: requirePermissions(Permission.IMPORT_RUN) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const body = req.body as {
        accessToken:      string;
        squareLocationId?: string;
        locationId:        string;
      };
      if (!body.accessToken) throw new ValidationError('accessToken is required');
      if (!body.locationId)  throw new ValidationError('locationId is required');

      const job = await MigrationSvc.migrateFromSquare(
        user.orgId, body.locationId, user.sub,
        { accessToken: body.accessToken, squareLocationId: body.squareLocationId },
      );
      return reply.code(202).send({ job });
    },
  );

  // ── POST /api/v1/migrations/shopify ─────────────────────────────────────────

  fastify.post(
    '/api/v1/migrations/shopify',
    { preHandler: requirePermissions(Permission.IMPORT_RUN) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const body = req.body as {
        shopDomain:  string;
        accessToken: string;
        locationId:  string;
      };
      if (!body.shopDomain)  throw new ValidationError('shopDomain is required');
      if (!body.accessToken) throw new ValidationError('accessToken is required');
      if (!body.locationId)  throw new ValidationError('locationId is required');

      const job = await MigrationSvc.migrateFromShopify(
        user.orgId, body.locationId, user.sub,
        { shopDomain: body.shopDomain, accessToken: body.accessToken },
      );
      return reply.code(202).send({ job });
    },
  );

  // ── POST /api/v1/migrations/toast ───────────────────────────────────────────

  fastify.post(
    '/api/v1/migrations/toast',
    { preHandler: requirePermissions(Permission.IMPORT_RUN) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const body = req.body as {
        clientId:       string;
        clientSecret:   string;
        restaurantGuid: string;
        locationId:     string;
      };
      if (!body.clientId)       throw new ValidationError('clientId is required');
      if (!body.clientSecret)   throw new ValidationError('clientSecret is required');
      if (!body.restaurantGuid) throw new ValidationError('restaurantGuid is required');
      if (!body.locationId)     throw new ValidationError('locationId is required');

      const job = await MigrationSvc.migrateFromToast(
        user.orgId, body.locationId, user.sub,
        {
          clientId:       body.clientId,
          clientSecret:   body.clientSecret,
          restaurantGuid: body.restaurantGuid,
        },
      );
      return reply.code(202).send({ job });
    },
  );

  // ── POST /api/v1/migrations/lightspeed ──────────────────────────────────────

  fastify.post(
    '/api/v1/migrations/lightspeed',
    { preHandler: requirePermissions(Permission.IMPORT_RUN) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const body = req.body as {
        apiKey:     string;
        accountId:  string;
        locationId: string;
      };
      if (!body.apiKey)     throw new ValidationError('apiKey is required');
      if (!body.accountId)  throw new ValidationError('accountId is required');
      if (!body.locationId) throw new ValidationError('locationId is required');

      const job = await MigrationSvc.migrateFromLightspeed(
        user.orgId, body.locationId, user.sub,
        { apiKey: body.apiKey, accountId: body.accountId },
      );
      return reply.code(202).send({ job });
    },
  );

  // ── POST /api/v1/migrations/clover ──────────────────────────────────────────

  fastify.post(
    '/api/v1/migrations/clover',
    { preHandler: requirePermissions(Permission.IMPORT_RUN) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const body = req.body as {
        accessToken: string;
        merchantId:  string;
        locationId:  string;
      };
      if (!body.accessToken) throw new ValidationError('accessToken is required');
      if (!body.merchantId)  throw new ValidationError('merchantId is required');
      if (!body.locationId)  throw new ValidationError('locationId is required');

      const job = await MigrationSvc.migrateFromClover(
        user.orgId, body.locationId, user.sub,
        { accessToken: body.accessToken, merchantId: body.merchantId },
      );
      return reply.code(202).send({ job });
    },
  );

  // ── POST /api/v1/migrations/csv ─────────────────────────────────────────────

  fastify.post(
    '/api/v1/migrations/csv',
    { preHandler: requirePermissions(Permission.IMPORT_RUN) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const body = req.body as {
        fileUrl:      string;
        targetSchema: 'products' | 'customers' | 'inventory';
        rawCsv:       string;
        locationId:   string;
      };
      if (!body.fileUrl)      throw new ValidationError('fileUrl is required');
      if (!body.targetSchema) throw new ValidationError('targetSchema is required');
      if (!body.rawCsv)       throw new ValidationError('rawCsv is required');
      if (!body.locationId)   throw new ValidationError('locationId is required');

      const VALID_SCHEMAS = new Set(['products', 'customers', 'inventory']);
      if (!VALID_SCHEMAS.has(body.targetSchema)) {
        throw new ValidationError(
          'targetSchema must be one of: products, customers, inventory',
        );
      }

      const job = await MigrationSvc.migrateFromCsv(
        user.orgId, body.locationId, user.sub,
        {
          fileUrl:      body.fileUrl,
          targetSchema: body.targetSchema,
          rawCsv:       body.rawCsv,
        },
      );
      return reply.code(202).send({ job });
    },
  );

  // ── POST /api/v1/migrations/:jobId/apply ────────────────────────────────────

  fastify.post(
    '/api/v1/migrations/:jobId/apply',
    { preHandler: requirePermissions(Permission.IMPORT_RUN) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const { jobId } = req.params as { jobId: string };
      const body = req.body as {
        locationId:          string;
        importProducts?:     boolean;
        importCustomers?:    boolean;
        importLoyaltyPoints?: boolean;
        overwriteExisting?:  boolean;
      };
      if (!body.locationId) throw new ValidationError('locationId is required');

      const result = await MigrationSvc.applyMigration(
        user.orgId,
        jobId,
        body.locationId,
        user.sub,
        {
          importProducts:      body.importProducts     ?? true,
          importCustomers:     body.importCustomers    ?? true,
          importLoyaltyPoints: body.importLoyaltyPoints ?? false,
          overwriteExisting:   body.overwriteExisting  ?? false,
        },
      );
      return reply.send({ result });
    },
  );

  // ── GET /api/v1/migrations ──────────────────────────────────────────────────

  fastify.get(
    '/api/v1/migrations',
    { preHandler: requirePermissions(Permission.IMPORT_RUN) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const jobs = await MigrationSvc.listMigrationJobs(user.orgId);
      return reply.send({ jobs });
    },
  );

  // ── POST /api/v1/migrations/test/square ─────────────────────────────────────

  fastify.post(
    '/api/v1/migrations/test/square',
    { preHandler: requirePermissions(Permission.IMPORT_RUN) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = req.body as { accessToken: string };
      if (!body.accessToken) throw new ValidationError('accessToken is required');
      const result = await MigrationSvc.testSquareConnection(body.accessToken);
      return reply.send(result);
    },
  );

  // ── POST /api/v1/migrations/test/shopify ────────────────────────────────────

  fastify.post(
    '/api/v1/migrations/test/shopify',
    { preHandler: requirePermissions(Permission.IMPORT_RUN) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = req.body as { shopDomain: string; accessToken: string };
      if (!body.shopDomain)  throw new ValidationError('shopDomain is required');
      if (!body.accessToken) throw new ValidationError('accessToken is required');
      const result = await MigrationSvc.testShopifyConnection(
        body.shopDomain, body.accessToken,
      );
      return reply.send(result);
    },
  );

  // ── POST /api/v1/migrations/test/clover ─────────────────────────────────────

  fastify.post(
    '/api/v1/migrations/test/clover',
    { preHandler: requirePermissions(Permission.IMPORT_RUN) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = req.body as { merchantId: string; accessToken: string };
      if (!body.merchantId)  throw new ValidationError('merchantId is required');
      if (!body.accessToken) throw new ValidationError('accessToken is required');
      const result = await MigrationSvc.testCloverConnection(
        body.merchantId, body.accessToken,
      );
      return reply.send(result);
    },
  );
}
