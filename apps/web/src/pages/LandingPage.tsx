import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import { analytics } from '../lib/analytics';

// ─── Content data ──────────────────────────────────────────────────────────────

const PAIN_POINTS = [
  "I'm locked into a 2-year contract and they won't even answer my calls.",
  'Every feature I actually need costs extra. It never ends.',
  'Setup took 3 weeks and a consultant. I just wanted to take orders.',
];

const VALUE_PROPS = [
  {
    title: 'Your menu. Imported in 60 seconds.',
    body: 'Upload your current menu as a PDF. Taproot reads it, imports every item, and has you ready to take orders before your coffee gets cold.',
  },
  {
    title: 'One price. Forever.',
    body: '$99/month. Includes everything. Online ordering. Loyalty. Kitchen display. AI insights. Employee management. Not as add-ons. Included.',
  },
  {
    title: 'Works on the iPad you already have.',
    body: "No proprietary hardware. No $700 terminal you're forced to lease. Your existing iPad. Any Android tablet. Any browser.",
  },
  {
    title: 'Cancel anytime. We mean it.',
    body: "No 2-year contract. No early termination fee. If Taproot isn't working for you, cancel today and pay nothing tomorrow. Your data exports in one click. Always.",
  },
  {
    title: 'Support that actually shows up.',
    body: 'We know what it\'s like at 7pm on a Friday when something breaks and 40 people are waiting for their food. We answer. Every time.',
  },
];

const COMPARISON: Array<[string, string, string, string]> = [
  ['Monthly cost', '$400+/mo', 'Varies', '$99 flat'],
  ['Contract', '2 years', 'None', 'None'],
  ['Hardware required', 'Yes ($700+)', 'Optional', 'No'],
  ['Setup time', 'Weeks', 'Days', '10 minutes'],
  ['AI menu import', '❌', '❌', '✅'],
  ['Hidden fees', 'Yes', 'Yes', 'Never'],
  ['Online ordering', '+$50/mo', 'Included', 'Included'],
  ['Loyalty program', '+$25/mo', '+$45/mo', 'Included'],
  ['Support after signup', 'Poor', 'Poor', 'Always'],
  ['True monthly cost', '$174-320+', '$194+', '$99'],
];

const PLAN_FEATURES = [
  'Unlimited locations', 'Unlimited employees', 'AI menu import', 'Online ordering',
  'Loyalty program', 'Gift cards', 'Kitchen display', 'Table management',
  'Advanced reporting', 'AI demand forecasting', 'Every future feature', 'No setup fee',
  'No hidden fees', 'No per-device fees', 'No transaction fees',
];

const FAQS: Array<[string, string]> = [
  ['Do I need new hardware?', 'No. Taproot works on any iPad, Android tablet, or laptop. If you have a device, you have a POS.'],
  ['Can I import my menu from Toast or Square?', 'Yes. Upload your menu as a PDF or CSV and Taproot imports it automatically.'],
  ['What happens to my data if I cancel?', "It's yours. Always. Export everything in one click. We never hold your data hostage."],
  ['Is there a setup fee?', 'No. No setup fee. No onboarding fee. No implementation consultant. Just sign up and go.'],
  ['Are there any fees beyond $99/month?', 'Three third-party pass-through costs exist: Stripe processing (2.7% + $0.05 per card transaction), sales tax (remitted to your tax authority), and AI features (included up to fair use limits). None of these go to Taproot.'],
  ['What if I need help?', 'We answer. Email, chat, or call. Especially on Friday nights when things get real.'],
  ['Can I use my own payment processor?', "Taproot uses Stripe Connect. You keep your own Stripe account and your own processing rates. We don't take a cut of your transactions."],
];

// ─── LandingPage ──────────────────────────────────────────────────────────────

