import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { validateConfig, config } from './config';
import authPlugin from './auth/index';
import inventoryRoutes from './routes/inventory.routes';
import orderRoutes from './routes/order.routes';
import websocketRoutes from './routes/websocket.routes';
import { AppError, ValidationError } from './errors';

// Validate required env vars at startup — throws immediately if any are missing
validateConfig();

async function buildApp(): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: {
      level: config.NODE_ENV === 'production' ? 'info' : 'debug',
      ...(config.NODE_ENV !== 'production' && {
        transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss Z' } },
      }),
    },
    trustProxy: true,
  });

  // ─── Security headers ───────────────────────────────────────────────────────

  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc:  ["'self'"],
        styleSrc:   ["'self'", "'unsafe-inline'"],
        imgSrc:     ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc:    ["'self'"],
        objectSrc:  ["'none'"],
        frameSrc:   ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  // ─── CORS ───────────────────────────────────────────────────────────────────

  await fastify.register(cors, {
    origin: config.NODE_ENV === 'production'
      ? [config.APP_URL]
      : ['http://localhost:5173', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-Organization-Slug',
      'X-Location-Token',
    ],
    credentials: true,
  });

  // ─── Global rate limit ──────────────────────────────────────────────────────

  await fastify.register(rateLimit, {
    max: 200,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: (_req, context) => ({
      code: 'RATE_LIMITED',
      message: `Too many requests. Retry after ${Math.ceil((context as { ttl: number }).ttl / 1000)} seconds.`,
    }),
  });

  // ─── HTTPS enforcement in production ───────────────────────────────────────

  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (
      config.NODE_ENV === 'production' &&
      request.headers['x-forwarded-proto'] !== 'https'
    ) {
      return reply.code(301).redirect(`https://${request.hostname}${request.url}`);
    }
  });

  // ─── Auth plugin (registers /api/v1/auth/* routes + request decorators) ────

  await fastify.register(authPlugin);
  await fastify.register(inventoryRoutes);
  await fastify.register(orderRoutes);
  await fastify.register(websocketRoutes);

  // ─── Global authentication preHandler ──────────────────────────────────────

  const PUBLIC_ROUTES = new Set([
    'GET /health',
    'POST /api/v1/auth/login',
    'POST /api/v1/auth/login/mfa',
    'POST /api/v1/auth/login/pin',
    'POST /api/v1/auth/refresh',
    'POST /api/v1/auth/password/reset/request',
    'POST /api/v1/auth/password/reset/confirm',
  ]);

  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const routeKey = `${request.method} ${request.routerPath}`;
    if (PUBLIC_ROUTES.has(routeKey)) return;
    await fastify.authenticate(request, reply);
  });

  // ─── Health check ───────────────────────────────────────────────────────────

  fastify.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? '1.0.0',
  }));

  // ─── Global error handler ───────────────────────────────────────────────────

  fastify.setErrorHandler((err, _request, reply) => {
    if (err instanceof ValidationError) {
      return reply.code(err.statusCode).send({
        code: err.code,
        message: err.message,
        details: err.details,
      });
    }

    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({
        code: err.code,
        message: err.message,
      });
    }

    if (err.validation) {
      return reply.code(422).send({
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.validation,
      });
    }

    if (err.statusCode === 429) {
      return reply.code(429).send(err);
    }

    fastify.log.error({ err }, 'Unhandled error');
    return reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'An internal error occurred' });
  });

  return fastify;
}

buildApp()
  .then((app) => app.listen({ port: config.PORT, host: '0.0.0.0' }))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
