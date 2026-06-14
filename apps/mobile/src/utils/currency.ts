export function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

export function parseCents(dollars: string): number {
  const num = parseFloat(dollars.replace(/[$,]/g, ''));
  return Math.round(num * 100);
}
