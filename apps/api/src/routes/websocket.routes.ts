import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { verifyAccessToken, extractBearerToken } from '../auth/jwt';
import { subscribeToLocation, subscribeToKDS } from '../services/realtime.service';
import type { OrderEvent } from '../services/realtime.service';

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default async function websocketRoutes(fastify: FastifyInstance): Promise<void> {
  // Register @fastify/websocket plugin
  await fastify.register(import('@fastify/websocket'));

  // ── /api/v1/ws/locations/:locationId/orders ─────────────────────────────
  // Streams all order events for a location to authenticated clients.

  fastify.get(
    '/api/v1/ws/locations/:locationId/orders',
    { websocket: true },
    (socket: WebSocket, req: FastifyRequest) => {
      const { locationId } = req.params as { locationId: string };

      // Authenticate via ?token=<accessToken> query param (WS can't set headers)
      const q = req.query as { token?: string };
      let orgId: string | null = null;
      let employeeId: string | null = null;

      try {
        const token = q.token ?? extractBearerToken(req.headers.authorization);
        const payload = verifyAccessToken(token);
        orgId = payload.orgId;
        employeeId = payload.sub;

        // Validate location access
        const { locationIds } = payload;
        if (locationIds.length > 0 && !locationIds.includes(locationId)) {
          socket.close(4003, 'Forbidden: no access to this location');
          return;
        }
      } catch {
        socket.close(4001, 'Unauthorized');
        return;
      }

      // Subscribe to Redis channel
      const unsubscribe = subscribeToLocation(locationId, (event: OrderEvent) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify(event));
        }
      });

      // Send connected confirmation
      socket.send(JSON.stringify({
        type: 'connection:established',
        locationId,
        timestamp: new Date().toISOString(),
      }));

      // Heartbeat every 30 s to keep the connection alive
      const heartbeat = setInterval(() => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({ type: 'ping', timestamp: new Date().toISOString() }));
        }
      }, 30_000);

      socket.on('message', (data: Buffer | string) => {
        // Support pong / explicit disconnect
        try {
          const msg = JSON.parse(data.toString()) as { type?: string };
          if (msg.type === 'pong') return; // expected heartbeat reply
          if (msg.type === 'disconnect') socket.close(1000, 'Client disconnected');
        } catch {
          // ignore malformed messages
        }
      });

      socket.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
        fastify.log.debug(
          { locationId, employeeId },
          '[ws] Order feed client disconnected',
        );
      });

      socket.on('error', (err: Error) => {
        fastify.log.warn({ err, locationId }, '[ws] WebSocket error');
        clearInterval(heartbeat);
        unsubscribe();
      });
    },
  );

  // ── /api/v1/ws/locations/:locationId/kds ────────────────────────────────
  // Kitchen Display System feed — only kitchen-relevant events.

  fastify.get(
    '/api/v1/ws/locations/:locationId/kds',
    { websocket: true },
    (socket: WebSocket, req: FastifyRequest) => {
      const { locationId } = req.params as { locationId: string };

      const q = req.query as { token?: string };
      try {
        const token = q.token ?? extractBearerToken(req.headers.authorization);
        const payload = verifyAccessToken(token);
        const { locationIds } = payload;
        if (locationIds.length > 0 && !locationIds.includes(locationId)) {
          socket.close(4003, 'Forbidden: no access to this location');
          return;
        }
      } catch {
        socket.close(4001, 'Unauthorized');
        return;
      }

      const unsubscribe = subscribeToKDS(locationId, (event: OrderEvent) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify(event));
        }
      });

      socket.send(JSON.stringify({
        type: 'connection:established',
        channel: 'kds',
        locationId,
        timestamp: new Date().toISOString(),
      }));

      const heartbeat = setInterval(() => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({ type: 'ping', timestamp: new Date().toISOString() }));
        }
      }, 30_000);

      socket.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });

      socket.on('error', (err: Error) => {
        fastify.log.warn({ err, locationId }, '[ws/kds] WebSocket error');
        clearInterval(heartbeat);
        unsubscribe();
      });
    },
  );
}
