/**
 * PaymentsSettingsPage — /settings/payments
 * Stub placeholder — full Stripe Connect status + payment-method toggles land in S1-07.
 */

import { CreditCard } from 'lucide-react';

export function PaymentsSettingsPage() {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 md:px-6 py-4 border-b border-gray-100 bg-white shrink-0">
        <h1 className="text-lg font-bold text-gray-900">Payments</h1>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0 flex flex-col items-center justify-center text-center p-6">
        <CreditCard size={36} className="text-gray-200 mb-3" />
        <p className="text-sm font-medium text-gray-400">Payment settings coming next</p>
      </div>
    </div>
  );
}
