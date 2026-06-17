/**
 * urlFetch.service — fetch a menu from a public URL so it can re-enter the
 * existing import pipeline (URL import is just a different way to GET content;
 * everything after the fetch — parse, review, confirm — is unchanged).
 *
 * Security: only http(s); blocks internal/metadata hosts (SSRF mitigation by
 * hostname pattern). 10s timeout, 10MB cap. Supports PDF, images, and HTML
 * (text extracted for Claude). Throws UrlFetchError (code + message) on failure.
 */

// ── Types ───────────────────────────────────────────────────────────────────────

export type FetchedContentType = 'pdf' | 'html' | 'image' | 'unsupported';

export interface FetchedMenuContent {
  contentType: FetchedContentType;
  mimeType:    string;
  /** pdf/image → base64; html → extracted text. */
  content:     string;
  pageTitle:   string | null;
  sourceUrl:   string;
  fetchedAt:   string;
}

export interface UrlFetchError {
  code:
    | 'INVALID_URL'
    | 'BLOCKED_HOST'
    | 'TIMEOUT'
    | 'TOO_LARGE'
    | 'FETCH_FAILED'
    | 'UNSUPPORTED_TYPE';
  message: string;
}

/** Narrow an unknown thrown value to a UrlFetchError. */
export function isUrlFetchError(e: unknown): e is UrlFetchError {
  return typeof e === 'object' && e !== null && 'code' in e && 'message' in e;
}

// ── Security: blocked hosts ───────────────────────────────────────────────────────

const BLOCKED_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^192\.168\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
  /^169\.254\./,            // link-local / cloud metadata
  /metadata\.google\.internal/i,
];

// ── Validate URL ──────────────────────────────────────────────────────────────────

export function validateMenuUrl(url: string): UrlFetchError | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { code: 'INVALID_URL', message: 'Please enter a valid URL starting with http:// or https://' };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { code: 'INVALID_URL', message: 'Only http:// and https:// URLs are supported.' };
  }

  const host = parsed.hostname.toLowerCase();
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(host)) {
      return { code: 'BLOCKED_HOST', message: 'That URL is not accessible.' };
    }
  }

  return null;
}

// ── HTML helpers ──────────────────────────────────────────────────────────────────

function extractTextFromHtml(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');

  // Block elements → newlines
  text = text.replace(/<\/?(div|p|br|li|tr|td|th|h[1-6]|section|article)[^>]*>/gi, '\n');

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode common entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&dollar;/g, '$');

  // Collapse whitespace, preserve meaningful newlines
  text = text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');

  return text.slice(0, 50000); // Claude context guard
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? match[1].trim() : null;
}

// ── Main fetch ──────────────────────────────────────────────────────────────────

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const TIMEOUT_MS = 10_000;

export async function fetchMenuFromUrl(url: string): Promise<FetchedMenuContent> {
  const validationError = validateMenuUrl(url);
  if (validationError) throw validationError;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      signal:  controller.signal,
      headers: {
        'User-Agent': 'Taproot-POS-Menu-Importer/1.0',
        'Accept':     'text/html,application/pdf,image/*,*/*;q=0.8',
      },
      redirect: 'follow',
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw { code: 'TIMEOUT', message: 'The URL took too long to respond. Try downloading the menu as a PDF instead.' } as UrlFetchError;
    }
    throw { code: 'FETCH_FAILED', message: 'Could not reach that URL. Check that the link is correct and publicly accessible.' } as UrlFetchError;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw { code: 'FETCH_FAILED', message: `The URL returned an error (${response.status}). Make sure the link is publicly accessible.` } as UrlFetchError;
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_SIZE_BYTES) {
    throw { code: 'TOO_LARGE', message: 'That file is too large to import (max 10MB). Try a different URL.' } as UrlFetchError;
  }

  const mimeType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();

  // ── PDF ──────────────────────────────────────────────────────────────────────
  if (mimeType === 'application/pdf') {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_SIZE_BYTES) {
      throw { code: 'TOO_LARGE', message: 'That PDF is too large (max 10MB).' } as UrlFetchError;
    }
    return {
      contentType: 'pdf', mimeType, content: Buffer.from(buffer).toString('base64'),
      pageTitle: null, sourceUrl: url, fetchedAt: new Date().toISOString(),
    };
  }

  // ── Image ────────────────────────────────────────────────────────────────────
  if (mimeType.startsWith('image/')) {
    const supported = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (!supported.includes(mimeType)) {
      throw { code: 'UNSUPPORTED_TYPE', message: 'That image format is not supported. Try JPG, PNG, or WebP.' } as UrlFetchError;
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_SIZE_BYTES) {
      throw { code: 'TOO_LARGE', message: 'That image is too large (max 10MB).' } as UrlFetchError;
    }
    return {
      contentType: 'image', mimeType, content: Buffer.from(buffer).toString('base64'),
      pageTitle: null, sourceUrl: url, fetchedAt: new Date().toISOString(),
    };
  }

  // ── HTML / text ────────────────────────────────────────────────────────────────
  if (mimeType.startsWith('text/html') || mimeType.startsWith('text/plain') || mimeType === '') {
    const html  = await response.text();
    const title = extractTitle(html);
    const text  = extractTextFromHtml(html);

    if (text.length < 50) {
      throw {
        code: 'UNSUPPORTED_TYPE',
        message: 'We could not extract menu content from that page. The page may require JavaScript to load. Try downloading the menu as a PDF instead.',
      } as UrlFetchError;
    }

    return {
      contentType: 'html', mimeType: 'text/html', content: text,
      pageTitle: title, sourceUrl: url, fetchedAt: new Date().toISOString(),
    };
  }

  // ── Unsupported ──────────────────────────────────────────────────────────────
  throw {
    code: 'UNSUPPORTED_TYPE',
    message: `That URL contains a ${mimeType} file which cannot be imported. Try a PDF or image of your menu instead.`,
  } as UrlFetchError;
}
