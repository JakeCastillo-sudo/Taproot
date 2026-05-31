import { jest } from '@jest/globals';

// ─── Mock DB client ───────────────────────────────────────────────────────────

const mockQuery = jest.fn<() => Promise<any>>();
const mockWithTransaction = jest.fn<() => Promise<any>>();

jest.mock('../../db/client', () => ({
  query: mockQuery,
  withTransaction: mockWithTransaction,
}));

jest.mock('../../auth/audit', () => ({
  createAuditLog: jest.fn(),
}));

import {
  unitsAreCompatible,
  validateRecipeUnits,
  calculateDepletionForSale,
} from '../../services/recipe.service';
import { RecipeValidationError } from '../../errors';

// ─── unitsAreCompatible ───────────────────────────────────────────────────────

describe('unitsAreCompatible', () => {
  it('returns true for same family', () => {
    expect(unitsAreCompatible('ml', 'l')).toBe(true);
    expect(unitsAreCompatible('g', 'kg')).toBe(true);
    expect(unitsAreCompatible('oz', 'lb')).toBe(true);
    expect(unitsAreCompatible('m', 'ft')).toBe(true);
    expect(unitsAreCompatible('each', 'each')).toBe(true);
  });

  it('returns false for different families', () => {
    expect(unitsAreCompatible('ml', 'g')).toBe(false);
    expect(unitsAreCompatible('each', 'ml')).toBe(false);
    expect(unitsAreCompatible('oz', 'ml')).toBe(false);
    expect(unitsAreCompatible('m', 'kg')).toBe(false);
  });

  it('returns false for unknown units', () => {
    expect(unitsAreCompatible('cups', 'ml')).toBe(false);
    expect(unitsAreCompatible('ml', 'tbsp')).toBe(false);
    expect(unitsAreCompatible('unknown', 'unknown')).toBe(false);
  });

  it('returns false when either unit is empty string', () => {
    expect(unitsAreCompatible('', 'ml')).toBe(false);
    expect(unitsAreCompatible('ml', '')).toBe(false);
  });
});

// ─── validateRecipeUnits ──────────────────────────────────────────────────────

describe('validateRecipeUnits', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes when units are compatible', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ unit_of_measure: 'ml', name: 'Syrup' }],
    });

    await expect(
      validateRecipeUnits([{
        ingredientProductId: 'prod-1',
        quantity: 30,
        unit: 'l',
        wasteFactor: 0.05,
      }]),
    ).resolves.toBeUndefined();
  });

  it('throws when ingredient product not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(
      validateRecipeUnits([{
        ingredientProductId: 'missing',
        quantity: 1,
        unit: 'each',
        wasteFactor: 0,
      }]),
    ).rejects.toBeInstanceOf(RecipeValidationError);
  });

  it('throws when units are incompatible', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ unit_of_measure: 'g', name: 'Flour' }],
    });

    await expect(
      validateRecipeUnits([{
        ingredientProductId: 'prod-flour',
        quantity: 100,
        unit: 'ml',          // ml vs g — incompatible
        wasteFactor: 0,
      }]),
    ).rejects.toBeInstanceOf(RecipeValidationError);
  });

  it('throws when quantity is zero', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ unit_of_measure: 'ml', name: 'Syrup' }],
    });

    await expect(
      validateRecipeUnits([{
        ingredientProductId: 'prod-1',
        quantity: 0,
        unit: 'ml',
        wasteFactor: 0,
      }]),
    ).rejects.toBeInstanceOf(RecipeValidationError);
  });

  it('throws when quantity is negative', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ unit_of_measure: 'ml', name: 'Syrup' }],
    });

    await expect(
      validateRecipeUnits([{
        ingredientProductId: 'prod-1',
        quantity: -5,
        unit: 'ml',
        wasteFactor: 0,
      }]),
    ).rejects.toBeInstanceOf(RecipeValidationError);
  });

  it('throws when wasteFactor is out of range', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ unit_of_measure: 'ml', name: 'Syrup' }],
    });

    await expect(
      validateRecipeUnits([{
        ingredientProductId: 'prod-1',
        quantity: 10,
        unit: 'ml',
        wasteFactor: 1.0,     // must be < 1
      }]),
    ).rejects.toBeInstanceOf(RecipeValidationError);
  });

  it('throws when wasteFactor is negative', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ unit_of_measure: 'ml', name: 'Syrup' }],
    });

    await expect(
      validateRecipeUnits([{
        ingredientProductId: 'prod-1',
        quantity: 10,
        unit: 'ml',
        wasteFactor: -0.1,
      }]),
    ).rejects.toBeInstanceOf(RecipeValidationError);
  });
});

