/**
 * security — client-side security helpers (Security Hardening, web layer).
 *
 * The SERVER is the enforcement boundary — these helpers reduce the chance of
 * the client rendering or forwarding something unsafe, they never replace
 * server-side validation.
 */

/** Strip HTML tags / JS URIs / inline handlers from untrusted display text. */
export function stripHtml(input: string): string {
  return input
    .replace(/<[^>]*>/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim();
}

/** Escape a string for safe insertion into HTML (popup printing, etc.). */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Validate an internal redirect target (open-redirect prevention).
 * Only same-app absolute paths are allowed; anything else → fallback.
 */
export function safeInternalPath(path: string | null | undefined, fallback = '/'): string {
  if (!path) return fallback;
  // Must start with a single "/" (not "//host" protocol-relative) and contain
  // no scheme/backslash trickery.
  if (!/^\/(?!\/)/.test(path) || /[\\]/.test(path) || /^\/\S*:/i.test(path)) return fallback;
  return path;
}

/** Mask all but the last 4 characters (card last4 display, key prefixes). */
export function maskSecret(value: string, visible = 4): string {
  if (value.length <= visible) return '•'.repeat(value.length);
  return '•'.repeat(Math.max(4, value.length - visible)) + value.slice(-visible);
}

/**
 * Never log these keys to console/analytics. Use to scrub objects before
 * any client-side logging.
 */
const SENSITIVE_KEYS = /pass(word)?|token|secret|pin|cvv|cvc|card.?number|authorization/i;

export function scrubSensitive<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = SENSITIVE_KEYS.test(k) ? '[REDACTED]' : v;
  }
  return out;
}
