/**
 * Onboarding email sequence job — new-customer drip (Day 1/3/7/12).
 *
 * Each org's owner gets, at most once each (deduped via email_logs.template_name):
 *   Day 1  → onboarding_day1      (only if no products imported yet)
 *   Day 3  → onboarding_day3      (only if no orders taken yet)
 *   Day 7  → onboarding_day7      (always — progress checklist)
 *   Day 12 → trial_ending_soon    (only if still on trial)
 *
 * Resilient: no-ops if migration 024 (email_logs) hasn't been applied. Gated by
 * the scheduler in index.ts behind ONBOARDING_EMAILS_ENABLED so no real customer
 * email goes out until you opt in (dev transport logs only regardless).
 */
import { query } from '../db/client';
import { logger } from '../lib/logger';
import { sendOnboardingSequenceEmail } from '../services/email.service';

interface SequenceStep {
  dayOffset: number;
  template: 'onboarding_day1' | 'onboarding_day3' | 'onboarding_day7' | 'trial_ending_soon';
  condition?: 'no_products_imported' | 'no_orders_taken' | 'still_on_trial';
}

const ONBOARDING_SEQUENCE: SequenceStep[] = [
  { dayOffset: 1, template: 'onboarding_day1', condition: 'no_products_imported' },
  { dayOffset: 3, template: 'onboarding_day3', condition: 'no_orders_taken' },
  { dayOffset: 7, template: 'onboarding_day7' },
  { dayOffset: 12, template: 'trial_ending_soon', condition: 'still_on_trial' },
];

async function tableExists(name: string): Promise<boolean> {
  const { rows: [r] } = await query<{ exists: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [`public.${name}`],
  );
  return Boolean(r?.exists);
}

interface OrgRow {
  id: string;
  name: string;
  created_at: string;
  subscription_status: string | null;
  trial_ends_at: string | null;
  email: string;
  first_name: string;
  product_count: string;
  order_count: string;
  employee_count: string;
  sent_templates: string[] | string | null;
}

export async function runEmailSequenceJob(now: Date = new Date()): Promise<void> {
  if (!(await tableExists('email_logs'))) {
    logger.warn('[EmailSequence] email_logs table missing — run migration 024, then it will send on the next tick');
    return;
  }

  const { rows: orgs } = await query<OrgRow>(
    `SELECT o.id, o.name, o.created_at, o.subscription_status, o.trial_ends_at,
       e.email, e.first_name,
       (SELECT COUNT(*) FROM products p
          WHERE p.organization_id = o.id AND p.deleted_at IS NULL) AS product_count,
       (SELECT COUNT(*) FROM orders ord
          WHERE ord.organization_id = o.id) AS order_count,
       (SELECT COUNT(*) FROM employees emp
          WHERE emp.organization_id = o.id AND emp.deleted_at IS NULL
            AND emp.account_setup_required = false) AS employee_count,
       (SELECT COALESCE(json_agg(DISTINCT el.template_name), '[]'::json)
          FROM email_logs el
         WHERE el.organization_id = o.id
           AND el.template_name IN
             ('onboarding_day1','onboarding_day3','onboarding_day7','trial_ending_soon')
       ) AS sent_templates
     FROM organizations o
     JOIN employees e ON e.organization_id = o.id AND e.role = 'owner' AND e.deleted_at IS NULL
    WHERE o.deleted_at IS NULL
      AND o.created_at > NOW() - INTERVAL '30 days'
      AND e.email IS NOT NULL
    ORDER BY o.created_at ASC`,
  );

  let sent = 0;
  let failed = 0;

  for (const org of orgs) {
    const daysSince = Math.floor((now.getTime() - new Date(org.created_at).getTime()) / 86_400_000);
    const sentTemplates: string[] = Array.isArray(org.sent_templates)
      ? org.sent_templates
      : typeof org.sent_templates === 'string'
        ? JSON.parse(org.sent_templates)
        : [];
    const productCount = parseInt(org.product_count, 10) || 0;
    const orderCount = parseInt(org.order_count, 10) || 0;
    const employeeCount = parseInt(org.employee_count, 10) || 0;

    for (const step of ONBOARDING_SEQUENCE) {
      if (sentTemplates.includes(step.template)) continue;
      if (daysSince < step.dayOffset) continue;
      if (step.condition === 'no_products_imported' && productCount > 0) continue;
      if (step.condition === 'no_orders_taken' && orderCount > 0) continue;
      if (step.condition === 'still_on_trial' && org.subscription_status !== 'trialing') continue;

      try {
        await sendOnboardingSequenceEmail({
          to: org.email,
          template: step.template,
          ownerName: org.first_name,
          restaurantName: org.name,
          orgId: org.id,
          trialEndsAt: org.trial_ends_at,
          hasProducts: productCount > 0,
          hasOrders: orderCount > 0,
          hasEmployees: employeeCount > 1, // >1 = at least one teammate beyond the owner
        });
        sent++;
        await new Promise((r) => setTimeout(r, 500)); // gentle throttle
      } catch (err) {
        failed++;
        logger.error('[EmailSequence] send failed', {
          org: org.id, template: step.template,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  logger.info('[EmailSequence] done', { orgs: orgs.length, sent, failed });
}
