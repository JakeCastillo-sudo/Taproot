import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AccessTokenPayload } from '../auth/jwt';
import { Permission, requirePermissions } from '../auth/permissions';
import * as OrderSvc from '../services/order.service';
import * as PaymentSvc from '../services/payment.service';
import * as TransactionSvc from '../services/transaction.service';
import * as PurchaseOrderSvc from '../services/purchaseOrder.service';
import * as ReceiptSvc from '../services/receipt.service';

type AuthedRequest = FastifyRequest & { user: AccessTokenPayload };

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** True if the caller is a cashier (not manager/owner) */
function isCashierOnly(user: AccessTokenPayload): boolean {
  return user.role === 'cashier';
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default async function orderRoutes(fastify: FastifyInstance): Promise<void> {

  // ── Orders ────────────────────────────────────────────────────────────────

  // GET /api/v1/orders — org-wide enriched order history (Order History screen)
  fastify.get(
    '/api/v1/orders',
    { preHandler: [requirePermissions(Permission.ORDER_VIEW)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const q = req.query as Record<string, string>;
      const filter: OrderSvc.OrderHistoryFilter = {
        status:        q.status,
        employeeId:    q.employeeId,
        paymentMethod: q.paymentMethod,
        from:          q.from,
        to:            q.to,
        search:        q.search,
        locationId:    q.locationId,
        page:          q.page  ? parseInt(q.page, 10)  : undefined,
        limit:         q.limit ? parseInt(q.limit, 10) : undefined,
      };
      // Cashiers without ORDER_VIEW_ALL only see their own orders
      if (isCashierOnly(user) && !user.permissions.includes(Permission.ORDER_VIEW_ALL)) {
        filter.restrictToEmployeeId = user.sub;
      }
      const result = await OrderSvc.listOrderHistory(user.orgId, filter);
      return reply.send(result);
    },
  );

  // POST /api/v1/orders/:id/void — org-level void (refunds completed payments)
  fastify.post(
    '/api/v1/orders/:id/void',
    { preHandler: [requirePermissions(Permission.ORDER_VOID)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const { id } = req.params as { id: string };
      const { reason } = req.body as { reason: string };
      const result = await TransactionSvc.voidOrder(user.orgId, user.sub, id, reason);
      return reply.send(result);
    },
  );

  // POST /api/v1/orders/:id/adjust-tip — manager post-payment tip adjustment
  fastify.post(
    '/api/v1/orders/:id/adjust-tip',
    { preHandler: [requirePermissions(Permission.ORDER_REFUND)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const { id } = req.params as { id: string };
      const { tipAmount } = req.body as { tipAmount: number };
      const result = await TransactionSvc.adjustTip(user.orgId, user.sub, id, Math.round(tipAmount));
      return reply.send(result);
    },
  );

  // GET /api/v1/orders/:id/line-items — for the by-item refund picker
  fastify.get(
    '/api/v1/orders/:id/line-items',
    { preHandler: [requirePermissions(Permission.ORDER_VIEW)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const { id } = req.params as { id: string };
      const items = await TransactionSvc.listOrderLineItems(user.orgId, id);
      return reply.send({ lineItems: items });
    },
  );

  // POST /api/v1/orders/:id/refund — full / partial / by-item refund
  fastify.post(
    '/api/v1/orders/:id/refund',
    { preHandler: [requirePermissions(Permission.ORDER_REFUND)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const { id } = req.params as { id: string };
      const body = req.body as TransactionSvc.RefundOrderInput;
      const result = await TransactionSvc.refundOrder(user.orgId, user.sub, id, body);
      return reply.send(result);
    },
  );

  // GET /api/v1/locations/:locationId/orders
  fastify.get(
    '/api/v1/locations/:locationId/orders',
    { preHandler: [requirePermissions(Permission.ORDER_VIEW)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const { locationId } = req.params as { locationId: string };
      const q = req.query as Record<string, string>;

      const filter: OrderSvc.ListOrdersFilter = {
        status:    q.status,
        orderType: q.orderType,
        customerId: q.customerId,
        dateFrom:  q.dateFrom,
        dateTo:    q.dateTo,
        limit:     q.limit  ? parseInt(q.limit, 10)  : undefined,
        offset:    q.offset ? parseInt(q.offset, 10) : undefined,
      };

      // Cashiers who lack ORDER_VIEW_ALL may only see their own orders
      if (
        isCashierOnly(user) &&
        !user.permissions.includes(Permission.ORDER_VIEW_ALL)
      ) {
        filter.restrictToEmployeeId = user.sub;
      }

      const result = await OrderSvc.listOrders(user.orgId, locationId, filter);
      return reply.send(result);
    },
  );

  // POST /api/v1/locations/:locationId/orders
  fastify.post(
    '/api/v1/locations/:locationId/orders',
    { preHandler: [requirePermissions(Permission.ORDER_CREATE)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const { locationId } = req.params as { locationId: string };
      const input = req.body as OrderSvc.CreateOrderInput;
      // WG-004: only pass through price overrides if the actor holds the permission.
      const canOverridePrice = user.permissions.includes(Permission.ORDER_PRICE_OVERRIDE);
      const order = await OrderSvc.createOrder(user.orgId, locationId, user.sub, input, canOverridePrice);
      return reply.code(201).send(order);
    },
  );

  // GET /api/v1/locations/:locationId/orders/:orderId
  fastify.get(
    '/api/v1/locations/:locationId/orders/:orderId',
    { preHandler: [requirePermissions(Permission.ORDER_VIEW)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const { orderId } = req.params as { locationId: string; orderId: string };
      const restrictTo = isCashierOnly(user) && !user.permissions.includes(Permission.ORDER_VIEW_ALL)
        ? user.sub
        : undefined;
      const order = await OrderSvc.getOrder(user.orgId, orderId, restrictTo);
      return reply.send(order);
    },
  );

  // PATCH /api/v1/locations/:locationId/orders/:orderId
  fastify.patch(
    '/api/v1/locations/:locationId/orders/:orderId',
    { preHandler: [requirePermissions(Permission.ORDER_CREATE)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const { locationId, orderId } = req.params as { locationId: string; orderId: string };
      const input = req.body as OrderSvc.UpdateOrderInput;
      // WG-004: only pass through price overrides if the actor holds the permission.
      const canOverridePrice = user.permissions.includes(Permission.ORDER_PRICE_OVERRIDE);
      const order = await OrderSvc.updateOrder(user.orgId, locationId, orderId, user.sub, input, canOverridePrice);
      return reply.send(order);
    },
  );

  // POST /api/v1/locations/:locationId/orders/:orderId/void
  fastify.post(
    '/api/v1/locations/:locationId/orders/:orderId/void',
    { preHandler: [requirePermissions(Permission.ORDER_VOID)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const { orderId } = req.params as { locationId: string; orderId: string };
      const { reason } = req.body as { reason: string };
      // WG-003: use the refunding void path (reverses captured payments) instead of
      // OrderSvc.voidOrder, which did not refund. Matches the org-level void route above.
      const result = await TransactionSvc.voidOrder(user.orgId, user.sub, orderId, reason);
      return reply.send(result);
    },
  );

  // POST /api/v1/locations/:locationId/orders/:orderId/park
  fastify.post(
    '/api/v1/locations/:locationId/orders/:orderId/park',
    { preHandler: [requirePermissions(Permission.ORDER_CREATE)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const { locationId, orderId } = req.params as { locationId: string; orderId: string };
      const order = await OrderSvc.parkOrder(user.orgId, locationId, orderId, user.sub);
      return reply.send(order);
    },
  );

  // POST /api/v1/locations/:locationId/orders/:orderId/resume
  fastify.post(
    '/api/v1/locations/:locationId/orders/:orderId/resume',
    { preHandler: [requirePermissions(Permission.ORDER_CREATE)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const { locationId, orderId } = req.params as { locationId: string; orderId: string };
      const order = await OrderSvc.resumeOrder(user.orgId, locationId, orderId, user.sub);
      return reply.send(order);
    },
  );

  // POST /api/v1/locations/:locationId/orders/:orderId/split
  fastify.post(
    '/api/v1/locations/:locationId/orders/:orderId/split',
    { preHandler: [requirePermissions(Permission.ORDER_CREATE)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const { locationId, orderId } = req.params as { locationId: string; orderId: string };
      const input = req.body as OrderSvc.SplitOrderInput;
      const orders = await OrderSvc.splitOrder(user.orgId, locationId, orderId, user.sub, input);
      return reply.code(201).send(orders);
    },
  );

  // POST /api/v1/locations/:locationId/orders/merge
  fastify.post(
    '/api/v1/locations/:locationId/orders/merge',
    { preHandler: [requirePermissions(Permission.ORDER_CREATE)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const { locationId } = req.params as { locationId: string };
      const { orderIds } = req.body as { orderIds: string[] };
      const order = await OrderSvc.mergeOrders(user.orgId, locationId, orderIds, user.sub);
      return reply.send(order);
    },
  );

  // ── Payments ─────────────────────────────────────────────────────────────

  // GET /api/v1/locations/:locationId/orders/:orderId/payments
  fastify.get(
    '/api/v1/locations/:locationId/orders/:orderId/payments',
    { preHandler: [requirePermissions(Permission.ORDER_VIEW)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const { orderId } = req.params as { locationId: string; orderId: string };
      const payments = await PaymentSvc.listPaymentsForOrder(user.orgId, orderId);
      return reply.send(payments);
    },
  );

  // POST /api/v1/locations/:locationId/orders/:orderId/payments
  fastify.post(
    '/api/v1/locations/:locationId/orders/:orderId/payments',
    { preHandler: [requirePermissions(Permission.ORDER_CREATE)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const { orderId } = req.params as { locationId: string; orderId: string };
      const input = req.body as PaymentSvc.ProcessPaymentInput;
      const payment = await PaymentSvc.processPayment(user.orgId, orderId, user.sub, input);
      return reply.code(201).send(payment);
    },
  );

  // POST /api/v1/payments/:paymentId/refund
  fastify.post(
    '/api/v1/payments/:paymentId/refund',
    { preHandler: [requirePermissions(Permission.ORDER_REFUND)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const { paymentId } = req.params as { paymentId: string };
      const { amount, reason } = req.body as { amount: number; reason?: string };
      const payment = await PaymentSvc.refundPayment(user.orgId, user.sub, {
        paymentId, amount, reason,
      });
      return reply.send(payment);
    },
  );

  // GET /api/v1/payments/:paymentId
  fastify.get(
    '/api/v1/payments/:paymentId',
    { preHandler: [requirePermissions(Permission.ORDER_VIEW)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const { paymentId } = req.params as { paymentId: string };
      const payment = await PaymentSvc.getPayment(user.orgId, paymentId);
      return reply.send(payment);
    },
  );

  // ── Receipts ─────────────────────────────────────────────────────────────

  // GET /api/v1/locations/:locationId/orders/:orderId/receipt
  fastify.get(
    '/api/v1/locations/:locationId/orders/:orderId/receipt',
    { preHandler: [requirePermissions(Permission.ORDER_VIEW)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const { orderId } = req.params as { locationId: string; orderId: string };
      const q = req.query as { format?: string };

      const receipt = await ReceiptSvc.buildReceipt(user.orgId, orderId);

      if (q.format === 'text') {
        return reply
          .header('Content-Type', 'text/plain')
          .send(ReceiptSvc.formatReceiptText(receipt));
      }
      return reply.send(receipt);
    },
  );

  // POST /api/v1/locations/:locationId/orders/:orderId/receipt/email
  fastify.post(
    '/api/v1/locations/:locationId/orders/:orderId/receipt/email',
    { preHandler: [requirePermissions(Permission.ORDER_VIEW)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const { orderId } = req.params as { locationId: string; orderId: string };
      const { email } = req.body as { email: string };
      const result = await ReceiptSvc.sendReceiptEmail(user.orgId, orderId, email);
      return reply.send(result);
    },
  );

  // ── Purchase Orders ───────────────────────────────────────────────────────

  // GET /api/v1/purchase-orders
  fastify.get(
    '/api/v1/purchase-orders',
    { preHandler: [requirePermissions(Permission.INVENTORY_PO_CREATE)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const q = req.query as Record<string, string>;
      const result = await PurchaseOrderSvc.listPurchaseOrders(user.orgId, {
        status:     q.status,
        supplierId: q.supplierId,
        locationId: q.locationId,
        dateFrom:   q.dateFrom,
        dateTo:     q.dateTo,
        limit:      q.limit   ? parseInt(q.limit, 10)   : undefined,
        offset:     q.offset  ? parseInt(q.offset, 10)  : undefined,
      });
      return reply.send(result);
    },
  );

  // POST /api/v1/purchase-orders
  fastify.post(
    '/api/v1/purchase-orders',
    { preHandler: [requirePermissions(Permission.INVENTORY_PO_CREATE)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const input = req.body as PurchaseOrderSvc.CreatePOInput;
      const po = await PurchaseOrderSvc.createPurchaseOrder(user.orgId, user.sub, input);
      return reply.code(201).send(po);
    },
  );

  // GET /api/v1/purchase-orders/:id
  fastify.get(
    '/api/v1/purchase-orders/:id',
    { preHandler: [requirePermissions(Permission.INVENTORY_PO_CREATE)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const { id } = req.params as { id: string };
      const po = await PurchaseOrderSvc.getPurchaseOrder(user.orgId, id);
      return reply.send(po);
    },
  );

  // POST /api/v1/purchase-orders/:id/send
  fastify.post(
    '/api/v1/purchase-orders/:id/send',
    { preHandler: [requirePermissions(Permission.INVENTORY_PO_CREATE)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const { id } = req.params as { id: string };
      const po = await PurchaseOrderSvc.sendPurchaseOrder(user.orgId, id, user.sub);
      return reply.send(po);
    },
  );

  // POST /api/v1/purchase-orders/:id/confirm
  fastify.post(
    '/api/v1/purchase-orders/:id/confirm',
    { preHandler: [requirePermissions(Permission.INVENTORY_PO_CREATE)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const { id } = req.params as { id: string };
      const po = await PurchaseOrderSvc.confirmPurchaseOrder(user.orgId, id, user.sub);
      return reply.send(po);
    },
  );

  // POST /api/v1/purchase-orders/:id/cancel
  fastify.post(
    '/api/v1/purchase-orders/:id/cancel',
    { preHandler: [requirePermissions(Permission.INVENTORY_PO_CREATE)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const { id } = req.params as { id: string };
      const { reason } = (req.body ?? {}) as { reason?: string };
      const po = await PurchaseOrderSvc.cancelPurchaseOrder(user.orgId, id, user.sub, reason);
      return reply.send(po);
    },
  );

  // POST /api/v1/purchase-orders/:id/receive
  fastify.post(
    '/api/v1/purchase-orders/:id/receive',
    { preHandler: [requirePermissions(Permission.INVENTORY_PO_RECEIVE)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user } = req as AuthedRequest;
      const { id } = req.params as { id: string };
      const { lines } = req.body as { lines: PurchaseOrderSvc.ReceivePOLineInput[] };
      const po = await PurchaseOrderSvc.receivePurchaseOrder(user.orgId, id, user.sub, lines);
      return reply.send(po);
    },
  );

  // ── GET /api/v1/orders/:orderId/receipt ───────────────────────────────────
  // Returns structured receipt data for the receipt page.
  // Falls back gracefully when the order does not yet have completed payments.
  fastify.get(
    '/api/v1/orders/:orderId/receipt',
    { preHandler: [requirePermissions(Permission.ORDER_VIEW)] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { user }   = req as AuthedRequest;
      const { orderId } = req.params as { orderId: string };
      const receipt = await ReceiptSvc.buildReceipt(user.orgId, orderId);
      return reply.send(receipt);
    },
  );
}
