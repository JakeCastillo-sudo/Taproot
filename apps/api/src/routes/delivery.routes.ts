/**
 * Delivery routes.
 *  - GET  /api/v1/delivery/providers           (authed) list provider config
 *  - PUT  /api/v1/delivery/providers/:provider (authed, owner/manager) upsert config
 *  - POST /api/v1/webhooks/doordash            (PUBLIC) DoorDash order webhook
 *  - POST /api/v1/webhooks/ubereats            (PUBLIC) Uber Eats order webhook
 *
 * Webhooks resolve the org/location by the provider store id, verify the HMAC
 * signature (when a secret is configured), then create the order off the request
 * path and ack fast (providers expect a quick 2xx).
 *
 * RAW BODY CAVEAT: providers sign the exact raw bytes. Fastify has already parsed
 * JSON here, so we verify against a canonical re-stringify — adequate for setup but
 * for production sign-off, capture the raw body for byte-exact verification.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AccessTokenPayload } from '../auth/jwt';
import * as Delivery from '../services/delivery.service';

type AuthedRequest = FastifyRequest & { user: AccessTokenPayload };

const VALID_PROVIDERS = new Set(['doordash', 'ubereats', 'grubhub']);

function requireAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  const { user } = req as AuthedRequest;
  if (user.role !== 'owner' && user.role !== 'manager') {
    reply.code(403).send({ code: 'FORBIDDEN', message: 'Manager or owner role required' });
    return false;
  }
  return true;
}

export default async function deliveryRoutes(fastify: FastifyInstance): Promise<void> {
  // ── GET providers (authed) ─────────────────────────────────────────────────
  fastify.get('/api/v1/delivery/providers', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user } = req as AuthedRequest;
    const providers = await Delivery.getDeliveryProviders(user.orgId);
    return reply.send({ providers });
  });

  // ── PUT provider config (authed, owner/manager) ────────────────────────────
  fastify.put('/api/v1/delivery/providers/:provider', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(req, reply)) return;
    const { user } = req as AuthedRequest;
    const { provider } = req.params as { provider: string };
    if (!VALID_PROVIDERS.has(provider)) {
      return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Unknown provider' });
    }
    const body = (req.body ?? {}) as {
      isEnabled?: boolean; webhookSecret?: string; apiKey?: string; storeId?: string; settings?: object;
    };
    await Delivery.upsertDeliveryProvider(user.orgId, provider, {
      isEnabled: body.isEnabled ?? false,
      webhookSecret: body.webhookSecret,
      apiKey: body.apiKey,
      storeId: body.storeId,
      settings: body.settings,
    });
    return reply.send({ success: true });
  });

  // ── Webhook handler factory ────────────────────────────────────────────────
  async function handleWebhook(
    req: FastifyRequest,
    reply: FastifyReply,
    provider: Delivery.DeliveryProvider,
    signatureHeader: string,
    extractStoreId: (body: Record<string, unknown>) => string,
    verify: (raw: string, sig: string, secret: string) => boolean,
    normalize: (raw: Record<string, unknown>) => Delivery.DeliveryWebhookPayload,
  ): Promise<FastifyReply> {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const storeId = extractStoreId(body);
    if (!storeId) return reply.code(200).send({ received: false, reason: 'missing store id' });

    const store = await Delivery.resolveStore(provider, storeId);
    if (!store) {
      // Ack so the provider doesn't retry a store we don't manage.
      return reply.code(200).send({ received: false, reason: 'store not configured' });
    }

    // Verify signature when a secret is configured (best-effort raw body — see caveat).
    if (store.webhookSecret) {
      const sig = (req.headers[signatureHeader] as string | undefined) ?? '';
      const raw = JSON.stringify(body);
      if (!verify(raw, sig, store.webhookSecret)) {
        return reply.code(401).send({ error: 'Invalid signature' });
      }
    } else {
      req.log.warn(`[Delivery] ${provider} webhook for store ${storeId} has no secret configured — accepting unverified`);
    }

    const payload = normalize(body);
    // Create the order off the request path; ack fast (idempotent on retry).
    void Delivery.processDeliveryOrder(store.orgId, store.locationId, payload).catch((err) =>
      req.log.error({ err }, `[Delivery] ${provider} order creation failed`),
    );

    return reply.code(200).send({ received: true });
  }

  // ── POST /webhooks/doordash (PUBLIC) ───────────────────────────────────────
  fastify.post('/api/v1/webhooks/doordash', async (req, reply) =>
    handleWebhook(
      req,
      reply,
      'doordash',
      'x-doordash-signature',
      (b) => String((b as Record<string, unknown>).store_id ?? ''),
      Delivery.verifyDoorDashWebhook,
      Delivery.normalizeDoorDashPayload,
    ),
  );

  // ── POST /webhooks/ubereats (PUBLIC) ───────────────────────────────────────
  fastify.post('/api/v1/webhooks/ubereats', async (req, reply) =>
    handleWebhook(
      req,
      reply,
      'ubereats',
      'x-uber-signature',
      (b) => String((b as Record<string, unknown>).restaurant_id ?? (b as Record<string, unknown>).store_id ?? ''),
      Delivery.verifyUberEatsWebhook,
      Delivery.normalizeUberEatsPayload,
    ),
  );
}