// ─── calculateDepletionForSale ────────────────────────────────────────────────

describe('calculateDepletionForSale', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns empty array when quantity is 0', async () => {
    const result = await calculateDepletionForSale('prod-1', null, 0, []);
    expect(result).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns empty array when no recipe lines exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await calculateDepletionForSale('prod-1', null, 2, []);
    expect(result).toEqual([]);
  });

  it('applies core depletion formula correctly', async () => {
    // Recipe: yieldFactor=0.8, ingredient: qty=100ml, wasteFactor=0.1
    // depletionQty = (100 × 1.1) / 0.8 × 1 = 137.5
    mockQuery.mockResolvedValueOnce({
      rows: [{
        yield_factor: '0.8',
        ingredient_product_id: 'ing-1',
        ingredient_variant_id: null,
        line_qty: '100',
        unit: 'ml',
        waste_factor: '0.1',
      }],
    });

    const result = await calculateDepletionForSale('prod-1', null, 1, []);
    expect(result).toHaveLength(1);
    expect(result[0].depletionQty).toBeCloseTo(137.5);
    expect(result[0].unit).toBe('ml');
    expect(result[0].ingredientProductId).toBe('ing-1');
  });

  it('scales depletion by quantity sold', async () => {
    // Selling 3 units: depletion should triple
    mockQuery.mockResolvedValueOnce({
      rows: [{
        yield_factor: '1.0',
        ingredient_product_id: 'ing-1',
        ingredient_variant_id: null,
        line_qty: '50',
        unit: 'g',
        waste_factor: '0.0',
      }],
    });

    const result = await calculateDepletionForSale('prod-1', null, 3, []);
    expect(result[0].depletionQty).toBeCloseTo(150); // 50 × 1.0 / 1.0 × 3
  });

  it('applies modifier ingredient overrides', async () => {
    // Base qty 100ml, modifier adds +20ml
    mockQuery.mockResolvedValueOnce({
      rows: [{
        yield_factor: '1.0',
        ingredient_product_id: 'ing-1',
        ingredient_variant_id: null,
        line_qty: '100',
        unit: 'ml',
        waste_factor: '0.0',
      }],
    });

    const modifiers = [{
      modifierId: 'mod-1',
      name: 'Extra syrup',
      priceDelta: 0.5,
      ingredientOverrides: [{
        ingredientProductId: 'ing-1',
        quantityDelta: 20,
      }],
    }];

    const result = await calculateDepletionForSale('prod-1', null, 1, modifiers);
    // lineQty becomes 120, wasteFactor=0, yieldFactor=1 → 120 × 1 / 1 × 1 = 120
    expect(result[0].depletionQty).toBeCloseTo(120);
  });

  it('handles multiple recipe lines', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { yield_factor: '1.0', ingredient_product_id: 'ing-1', ingredient_variant_id: null, line_qty: '200', unit: 'ml', waste_factor: '0.0' },
        { yield_factor: '1.0', ingredient_product_id: 'ing-2', ingredient_variant_id: null, line_qty: '50', unit: 'g', waste_factor: '0.05' },
      ],
    });

    const result = await calculateDepletionForSale('prod-1', null, 2, []);
    expect(result).toHaveLength(2);
    expect(result[0].depletionQty).toBeCloseTo(400);   // 200 × 1.0 / 1.0 × 2
    expect(result[1].depletionQty).toBeCloseTo(105);   // 50 × 1.05 / 1.0 × 2
  });

  it('waste factor increases depletion', async () => {
    // wasteFactor = 0.25: deplete 25% extra
    mockQuery.mockResolvedValueOnce({
      rows: [{
        yield_factor: '1.0',
        ingredient_product_id: 'ing-1',
        ingredient_variant_id: null,
        line_qty: '80',
        unit: 'g',
        waste_factor: '0.25',
      }],
    });

    const result = await calculateDepletionForSale('prod-1', null, 1, []);
    expect(result[0].depletionQty).toBeCloseTo(100); // 80 × 1.25 / 1.0 × 1
  });

  it('yield factor below 1 increases depletion proportionally', async () => {
    // yieldFactor = 0.5 means you need twice as much raw material
    mockQuery.mockResolvedValueOnce({
      rows: [{
        yield_factor: '0.5',
        ingredient_product_id: 'ing-1',
        ingredient_variant_id: null,
        line_qty: '100',
        unit: 'g',
        waste_factor: '0.0',
      }],
    });

    const result = await calculateDepletionForSale('prod-1', null, 1, []);
    expect(result[0].depletionQty).toBeCloseTo(200); // 100 / 0.5
  });
});
