/**
 * Gift card management service.
 *
 * Handles issuance, reloading, balance lookup, and deactivation.
 * Redemption is handled inside payment.service (processPayment with
 * payment_method='gift_card') — this service only manages the card lifecycle.
 *
 * Every balance change is written to gift_card_transactions (immutable ledger).
 */

import crypto from 'crypto';
import { query, withTransaction } from '../db/client';
import { ValidationError, NotFoundError } from '../errors';
import { createAuditLog } from '../auth/audit';
import type { GiftCard, GiftCardTransaction } from '@taproot/shared';

// ─── Input types ──────────────────────────────────────────────────────────────

export interface IssueGiftCardInput {
  initialBalance:    number;  // in smallest currency unit (cents)
  currency?:         string;  // default 'USD'
  issuedToCustomerId?: string;
  expiresAt?:        string;  // ISO-8601
  notes?:            string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Generate a random gift card code: XXXX-XXXX-XXXX-XXXX (16 uppercase hex). */
function generateGiftCardCode(): string {
  const bytes = crypto.randomBytes(8).toString('hex').toUpperCase();
  return [
    bytes.slice(0,  4),
    bytes.slice(4,  8),
    bytes.slice(8, 12),
    bytes.slice(12, 16),
  ].join('-');
}

async function requireGiftCard(orgId: string, cardId: string): Promise<GiftCard> {
  const { rows: [card] } = await query<GiftCard>(
    `SELECT * FROM gift_cards WHERE id = $1 AND organization_id = $2`,
    [cardId, orgId],
  );
  if (!card) throw new NotFoundError('Gift card');
  return card;
}

// ─── issueGiftCard ────────────────────────────────────────────────────────────

export async function issueGiftCard(
  orgId:      string,
  employeeId: string,
  input:      IssueGiftCardInput,
): Promise<GiftCard> {
  if (input.initialBalance <= 0) {
    throw new ValidationError('Initial balance must be greater than 0');
  }

  // Validate customer if provided
  if (input.issuedToCustomerId) {
    const { rows: [customer] } = await query(
      `SELECT id FROM customers WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [input.issuedToCustomerId, orgId],
    );
    if (!customer) throw new NotFoundError('Customer');
  }

  // Generate a unique code (retry on collision)
  let code: string;
  let attempts = 0;
  do {
    code = generateGiftCardCode();
    const { rows: [exists] } = await query(
      `SELECT id FROM gift_cards WHERE code = $1`,
      [code],
    );
    if (!exists) break;
    attempts++;
    if (attempts >= 5) throw new ValidationError('Unable to generate a unique gift card code — try again');
  } while (true);

  const card = await withTransaction(async (client) => {
    const { rows: [newCard] } = await client.query<GiftCard>(
      `INSERT INTO gift_cards
         (organization_id, code, initial_balance, current_balance, currency,
          issued_to_customer_id, issued_by_employee_id, expires_at)
       VALUES ($1,$2,$3,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        orgId,
        code,
        input.initialBalance,
        input.currency ?? 'USD',
        input.issuedToCustomerId ?? null,
        employeeId,
        input.expiresAt ?? null,
      ],
    );

    // Ledger entry
    await client.query(
      `INSERT INTO gift_card_transactions
         (gift_card_id, transaction_type, amount, balance_before, balance_after,
          employee_id, notes)
       VALUES ($1,'issue',$2,0,$2,$3,$4)`,
      [newCard.id, input.initialBalance, employeeId, input.notes ?? null],
    );

    return newCard;
  });

  void createAuditLog({
    organizationId: orgId,
    actorId:        employeeId,
    action:         'gift_card.issued',
    resourceType:   'gift_card',
    resourceId:     card.id,
    afterState:     { code: card.code, initialBalance: input.initialBalance },
  });

  return card;
}

// ─── getGiftCard ──────────────────────────────────────────────────────────────

/** Look up a gift card by code (used at POS checkout). */
export async function getGiftCard(
  orgId:  string,
  code:   string,
): Promise<GiftCard> {
  const { rows: [card] } = await query<GiftCard>(
    `SELECT * FROM gift_cards WHERE code = $1 AND organization_id = $2`,
    [code.toUpperCase().replace(/\s+/g, ''), orgId],
  );
  if (!card) throw new NotFoundError('Gift card');
  return card;
}

