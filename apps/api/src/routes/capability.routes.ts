/**
 * capability.routes — read/update the org capability spine (v2.0).
 *
 * ┌─ SANDBOX SEAM ───────────────────────────────────────────────────────────────┐
 * │ This file is intentionally NOT registered in index.ts. Route registration is  │
 * │ explicit in index.ts (the boot path), which this v2.0 sandbox build does not   │
 * │ touch. To wire after review, add to index.ts (see docs/V2_0_SANDBOX_NOTES.md): │
 * │   import capabilityRoutes from './routes/capability.routes';                   │
 * │   await fastify.register(capabilityRoutes);                                    │
 * │ Until wired, the web layer fails OPEN to restaurant behavior, so the absence   │
 * │ of these endpoints changes nothing for existing orgs.                          │
 * └───────────────────────────────────────────────────────────────────────────────┘
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AccessTokenPayload } from '../auth/jwt';
import * as CapabilitySvc from '../services/capability.service';
import { ValidationError } from '../errors';

type AuthedRequest = FastifyRequest & { user: AccessTokenPayload };

function requireManager(req: FastifyRequest, reply: FastifyReply): boolean {
  const { user } = req as AuthedRequest;
  if (user.role !== 'owner' && user.role !== 'manager') {
    reply.status(403).send({ code: 'FORBIDDEN', message: 'Owner or manager access required' });
    return false;
  }
  return true;
}

export default async function capabilityRoutes(fastify: FastifyInstance): Promise<void> {
  // Current org capabilities. Any authenticated user may read (the UI gates on it);
  // always returns a full default-on object, even pre-migration.
  fastify.get('/api/v1/capabilities', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const capabilities = await CapabilitySvc.getCapabilities(user.orgId);
    return reply.send({ capabilities });
  });

  // The named onboarding presets (capability bundles).
  fastify.get('/api/v1/capabilities/presets', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ presets: CapabilitySvc.listPresets() });
  });

  // Update capabilities (owner/manager only). Accepts either a partial patch or a
  // named preset: { "preset": "studio_cafe" }.
  fastify.put('/api/v1/capabilities', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireManager(req, reply)) return;
    const { user } = req as AuthedRequest;
    const body = (req.body ?? {}) as { preset?: string } & CapabilitySvc.CapabilitiesPatch;
    try {
      const capabilities = body.preset
        ? await CapabilitySvc.applyPreset(user.orgId, body.preset)
        : await CapabilitySvc.updateCapabilities(user.orgId, body);
      return reply.send({ capabilities });
    } catch (err) {
      if (err instanceof ValidationError) {
        return reply.status(400).send({ code: 'VALIDATION_ERROR', message: err.message });
      }
      throw err;
    }
  });
}