export function LandingPage() {
  const navigate = useNavigate();

  const handleStartTrial = () => {
    analytics.upgradePageViewed();
    navigate('/register');
  };
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });

  return (
    // Page owns its scroll — the document body is overflow:hidden (PWA shell), so
    // marketing sections stack inside this h-screen scroll container. Sticky header
    // + scrollIntoView both work against this scrolling ancestor.
    <div className="h-screen overflow-y-auto bg-white">

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
            <button onClick={() => navigate('/login')} className="text-sm text-gray-600 hover:text-gray-900 transition-colors">Sign in</button>
            <button onClick={handleStartTrial} className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-dark transition-colors">Start free trial</button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-3xl mx-auto px-4 pt-16 pb-12 text-center">
        <h1 className="text-4xl sm:text-5xl font-extrabold text-gray-900 leading-tight mb-5 tracking-tight">
          The POS built for the restaurant<br className="hidden sm:block" />
          <span className="text-primary"> Toast forgot about.</span>
        </h1>
        <p className="text-lg text-gray-500 max-w-xl mx-auto mb-8 leading-relaxed">
          No contracts. No surprise fees. No being treated like you're too small to matter.
          Just a POS that works — and gets smarter every day.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button onClick={handleStartTrial} className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3.5 bg-primary text-white font-semibold rounded-xl hover:bg-primary-dark active:scale-[0.98] transition-all shadow-md shadow-primary/20">
            Start free for 14 days <ArrowRight size={16} />
          </button>
          <button onClick={() => scrollTo('how')} className="w-full sm:w-auto px-6 py-3.5 border border-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors">
            Watch demo (60s)
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-5">No credit card required · Cancel anytime · Setup in 10 minutes</p>
      </section>

      {/* Origin story */}
      <section className="bg-gray-50 border-y border-gray-100 py-14">
        <div className="max-w-2xl mx-auto px-4 text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-5">Why we built this</h2>
          <div className="text-gray-600 leading-relaxed space-y-2 text-[15px]">
            <p>My wife started a food truck.</p>
            <p>Then grew it into a restaurant.</p>
            <p>Toast charged her for every new feature.</p>
            <p>Support disappeared after she signed the contract.</p>
            <p>She was too small to matter to them.</p>
            <p>So I built what she actually needed.</p>
            <p>Taproot is the POS for operators like her — independent, scrappy, and done being ignored.</p>
          </div>
          <p className="mt-5 font-semibold text-gray-900">— Jake, Founder</p>
        </div>
      </section>

      {/* Pain */}
      <section className="max-w-5xl mx-auto px-4 py-14">
        <h2 className="text-2xl font-bold text-gray-900 text-center mb-8">Sound familiar?</h2>
        <div className="grid sm:grid-cols-3 gap-5">
          {PAIN_POINTS.map((p, i) => (
            <div key={i} className="bg-gray-50 rounded-xl p-5 border border-gray-100">
              <p className="text-gray-700 leading-relaxed italic">&ldquo;{p}&rdquo;</p>
            </div>
          ))}
        </div>
        <p className="text-center text-sm text-gray-500 mt-6 max-w-2xl mx-auto">
          We built Taproot because every one of these is a real thing a real restaurant owner said.
          About Toast. About Square. About Clover.
        </p>
      </section>

      {/* Value props */}
      <section id="how" className="bg-gray-50 border-y border-gray-100 py-14">
        <div className="max-w-3xl mx-auto px-4">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-8">Here's what different looks like.</h2>
          <div className="space-y-4">
            {VALUE_PROPS.map((v, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-100 p-5 flex gap-4">
                <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary font-bold flex items-center justify-center shrink-0">{i + 1}</div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">{v.title}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">{v.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison */}
      <section className="max-w-3xl mx-auto px-4 py-14">
        <h2 className="text-2xl font-bold text-gray-900 text-center mb-8">The honest comparison</h2>
        <div className="overflow-x-auto rounded-2xl border border-gray-100">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="text-left font-medium px-4 py-3">Feature</th>
                <th className="font-medium px-4 py-3">Toast</th>
                <th className="font-medium px-4 py-3">Square</th>
                <th className="font-bold px-4 py-3 text-primary">Taproot</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {COMPARISON.map(([feature, toast, square, taproot], i) => (
                <tr key={i}>
                  <td className="px-4 py-3 text-gray-600">{feature}</td>
                  <td className="text-center text-gray-500">{toast}</td>
                  <td className="text-center text-gray-500">{square}</td>
                  <td className="text-center font-semibold text-gray-900">{taproot}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Pricing */}
      <section className="bg-gray-50 border-y border-gray-100 py-14">
        <div className="max-w-md mx-auto px-4 text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Simple pricing for real restaurants.</h2>
          <p className="text-gray-500 mb-8">One price. Everything included. Locked forever.</p>

          <div className="bg-white rounded-2xl border border-primary/20 shadow-sm p-7 text-left">
            <div className="text-center mb-5">
              <div className="flex items-baseline justify-center gap-1">
                <span className="text-4xl font-extrabold text-gray-900">$99</span>
                <span className="text-gray-400 text-sm">/ month</span>
              </div>
              <p className="text-xs text-gray-400 mt-1">or $990/year (2 months free)</p>
            </div>

            <ul className="space-y-2 mb-6">
              {PLAN_FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-2.5 text-sm text-gray-700">
                  <Check size={14} className="text-primary shrink-0" /> {f}
                </li>
              ))}
            </ul>

            <button onClick={handleStartTrial} className="w-full py-3.5 bg-primary text-white font-semibold rounded-xl hover:bg-primary-dark transition-colors flex items-center justify-center gap-2">
              Start free for 14 days <ArrowRight size={16} />
            </button>
            <p className="text-xs text-gray-400 mt-3 text-center">No credit card required</p>
          </div>

          {/* Price Promise */}
          <div className="mt-8 text-left">
            <h3 className="text-lg font-bold text-gray-900 mb-2">The Taproot Price Promise</h3>
            <div className="text-sm text-gray-600 leading-relaxed space-y-3">
              <p>Your price is locked. We will never raise your rate more than the official US inflation rate (CPI). We'll notify you 90 days before any change. You'll never wake up to a surprise bill.</p>
              <p>Everything we build is included. Every feature on our roadmap comes to you at no additional charge. No tiers. No premium features. No add-on packages. One price. Everything. Forever.</p>
              <p>No Taproot transaction fees. Ever. We make money when you subscribe. Not when you sell.</p>
            </div>

            {/* Disclaimer */}
            <div className="mt-4">
              <p className="text-xs font-semibold text-gray-500 mb-1">What's not a Taproot charge</p>
              <p className="text-xs italic text-gray-400 leading-relaxed">
                Third-party fees collected on our platform are pass-through costs we don't control and don't profit from:
              </p>
              <ul className="mt-1 space-y-1">
                <li className="text-xs italic text-gray-400 leading-relaxed"><strong className="not-italic text-gray-500">Credit card processing:</strong> Stripe charges 2.7% + $0.05 per in-person transaction. Goes directly to Stripe.</li>
                <li className="text-xs italic text-gray-400 leading-relaxed"><strong className="not-italic text-gray-500">Sales tax:</strong> Collected on behalf of your local tax authority. Taproot never touches this money.</li>
                <li className="text-xs italic text-gray-400 leading-relaxed"><strong className="not-italic text-gray-500">AI usage:</strong> Included up to fair use limits. Heavy commercial usage may incur a small pass-through charge at cost. We'll always notify you before this applies.</li>
              </ul>
              <p className="text-xs italic text-gray-400 leading-relaxed mt-1">
                These are industry-standard third-party costs. We list them here because you deserve to know exactly where every dollar goes.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Savings */}
      <section className="max-w-2xl mx-auto px-4 py-14 text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-5">What you actually save</h2>
        <div className="text-gray-600 leading-relaxed space-y-3 text-[15px]">
          <p>The average independent restaurant pays $2,400/year for a basic Toast setup. Add online ordering, loyalty, and a kitchen display and you're at $4,800/year before hardware.</p>
          <p><strong className="text-gray-900">Taproot is $1,188/year. With everything included.</strong></p>
          <p>That's $3,600/year back in your pocket.<br />Over 5 years: <strong className="text-primary">$18,000 saved</strong>.<br />Over 10 years: <strong className="text-primary">$36,000 saved</strong>.</p>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-gray-50 border-t border-gray-100 py-14">
        <div className="max-w-2xl mx-auto px-4">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-8">Questions we hear a lot</h2>
          <div className="space-y-4">
            {FAQS.map(([q, a]) => (
              <div key={q} className="bg-white rounded-xl border border-gray-100 p-5">
                <h3 className="font-semibold text-gray-900 mb-1">{q}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="max-w-2xl mx-auto px-4 py-16 text-center">
        <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-5">Your restaurant deserves better than being ignored.</h2>
        <div className="text-gray-600 leading-relaxed space-y-3 text-[15px] mb-8">
          <p>Toast built a great product for large restaurants. We built Taproot for everyone else. The food trucks. The neighborhood cafes. The family restaurants that have been running for 20 years and just need something that works.</p>
          <p>No contract. No surprises. No being treated like you're too small to matter.</p>
          <p className="font-semibold text-gray-900">You're not too small. You're exactly who we built this for.</p>
        </div>
        <button onClick={handleStartTrial} className="inline-flex items-center justify-center gap-2 px-7 py-3.5 bg-primary text-white font-semibold rounded-xl hover:bg-primary-dark active:scale-[0.98] transition-all shadow-md shadow-primary/20">
          Start your free trial <ArrowRight size={16} />
        </button>
        <p className="text-xs text-gray-400 mt-3">No credit card. 10-minute setup. Cancel anytime.</p>
      </section>

      {/* Footer */}
      <footer className="max-w-5xl mx-auto px-4 py-8 border-t border-gray-100">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-400">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-primary flex items-center justify-center">
              <span className="text-white text-xs font-bold">T</span>
            </div>
            <span>© {new Date().getFullYear()} Taproot POS</span>
          </div>
          <div className="flex items-center gap-5">
            <a href="mailto:support@taprootpos.com" className="hover:text-gray-700 transition-colors">Support</a>
            <button onClick={() => navigate('/privacy')} className="hover:text-gray-700 transition-colors">Privacy</button>
            <button onClick={() => navigate('/terms')} className="hover:text-gray-700 transition-colors">Terms</button>
            <a href="https://docs.taprootpos.com" target="_blank" rel="noopener noreferrer" className="hover:text-gray-700 transition-colors">Docs</a>
          </div>
        </div>
      </footer>

    </div>
  );
}
