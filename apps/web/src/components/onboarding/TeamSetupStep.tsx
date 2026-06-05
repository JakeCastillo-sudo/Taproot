/**
 * TeamSetupStep — onboarding step 4: add team members (optional).
 */

import { useState } from 'react';
import { UserPlus, Check } from 'lucide-react';
import { employees as employeesApi } from '../../lib/api';
import { showToast } from '../ui/Toast';

const ROLES = [
  { value: 'manager', label: 'Manager' },
  { value: 'cashier', label: 'Cashier' },
  { value: 'kitchen', label: 'Kitchen' },
];

export function TeamSetupStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const [added, setAdded] = useState<string[]>([]);
  const [firstName, setFirstName] = useState('');
  const [role, setRole] = useState('cashier');
  const [pin, setPin] = useState('');
  const [saving, setSaving] = useState(false);

  const add = async () => {
    if (!firstName.trim()) { showToast.error('Enter a name'); return; }
    setSaving(true);
    try {
      await employeesApi.create({ firstName: firstName.trim(), lastName: '', email: '', role, pin: pin || undefined });
      setAdded((a) => [...a, `${firstName.trim()} (${role})`]);
      setFirstName(''); setPin(''); setRole('cashier');
      showToast.success('Team member added');
    } catch (e) { showToast.error(e instanceof Error ? e.message : 'Failed to add'); }
    finally { setSaving(false); }
  };

  const field = 'w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40';

  return (
    <div>
      <div className="text-center mb-6">
        <div className="text-5xl mb-3">👥</div>
        <h1 className="text-2xl font-extrabold text-gray-900">Add your team</h1>
        <p className="text-gray-500 mt-1">Give your staff their own logins. You can always do this later.</p>
      </div>

      {added.length > 0 && (
        <div className="mb-4 space-y-1">
          {added.map((a, i) => <div key={i} className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2"><Check size={14} /> {a}</div>)}
        </div>
      )}

      <div className="space-y-3 bg-gray-50 rounded-xl p-4">
        <input className={field} value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First name" />
        <div className="grid grid-cols-2 gap-3">
          <select className={field + ' bg-white'} value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <input className={field} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="PIN (optional)" />
        </div>
        <button onClick={() => void add()} disabled={saving}
          className="w-full flex items-center justify-center gap-2 py-2.5 border border-primary text-primary rounded-lg text-sm font-semibold hover:bg-primary/5 disabled:opacity-50">
          <UserPlus size={15} /> {saving ? 'Adding…' : 'Add team member'}
        </button>
      </div>

      <button onClick={onNext} className="w-full mt-5 py-3 bg-primary text-white rounded-xl font-bold hover:bg-primary-dark">
        {added.length > 0 ? 'Continue →' : 'Continue →'}
      </button>
      <button onClick={onSkip} className="w-full mt-2 py-2 text-gray-500 text-sm hover:text-gray-700">Skip for now</button>
    </div>
  );
}
