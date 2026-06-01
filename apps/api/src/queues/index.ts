/**
 * Bull queue infrastructure — background job processing for Taproot.
 *
 * Queues
 * ──────
 *   offlinePayment  — drain the Redis offline payment queue
 *   receipt         — send email/SMS receipts
 *   lowStockAlert   — notify managers when stock falls below reorder point
 *   email           — general-purpose transactional email
 *   aiAnalysis      — async AI-driven reporting (future use)
 *
 * Configuration
 * ─────────────
 * - Backed by ioredis (same REDIS_URL as pub/sub)
 * - 5 concurrent workers per queue
 * - Exponential back-off: first retry after 5 s, max 3 attempts
 * - Failed jobs retained for 100 entries; completed for 50
 * - Graceful shutdown: drain + close all queues
 *
 * Usage
 * ─────
 *   import { queues } from './queues';
 *   await queues.receipt.add({ orderId, email }, { jobId: orderId });
 */

import Bull from 'bull';
import { config } from '../config';

// ─── Queue options ─────────────────────────────────────────────────────────────

const defaultJobOptions: Bull.JobOptions = {
  attempts:    3,
  backoff:     { type: 'exponential', delay: 5_000 },
  removeOnComplete: 50,
  removeOnFail:     100,
};

const queueOptions: Bull.QueueOptions = {
  redis: config.REDIS_URL,
  defaultJobOptions,
};

// ─── Queue instances ───────────────────────────────────────────────────────────

// Typed job data interfaces
export interface OfflinePaymentJobData {
  orgId: string;
}

export interface ReceiptJobData {
  orderId: string;
  email:   string;
  channel: 'email' | 'sms';
}

export interface LowStockAlertJobData {
  orgId:      string;
  locationId: string;
  productId:  string;
  variantId:  string | null;
  currentQty: number;
  reorderAt:  number;
}

export interface EmailJobData {
  to:      string;
  subject: string;
  html:    string;
  text?:   string;
}

export interface AiAnalysisJobData {
  orgId:      string;
  reportType: 'sales_forecast' | 'inventory_optimisation' | 'customer_churn' | 'import_document';
  params:     Record<string, unknown>;
}

export interface ImportJobQueueData {
  jobId: string;
  orgId: string;
}

// Queue registry with typed generics
export const queues = {
  offlinePayment: new Bull<OfflinePaymentJobData>('offlinePayment', queueOptions),
  receipt:        new Bull<ReceiptJobData>('receipt',        queueOptions),
  lowStockAlert:  new Bull<LowStockAlertJobData>('lowStockAlert',  queueOptions),
  email:          new Bull<EmailJobData>('email',          queueOptions),
  aiAnalysis:     new Bull<AiAnalysisJobData>('aiAnalysis',     queueOptions),
} as const;

// ─── Register processors ────────────────────────────────────────────────────────

// Import processors lazily to avoid circular dependencies
import { registerProcessors } from './processors';
registerProcessors(queues);

// ─── Graceful shutdown ─────────────────────────────────────────────────────────

export async function closeQueues(): Promise<void> {
  await Promise.all(Object.values(queues).map((q) => q.close()));
}

// ─── Health check ──────────────────────────────────────────────────────────────

export async function getQueueHealth(): Promise<Record<string, {
  waiting:   number;
  active:    number;
  completed: number;
  failed:    number;
  delayed:   number;
}>> {
  const health: Record<string, {
    waiting: number; active: number; completed: number; failed: number; delayed: number;
  }> = {};

  for (const [name, queue] of Object.entries(queues)) {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);
    health[name] = { waiting, active, completed, failed, delayed };
  }

  return health;
}
