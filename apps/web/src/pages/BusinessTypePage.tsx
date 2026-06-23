/**
 * BusinessTypePage — v2.0 onboarding "what kind of business are you?" step.
 *
 * Preset-card selection → sets the org's capability bundle → lands the user on the
 * dashboard ("landing zone"; all presets land on the existing dashboard for now —
 * landing-zone differentiation comes in later versions).
 *
 * NON-DESTRUCTIVE BY DESIGN:
 *  - Reachable at /onboarding/business-type and from Settings → Capabilities; it is
 *    NOT a forced redirect and does not alter the existing login flow. The "force
 *    new orgs through this on first login" insertion is intentionally left as a
 *    commented seam (see docs/V2_0_SANDBOX_NOTES.md) so it can't trap existing users.
 *  - Capability persistence is best-effort: if the backend route is unwired
 *    (pre-review) the PUT 404s, we surface a soft message and STILL proceed to the
 *    dashboard. The user is never trapped.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { UtensilsCrossed, Dumbbell, ShoppingBag } from 'lucide-react';
import { capabilities as capabilitiesApi } from '../lib/api';
import { showToast } from '../components/ui/Toast';

interface PresetCard {
  preset: string;
  title: string;
  description: string;
  icon: React.ReactNode;
}

const PRESET_CARDS: PresetCard[] = [
  {
    preset: 'restaurant',
    title: 'Restaurant',
    description: 'Food & beverage POS — menu, kitchen, orders. The classic Taproot setup.',
    icon: <UtensilsCrossed size={28} />,
  },
  {
    preset: 'studio_cafe',
    title: 'Studio + Café',
    description: 'Fitness/studio booking fused with a café counter — classes, packs, and food on one ledger.',
    icon: <Dumbbell size={28} />,
  },
  {
    preset: 'retail',
    title: 'Retail',
    description: 'Product-first retail POS — inventory, variants, and checkout.',
    icon: <ShoppingBag size={28} />,
  },
];

export function BusinessTypePage() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string | null>(null);

  const apply = useMutation({
    mutationFn: (preset: string) => capabilitiesApi.update({ preset }),
    onSuccess: () => {
      showToast.success('Business type set');
      navigate('/', { replace: true });
    },
    onError: () => {
      // Best-effort persistence tonight; never trap the user — proceed anyway.
      showToast.info('Continuing to your dashboard');
      navigate('/', { replace: true });
    },
  });

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-3xl">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">What kind of business are you?</h1>
          <p className="text-sm text-gray-500 mt-2">
            This sets up the right features. You can change it anytime in Settings → Capabilities.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {PRESET_CARDS.map((p) => (
            <button
              key={p.preset}
              onClick={() => { setSelected(p.preset); apply.mutate(p.preset); }}
              disabled={apply.isPending}
              className={clsx(
                'border rounded-xl p-5 text-left transition-all disabled:opacity-60',
                selected === p.preset
                  ? 'border-primary bg-primary/5'
                  : 'border-gray-200 hover:border-primary hover:bg-primary/5',
              )}
            >
              <div className="text-primary mb-3">{p.icon}</div>
              <h3 className="font-semibold text-gray-900">{p.title}</h3>
              <p className="text-sm text-gray-500 mt-1">{p.description}</p>
            </button>
          ))}
        </div>

        <div className="text-center mt-6">
          <button
            onClick={() => navigate('/', { replace: true })}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}
