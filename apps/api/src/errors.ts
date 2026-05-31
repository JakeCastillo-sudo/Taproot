// ─── Base ─────────────────────────────────────────────────────────────────────

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): Record<string, unknown> {
    return { code: this.code, message: this.message };
  }

  toGraphQLExtensions(): Record<string, unknown> {
    return { code: this.code, statusCode: this.statusCode };
  }
}

// ─── Auth errors ──────────────────────────────────────────────────────────────

export class AuthError extends AppError {
  constructor(code: string, message: string, statusCode = 401) {
    super(code, message, statusCode);
  }
}

export class TokenExpiredError extends AuthError {
  constructor() { super('TOKEN_EXPIRED', 'Token has expired', 401); }
}

export class TokenInvalidError extends AuthError {
  constructor(detail?: string) { super('TOKEN_INVALID', detail ?? 'Invalid token', 401); }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Insufficient permissions') { super('FORBIDDEN', message, 403); }
}

// ─── Generic domain errors ────────────────────────────────────────────────────

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') { super('NOT_FOUND', `${resource} not found`, 404); }
}

export class ConflictError extends AppError {
  constructor(message: string) { super('CONFLICT', message, 409); }
}

export class ValidationError extends AppError {
  constructor(message: string, public readonly details?: unknown) {
    super('VALIDATION_ERROR', message, 422);
  }
}

// ─── Product / Variant ────────────────────────────────────────────────────────

export class ProductNotFoundError extends AppError {
  constructor(productId?: string) {
    super('PRODUCT_NOT_FOUND', productId ? `Product ${productId} not found` : 'Product not found', 404);
  }
}

export class VariantNotFoundError extends AppError {
  constructor(variantId?: string) {
    super('VARIANT_NOT_FOUND', variantId ? `Variant ${variantId} not found` : 'Variant not found', 404);
  }
}

// ─── Recipe ───────────────────────────────────────────────────────────────────

export class RecipeNotFoundError extends AppError {
  constructor(productId?: string) {
    super('RECIPE_NOT_FOUND', productId ? `No active recipe for product ${productId}` : 'Recipe not found', 404);
  }
}

export class RecipeValidationError extends AppError {
  constructor(
    message: string,
    public readonly lineNumber?: number,
    public readonly field?: string,
    public readonly reason?: string,
  ) {
    super('RECIPE_VALIDATION_ERROR', message, 400);
  }

  override toJSON(): Record<string, unknown> {
    return { code: this.code, message: this.message, lineNumber: this.lineNumber, field: this.field, reason: this.reason };
  }
}

export class CircularRecipeError extends AppError {
  constructor(
    public readonly chain: string[],
  ) {
    super('CIRCULAR_RECIPE', `Circular recipe reference detected: ${chain.join(' → ')}`, 400);
  }

  override toJSON(): Record<string, unknown> {
    return { code: this.code, message: this.message, chain: this.chain };
  }
}

// ─── Inventory ────────────────────────────────────────────────────────────────

export class InsufficientStockError extends AppError {
  constructor(
    public readonly productName: string,
    public readonly availableQty: number,
    public readonly requestedQty: number,
  ) {
    super('INSUFFICIENT_STOCK', `Insufficient stock for "${productName}": ${availableQty} available, ${requestedQty} requested`, 409);
  }

  override toJSON(): Record<string, unknown> {
    return { code: this.code, message: this.message, productName: this.productName, availableQty: this.availableQty, requestedQty: this.requestedQty };
  }
}

export class InventoryLevelError extends AppError {
  constructor(message: string) { super('INVENTORY_LEVEL_ERROR', message, 409); }
}

// ─── Pricing ──────────────────────────────────────────────────────────────────

export class PricingError extends AppError {
  constructor(variantId: string, locationId?: string) {
    super('NO_ACTIVE_PRICE', `No active price found for variant ${variantId}${locationId ? ` at location ${locationId}` : ''}`, 422);
  }
}

// ─── Purchase Orders ──────────────────────────────────────────────────────────

export class PurchaseOrderError extends AppError {
  constructor(message: string, statusCode: 400 | 409 = 400) {
    super('PURCHASE_ORDER_ERROR', message, statusCode);
  }
}
