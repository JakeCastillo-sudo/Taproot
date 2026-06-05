/**
 * Table routes — floor plan CRUD + bulk position save. Authenticated globally;
 * org scope from JWT. Location passed via query/body.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AccessTokenPayload } from '../auth/jwt';
import * as TableSvc from '../services/table.service';

type AuthedRequest = FastifyRequest & { user: AccessTokenPayload };

function resolveLocation(user: AccessTokenPayload, provided?: string): string {
  return provided || user.locationIds[0] || '20000000-0000-0000-0000-000000000001';
}

export default async function tableRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /api/v1/tables?locationId=
  fastify.get('/api/v1/tables', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const locationId = resolveLocation(user, (req.query as { locationId?: string }).locationId);
    const tables = await TableSvc.listTables(user.orgId, locationId);
    return reply.send({ tables });
  });

  // POST /api/v1/tables
  fastify.post('/api/v1/tables', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const body = req.body as TableSvc.CreateTableData & { locationId?: string };
    const locationId = resolveLocation(user, body.locationId);
    const table = await TableSvc.createTable(user.orgId, locationId, body, user.sub);
    return reply.code(201).send(table);
  });

  // PATCH /api/v1/tables/bulk-positions (declare before :id)
  fastify.patch('/api/v1/tables/bulk-positions', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const body = req.body as { positions: Array<{ id: string; positionX: number; positionY: number; width?: number; height?: number }> };
    await TableSvc.bulkUpdatePositions(user.orgId, body.positions ?? []);
    return reply.send({ success: true });
  });

  // PATCH /api/v1/tables/:id
  fastify.patch('/api/v1/tables/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    const table = await TableSvc.updateTable(user.orgId, id, req.body as TableSvc.UpdateTableData, user.sub);
    return reply.send(table);
  });

  // DELETE /api/v1/tables/:id
  fastify.delete('/api/v1/tables/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    await TableSvc.deleteTable(user.orgId, id, user.sub);
    return reply.code(204).send();
  });
}
