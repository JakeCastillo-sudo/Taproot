/**
 * TaxSetupStep — onboarding step 6: configure the sales tax rate.
 */

import { useState } from 'react';
import { settings as settingsApi } from '../../lib/api';
import { showToast } from '../ui/Toast';

// Base state sales-tax rates (percent), all 50 states + DC. Override-able — these
// are state-level only and do NOT include county/city taxes.
const STATE_RATES: Record<string, number> = {
  AL: 4.0,   AK: 0,     AZ: 5.6,   AR: 6.5,
  CA: 7.25,  CO: 2.9,   CT: 6.35,  DE: 0,
  FL: 6.0,   GA: 4.0,   HI: 4.0,   ID: 6.0,
  IL: 6.25,  IN: 7.0,   IA: 6.0,   KS: 6.5,
  KY: 6.0,   LA: 4.45,  ME: 5.5,   MD: 6.0,
  MA: 6.25,  MI: 6.0,   MN: 6.875, MS: 7.0,
  MO: 4.225, MT: 0,     NE: 5.5,   NV: 6.85,
  NH: 0,     NJ: 6.625, NM: 5.125, NY: 4.0,
  NC: 4.75,  ND: 5.0,   OH: 5.75,  OK: 4.5,
  OR: 0,     PA: 6.0,   RI: 7.0,   SC: 6.0,
  SD: 4.5,   TN: 7.0,   TX: 6.25,  UT: 6.1,
  VT: 6.0,   VA: 5.3,   WA: 6.5,   WV: 6.0,
  WI: 5.0,   WY: 4.0,   DC: 6.0,
};

const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama',        AK: 'Alaska',
  AZ: 'Arizona',        AR: 'Arkansas',
  CA: 'California',      CO: 'Colorado',
  CT: 'Connecticut',    DE: 'Delaware',
  FL: 'Florida',        GA: 'Georgia',
  HI: 'Hawaii',         ID: 'Idaho',
  IL: 'Illinois',       IN: 'Indiana',
  IA: 'Iowa',           KS: 'Kansas',
  KY: 'Kentucky',       LA: 'Louisiana',
  ME: 'Maine',          MD: 'Maryland',
  MA: 'Massachusetts',  MI: 'Michigan',
  MN: 'Minnesota',      MS: 'Mississippi',
  MO: 'Missouri',       MT: 'Montana',
  NE: 'Nebraska',       NV: 'Nevada',
  NH: 'New Hampshire',  NJ: 'New Jersey',
  NM: 'New Mexico',     NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio',           OK: 'Oklahoma',
  OR: 'Oregon',         PA: 'Pennsylvania',
  RI: 'Rhode Island',   SC: 'South Carolina',
  SD: 'South Dakota',   TN: 'Tennessee',
  TX: 'Texas',          UT: 'Utah',
  VT: 'Vermont',        VA: 'Virginia',
  WA: 'Washington',     WV: 'West Virginia',
  WI: 'Wisconsin',      WY: 'Wyoming',
  DC: 'Washington D.C.',
};

// State abbreviations sorted alphabetically by full state name.
const STATE_OPTIONS = Object.keys(STATE_RATES).sort((a, b) =>
  STATE_NAMES[a].localeCompare(STATE_NAMES[b]),
);

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
            {STATE_OPTIONS.map((s) => (
              <option key={s} value={s}>{STATE_NAMES[s]} ({STATE_RATES[s].toFixed(1)}%)</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Sales tax rate (%)</label>
          <input className={field} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 8.25" />
          <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">
            This is the base state rate. Your actual rate may include county and city taxes.
            Verify at your state's revenue department website.
          </p>
          <p className="text-xs text-gray-400 mt-1 leading-relaxed">
            Oregon, Montana, New Hampshire, Delaware, and Alaska have no state sales tax.
          </p>
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
