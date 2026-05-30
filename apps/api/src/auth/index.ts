import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { authenticate, authenticateOptional, requireOrganization, requireLocation } from './middleware';
import { requirePermissions, type Permission } from './permissions';
import { registerAuthRoutes } from './routes';
import type { AccessTokenPayload } from './jwt';

// ─── Module augmentation — extends Fastify request/instance types ─────────────

declare module 'fastify' {
  interface FastifyRequest {
    user: AccessTokenPayload | null;
    organization: {
      id: string;
      name: string;
      slug: string;
      deleted_at: string | null;
    } | null;
  }

  interface FastifyInstance {
    authenticate: typeof authenticate;
    authenticateOptional: typeof authenticateOptional;
    requireOrganization: typeof requireOrganization;
    requireLocation: typeof requireLocation;
    requirePermissions: (...perms: Permission[]) => ReturnType<typeof requirePermissions>;
  }
}

const authPlugin = fp(async (fastify: FastifyInstance) => {
  // Decorate request with default null values before any route runs
  fastify.decorateRequest('user', null);
  fastify.decorateRequest('organization', null);

  // Expose auth hooks as fastify instance decorators for use in route definitions
  fastify.decorate('authenticate', authenticate);
  fastify.decorate('authenticateOptional', authenticateOptional);
  fastify.decorate('requireOrganization', requireOrganization);
  fastify.decorate('requireLocation', requireLocation);
  fastify.decorate('requirePermissions', requirePermissions);

  // Register all /api/v1/auth/* routes
  await fastify.register(
    async (authScope: FastifyInstance) => {
      await registerAuthRoutes(authScope);
    },
    { prefix: '/api/v1/auth' },
  );
}, {
  name: 'taproot-auth',
  fastify: '4.x',
});

export default authPlugin;
export { authenticate, authenticateOptional, requireOrganization, requireLocation, requirePermissions };
export type { AccessTokenPayload };
