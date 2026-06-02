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
  varianceReports:      (params?: object)  => ['varianceReports', params] as const,
  varianceReport:       (id: string)       => ['varianceReport', id]     as const,
  discounts:            ()                 => ['discounts', 'active']    as const,
  reportDashboard:      (params?: object)  => ['report', 'dashboard', params] as const,
  reportSales:          (params: object)   => ['report', 'sales', params]     as const,
  reportTopProducts:    (params: object)   => ['report', 'top-products', params] as const,
  reportTopCustomers:   (params: object)   => ['report', 'top-customers', params] as const,
  reportPayments:       (params: object)   => ['report', 'payments', params]  as const,
  reportEmployees:      (params: object)   => ['report', 'employees', params] as const,
  reportHeatmap:        (params: object)   => ['report', 'heatmap', params]   as const,
  importJob:            (id: string)       => ['import', 'job', id]            as const,
  importJobs:           (params?: object)  => ['import', 'jobs', params]       as const,
  migrationJob:         (id: string)       => ['migration', 'job', id]         as const,
  migrationJobs:        ()                 => ['migration', 'jobs']            as const,
  billing:              ()                 => ['billing']                      as const,
  billingInvoices:      ()                 => ['billing', 'invoices']          as const,
} as const;
