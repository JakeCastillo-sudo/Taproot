import { useNavigate } from 'react-router-dom';
import {
  Zap, ShoppingCart, BarChart2, Users,
  Package, CreditCard, CheckCircle, ArrowRight,
} from 'lucide-react';
import { analytics } from '../lib/analytics';

// ─── Feature cards ────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon:        <ShoppingCart size={22} className="text-primary" />,
    title:       'Built for speed',
    description: 'Take orders and process payments in seconds. Works on any device — no proprietary hardware required.',
  },
  {
    icon:        <Zap size={22} className="text-primary" />,
    title:       'AI menu import',
    description: 'Drop a PDF, photo, or CSV — Taproot reads your menu and builds your entire catalog in minutes.',
  },
  {
    icon:        <BarChart2 size={22} className="text-primary" />,
    title:       'Real-time insights',
    description: 'Revenue trends, top products, staff performance, and loyalty analytics — all in one dashboard.',
  },
  {
    icon:        <Package size={22} className="text-primary" />,
    title:       'Recipe costing',
    description: 'Link ingredients to menu items, track real-time COGS, and get automatic low-stock alerts.',
  },
  {
    icon:        <Users size={22} className="text-primary" />,
    title:       'Loyalty & gift cards',
    description: 'Built-in loyalty tiers and branded gift cards — no third-party app required.',
  },
  {
    icon:        <CreditCard size={22} className="text-primary" />,
    title:       'Stripe-powered payments',
    description: 'Accept cards, contactless, and offline payments. Competitive processing rates with no lock-in.',
  },
];

const PLAN_FEATURES = [
  'Unlimited orders & payments',
  'AI menu import & migration',
  'Recipe costing & inventory',
  'Customer loyalty & gift cards',
  'Analytics & reporting',
  'Unlimited team members',
  'PWA — works on any device',
  'Email & chat support',
];

// ─── LandingPage ──────────────────────────────────────────────────────────────

export function LandingPage() {
  const navigate = useNavigate();

  const handleStartTrial = () => {
    analytics.upgradePageViewed();
    navigate('/register');
  };

  return (
    <div className="min-h-screen bg-white">

      {/* Nav */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-white text-xs font-bold">T</span>
            </div>
            <span className="font-bold text-gray-900">Taproot POS</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/login')}
              className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              Sign in
            </button>
            <button
              onClick={handleStartTrial}
              className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-dark transition-colors"
            >
              Start free trial
            </button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-4 pt-16 pb-12 text-center">
        <span className="inline-block bg-primary/10 text-primary text-xs font-semibold px-3 py-1 rounded-full mb-5">
          14-day free trial · No credit card required
        </span>
        <h1 className="text-4xl sm:text-5xl font-extrabold text-gray-900 leading-tight mb-5 tracking-tight">
          The POS built for<br className="hidden sm:block" />
          <span className="text-primary"> independent operators</span>
        </h1>
        <p className="text-lg text-gray-500 max-w-xl mx-auto mb-8 leading-relaxed">
          Taproot handles ordering, payments, inventory, and loyalty — all in one place.
          Import your menu with AI, train staff in minutes, and go live today.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={handleStartTrial}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3.5 bg-primary text-white font-semibold rounded-xl hover:bg-primary-dark active:scale-[0.98] transition-all shadow-md shadow-primary/20"
          >
            Start your free trial
            <ArrowRight size={16} />
          </button>
          <button
            onClick={() => navigate('/login')}
            className="w-full sm:w-auto px-6 py-3.5 border border-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors"
          >
            Sign in to existing account
          </button>
        </div>
      </section>

      {/* Feature grid */}
      <section className="max-w-5xl mx-auto px-4 py-12">
        <h2 className="text-2xl font-bold text-gray-900 text-center mb-8">
          Everything you need to run your business
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="bg-gray-50 rounded-xl p-5 border border-gray-100 hover:border-primary/20 hover:shadow-sm transition-all"
            >
              <div className="w-9 h-9 rounded-lg bg-white border border-gray-100 flex items-center justify-center mb-3 shadow-sm">
                {f.icon}
              </div>
              <h3 className="font-semibold text-gray-900 mb-1">{f.title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{f.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="bg-gray-50 border-y border-gray-100 py-14">
        <div className="max-w-md mx-auto px-4 text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Simple, transparent pricing</h2>
          <p className="text-gray-500 mb-8">One plan. Everything included. Cancel anytime.</p>

          <div className="bg-white rounded-2xl border border-primary/20 shadow-sm p-7">
            {/* Price */}
            <div className="mb-5">
              <div className="flex items-baseline justify-center gap-1">
                <span className="text-4xl font-extrabold text-gray-900">$199</span>
                <span className="text-gray-400 text-sm">/ month per location</span>
              </div>
              <p className="text-xs text-gray-400 mt-1">Billed monthly · Cancel anytime</p>
            </div>

            {/* Features */}
            <ul className="space-y-2.5 text-left mb-6">
              {PLAN_FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-2.5 text-sm text-gray-700">
                  <CheckCircle size={14} className="text-primary shrink-0" />
                  {f}
                </li>
              ))}
            </ul>

            <button
              onClick={handleStartTrial}
              className="w-full py-3.5 bg-primary text-white font-semibold rounded-xl hover:bg-primary-dark transition-colors"
            >
              Start 14-day free trial
            </button>
            <p className="text-xs text-gray-400 mt-3">
              No credit card required to start your trial
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-400">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-primary flex items-center justify-center">
              <span className="text-white text-xs font-bold">T</span>
            </div>
            <span>© {new Date().getFullYear()} Taproot POS</span>
          </div>
          <div className="flex items-center gap-5">
            <a href="mailto:support@taprootpos.com" className="hover:text-gray-700 transition-colors">
              Support
            </a>
            <button onClick={() => navigate('/privacy')} className="hover:text-gray-700 transition-colors">
              Privacy
            </button>
            <button onClick={() => navigate('/terms')} className="hover:text-gray-700 transition-colors">
              Terms
            </button>
            <a href="https://docs.taprootpos.com" target="_blank" rel="noopener noreferrer" className="hover:text-gray-700 transition-colors">
              Docs
            </a>
          </div>
        </div>
      </footer>

    </div>
  );
}
