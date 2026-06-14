/**
 * LandingPage — production marketing page (S10-01, V1.3).
 *
 * The first thing every potential customer sees. Clean, fast, mobile-first.
 * Built with only React + TypeScript + Tailwind + lucide-react (no new deps).
 * System fonts only (no web-font fetch). Taproot green (#1D9E75 = `primary`).
 * Every CTA links to /register.
 *
 * Sections: Nav · Hero · Origin · Pain · Features · AI · Comparison ·
 *           Pricing · Price Promise · Savings Calculator · FAQ · Closing · Footer
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Leaf, Menu, X, Upload, Tag, Monitor, XCircle, Headphones,
  LineChart, TrendingUp, DollarSign, Lock, Package, Shield,
  Check, ChevronDown, ArrowRight, Play, Twitter, Linkedin, Instagram,
  Smartphone, Tablet, Globe, SlidersHorizontal,
} from 'lucide-react';
import { clsx } from 'clsx';
import { PlatformDetect } from '../components/PlatformDetect';

const SYSTEM_FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

// ─── Logo ───────────────────────────────────────────────────────────────────

function Logo({ light = false }: { light?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary">
        <Leaf size={18} className="text-white" />
      </span>
      <span className={clsx('text-lg font-bold tracking-tight', light ? 'text-white' : 'text-gray-900')}>
        Taproot
      </span>
    </span>
  );
}

// ─── Nav (Section 1) ─────────────────────────────────────────────────────────

function Nav() {
  const [open, setOpen] = useState(false);
  return (
    <nav className="fixed top-0 inset-x-0 z-50 bg-white shadow-sm">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link to="/" aria-label="Taproot home"><Logo /></Link>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-6">
          <a href="#pricing" className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">Pricing</a>
          <Link to="/hardware" className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">Hardware</Link>
          <Link to="/download" className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">Download</Link>
          <Link to="/support" className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">Support</Link>
          <Link to="/login" className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">Sign in</Link>
          <Link to="/register" className="text-sm font-semibold text-white bg-primary hover:bg-primary-dark px-4 py-2 rounded-lg transition-colors">
            Start free trial
          </Link>
        </div>

        {/* Mobile toggle */}
        <button className="md:hidden p-2 -mr-2 text-gray-700" onClick={() => setOpen((v) => !v)} aria-label="Menu">
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {open && (
        <div className="md:hidden border-t border-gray-100 bg-white px-4 py-3 space-y-1">
          <a href="#pricing" onClick={() => setOpen(false)} className="block px-2 py-2 text-sm font-medium text-gray-700 rounded-md hover:bg-gray-50">Pricing</a>
          <Link to="/hardware" className="block px-2 py-2 text-sm font-medium text-gray-700 rounded-md hover:bg-gray-50">Hardware</Link>
          <Link to="/download" className="block px-2 py-2 text-sm font-medium text-gray-700 rounded-md hover:bg-gray-50">Download</Link>
          <Link to="/support" className="block px-2 py-2 text-sm font-medium text-gray-700 rounded-md hover:bg-gray-50">Support</Link>
          <Link to="/login" className="block px-2 py-2 text-sm font-medium text-gray-700 rounded-md hover:bg-gray-50">Sign in</Link>
          <Link to="/register" className="block px-2 py-2 text-sm font-semibold text-white bg-primary rounded-md text-center">Start free trial</Link>
        </div>
      )}
    </nav>
  );
}

// ─── Reusable bits ────────────────────────────────────────────────────────────

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-bold uppercase tracking-[0.12em] mb-3 text-primary">
      {children}
    </p>
  );
}

function PrimaryCTA({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Link
      to="/register"
      className={clsx(
        'inline-flex items-center justify-center gap-2 bg-primary hover:bg-primary-dark text-white font-semibold rounded-lg px-6 py-3.5 text-base transition-colors active:scale-[0.99]',
        className,
      )}
    >
      {children}
    </Link>
  );
}

// ─── Hero (Section 2) ──────────────────────────────────────────────────────────

