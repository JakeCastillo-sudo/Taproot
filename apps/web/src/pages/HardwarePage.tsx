/**
 * HardwarePage — /hardware (public, no auth).
 *
 * Hardware recommendations: starter kit, full-service kit, shop-by-category,
 * partner pricing, compatibility check, FAQ. No markup, no lock-in — links go
 * to Amazon/Stripe directly (placeholder search links for now).
 *
 * Visual language matches the S10 landing page (system font, Taproot green).
 * Page owns its scroll (h-screen overflow-y-auto — PWA shell convention).
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Leaf, ArrowRight, Check, ChevronDown, Printer, CreditCard,
  Banknote, TabletSmartphone, Monitor, ScrollText, Mail, ExternalLink,
} from 'lucide-react';
import { clsx } from 'clsx';

const SYSTEM_FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

// ─── Data ─────────────────────────────────────────────────────────────────────

interface HardwareItem {
  name: string;
  model: string;
  price: string;
  why: string;
  link: string;
  linkLabel: string;
}

const amazon = (q: string) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}`;

const STARTER_KIT: HardwareItem[] = [
  {
    name: 'Receipt Printer',
    model: 'Epson TM-T20IV',
    price: '$229–279',
    why: 'The best balance of speed and reliability for restaurant receipt printing. 310mm/s print speed. Energy Star certified.',
    link: amazon('Epson TM-T20IV receipt printer'),
    linkLabel: 'View on Amazon',
  },
  {
    name: 'Payment Terminal',
    model: 'Stripe WisePOS E',
    price: '$249 (from Stripe directly)',
    why: 'Native Stripe integration — no configuration needed. Works immediately with Taproot payments. Chip, tap, and swipe.',
    link: 'https://stripe.com/terminal',
    linkLabel: 'View on Stripe',
  },
  {
    name: 'Cash Drawer',
    model: 'APG Vasario',
    price: '$99–129',
    why: 'Industry standard cash drawer. Connects to your receipt printer — opens automatically after every cash sale.',
    link: amazon('APG Vasario cash drawer'),
    linkLabel: 'View on Amazon',
  },
  {
    name: 'iPad Stand',
    model: 'Heckler Design WindFall',
    price: '$149–199',
    why: 'The best iPad stand for counter service. Secure, adjustable, and looks professional.',
    link: amazon('Heckler Design WindFall iPad stand'),
    linkLabel: 'View on Amazon',
  },
];

const FULL_SERVICE_KIT: HardwareItem[] = [
  {
    name: 'Receipt Printer',
    model: 'Star TSP143IIIU',
    price: '$249–299',
    why: 'Gold standard for iPad-based POS. Unmatched reliability. 5+ year lifespan.',
    link: amazon('Star TSP143IIIU receipt printer'),
    linkLabel: 'View on Amazon',
  },
  {
    name: 'Kitchen Printer',
    model: 'Epson TM-T20III',
    price: '$199–249',
    why: 'Ethernet-connected kitchen printer. Fast, quiet, and durable in hot environments.',
    link: amazon('Epson TM-T20III ethernet kitchen printer'),
    linkLabel: 'View on Amazon',
  },
  {
    name: 'Tableside Terminal',
    model: 'Stripe WisePad 3',
    price: '$59',
    why: "Handheld Bluetooth card reader. Bring the payment to the customer's table.",
    link: 'https://stripe.com/terminal',
    linkLabel: 'View on Stripe',
  },
  {
    name: 'KDS Screen',
    model: 'Amazon Fire HD 10',
    price: '$149',
    why: "Run Taproot's Kitchen Display at your cook station. Mount on wall with $29 bracket.",
    link: amazon('Amazon Fire HD 10 tablet'),
    linkLabel: 'View on Amazon',
  },
];

const CATEGORIES = [
  { label: 'Receipt Printers',  icon: Printer,          q: 'thermal receipt printer ESC/POS' },
  { label: 'Kitchen Printers',  icon: ScrollText,       q: 'kitchen impact printer ethernet' },
  { label: 'Payment Terminals', icon: CreditCard,       q: 'Stripe terminal card reader' },
  { label: 'Cash Drawers',      icon: Banknote,         q: 'POS cash drawer printer driven' },
  { label: 'iPad Stands',       icon: TabletSmartphone, q: 'iPad POS stand counter mount' },
  { label: 'Thermal Paper',     icon: Monitor,          q: '80mm thermal receipt paper rolls' },
];

const FAQS: Array<[string, React.ReactNode]> = [
  [
    'Do I need hardware to use Taproot?',
    <>No. Taproot works on any iPad, Android tablet, or laptop you already own. Hardware adds convenience — it&apos;s never required.</>,
  ],
  [
    'Who handles hardware support?',
    <>
      The manufacturer directly. We help you set everything up and troubleshoot.
      <br />Epson support: <a href="tel:1-800-463-7766" className="text-primary hover:underline">1-800-463-7766</a>
      <br />Star support: <a href="tel:1-800-782-7636" className="text-primary hover:underline">1-800-782-7636</a>
    </>,
  ],
  [
    'Can I use hardware from my old POS system?',
    <>Often yes. Most ESC/POS thermal printers work with Taproot. Contact us to verify your specific model.</>,
  ],
  [
    'What if my hardware breaks?',
    <>Buy a replacement from Amazon or Best Buy. No proprietary parts. No waiting for a service technician. No mandatory contracts.</>,
  ],
];

// ─── Small pieces ─────────────────────────────────────────────────────────────

function ProductCard({ item }: { item: HardwareItem }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{item.name}</p>
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide bg-primary-light text-primary-dark px-2 py-0.5 rounded-full">
          Our pick
        </span>
      </div>
      <h3 className="mt-1 text-lg font-bold text-gray-900">{item.model}</h3>
      <p className="text-sm font-semibold text-primary-dark mt-0.5">{item.price}</p>
      <p className="mt-3 text-sm text-gray-500 leading-relaxed flex-1">{item.why}</p>
      <a
        href={item.link}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-flex items-center justify-center gap-1.5 border border-gray-200 text-gray-700 text-sm font-semibold rounded-lg px-4 py-2.5 hover:bg-gray-50 transition-colors"
      >
        {item.linkLabel} <ExternalLink size={13} />
      </a>
      <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-green-700">
        <Check size={13} className="text-green-600" /> Works with Taproot
      </p>
    </div>
  );
}

function KitSection({ title, subtitle, items, alt }: {
  title: string; subtitle: string; items: HardwareItem[]; alt?: boolean;
}) {
  return (
    <section className={clsx('py-16 sm:py-20', alt ? 'bg-[#F9FAFB]' : 'bg-white')}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900">{title}</h2>
        <p className="mt-2 text-gray-500">{subtitle}</p>
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {items.map((item) => <ProductCard key={item.model} item={item} />)}
        </div>
      </div>
    </section>
  );
}

function FaqRow({ q, a }: { q: string; a: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-gray-100">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-4 py-4 text-left"
      >
        <span className="text-sm sm:text-base font-semibold text-gray-900">{q}</span>
        <ChevronDown size={18} className={clsx('shrink-0 text-gray-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="pb-4 text-sm text-gray-500 leading-relaxed">{a}</div>}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function HardwarePage() {
  return (
    <div className="h-screen overflow-y-auto bg-white" style={{ fontFamily: SYSTEM_FONT }}>

      {/* ── Nav ── */}
      <nav className="sticky top-0 z-50 bg-white shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link to="/" aria-label="Taproot home" className="inline-flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary">
              <Leaf size={18} className="text-white" />
            </span>
            <span className="text-lg font-bold tracking-tight text-gray-900">Taproot</span>
          </Link>
          <div className="flex items-center gap-4 sm:gap-6">
            <Link to="/login" className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">Sign in</Link>
            <Link to="/register" className="text-sm font-semibold text-white bg-primary hover:bg-primary-dark px-4 py-2 rounded-lg transition-colors">
              Start free trial
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Header ── */}
      <header className="bg-[#F9FAFB] py-16 sm:py-20 text-center">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-gray-900 leading-tight">
            Hardware that works with Taproot
          </h1>
          <p className="mt-4 text-lg text-gray-500">
            Recommended by us. Bought by you. No markup. No lock-in.
          </p>
          <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-gray-500">
            <Check size={15} className="text-primary" />
            We&apos;ve tested every recommendation in real restaurant environments.
          </p>
        </div>
      </header>

      {/* ── Starter kit ── */}
      <KitSection
        title="Starter Kit — $750–900"
        subtitle="Perfect for food trucks and counter service restaurants"
        items={STARTER_KIT}
      />

      {/* ── Full service kit ── */}
      <KitSection
        title="Full Service Kit — $2,200–2,600"
        subtitle="For sit-down restaurants with table service"
        items={FULL_SERVICE_KIT}
        alt
      />

      {/* ── Shop by category ── */}
      <section className="py-16 sm:py-20 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900">Shop by category</h2>
          <div className="mt-8 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {CATEGORIES.map(({ label, icon: Icon, q }) => (
              <a
                key={label}
                href={amazon(q)}
                target="_blank"
                rel="noopener noreferrer"
                className="group bg-white rounded-2xl border border-gray-100 shadow-sm p-5 text-center hover:border-primary/40 hover:shadow transition-all"
              >
                <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-primary-light text-primary-dark mb-3">
                  <Icon size={20} />
                </span>
                <p className="text-sm font-semibold text-gray-800 group-hover:text-primary transition-colors">{label}</p>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* ── Partner discount ── */}
      <section className="py-16 sm:py-20 bg-[#F9FAFB]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <div className="bg-primary rounded-2xl p-8 sm:p-10 text-center text-white shadow-lg">
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Taproot partner pricing</h2>
            <p className="mt-4 text-white/90 leading-relaxed">
              As a Taproot customer you get access to partner pricing on Star Micronics and Epson
              hardware — the same discount our most valued resellers receive.
            </p>
            <p className="mt-3 text-white/90 leading-relaxed">
              Email us with your Taproot account email and we&apos;ll send your discount code within 24 hours.
            </p>
            <a
              href="mailto:hardware@taproot-pos.com?subject=Partner%20pricing%20request"
              className="mt-7 inline-flex items-center gap-2 bg-white text-primary-dark font-semibold rounded-lg px-6 py-3 hover:bg-primary-light transition-colors"
            >
              Get my discount <ArrowRight size={16} />
            </a>
          </div>
        </div>
      </section>

      {/* ── Compatibility ── */}
      <section className="py-16 sm:py-20 bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900">
            Will my existing printer work?
          </h2>
          <p className="mt-4 text-gray-500 leading-relaxed">
            Most ESC/POS thermal printers work with Taproot out of the box. If you already have an
            Epson or Star printer from another POS system, it will likely work.
          </p>
          <p className="mt-3 text-gray-500">
            Not sure? Email us your printer model and we&apos;ll tell you in minutes.
          </p>
          <a
            href="mailto:hardware@taproot-pos.com?subject=Printer%20compatibility%20check"
            className="mt-7 inline-flex items-center gap-2 border border-gray-300 text-gray-700 font-semibold rounded-lg px-6 py-3 hover:bg-gray-50 transition-colors"
          >
            <Mail size={16} /> Check my printer
          </a>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="py-16 sm:py-20 bg-[#F9FAFB]">
        <div className="max-w-2xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900 text-center">
            Hardware questions
          </h2>
          <div className="mt-8 bg-white rounded-2xl border border-gray-100 shadow-sm px-5 sm:px-6 py-2">
            {FAQS.map(([q, a]) => <FaqRow key={q} q={q} a={a} />)}
          </div>
        </div>
      </section>

      {/* ── Footer CTA ── */}
      <footer className="py-14 bg-white border-t border-gray-100 text-center">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <p className="text-gray-500">Ready to set up your restaurant?</p>
          <Link
            to="/register"
            className="mt-4 inline-flex items-center gap-2 bg-primary hover:bg-primary-dark text-white font-semibold rounded-lg px-6 py-3.5 transition-colors"
          >
            Start free for 14 days <ArrowRight size={16} />
          </Link>
          <p className="mt-8 text-xs text-gray-400">
            © {new Date().getFullYear()} Taproot POS ·{' '}
            <Link to="/" className="hover:underline">Home</Link> ·{' '}
            <Link to="/privacy" className="hover:underline">Privacy</Link> ·{' '}
            <Link to="/terms" className="hover:underline">Terms</Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
