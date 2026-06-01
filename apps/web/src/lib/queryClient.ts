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
  products:         (params?: object)  => ['products', params] as const,
  product:          (id: string)       => ['product', id]      as const,
  categories:       ()                 => ['categories']       as const,
  orders:           (locationId: string, params?: object) => ['orders', locationId, params] as const,
  order:            (id: string)       => ['order', id]        as const,
  customers:        (q: string)        => ['customers', 'search', q] as const,
  customer:         (id: string)       => ['customer', id]     as const,
  inventory:        (locationId: string, params?: object) => ['inventory', locationId, params] as const,
  inventoryMovements: (locationId: string, productId: string) => ['inventory', 'movements', locationId, productId] as const,
  forecast:         (locationId: string) => ['forecast', locationId] as const,
  recipe:           (productId: string)  => ['recipe', productId]    as const,
  varianceReports:  (params?: object)  => ['varianceReports', params] as const,
  varianceReport:   (id: string)       => ['varianceReport', id]     as const,
  discounts:        ()                 => ['discounts', 'active']    as const,
} as const;