function Hero({ onDemo }: { onDemo: () => void }) {
  return (
    <section className="min-h-screen flex items-center bg-[#F9FAFB] pt-16">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-16 text-center">
        <span className="inline-flex items-center gap-1.5 bg-primary-light text-primary-dark text-sm font-semibold px-3 py-1 rounded-full">
          🌿 Built for independent restaurants
        </span>

        <h1 className="mt-6 text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-gray-900 leading-[1.08]">
          The POS built for the restaurant<br className="hidden sm:block" /> Toast forgot about.
        </h1>

        <p className="mt-6 text-lg sm:text-xl text-gray-500 max-w-2xl mx-auto leading-relaxed">
          No contracts. No surprise fees. No being treated like you're too small to matter.
          Just a POS that works — and gets smarter every day.
        </p>

        <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
          <PrimaryCTA className="w-full sm:w-auto">Start free for 14 days <ArrowRight size={18} /></PrimaryCTA>
          <button
            onClick={onDemo}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 border border-gray-300 text-gray-700 font-semibold rounded-lg px-6 py-3.5 text-base hover:bg-white transition-colors"
          >
            <Play size={16} /> Watch 60-second demo
          </button>
        </div>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-gray-500">
          <span className="inline-flex items-center gap-1"><Check size={14} className="text-primary" /> No credit card required</span>
          <span className="text-gray-300">·</span>
          <span className="inline-flex items-center gap-1"><Check size={14} className="text-primary" /> Setup in 10 minutes</span>
          <span className="text-gray-300">·</span>
          <span className="inline-flex items-center gap-1"><Check size={14} className="text-primary" /> Cancel anytime</span>
        </div>
      </div>
    </section>
  );
}

// ─── Origin story (Section 3) ──────────────────────────────────────────────────

function Origin() {
  return (
    <section className="bg-white py-20 sm:py-24">
      <div className="max-w-[640px] mx-auto px-4 sm:px-6">
        <blockquote className="border-l-4 border-primary pl-6 italic text-lg sm:text-xl text-gray-700 leading-relaxed space-y-4">
          <p>My wife started a food truck. Then grew it into a restaurant. Toast charged her for every new feature. Support disappeared after she signed the contract. She was too small to matter to them.</p>
          <p>So I built what she actually needed.</p>
          <p>Taproot is the POS for operators like her — independent, scrappy, and done being ignored.</p>
        </blockquote>
        <div className="flex items-center gap-3 mt-6 pl-6">
          <span className="w-10 h-10 rounded-full bg-primary text-white font-bold flex items-center justify-center">J</span>
          <span className="text-sm font-semibold text-gray-600">— Jake Castillo, Founder</span>
        </div>
      </div>
    </section>
  );
}

// ─── Pain points (Section 4) ──────────────────────────────────────────────────

const PAINS = [
  { q: "I'm locked into a 2-year contract and they won't even answer my calls.", who: '— Restaurant owner, Austin TX' },
  { q: 'Every feature I actually need costs extra. It never ends.', who: '— Cafe owner, Nashville TN' },
  { q: 'Setup took 3 weeks and a consultant. I just wanted to take orders.', who: '— Food truck owner, Chicago IL' },
];

function Pain() {
  return (
    <section className="bg-[#F9FAFB] py-20 sm:py-24">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 text-center">
        <Eyebrow>Why operators switch</Eyebrow>
        <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900">Sound familiar?</h2>

        <div className="grid gap-5 sm:grid-cols-3 mt-12 text-left">
          {PAINS.map((p) => (
            <div key={p.who} className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
              <span className="text-4xl leading-none text-red-300 font-serif">&ldquo;</span>
              <p className="italic text-gray-700 -mt-3">{p.q}</p>
              <p className="text-sm text-gray-400 mt-4">{p.who}</p>
            </div>
          ))}
        </div>

        <p className="text-gray-500 mt-10 max-w-2xl mx-auto">
          We built Taproot because every one of these is a real thing a real restaurant owner told us.
        </p>
      </div>
    </section>
  );
}

// ─── Features (Section 5) ──────────────────────────────────────────────────────

