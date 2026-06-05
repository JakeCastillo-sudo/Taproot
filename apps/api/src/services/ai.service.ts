/**
 * ai.service — shared Claude helper + Redis cache for the Intelligence layer.
 *
 * All Sprint 5 features compute deterministic numbers from SQL first, then
 * optionally ask Claude for a narrative/recommendation. askClaudeJSON returns
 * null on any failure (no key, parse error, API down) so callers always degrade
 * gracefully to their deterministic output.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { getPublisher } from '../db/redis';

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  return _client;
}

export function aiAvailable(): boolean {
  return Boolean(config.ANTHROPIC_API_KEY);
}

/** Ask Claude and parse a JSON object response. Returns null on any failure. */
export async function askClaudeJSON<T = Record<string, unknown>>(
  system: string, user: string, maxTokens = 1024,
): Promise<T | null> {
  if (!config.ANTHROPIC_API_KEY) return null;
  try {
    const msg = await client().messages.create({
      model: config.CLAUDE_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    });
    const block = msg.content[0];
    if (block.type !== 'text') return null;
    const cleaned = block.text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

/** Ask Claude for a plain-text response. Returns null on any failure. */
export async function askClaudeText(system: string, user: string, maxTokens = 1024): Promise<string | null> {
  if (!config.ANTHROPIC_API_KEY) return null;
  try {
    const msg = await client().messages.create({
      model: config.CLAUDE_MODEL, max_tokens: maxTokens, system,
      messages: [{ role: 'user', content: user }],
    });
    const block = msg.content[0];
    return block.type === 'text' ? block.text.trim() : null;
  } catch {
    return null;
  }
}

// ─── Redis cache (best-effort) ────────────────────────────────────────────────

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await getPublisher().get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    await getPublisher().set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch {
    /* cache is best-effort */
  }
}
