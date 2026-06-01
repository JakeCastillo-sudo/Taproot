/** Tiny ID generator — crypto.randomUUID() when available, fallback otherwise */
export function nanoid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 11);
}
