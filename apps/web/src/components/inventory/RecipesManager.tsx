/**
 * RecipesManager — lists all products, shows recipe status, lets user open RecipeEditor.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, ChefHat, Plus, Pencil, Package } from 'lucide-react';
import { clsx } from 'clsx';
import { products as productsApi } from '../../lib/api';
import { QK } from '../../lib/queryClient';
import { RecipeEditor } from './RecipeEditor';
import type { Product } from '@taproot/shared';

// ─── Props ────────────────────────────────────────────────────────────────────

// No props — uses all products in org

// ─── Component ────────────────────────────────────────────────────────────────

export function RecipesManager() {
  const [search,        setSearch]        = useState('');
  const [editProduct,   setEditProduct]   = useState<Product | null>(null);
  const [filterRecipes, setFilterRecipes] = useState<'all' | 'has_recipe' | 'no_recipe'>('all');

  const { data, isLoading } = useQuery({
    queryKey: QK.products({ isActive: true, search, perPage: 200 }),
    queryFn:  () => productsApi.list({ isActive: true, search: search || undefined, perPage: 200 }),
    staleTime: 30_000,
  });

  const allProducts = data?.products ?? [];

  // Filter by recipe status — API doesn't return recipe flag directly,
  // but product_type 'recipe' hints the product IS a recipe product.
  const filtered = allProducts.filter((p) => {
    if (filterRecipes === 'has_recipe') return p.product_type === 'recipe';
    if (filterRecipes === 'no_recipe')  return p.product_type !== 'recipe';
    return true;
  });

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products…"
            className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div className="flex rounded-md border border-gray-200 overflow-hidden bg-white">
          {(['all', 'has_recipe', 'no_recipe'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilterRecipes(f)}
              className={clsx(
                'px-3 py-1.5 text-xs font-medium transition-colors',
                filterRecipes === f
                  ? 'bg-primary text-white'
                  : 'text-gray-600 hover:bg-gray-50',
              )}
            >
              {f === 'all' ? 'All' : f === 'has_recipe' ? 'Has recipe' : 'No recipe'}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-24 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Package size={32} className="text-gray-200 mb-3" />
          <p className="text-sm font-medium text-gray-400">No products found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((product) => {
            const hasRecipe = product.product_type === 'recipe';
            return (
              <div
                key={product.id}
                className="bg-white border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{product.name}</p>
                    {product.sku && (
                      <p className="text-xs text-gray-400 font-mono mt-0.5">{product.sku}</p>
                    )}
                  </div>
                  <button
                    onClick={() => setEditProduct(product)}
                    className={clsx(
                      'flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors shrink-0',
                      hasRecipe
                        ? 'bg-primary/10 text-primary hover:bg-primary/20'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                    )}
                  >
                    {hasRecipe ? <Pencil size={11} /> : <Plus size={11} />}
                    {hasRecipe ? 'Edit' : 'Add recipe'}
                  </button>
                </div>

                <div className="flex items-center gap-2 mt-2">
                  <span className={clsx(
                    'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
                    hasRecipe
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-500',
                  )}>
                    <ChefHat size={10} />
                    {hasRecipe ? 'Recipe' : 'No recipe'}
                  </span>
                  <span className="text-xs text-gray-400 capitalize">{product.product_type}</span>
                  {product.unit_of_measure !== 'each' && (
                    <span className="text-xs text-gray-400">{product.unit_of_measure}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editProduct && (
        <RecipeEditor
          productId={editProduct.id}
          productName={editProduct.name}
          onClose={() => setEditProduct(null)}
        />
      )}
    </div>
  );
}
