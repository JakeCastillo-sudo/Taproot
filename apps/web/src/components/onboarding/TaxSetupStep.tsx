/**
 * TaxSetupStep — onboarding step 6: configure the sales tax rate.
 */

import { useState } from 'react';
import { settings as settingsApi } from '../../lib/api';
import { showToast } from '../ui/Toast';

// Common state base sales-tax rates (percent). Override-able.
const STATE_RATES: Record<string, number> = {
  CA: 7.25, NY: 4.0, TX: 6.25, FL: 6.0, IL: 6.25, PA: 6.0, WA: 6.5, MA: 6.25,
  GA: 4.0, NC: 4.75, MI: 6.0, NJ: 6.625, VA: 5.3, OH: 5.75, CO: 2.9, AZ: 5.6,
  OR: 0, MT: 0, NH: 0, DE: 0,
};

export function TaxSetupStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const [state, setState] = useState('');
  const [rate, setRate] = useState('');
  const [saving, setSaving] = useState(false);

  const pickState = (s: string) => {
    setState(s);
    if (s in STATE_RATES) setRate(String(STATE_RATES[s]));
  };

  const save = async () => {
    const pct = parseFloat(rate);
    if (!isFinite(pct) || pct < 0) { showToast.error('Enter a valid tax rate'); return; }
    setSaving(true);
    try {
      await settingsApi.saveTax({ taxRates: [{ name: 'Sales Tax', rate: pct / 100, appliesTo: 'all' }], taxInclusive: false });
      showToast.success('Tax rate saved');
      onNext();
    } catch (e) { showToast.error(e instanceof Error ? e.message : 'Failed to save'); }
    finally { setSaving(false); }
  };

  const field = 'w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40';

  return (
    <div>
      <div className="text-center mb-6">
        <div className="text-5xl mb-3">🧾</div>
        <h1 className="text-2xl font-extrabold text-gray-900">Set your tax rate</h1>
        <p className="text-gray-500 mt-1">Pick your state and we'll fill in the common rate. Adjust if needed.</p>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">State</label>
          <select className={field + ' bg-white'} value={state} onChange={(e) => pickState(e.target.value)}>
            <option value="">Select a state…</option>
            {Object.keys(STATE_RATES).sort().map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Sales tax rate (%)</label>
          <input className={field} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 8.25" />
        </div>
      </div>

      <button onClick={() => void save()} disabled={saving}
        className="w-full mt-5 py-3 bg-primary text-white rounded-xl font-bold hover:bg-primary-dark disabled:opacity-50">
        {saving ? 'Saving…' : 'Done →'}
      </button>
      <button onClick={onSkip} className="w-full mt-2 py-2 text-gray-500 text-sm hover:text-gray-700">Skip — set this later</button>
    </div>
  );
}
