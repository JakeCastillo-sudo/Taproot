import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:           30_000, // 30 s — products/categories
      gcTime:              5 * 60_000,
      retry:               1,       // fail fast for POS
      refetchOnWindowFocus: false,  // cashier doesn't need surprise refreshes
    },
    mutations: {
      retry: 0,
    },
  },
});

/** Query keys (typed constants — avoids string typos) */
export const QK = {
  products:    (params?: object) => ['products', params] as const,
  product:     (id: string)      => ['product', id]      as const,
  categories:  ()                => ['categories']       as const,
  orders:      (locationId: string, params?: object) => ['orders', locationId, params] as const,
  order:       (id: string)      => ['order', id]        as const,
  customers:   (q: string)       => ['customers', 'search', q] as const,
  customer:    (id: string)      => ['customer', id]     as const,
  inventory:   (locationId: string) => ['inventory', locationId] as const,
  discounts:   ()                => ['discounts', 'active'] as const,
} as const;
