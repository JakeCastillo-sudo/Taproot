/**
 * Bull queue processors — concurrency 5, registered centrally.
 *
 * Processors
 * ──────────
 *   offlinePayment  — drain processOfflineQueue() for the given org
 *   receipt         — build + send a receipt via receipt.service
 *   lowStockAlert   — email managers when a product falls below reorder point
 */

import Bull from 'bull';
import type {
  OfflinePaymentJobData,
  ReceiptJobData,
  LowStockAlertJobData,
  EmailJobData,
  AiAnalysisJobData,
} from './index';
import { processOfflineQueue } from '../payments/offline.service';
import { sendReceiptEmail } from '../services/receipt.service';
import { query } from '../db/client';
import { handleAiAnalysisJob } from './processors/aiAnalysis.processor';

const CONCURRENCY = 5;

// ─── Type for the queues map passed in ────────────────────────────────────────

type QueuesMap = {
  offlinePayment: Bull.Queue<OfflinePaymentJobData>;
  receipt:        Bull.Queue<ReceiptJobData>;
  lowStockAlert:  Bull.Queue<LowStockAlertJobData>;
  email:          Bull.Queue<EmailJobData>;
  aiAnalysis:     Bull.Queue<AiAnalysisJobData>;
};

// ─── Registration ──────────────────────────────────────────────────────────────

export function registerProcessors(queues: QueuesMap): void {

  // ── offlinePayment ──────────────────────────────────────────────────────────
  queues.offlinePayment.process(CONCURRENCY, async (job) => {
    const { orgId } = job.data;
    const results = await processOfflineQueue(orgId);

    const processed    = results.filter((r) => r.status === 'processed').length;
    const failed       = results.filter((r) => r.status === 'failed').length;
    const deadLettered = results.filter((r) => r.status === 'dead_lettered').length;

    job.log(`Processed ${processed}, failed ${failed}, dead-lettered ${deadLettered}`);

    return { orgId, processed, failed, deadLettered };
  });

  // ── receipt ─────────────────────────────────────────────────────────────────
  queues.receipt.process(CONCURRENCY, async (job) => {
    const { orderId, email } = job.data;

    if (email) {
      // sendReceiptEmail internally calls buildReceipt — pass a placeholder orgId
      // looked up from the order inside the function
      const { rows: [order] } = await query<{ organization_id: string }>(
        `SELECT organization_id FROM orders WHERE id = $1`,
        [orderId],
      );
      if (order) {
        await sendReceiptEmail(order.organization_id, orderId, email);
      }
    }

    job.log(`Receipt sent to ${email} for order ${orderId}`);
    return { orderId, email };
  });

  // ── lowStockAlert ────────────────────────────────────────────────────────────
  queues.lowStockAlert.process(CONCURRENCY, async (job) => {
    const { orgId, locationId, productId, variantId, currentQty, reorderAt } = job.data;

    // Fetch product name and org manager emails
    const { rows: [product] } = await query<{ name: string }>(
      `SELECT name FROM products WHERE id = $1`,
      [productId],
    );

    const { rows: managers } = await query<{ email: string; name: string }>(
      `SELECT e.email, e.first_name || ' ' || e.last_name AS name
       FROM employees e
       WHERE e.organization_id = $1
         AND e.role IN ('owner', 'manager')
         AND e.deleted_at IS NULL`,
      [orgId],
    );

    if (managers.length === 0) {
      job.log(`No managers found for org ${orgId} — skipping low-stock alert`);
      return { skipped: true };
    }

    const productName  = product?.name ?? productId;
    const variantLabel = variantId ? ` (variant ${variantId})` : '';

    // Queue individual email jobs for each manager
    const emailQueue = (job.queue as any)._queueRef as Bull.Queue<EmailJobData>;
    for (const mgr of managers) {
      await emailQueue.add({
        to:      mgr.email,
        subject: `[Taproot] Low stock alert: ${productName}`,
        html: `
          <p>Hi ${mgr.name},</p>
          <p>
            <strong>${productName}${variantLabel}</strong> at location ${locationId}
            has dropped to <strong>${currentQty}</strong> units
            (reorder point: ${reorderAt}).
          </p>
          <p>Please review your inventory and place a purchase order if needed.</p>
        `,
        text: `Low stock: ${productName}${variantLabel} at location ${locationId} — qty ${currentQty} (reorder at ${reorderAt}).`,
      });
    }

    job.log(`Low-stock alert queued for ${managers.length} manager(s)`);
    return { productId, currentQty, managersNotified: managers.length };
  });

  // ── email — general purpose ─────────────────────────────────────────────────
  queues.email.process(CONCURRENCY, async (job) => {
    const { to, subject, html, text } = job.data;
    // Dynamic import to avoid loading the email module on startup
    const { sendEmail } = await import('../email');
    await sendEmail({ to, subject, html, text: text ?? '' });
    job.log(`Email sent to ${to}: ${subject}`);
    return { to, subject };
  });

  // ── aiAnalysis — document imports + AI-driven reports ───────────────────────
  queues.aiAnalysis.process(CONCURRENCY, async (job) => {
    const { orgId, reportType, params } = job.data;
    return handleAiAnalysisJob(reportType, params, orgId, (msg) => job.log(msg));
  });

  // ── Global error logging ────────────────────────────────────────────────────
  for (const [name, queue] of Object.entries(queues)) {
    (queue as Bull.Queue).on('failed', (job, err) => {
      console.error(`[queue:${name}] Job ${job.id} failed (attempt ${job.attemptsMade}):`, err.message);
    });
    (queue as Bull.Queue).on('stalled', (job) => {
      console.warn(`[queue:${name}] Job ${job.id} stalled — will be retried`);
    });
  }
}
