import React, { useState } from 'react';
import { Plus, Pencil, Trash2, Search } from 'lucide-react';
import { useFetch, apiPost, apiPut, apiDelete } from '../hooks/useApi';
import Modal from '../components/Modal';
import { useApp } from '../context/AppContext';

function ProductForm({ initial, categories, onSave, onClose }) {
  const [form, setForm] = useState(initial || { name: '', price: '', category_id: '', sku: '', stock: '-1' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name || form.price === '') return setError('Name and price are required');
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: form.name,
        price: parseFloat(form.price),
        category_id: form.category_id || null,
        sku: form.sku || null,
        stock: parseInt(form.stock) || -1,
        active: 1,
      };
      if (initial?.id) {
        await apiPut(`/api/products/${initial.id}`, payload);
      } else {
        await apiPost('/api/products', payload);
      }
      onSave();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="p-5 space-y-4">
      <div>
        <label className="label">Product Name *</label>
        <input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Burger" required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Price *</label>
          <input className="input" type="number" step="0.01" min="0" value={form.price} onChange={e => set('price', e.target.value)} placeholder="0.00" required />
        </div>
        <div>
          <label className="label">Category</label>
          <select className="input" value={form.category_id} onChange={e => set('category_id', e.target.value)}>
            <option value="">None</option>
            {(categories || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">SKU</label>
          <input className="input" value={form.sku} onChange={e => set('sku', e.target.value)} placeholder="PROD-001" />
        </div>
        <div>
          <label className="label">Stock (-1 = unlimited)</label>
          <input className="input" type="number" value={form.stock} onChange={e => set('stock', e.target.value)} />
        </div>
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving...' : initial?.id ? 'Update' : 'Add Product'}</button>
      </div>
    </form>
  );
}

export default function Products() {
  const { settings } = useApp();
  const sym = settings.currency_symbol || '$';
  const { data: products, refetch } = useFetch('/api/products?active=true');
  const { data: categories } = useFetch('/api/categories');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const filtered = (products || []).filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.sku?.toLowerCase().includes(search.toLowerCase())
  );

  async function handleDelete(id) {
    if (!confirm('Deactivate this product?')) return;
    await apiDelete(`/api/products/${id}`);
    refetch();
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Products</h1>
        <button onClick={() => { setEditing(null); setModalOpen(true); }} className="btn-primary">
          <Plus size={16} /> Add Product
        </button>
      </div>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
        <input className="input pl-9" placeholder="Search by name or SKU..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Category</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">SKU</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">Price</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">Stock</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map(p => (
              <tr key={p.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{p.name}</td>
                <td className="px-4 py-3">
                  {p.category_name ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white"
                      style={{ backgroundColor: p.category_color || '#6366f1' }}>
                      {p.category_name}
                    </span>
                  ) : <span className="text-gray-400">—</span>}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-gray-500">{p.sku || '—'}</td>
                <td className="px-4 py-3 text-right font-semibold text-green-600">{sym}{p.price.toFixed(2)}</td>
                <td className="px-4 py-3 text-right text-gray-500">{p.stock === -1 ? '∞' : p.stock}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => { setEditing(p); setModalOpen(true); }} className="btn-ghost p-1.5 rounded-lg">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => handleDelete(p.id)} className="btn-ghost p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="text-center py-12 text-gray-400">No products found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Product' : 'Add Product'}>
        <ProductForm initial={editing} categories={categories} onSave={refetch} onClose={() => setModalOpen(false)} />
      </Modal>
    </div>
  );
}