/** Look up a gift card by ID. */
export async function getGiftCardById(orgId: string, cardId: string): Promise<GiftCard> {
  return requireGiftCard(orgId, cardId);
}

// ─── reloadGiftCard ───────────────────────────────────────────────────────────

export async function reloadGiftCard(
  orgId:      string,
  employeeId: string,
  cardId:     string,
  amount:     number,
  orderId?:   string,
  notes?:     string,
): Promise<GiftCard> {
  if (amount <= 0) throw new ValidationError('Reload amount must be greater than 0');

  const card = await requireGiftCard(orgId, cardId);
  if (!card.is_active) throw new ValidationError('Cannot reload an inactive gift card');

  const balanceBefore = card.current_balance;
  const balanceAfter  = balanceBefore + amount;

  const updated = await withTransaction(async (client) => {
    const { rows: [updated] } = await client.query<GiftCard>(
      `UPDATE gift_cards
       SET current_balance = current_balance + $1, updated_at = now()
       WHERE id = $2 AND organization_id = $3
       RETURNING *`,
      [amount, cardId, orgId],
    );

    await client.query(
      `INSERT INTO gift_card_transactions
         (gift_card_id, order_id, transaction_type, amount,
          balance_before, balance_after, employee_id, notes)
       VALUES ($1,$2,'reload',$3,$4,$5,$6,$7)`,
      [cardId, orderId ?? null, amount, balanceBefore, balanceAfter, employeeId, notes ?? null],
    );

    return updated;
  });

  return updated;
}

// ─── deactivateGiftCard ───────────────────────────────────────────────────────

export async function deactivateGiftCard(
  orgId:      string,
  cardId:     string,
  employeeId: string,
  reason?:    string,
): Promise<void> {
  const card = await requireGiftCard(orgId, cardId);
  if (!card.is_active) throw new ValidationError('Gift card is already inactive');

  await query(
    `UPDATE gift_cards SET is_active = false, updated_at = now() WHERE id = $1`,
    [cardId],
  );

  void createAuditLog({
    organizationId: orgId,
    actorId:        employeeId,
    action:         'gift_card.deactivated',
    resourceType:   'gift_card',
    resourceId:     cardId,
    afterState:     { reason: reason ?? null, balance_at_deactivation: card.current_balance },
  });
}

// ─── getGiftCardTransactions ──────────────────────────────────────────────────

export async function getGiftCardTransactions(
  orgId:  string,
  cardId: string,
): Promise<GiftCardTransaction[]> {
  await requireGiftCard(orgId, cardId);

  const { rows } = await query<GiftCardTransaction>(
    `SELECT t.*
     FROM gift_card_transactions t
     JOIN gift_cards g ON g.id = t.gift_card_id
     WHERE t.gift_card_id = $1 AND g.organization_id = $2
     ORDER BY t.created_at DESC`,
    [cardId, orgId],
  );
  return rows;
}

// ─── listGiftCards ────────────────────────────────────────────────────────────

export async function listGiftCards(
  orgId:    string,
  params: {
    customerId?: string;
    isActive?:   boolean;
    page?:       number;
    perPage?:    number;
  } = {},
): Promise<{ cards: GiftCard[]; total: number }> {
  const page    = Math.max(1, params.page    ?? 1);
  const perPage = Math.min(100, params.perPage ?? 25);
  const offset  = (page - 1) * perPage;

  const conditions: string[] = ['organization_id = $1'];
  const bindings: unknown[]  = [orgId];

  if (params.customerId) {
    bindings.push(params.customerId);
    conditions.push(`issued_to_customer_id = $${bindings.length}`);
  }
  if (params.isActive !== undefined) {
    bindings.push(params.isActive);
    conditions.push(`is_active = $${bindings.length}`);
  }

  const where = conditions.join(' AND ');

  const { rows: countRows } = await query<{ total: string }>(
    `SELECT COUNT(*) AS total FROM gift_cards WHERE ${where}`,
    bindings,
  );
  const total = parseInt(countRows[0]?.total ?? '0', 10);

  bindings.push(perPage, offset);
  const { rows: cards } = await query<GiftCard>(
    `SELECT * FROM gift_cards WHERE ${where}
     ORDER BY created_at DESC
     LIMIT $${bindings.length - 1} OFFSET $${bindings.length}`,
    bindings,
  );

  return { cards, total };
}
