/**
 * Document Parser Service — AI-powered document intelligence.
 *
 * Uses Claude (model controlled by config.CLAUDE_MODEL, default claude-sonnet-4-6)
 * to classify and extract structured data from menu PDFs, supplier invoices,
 * goods receipts, inventory lists, and recipe sheets.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';

// ─── Anthropic client (lazy singleton) ────────────────────────────────────────

let _anthropic: Anthropic | null = null;

function getAnthropic(): Anthropic {
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}

const MODEL = config.CLAUDE_MODEL;

// ─── Shared helpers ────────────────────────────────────────────────────────────

async function callClaude(
  system: string,
  userContent: string | Anthropic.MessageParam['content'],
  maxTokens = 4096,
): Promise<string> {
  const client = getAnthropic();
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{
      role: 'user',
      content: typeof userContent === 'string' ? userContent : userContent,
    }],
  });

  const block = msg.content[0];
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude');
  return block.text;
}

function parseJson<T>(raw: string): T {
  // Strip markdown code fences if Claude wrapped the JSON
  const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
  return JSON.parse(cleaned) as T;
}

// ─── Document types ────────────────────────────────────────────────────────────

export type DocumentType =
  | 'menu'
  | 'invoice'
  | 'goods_receipt'
  | 'inventory_list'
  | 'recipe_sheet'
  | 'unknown';

export interface ClassifyResult {
  type:       DocumentType;
  confidence: number;
  reasoning:  string;
}

// ─── 1. Document classification ───────────────────────────────────────────────

export async function classifyDocument(
  content: string,
  filename: string,
): Promise<ClassifyResult> {
  const system = `You are a document classifier for a restaurant/retail POS system.
Classify the document type based on its content and filename.
Respond with JSON only: { "type": string, "confidence": number, "reasoning": string }
Valid types: "menu", "invoice", "goods_receipt", "inventory_list", "recipe_sheet", "unknown"
confidence must be 0-1.`;

  const user = `Filename: ${filename}\n\nFirst 2000 characters:\n${content.slice(0, 2000)}`;

  const raw = await callClaude(system, user, 512);
  const result = parseJson<{ type: string; confidence: number; reasoning: string }>(raw);

  const validTypes = new Set<DocumentType>([
    'menu', 'invoice', 'goods_receipt', 'inventory_list', 'recipe_sheet', 'unknown',
  ]);
  const type = validTypes.has(result.type as DocumentType)
    ? (result.type as DocumentType)
    : 'unknown';
  const confidence = typeof result.confidence === 'number'
    ? Math.min(1, Math.max(0, result.confidence))
    : 0;

  return {
    type: confidence < 0.7 ? 'unknown' : type,
    confidence,
    reasoning: result.reasoning ?? '',
  };
}

// ─── 2. Parsed types ──────────────────────────────────────────────────────────

export interface ParsedMenuModifierOption {
  name:       string;
  priceDelta: number;
}

export interface ParsedMenuModifierGroup {
  groupName: string;
  options:   ParsedMenuModifierOption[];
}

export interface ParsedMenuItem {
  name:        string;
  description?: string;
  price:       number;   // cents
  category?:   string;
  modifiers?:  ParsedMenuModifierGroup[];
}

export interface ParsedMenu {
  items:       ParsedMenuItem[];
  categories:  string[];
  confidence:  number;
  rawText:     string;
}

export interface ParsedInvoiceLineItem {
  description: string;
  sku?:        string;
  quantity:    number;
  unit?:       string;
  unitCost:    number;   // cents
  totalCost:   number;   // cents
}

export interface ParsedInvoice {
  supplierName?:  string;
  invoiceNumber?: string;
  invoiceDate?:   string;
  dueDate?:       string;
  lineItems:      ParsedInvoiceLineItem[];
  subtotal:       number;
  taxAmount:      number;
  total:          number;
  confidence:     number;
}

export interface ParsedGoodsReceiptItem {
  description:       string;
  sku?:              string;
  quantityDelivered: number;
  unit?:             string;
  unitCost?:         number;
}

export interface ParsedGoodsReceipt {
  supplierName?: string;
  deliveryDate?: string;
  poNumber?:     string;
  items:         ParsedGoodsReceiptItem[];
  confidence:    number;
}

export interface ParsedInventoryItem {
  name:      string;
  sku?:      string;
  quantity:  number;
  unit?:     string;
  location?: string;
}

export interface ParsedInventoryList {
  items:      ParsedInventoryItem[];
  confidence: number;
}

export interface ParsedRecipeIngredient {
  name:         string;
  quantity:     number;
  unit:         string;
  wasteFactor?: number;
}

export interface ParsedRecipe {
  productName:  string;
  yieldFactor?: number;
  ingredients:  ParsedRecipeIngredient[];
  notes?:       string;
}

export interface ParsedRecipeSheet {
  recipes:    ParsedRecipe[];
  confidence: number;
}

export interface ColumnMappingEntry {
  sourceColumn: string;
  targetField:  string;
  confidence:   number;
  transform?:   string;
}

export interface ColumnMapping {
  mappings:         ColumnMappingEntry[];
  unmappedColumns:  string[];
  confidence:       number;
}

// ─── 3. Menu parser ───────────────────────────────────────────────────────────

export async function parseMenu(content: string): Promise<ParsedMenu> {
  const system = `You are a menu parser for a POS system. Extract all menu items
with their prices, categories, and modifiers from the provided menu text.
Convert all prices to cents (integer). All price fields must be integers (no decimals).
Respond with JSON only matching this schema:
{
  "items": [{ "name": string, "description"?: string, "price": integer,
    "category"?: string, "modifiers"?: [{ "groupName": string,
    "options": [{ "name": string, "priceDelta": integer }] }] }],
  "categories": [string],
  "confidence": number
}`;

  const raw = await callClaude(system, content, 8192);
  const parsed = parseJson<Omit<ParsedMenu, 'rawText'>>(raw);

  return {
    items:      Array.isArray(parsed.items) ? parsed.items : [],
    categories: Array.isArray(parsed.categories) ? parsed.categories : [],
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.8,
    rawText:    content,
  };
}

// ─── 4. Invoice parser ────────────────────────────────────────────────────────

export async function parseInvoice(content: string): Promise<ParsedInvoice> {
  const system = `You are an invoice parser for a POS system. Extract all invoice data.
Convert all monetary amounts to cents (integer). All cost/price fields must be integers.
Respond with JSON only matching this schema:
{
  "supplierName"?: string, "invoiceNumber"?: string,
  "invoiceDate"?: string, "dueDate"?: string,
  "lineItems": [{ "description": string, "sku"?: string, "quantity": number,
    "unit"?: string, "unitCost": integer, "totalCost": integer }],
  "subtotal": integer, "taxAmount": integer, "total": integer,
  "confidence": number
}`;

  const raw = await callClaude(system, content, 4096);
  const parsed = parseJson<ParsedInvoice>(raw);

  return {
    supplierName:  parsed.supplierName,
    invoiceNumber: parsed.invoiceNumber,
    invoiceDate:   parsed.invoiceDate,
    dueDate:       parsed.dueDate,
    lineItems:     Array.isArray(parsed.lineItems) ? parsed.lineItems : [],
    subtotal:      parsed.subtotal ?? 0,
    taxAmount:     parsed.taxAmount ?? 0,
    total:         parsed.total ?? 0,
    confidence:    typeof parsed.confidence === 'number' ? parsed.confidence : 0.8,
  };
}

// ─── 5. Goods receipt parser ──────────────────────────────────────────────────

export async function parseGoodsReceipt(content: string): Promise<ParsedGoodsReceipt> {
  const system = `You are a goods receipt / delivery note parser for a POS system.
Extract all delivered items and quantities.
Convert all monetary amounts to cents (integer).
Respond with JSON only matching this schema:
{
  "supplierName"?: string, "deliveryDate"?: string, "poNumber"?: string,
  "items": [{ "description": string, "sku"?: string,
    "quantityDelivered": number, "unit"?: string, "unitCost"?: integer }],
  "confidence": number
}`;

  const raw = await callClaude(system, content, 4096);
  const parsed = parseJson<ParsedGoodsReceipt>(raw);

  return {
    supplierName: parsed.supplierName,
    deliveryDate: parsed.deliveryDate,
    poNumber:     parsed.poNumber,
    items:        Array.isArray(parsed.items) ? parsed.items : [],
    confidence:   typeof parsed.confidence === 'number' ? parsed.confidence : 0.8,
  };
}

// ─── 6. Inventory list parser ─────────────────────────────────────────────────

export async function parseInventoryList(content: string): Promise<ParsedInventoryList> {
  const system = `You are an inventory list parser for a POS system.
Extract all products and their current stock quantities.
Respond with JSON only matching this schema:
{
  "items": [{ "name": string, "sku"?: string, "quantity": number,
    "unit"?: string, "location"?: string }],
  "confidence": number
}`;

  const raw = await callClaude(system, content, 4096);
  const parsed = parseJson<ParsedInventoryList>(raw);

  return {
    items:      Array.isArray(parsed.items) ? parsed.items : [],
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.8,
  };
}

// ─── 7. Recipe sheet parser ───────────────────────────────────────────────────

export async function parseRecipeSheet(content: string): Promise<ParsedRecipeSheet> {
  const system = `You are a recipe sheet parser for a restaurant POS system.
Extract all recipes with their ingredients, quantities, and units.
Respond with JSON only matching this schema:
{
  "recipes": [{
    "productName": string, "yieldFactor"?: number,
    "ingredients": [{ "name": string, "quantity": number,
      "unit": string, "wasteFactor"?: number }],
    "notes"?: string
  }],
  "confidence": number
}`;

  const raw = await callClaude(system, content, 4096);
  const parsed = parseJson<ParsedRecipeSheet>(raw);

  return {
    recipes:    Array.isArray(parsed.recipes) ? parsed.recipes : [],
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.8,
  };
}

// ─── 8. CSV column mapper ─────────────────────────────────────────────────────

const SCHEMA_DESCRIPTIONS: Record<string, string> = {
  products:  'name, sku, barcode, description, category, price_cents, cost_price_cents, unit_of_measure, track_inventory',
  inventory: 'name, sku, quantity, unit, location, reorder_point',
  customers: 'first_name, last_name, email, phone, loyalty_points, notes',
  orders:    'order_number, date, customer_email, total_cents, status, payment_method',
};

export async function mapCsvColumns(
  headers:    string[],
  sampleRows: string[][],
  targetSchema: 'products' | 'inventory' | 'customers' | 'orders',
): Promise<ColumnMapping> {
  const system = `You are a data migration expert. Map CSV columns to the target schema fields.
Respond with JSON only matching this schema:
{
  "mappings": [{ "sourceColumn": string, "targetField": string,
    "confidence": number, "transform"?: string }],
  "unmappedColumns": [string],
  "confidence": number
}`;

  const preview = sampleRows
    .slice(0, 3)
    .map((row) => row.join('\t'))
    .join('\n');

  const user = `Source CSV columns: ${headers.join(', ')}

Sample data (first 3 rows):
${preview}

Target schema fields: ${SCHEMA_DESCRIPTIONS[targetSchema] ?? targetSchema}`;

  const raw = await callClaude(system, user, 2048);
  const parsed = parseJson<ColumnMapping>(raw);

  return {
    mappings:        Array.isArray(parsed.mappings) ? parsed.mappings : [],
    unmappedColumns: Array.isArray(parsed.unmappedColumns) ? parsed.unmappedColumns : [],
    confidence:      typeof parsed.confidence === 'number' ? parsed.confidence : 0.8,
  };
}

// ─── 9. Vision helper for image-based documents ───────────────────────────────

export async function parseImageDocument(
  imageBuffer: Buffer,
  mimeType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
): Promise<string> {
  const client = getAnthropic();
  const base64 = imageBuffer.toString('base64');

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: 'Extract all text content from this document image exactly as it appears, preserving structure and layout.',
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mimeType, data: base64 },
        },
        { type: 'text', text: 'Please extract all text from this document.' },
      ],
    }],
  });

  const block = msg.content[0];
  return block.type === 'text' ? block.text : '';
}