const FEATURES = [
  { icon: Upload, title: 'Your menu. Imported in 60 seconds.', body: "Upload your current menu as a PDF. Taproot reads it, imports every item, and has you ready to take orders before your coffee gets cold. No data entry. No consultants." },
  { icon: Tag, title: 'One price. Everything included.', body: '$99/month includes everything. Online ordering. Loyalty program. Kitchen display. AI insights. Employee management. Not as add-ons. Included.' },
  { icon: Monitor, title: 'Works on the iPad you already have.', body: "No proprietary hardware. No $700 terminal you're forced to lease. Your existing iPad, any Android tablet, any browser." },
  { icon: SlidersHorizontal, title: 'Modifiers & options', body: 'Add milk choices, sizes, flavors, and add-ons to any menu item. Charge extra for oat milk. Require a size selection. It all flows through to the kitchen ticket automatically.' },
  { icon: XCircle, title: 'Cancel anytime. We mean it.', body: "No 2-year contract. No early termination fee. If Taproot isn't working for you, cancel today and pay nothing tomorrow. Your data exports in one click. Always." },
  { icon: Headphones, title: 'Support that actually shows up.', body: 'We know what 7pm on a Friday feels like when something breaks and 40 people are waiting. We answer. Every time.' },
];

function Features() {
  return (
    <section className="bg-white py-20 sm:py-24">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="text-center">
          <Eyebrow>What makes us different</Eyebrow>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900">Here's what different looks like.</h2>
        </div>

        <div className="mt-14 space-y-12 sm:space-y-16">
          {FEATURES.map((f, i) => {
            const Icon = f.icon;
            const flip = i % 2 === 1;
            return (
              <div key={f.title} className={clsx('flex flex-col sm:flex-row items-center gap-6 sm:gap-10', flip && 'sm:flex-row-reverse')}>
                <div className="shrink-0 w-20 h-20 rounded-2xl bg-primary-light flex items-center justify-center">
                  <Icon size={34} className="text-primary" strokeWidth={1.8} />
                </div>
                <div className={clsx('text-center', flip ? 'sm:text-right' : 'sm:text-left')}>
                  <h3 className="text-xl font-bold text-gray-900">{f.title}</h3>
                  <p className="text-gray-500 mt-2 leading-relaxed max-w-xl">{f.body}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── AI features (Section 6) ───────────────────────────────────────────────────

const AI_CARDS = [
  { icon: LineChart, title: 'Daily Intelligence', body: "Every morning: what sold, what to prep, who's scheduled, what to reorder. Your restaurant's overnight analyst." },
  { icon: TrendingUp, title: 'Demand Forecasting', body: 'Predict busy hours before they happen. Prep the right amount. Schedule the right staff. Stop running out of your best items.' },
  { icon: DollarSign, title: 'Menu Engineering', body: "Know which items make money and which don't. AI spots your Stars, Plowhorses, Puzzles, and Dogs. One-click to fix what's hurting your margins." },
];

function AIFeatures() {
  return (
    <section className="bg-[#111827] py-20 sm:py-24">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 text-center">
        <Eyebrow>AI-powered</Eyebrow>
        <h2 className="text-3xl sm:text-4xl font-extrabold text-white">The POS that gets smarter while you sleep.</h2>
        <p className="text-gray-400 mt-4 max-w-2xl mx-auto">
          Most POS systems just record what happened. Taproot tells you what to do about it.
        </p>

        <div className="grid gap-5 sm:grid-cols-3 mt-12 text-left">
          {AI_CARDS.map((c) => {
            const Icon = c.icon;
            return (
              <div key={c.title} className="bg-[#1F2937] rounded-2xl p-6 border border-white/5">
                <div className="w-11 h-11 rounded-xl bg-primary/20 flex items-center justify-center mb-4">
                  <Icon size={22} className="text-primary" />
                </div>
                <h3 className="text-lg font-bold text-white">{c.title}</h3>
                <p className="text-gray-400 mt-2 text-sm leading-relaxed">{c.body}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── Comparison (Section 7) ────────────────────────────────────────────────────

const COMPARE: Array<{ feature: string; toast: string; square: string; clover: string; taproot: string; toastBad?: boolean; squareBad?: boolean; cloverBad?: boolean }> = [
  { feature: 'Monthly cost', toast: '$400+/mo', square: 'Varies', clover: '$90+/mo', taproot: '$99 flat' },
  { feature: 'Contract', toast: '2 years', square: 'None', clover: '3 years', taproot: 'None', toastBad: true, cloverBad: true },
  { feature: 'Hardware required', toast: 'Yes ($700+)', square: 'Optional', clover: 'Yes ($799+)', taproot: 'No', toastBad: true, cloverBad: true },
  { feature: 'Setup time', toast: 'Weeks', square: 'Days', clover: 'Days', taproot: '10 min', toastBad: true, squareBad: true, cloverBad: true },
  { feature: 'AI menu import', toast: 'No', square: 'No', clover: 'No', taproot: 'Yes', toastBad: true, squareBad: true, cloverBad: true },
  { feature: 'Hidden fees', toast: 'Yes', square: 'Yes', clover: 'Yes', taproot: 'Never', toastBad: true, squareBad: true, cloverBad: true },
  { feature: 'Online ordering', toast: '+$50/mo', square: 'Included', clover: 'Extra', taproot: 'Included', toastBad: true, cloverBad: true },
  { feature: 'Loyalty program', toast: '+$25/mo', square: '+$45/mo', clover: 'Extra', taproot: 'Included', toastBad: true, squareBad: true, cloverBad: true },
  { feature: 'Price transparency', toast: 'Poor', square: 'Poor', clover: 'Poor', taproot: 'Full', toastBad: true, squareBad: true, cloverBad: true },
  { feature: 'True monthly cost', toast: '$174–320+', square: '$194+', clover: '$200+', taproot: '$99' },
];

function Comparison() {
  return (
    <section className="bg-white py-20 sm:py-24">
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        <div className="text-center">
          <Eyebrow>The honest comparison</Eyebrow>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900">See how we stack up.</h2>
        </div>

        <div className="mt-10 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="text-left">
                <th className="py-3 px-3 font-semibold text-gray-500">Feature</th>
                <th className="py-3 px-3 font-semibold text-gray-500 text-center">Toast</th>
                <th className="py-3 px-3 font-semibold text-gray-500 text-center">Square</th>
                <th className="py-3 px-3 font-semibold text-gray-500 text-center">Clover</th>
                <th className="py-3 px-3 font-bold text-primary-dark text-center bg-primary-light rounded-t-lg">Taproot</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE.map((r, i) => (
                <tr key={r.feature} className={clsx('border-t border-gray-100', i === COMPARE.length - 1 && 'font-semibold')}>
                  <td className="py-3 px-3 text-gray-700">{r.feature}</td>
                  <td className={clsx('py-3 px-3 text-center', r.toastBad ? 'text-danger' : 'text-gray-500')}>{r.toast}{r.toastBad && ' ✕'}</td>
                  <td className={clsx('py-3 px-3 text-center', r.squareBad ? 'text-danger' : 'text-gray-500')}>{r.square}{r.squareBad && ' ✕'}</td>
                  <td className={clsx('py-3 px-3 text-center', r.cloverBad ? 'text-danger' : 'text-gray-500')}>{r.clover}{r.cloverBad && ' ✕'}</td>
                  <td className="py-3 px-3 text-center bg-primary-light/60 text-primary-dark font-semibold">{r.taproot} ✓</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-gray-400 text-center mt-5 max-w-xl mx-auto">
          *Competitor pricing based on published rates, June 2026. True monthly cost includes common add-ons.
        </p>
      </div>
    </section>
  );
}

// ─── Pricing (Section 8) ───────────────────────────────────────────────────────

const PLAN_FEATURES = [
  'Unlimited locations', 'Unlimited employees', 'AI menu import', 'Online ordering',
  'Loyalty program', 'Gift cards', 'Kitchen display', 'Table management',
  'Advanced reporting', 'AI demand forecasting', 'Every future feature', 'No setup fee',
  'No hidden fees', 'No per-device fees', 'No transaction fees',
];

function Pricing() {
  const [annual, setAnnual] = useState(false);
  return (
    <section id="pricing" className="bg-[#F9FAFB] py-20 sm:py-24">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
        <Eyebrow>Pricing</Eyebrow>
        <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900">Simple pricing for real restaurants.</h2>
        <p className="text-gray-500 mt-3">One price. Everything included. Locked forever.</p>

        <div className="max-w-[480px] mx-auto mt-10 bg-white rounded-3xl border border-gray-100 shadow-md p-7 text-left relative">
          <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-white text-xs font-bold px-3 py-1 rounded-full">Most popular</span>

          {/* Toggle */}
          <div className="flex items-center justify-center gap-1 bg-gray-100 rounded-lg p-1 w-fit mx-auto mb-6">
            <button onClick={() => setAnnual(false)} className={clsx('px-4 py-1.5 rounded-md text-sm font-semibold transition-colors', !annual ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500')}>Monthly</button>
            <button onClick={() => setAnnual(true)} className={clsx('px-4 py-1.5 rounded-md text-sm font-semibold transition-colors', annual ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500')}>Annual</button>
          </div>

          <div className="text-center">
            <div className="flex items-end justify-center gap-1">
              <span className="text-5xl font-extrabold text-gray-900">${annual ? 82 : 99}</span>
              <span className="text-gray-400 mb-1.5">/month</span>
            </div>
            <p className="text-sm text-gray-400 mt-1">{annual ? 'Billed $990/year (2 months free)' : 'or $990/year (2 months free)'}</p>
          </div>

          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 mt-6">
            {PLAN_FEATURES.map((f) => (
              <li key={f} className="flex items-center gap-2 text-sm text-gray-700">
                <Check size={15} className="text-primary shrink-0" /> {f}
              </li>
            ))}
          </ul>

          <PrimaryCTA className="w-full mt-7">Start free for 14 days <ArrowRight size={18} /></PrimaryCTA>
          <p className="text-center text-xs text-gray-400 mt-3">No credit card required · Cancel anytime</p>
        </div>
      </div>
    </section>
  );
}

// ─── Price promise (Section 9) ─────────────────────────────────────────────────

const PROMISES: Array<{ icon: typeof Lock; title: string; body: string; example?: string }> = [
  { icon: Lock, title: 'Your price is locked.', body: "We can only raise your price with US inflation — and only by that exact amount. If inflation is 3% this year, your $99 becomes $102. That's it. No surprise fees. No arbitrary increases. 90 days notice before any change.", example: "Example: If US inflation is 3% in 2027, your price goes from $99.00 → $101.97/month. That's the legal maximum we can ever charge." },
  { icon: Package, title: 'Everything included.', body: 'Every feature on our roadmap comes to you at no additional charge. No tiers. No premium features. No add-on packages. One price. Forever.' },
  { icon: Shield, title: 'No Taproot fees on transactions.', body: 'We make money when you subscribe. Not when you sell. No cut of your revenue. Ever.' },
];

function PricePromise() {
  return (
    <section className="bg-white py-20 sm:py-24">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 text-center">
        <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900">The Taproot Price Promise</h2>
        <div className="grid gap-8 sm:grid-cols-3 mt-12 text-left">
          {PROMISES.map((p) => {
            const Icon = p.icon;
            return (
              <div key={p.title}>
                <div className="w-12 h-12 rounded-xl bg-primary-light flex items-center justify-center mb-4">
                  <Icon size={24} className="text-primary" />
                </div>
                <h3 className="text-lg font-bold text-gray-900">{p.title}</h3>
                <p className="text-gray-500 mt-2 text-sm leading-relaxed">{p.body}</p>
                {p.example && (
                  <p className="mt-3 text-xs text-primary-dark bg-primary-light rounded-lg p-3 leading-relaxed">
                    {p.example}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-xs text-gray-400 mt-10 max-w-2xl mx-auto leading-relaxed">
          Third-party pass-through costs (not Taproot charges): Stripe processing: 2.7% + $0.05/in-person
          transaction • Sales tax: remitted directly to tax authority • AI features: included up to fair use limits
        </p>
      </div>
    </section>
  );
}

// ─── Savings calculator (Section 10) ───────────────────────────────────────────

const COMPETITORS: Array<{ name: string; plans: Array<{ name: string; price: number }> }> = [
  {
    name: 'Toast',
    plans: [
      { name: 'Starter', price: 69 },
      { name: 'Point of Sale', price: 165 },
      { name: 'Toast + add-ons', price: 400 },
    ],
  },
  {
    name: 'Square',
    plans: [
      { name: 'Free', price: 0 },
      { name: 'Plus', price: 60 },
      { name: 'Premium', price: 150 },
      { name: 'Square + add-ons', price: 194 },
    ],
  },
  {
    name: 'Clover',
    plans: [
      { name: 'Starter', price: 14.95 },
      { name: 'Standard', price: 84.95 },
      { name: 'Advanced', price: 194.95 },
      { name: 'Clover + add-ons', price: 290 },
    ],
  },
];

// Flatten to a stable index-addressable list so the <select> value is the index
// (prices can collide / be 0, so we never key the selection on the price itself).
const COMPETITOR_PLANS = COMPETITORS.flatMap((c) =>
  c.plans.map((p) => ({
    group: c.name,
    label: p.name.includes(c.name) ? p.name : `${c.name} ${p.name}`,
    price: p.price,
  })),
);
// Default selection = Toast Point of Sale.
const DEFAULT_PLAN_IDX = COMPETITOR_PLANS.findIndex((p) => p.label === 'Toast Point of Sale');

function SavingsCalculator() {
  const [sel, setSel] = useState(DEFAULT_PLAN_IDX);
  const [other, setOther] = useState('');
  const current = sel === -1 ? (parseFloat(other) || 0) : (COMPETITOR_PLANS[sel]?.price ?? 0);
  const monthly = Math.max(0, Math.round(current - 99));
  const fmt = (n: number) => '$' + n.toLocaleString('en-US');

  return (
    <section className="bg-[#F9FAFB] py-20 sm:py-24">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 text-center">
        <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900">What you actually save</h2>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mt-10 text-left">
          <label className="block text-sm font-semibold text-gray-700 mb-2">I currently pay:</label>
          <select
            value={sel}
            onChange={(e) => setSel(Number(e.target.value))}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            {COMPETITORS.map((c) => (
              <optgroup key={c.name} label={c.name}>
                {COMPETITOR_PLANS.map((p, i) =>
                  p.group === c.name ? (
                    <option key={p.label} value={i}>{p.label} — {fmt(p.price)}/mo</option>
                  ) : null,
                )}
              </optgroup>
            ))}
            <option value={-1}>Other…</option>
          </select>
          {sel === -1 && (
            <input
              type="number"
              value={other}
              onChange={(e) => setOther(e.target.value)}
              placeholder="Enter your monthly cost ($)"
              className="w-full mt-3 px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          )}

          <div className="mt-6 grid grid-cols-3 gap-3 text-center">
            <div className="bg-primary-light rounded-xl py-4">
              <p className="text-2xl font-extrabold text-primary-dark">{fmt(monthly)}</p>
              <p className="text-xs text-gray-500 mt-0.5">/ month</p>
            </div>
            <div className="bg-primary-light rounded-xl py-4">
              <p className="text-2xl font-extrabold text-primary-dark">{fmt(monthly * 12)}</p>
              <p className="text-xs text-gray-500 mt-0.5">/ year</p>
            </div>
            <div className="bg-primary-light rounded-xl py-4">
              <p className="text-2xl font-extrabold text-primary-dark">{fmt(monthly * 60)}</p>
              <p className="text-xs text-gray-500 mt-0.5">over 5 years</p>
            </div>
          </div>
        </div>

        <div className="mt-8 bg-primary text-white rounded-2xl p-6">
          <p className="text-lg font-bold">$99/month. Everything included. No surprises.</p>
          <Link to="/register" className="inline-flex items-center gap-2 mt-4 bg-white text-primary-dark font-semibold rounded-lg px-5 py-3 hover:bg-gray-50 transition-colors">
            Start free for 14 days <ArrowRight size={18} />
          </Link>
        </div>
      </div>
    </section>
  );
}

// ─── FAQ (Section 11) ──────────────────────────────────────────────────────────

const FAQS = [
  { q: 'Do I need new hardware?', a: 'No. Taproot works on any iPad, Android tablet, or laptop. If you have a device, you have a POS.' },
  { q: 'Can I import my menu from Toast or Square?', a: 'Yes. Upload your menu as a PDF or CSV and Taproot imports it automatically. Or use our migration wizard to pull directly from your old system.' },
  { q: 'What happens to my data if I cancel?', a: "It's yours. Always. Export everything in one click — orders, customers, products, reports. We never hold your data hostage." },
  { q: 'Is there a setup fee?', a: 'No. No setup fee. No onboarding fee. No implementation consultant. Just sign up and go.' },
  { q: 'Are there any fees beyond $99/month?', a: 'Three third-party pass-through costs exist: Stripe processing (2.7% + $0.05 per card transaction), sales tax (remitted to your tax authority), and AI features (included up to fair use limits). None of these go to Taproot.' },
  { q: 'Will my price ever go up?', a: "Only with US inflation — and only by that exact amount. If inflation is 3% in a year, your $99 becomes about $101.97. That's the legal maximum we can ever charge. No arbitrary increases, no surprise fees, and 90 days notice before any change." },
  { q: 'What if I need help?', a: 'We answer. Email, chat, or call. Especially on Friday nights when things get real.' },
  { q: 'Can I use my own payment processor?', a: "Taproot uses Stripe Connect. You keep your own Stripe account and your own processing rates. We don't take a cut of your transactions." },
  { q: 'How long does setup actually take?', a: '10 minutes if you have your menu as a PDF. Upload it, Taproot imports every item, connect Stripe, add your employees, done.' },
];

function FAQ() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="bg-white py-20 sm:py-24">
      <div className="max-w-2xl mx-auto px-4 sm:px-6">
        <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 text-center mb-10">Questions we hear a lot</h2>
        <div className="divide-y divide-gray-100 border-y border-gray-100">
          {FAQS.map((f, i) => (
            <div key={f.q}>
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="w-full flex items-center justify-between gap-4 py-4 text-left"
                aria-expanded={open === i}
              >
                <span className="font-semibold text-gray-900">{f.q}</span>
                <ChevronDown size={18} className={clsx('shrink-0 text-gray-400 transition-transform', open === i && 'rotate-180')} />
              </button>
              {open === i && <p className="text-gray-500 leading-relaxed pb-4 -mt-1">{f.a}</p>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Closing CTA (Section 12) ──────────────────────────────────────────────────

function Closing() {
  return (
    <section className="bg-primary py-20 sm:py-24">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 text-center">
        <h2 className="text-3xl sm:text-4xl font-extrabold text-white leading-tight">
          Your restaurant deserves better than being ignored.
        </h2>
        <div className="text-white/90 mt-6 space-y-4 leading-relaxed">
          <p>Toast built a great product for large restaurants. We built Taproot for everyone else. The food trucks. The neighborhood cafes. The family restaurants that have been running for 20 years and just need something that works.</p>
          <p>No contract. No surprises. No being treated like you're too small to matter.</p>
          <p className="font-semibold">You're not too small. You're exactly who we built this for.</p>
        </div>
        <Link to="/register" className="inline-flex items-center gap-2 mt-8 bg-white text-gray-900 font-bold rounded-lg px-7 py-4 text-base hover:bg-gray-50 transition-colors">
          Start your free trial <ArrowRight size={18} />
        </Link>
        <p className="text-white/80 text-sm mt-4">No credit card. 10-minute setup. Cancel anytime.</p>
      </div>
    </section>
  );
}

// ─── Footer (Section 13) ───────────────────────────────────────────────────────

const FOOTER_COLS = [
  { title: 'Product', links: ['Features', 'Pricing', 'Demo', 'Changelog'] },
  { title: 'Company', links: ['About', 'Blog', 'Press', 'Careers'] },
  { title: 'Support', links: ['Help Center', 'Contact', 'Status', 'Security'] },
  { title: 'Legal', links: ['Privacy Policy', 'Terms of Service', 'Cookie Policy'] },
];

function Footer() {
  return (
    <footer className="bg-[#111827] text-gray-300 py-14">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-1">
            <Logo light />
            <p className="text-sm text-gray-400 mt-3 max-w-[14rem]">The POS built for independent restaurants.</p>
          </div>
          {FOOTER_COLS.map((col) => (
            <div key={col.title}>
              <h4 className="text-sm font-semibold text-white mb-3">{col.title}</h4>
              <ul className="space-y-2">
                {col.links.map((l) => (
                  <li key={l}><span className="text-sm text-gray-400 hover:text-white transition-colors cursor-pointer">{l}</span></li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="border-t border-white/10 mt-12 pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-gray-500">© 2026 Taproot POS. All rights reserved.</p>
          <div className="flex items-center gap-4 text-gray-400">
            <span className="hover:text-white transition-colors cursor-pointer" aria-label="Twitter"><Twitter size={18} /></span>
            <span className="hover:text-white transition-colors cursor-pointer" aria-label="LinkedIn"><Linkedin size={18} /></span>
            <span className="hover:text-white transition-colors cursor-pointer" aria-label="Instagram"><Instagram size={18} /></span>
          </div>
        </div>
      </div>
    </footer>
  );
}

// ─── Demo modal ────────────────────────────────────────────────────────────────

function DemoModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl overflow-hidden w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <span className="font-semibold text-gray-900">Taproot — 60-second demo</span>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100 text-gray-500" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="aspect-video bg-[#111827] flex flex-col items-center justify-center text-center text-white px-6">
          <Play size={40} className="text-primary mb-3" />
          <p className="font-semibold">Demo video coming soon.</p>
          <p className="text-sm text-gray-400 mt-1">In the meantime, try the live demo with the credentials on the sign-in page.</p>
          <Link to="/login" onClick={onClose} className="mt-4 bg-primary text-white text-sm font-semibold rounded-lg px-4 py-2 hover:bg-primary-dark transition-colors">Open live demo</Link>
        </div>
      </div>
    </div>
  );
}

// ─── Platforms (Section 11.5) ──────────────────────────────────────────────────

const PLATFORM_BADGES = [
  { icon: Smartphone, label: 'iOS & iPad' },
  { icon: Tablet, label: 'Android' },
  { icon: Monitor, label: 'Mac & Windows' },
  { icon: Globe, label: 'Web Browser' },
];

function Platforms() {
  return (
    <section className="bg-[#F9FAFB] py-20 sm:py-24">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
        <Eyebrow>Works everywhere</Eyebrow>
        <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900">Available on every device</h2>
        <p className="text-gray-500 mt-3">iOS · Android · Mac · Windows · Browser</p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-4 sm:gap-6">
          {PLATFORM_BADGES.map((b) => {
            const Icon = b.icon;
            return (
              <div key={b.label} className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm">
                <Icon size={20} className="text-primary" />
                <span className="text-sm font-semibold text-gray-700">{b.label}</span>
              </div>
            );
          })}
        </div>

        <Link
          to="/download"
          className="inline-flex items-center justify-center gap-2 mt-10 bg-primary hover:bg-primary-dark text-white font-semibold rounded-lg px-6 py-3.5 text-base transition-colors active:scale-[0.99]"
        >
          Download Taproot <ArrowRight size={18} />
        </Link>
      </div>
    </section>
  );
}

// ─── Support band ──────────────────────────────────────────────────────────────

function SupportBand() {
  return (
    <section className="bg-[#E1F5EE] py-16">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
        <span className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/15 text-primary mb-4">
          <Headphones size={24} />
        </span>
        <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900">Support that actually shows up</h2>
        <p className="text-gray-600 mt-3 leading-relaxed">
          Every Taproot subscription includes direct access to the founder. Real answers within
          2 hours during service. Under 30 minutes for emergencies. No ticket queue. No scripts. No upsells.
        </p>
        <Link
          to="/support"
          className="inline-flex items-center gap-2 mt-6 text-primary font-semibold hover:text-primary-dark transition-colors"
        >
          Learn more about support <ArrowRight size={18} />
        </Link>
      </div>
    </section>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function LandingPage() {
  const [demo, setDemo] = useState(false);
  return (
    <div className="h-screen overflow-y-auto bg-white" style={{ fontFamily: SYSTEM_FONT }}>
      <PlatformDetect variant="banner" />
      <Nav />
      <Hero onDemo={() => setDemo(true)} />
      <Origin />
      <Pain />
      <Features />
      <AIFeatures />
      <Comparison />
      <Pricing />
      <PricePromise />
      <SavingsCalculator />
      <FAQ />
      <Platforms />
      <SupportBand />
      <Closing />
      <Footer />
      {demo && <DemoModal onClose={() => setDemo(false)} />}
    </div>
  );
}

export default LandingPage;
