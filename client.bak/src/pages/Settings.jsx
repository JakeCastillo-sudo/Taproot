import React, { useState, useEffect } from 'react';
import { Save, Plus, Pencil, Trash2 } from 'lucide-react';
import { useFetch, apiPut, apiPost, apiDelete } from '../hooks/useApi';
import { useApp } from '../context/AppContext';
import Modal from '../components/Modal';

const COLORS = ['#ef4444','#f97316','#f59e0b','#22c55e','#14b8a6','#3b82f6','#8b5cf6','#ec4899','#6366f1','#10b981'];

export default function Settings() {
  const { settings: appSettings, setSettings: setAppSettings } = useApp();
  const { data: serverSettings, loading, refetch: refetchSettings } = useFetch('/api/settings');
  const { data: categories, refetch: refetchCats } = useFetch('/api/categories');

  const [form, setForm] = useState(appSettings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [catModal, setCatModal] = useState(false);
  const [catForm, setCatForm] = useState({ name: '', color: '#6366f1' });
  const [editingCat, setEditingCat] = useState(null);

  useEffect(() => {
    if (serverSettings) setForm(serverSettings);
  }, [serverSettings]);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    await apiPut('/api/settings', form);
    setAppSettings(form);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    refetchSettings();
  }

  async function handleSaveCat() {
    if (!catForm.name) return;
    if (editingCat) {
      await apiPut(`/api/categories/${editingCat.id}`, catForm);
    } else {
      await apiPost('/api/categories', catForm);
    }
    refetchCats();
    setCatModal(false);
    setCatForm({ name: '', color: '#6366f1' });
    setEditingCat(null);
  }

  async function handleDeleteCat(id) {
    if (!confirm('Delete this category?')) return;
    await apiDelete(`/api/categories/${id}`);
    refetchCats();
  }

  if (loading) return <div className="p-8 text-gray-400 animate-pulse">Loading...</div>;

  return (
    <div className="p-6 max-w-2xl space-y-8">
      <h1 className="text-xl font-bold">Settings</h1>

      {/* Business settings */}
      <form onSubmit={handleSave} className="card p-5 space-y-4">
        <h2 className="font-semibold text-sm">Business</h2>
        <div>
          <label className="label">Business Name</label>
          <input className="input" value={form.business_name || ''} onChange={e => setForm(f => ({ ...f, business_name: e.target.value }))} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Tax Rate (%)</label>
            <input className="input" type="number" step="0.01" min="0" max="100" value={form.tax_rate || ''} onChange={e => setForm(f => ({ ...f, tax_rate: e.target.value }))} />
          </div>
          <div>
            <label className="label">Currency Symbol</label>
            <input className="input" value={form.currency_symbol || ''} onChange={e => setForm(f => ({ ...f, currency_symbol: e.target.value }))} maxLength={3} />
          </div>
        </div>
        <div>
          <label className="label">Receipt Footer</label>
          <input className="input" value={form.receipt_footer || ''} onChange={e => setForm(f => ({ ...f, receipt_footer: e.target.value }))} placeholder="Thank you for your business!" />
        </div>
        <button type="submit" disabled={saving} className="btn-primary">
          <Save size={15} />
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
        </button>
      </form>

      {/* Categories */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm">Categories</h2>
          <button onClick={() => { setEditingCat(null); setCatForm({ name: '', color: '#6366f1' }); setCatModal(true); }} className="btn-secondary text-xs">
            <Plus size={14} /> Add Category
          </button>
        </div>
        <div className="space-y-2">
          {(categories || []).map(c => (
            <div key={c.id} className="flex items-center gap-3 p-2.5 rounded-lg border hover:bg-gray-50">
              <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
              <span className="flex-1 text-sm font-medium">{c.name}</span>
              <span className="text-xs text-gray-400">{c.product_count} products</span>
              <button onClick={() => { setEditingCat(c); setCatForm({ name: c.name, color: c.color }); setCatModal(true); }} className="btn-ghost p-1">
                <Pencil size={13} />
              </button>
              <button onClick={() => handleDeleteCat(c.id)} className="btn-ghost p-1 text-red-400 hover:text-red-600">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          {(categories || []).length === 0 && <p className="text-sm text-gray-400 text-center py-4">No categories yet</p>}
        </div>
      </div>

      <Modal open={catModal} onClose={() => setCatModal(false)} title={editingCat ? 'Edit Category' : 'Add Category'} size="sm">
        <div className="p-5 space-y-4">
          <div>
            <label className="label">Name</label>
            <input className="input" value={catForm.name} onChange={e => setCatForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Beverages" autoFocus />
          </div>
          <div>
            <label className="label">Color</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {COLORS.map(c => (
                <button key={c} type="button" onClick={() => setCatForm(f => ({ ...f, color: c }))}
                  className={`w-7 h-7 rounded-full transition-transform ${catForm.color === c ? 'ring-2 ring-offset-2 ring-gray-600 scale-110' : ''}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setCatModal(false)} className="btn-secondary">Cancel</button>
            <button onClick={handleSaveCat} className="btn-primary">{editingCat ? 'Update' : 'Add'}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
