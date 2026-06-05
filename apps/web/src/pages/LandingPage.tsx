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
          The POS that reads your menu<br className="hidden sm:block" />
          <span className="text-primary"> and sets itself up</span>
        </h1>
        <p className="text-lg text-gray-500 max-w-xl mx-auto mb-8 leading-relaxed">
          Upload your menu PDF. Taproot imports everything in 60 seconds.
          No contract. No hardware. No surprises.
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

      {/* Social proof */}
      <section className="border-y border-gray-100 bg-gray-50/60 py-5">
        <div className="max-w-5xl mx-auto px-4 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-sm text-gray-500">
          <span>★★★★★ <span className="text-gray-400">loved by independent operators</span></span>
          <span className="hidden sm:inline text-gray-300">·</span>
          <span>No credit card required</span>
          <span className="hidden sm:inline text-gray-300">·</span>
          <span>Live in under 10 minutes</span>
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

          {/* Third-party pass-through disclaimer */}
          <div className="mt-5 text-left px-1">
            <p className="text-xs font-semibold text-gray-500 mb-1.5">
              Third-party fees we don&apos;t control and don&apos;t profit from
            </p>
            <ul className="space-y-1">
              <li className="text-xs italic text-gray-400">
                <strong className="not-italic text-gray-500">Credit card processing</strong> — Stripe charges 2.7% + $0.05 per transaction, billed directly by Stripe. Taproot keeps $0.
              </li>
              <li className="text-xs italic text-gray-400">
                <strong className="not-italic text-gray-500">Sales tax</strong> — collected at checkout and remitted in full to your state / local tax authority.
              </li>
              <li className="text-xs italic text-gray-400">
                <strong className="not-italic text-gray-500">AI usage</strong> — included within fair-use limits (menu imports, NL queries, forecasting). Unusually high volume may be passed through at cost with 30-day notice.
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Comparison */}
      <section className="max-w-3xl mx-auto px-4 py-14">
        <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">No contract, no surprises</h2>
        <p className="text-gray-500 text-center mb-8">Cancel anytime. Your data is always yours.</p>
        <div className="overflow-x-auto rounded-2xl border border-gray-100">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="text-left font-medium px-4 py-3">&nbsp;</th>
                <th className="font-medium px-4 py-3">Toast</th>
                <th className="font-medium px-4 py-3">Square</th>
                <th className="font-bold px-4 py-3 text-primary">Taproot</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              <tr><td className="px-4 py-3 text-gray-600">Monthly cost</td><td className="text-center text-gray-500">$400+/mo</td><td className="text-center text-gray-500">% per txn</td><td className="text-center font-semibold text-gray-900">$199 flat</td></tr>
              <tr><td className="px-4 py-3 text-gray-600">Proprietary hardware</td><td className="text-center text-gray-500">Required</td><td className="text-center text-gray-500">Pushed</td><td className="text-center font-semibold text-primary">None</td></tr>
              <tr><td className="px-4 py-3 text-gray-600">Contract</td><td className="text-center text-gray-500">Multi-year</td><td className="text-center text-gray-500">Varies</td><td className="text-center font-semibold text-primary">Cancel anytime</td></tr>
              <tr><td className="px-4 py-3 text-gray-600">AI menu setup</td><td className="text-center text-gray-300">—</td><td className="text-center text-gray-300">—</td><td className="text-center font-semibold text-primary">60 seconds</td></tr>
            </tbody>
          </table>
        </div>
        <p className="text-center text-sm text-gray-500 mt-6">
          The average restaurant spends <strong>8 hours</strong> setting up a new POS. Taproot takes <strong>10 minutes</strong>.
        </p>
      </section>

      {/* FAQ */}
      <section className="bg-gray-50 border-t border-gray-100 py-14">
        <div className="max-w-2xl mx-auto px-4">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-8">Frequently asked</h2>
          <div className="space-y-4">
            {[
              ['Do I need new hardware?', 'No. Taproot runs on any phone, tablet, or computer you already own — it\'s a web app.'],
              ['Can I import from Toast or Square?', 'Yes. Upload a menu export (PDF/CSV) or use the migration wizard and we\'ll bring your catalog over.'],
              ['What happens to my data if I cancel?', 'You own it. Export anytime — orders, customers, products, and accounting CSVs are always available.'],
              ['Is there a setup fee?', 'No setup fee, and no credit card required to start your 14-day trial.'],
              ['What does "$199 flat" actually mean?', 'Your Taproot subscription is $199/month — that\'s it from us. Three pass-through costs exist that we don\'t control and don\'t profit from: (1) Credit card processing at 2.7% + $0.05 per transaction, billed directly by Stripe to your bank account. (2) Sales tax collected from customers and remitted in full to your tax authority. (3) AI features (menu import, forecasting, NL queries) included within fair-use limits — heavy usage beyond standard thresholds may be passed through at cost with 30 days\' notice. The vast majority of restaurants never exceed those limits.'],
            ].map(([q, a]) => (
              <div key={q} className="bg-white rounded-xl border border-gray-100 p-5">
                <h3 className="font-semibold text-gray-900 mb-1">{q}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{a}</p>
              </div>
            ))}
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
