/**
 * studioImport.routes — Mindbody / Mariana Tek migration importer (v2.2).
 *
 * ┌─ SANDBOX SEAM ───────────────────────────────────────────────────────────────┐
 * │ NOT registered in index.ts. To wire after review:                              │
 * │   import studioImportRoutes from './routes/studioImport.routes';                │
 * │   await fastify.register(studioImportRoutes);                                  │
 * └───────────────────────────────────────────────────────────────────────────────┘
 * Double-gated: requireManager + hasCapability('studio'). Dry-run before commit.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AccessTokenPayload } from '../auth/jwt';
import * as ImportSvc from '../services/studioImport.service';
import * as CapabilitySvc from '../services/capability.service';

type AuthedRequest = FastifyRequest & { user: AccessTokenPayload };
type Body = { provider?: ImportSvc.ImportProvider; kind?: ImportSvc.ImportKind; csv?: string };

function requireManager(req: FastifyRequest, reply: FastifyReply): boolean {
  const { user } = req as AuthedRequest;
  if (user.role !== 'owner' && user.role !== 'manager') {
    reply.status(403).send({ code: 'FORBIDDEN', message: 'Owner or manager access required' });
    return false;
  }
  return true;
}
async function gate(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  if (!requireManager(req, reply)) return false;
  const { user } = req as AuthedRequest;
  if (!(await CapabilitySvc.hasCapability(user.orgId, 'studio'))) {
    reply.status(404).send({ code: 'NOT_FOUND', message: 'Studio features are not enabled for this organization' });
    return false;
  }
  return true;
}
function validate(b: Body, reply: FastifyReply): b is Required<Body> {
  if (!b.provider || !['mindbody', 'mariana_tek'].includes(b.provider)) { reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'provider must be mindbody | mariana_tek' }); return false; }
  if (!b.kind || !['members', 'schedule'].includes(b.kind)) { reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'kind must be members | schedule' }); return false; }
  if (!b.csv?.trim()) { reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'csv is required' }); return false; }
  return true;
}

export default async function studioImportRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/api/v1/studio/import/dry-run', async (req, reply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    const body = (req.body ?? {}) as Body;
    if (!validate(body, reply)) return;
    return reply.send(await ImportSvc.dryRun(user.orgId, body.provider, body.kind, body.csv));
  });

  fastify.post('/api/v1/studio/import/commit', async (req, reply) => {
    if (!(await gate(req, reply))) return;
    const { user } = req as AuthedRequest;
    const body = (req.body ?? {}) as Body;
    if (!validate(body, reply)) return;
    return reply.send(await ImportSvc.commit(user.orgId, user.sub, body.provider, body.kind, body.csv));
  });
}
