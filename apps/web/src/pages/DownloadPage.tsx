/**
 * DownloadPage (/download) — public, no auth.
 *
 * Shows every way to run Taproot: a highlighted card auto-detected for the
 * visitor's device (usePlatform), a 2×2 grid of all platforms, a web/browser
 * section, a hardware pointer, and a short FAQ. Native store links show
 * "Coming soon" until APP_STORE_LIVE / PLAY_STORE_LIVE flip true.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Leaf, Smartphone, Tablet, Monitor, Globe, Download as DownloadIcon,
  ChevronDown, ArrowRight, Check,
} from 'lucide-react';
import { clsx } from 'clsx';
import { usePlatform, type PlatformOS } from '../hooks/usePlatform';
import {
  PlatformDetect, STORE_URLS, APP_STORE_LIVE, PLAY_STORE_LIVE,
} from '../components/PlatformDetect';

const SYSTEM_FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

interface PlatformCard {
  os: PlatformOS;
  icon: typeof Smartphone;
  title: string;
  desc: string;
  requirement: string;
  cta: string;
  href: string;
  comingSoon: boolean;
}

const PLATFORMS: PlatformCard[] = [
  {
    os: 'ios',
    icon: Smartphone,
    title: 'iPhone & iPad',
    desc: 'Full POS, Stripe Terminal, push notifications, offline mode',
    requirement: 'Requires iOS 16+',
    cta: 'Download on the App Store',
    href: STORE_URLS['app-store'],
    comingSoon: !APP_STORE_LIVE,
  },
  {
    os: 'android',
    icon: Tablet,
    title: 'Android Phone & Tablet',
    desc: 'Full POS, Google Pay, offline mode, kitchen display',
    requirement: 'Requires Android 11+',
    cta: 'Get it on Google Play',
    href: STORE_URLS['play-store'],
    comingSoon: !PLAY_STORE_LIVE,
  },
  {
    os: 'macos',
    icon: Monitor,
    title: 'Mac',
    desc: 'Native USB printing, cash drawer, barcode scanner, auto-launch',
    requirement: 'Requires macOS 11+ (Apple Silicon & Intel)',
    cta: 'Download for Mac',
    href: STORE_URLS['desktop-mac'],
    comingSoon: false,
  },
  {
    os: 'windows',
    icon: Monitor,
    title: 'Windows PC',
    desc: 'Native USB printing, cash drawer, barcode scanner, auto-launch',
    requirement: 'Requires Windows 10+',
    cta: 'Download for Windows',
    href: STORE_URLS['desktop-win'],
    comingSoon: false,
  },
];

const FAQS = [
  {
    q: 'Which version should I use?',
    a: 'iPad/iPhone → App Store. Android → Play Store. Mac or Windows office computer → Desktop app. Or just use taproot-pos.com in any browser.',
  },
  {
    q: 'Is the app free to download?',
    a: 'Yes. Requires a Taproot subscription ($99/month). 14-day free trial at taproot-pos.com.',
  },
  {
    q: 'Does the desktop app work with my USB printer?',
    a: 'Yes. The Mac and Windows desktop apps connect directly to Epson and Star Micronics USB printers and cash drawers — no network setup required.',
  },
  {
    q: 'How do updates work?',
    a: 'Mobile apps update through App Store / Play Store. Desktop app updates automatically in the background. The web app always runs the latest version.',
  },
];

function PlatformGridCard({ card, highlighted = false }: { card: PlatformCard; highlighted?: boolean }) {
  const Icon = card.icon;
  return (
    <div
      className={clsx(
        'bg-white rounded-2xl p-6 flex flex-col',
        highlighted ? 'border-2 border-primary shadow-md' : 'border border-gray-200 shadow-sm',
      )}
    >
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-primary-light flex items-center justify-center shrink-0">
          <Icon size={24} className="text-primary" />
        </div>
        <h3 className="text-lg font-bold text-gray-900">{card.title}</h3>
      </div>
      <p className="text-sm text-gray-500 mt-3 leading-relaxed flex-1">{card.desc}</p>
      <p className="text-xs text-gray-400 mt-3">{card.requirement}</p>
      {card.comingSoon ? (
        <span className="mt-4 inline-flex items-center justify-center text-sm font-semibold text-gray-500 bg-gray-100 rounded-lg px-4 py-2.5">
          Coming soon
        </span>
      ) : (
        <a
          href={card.href}
          className="mt-4 inline-flex items-center justify-center gap-2 bg-primary hover:bg-primary-dark text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
        >
          <DownloadIcon size={15} /> {card.cta} →
        </a>
      )}
    </div>
  );
}

export function DownloadPage() {
  const { os } = usePlatform();
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  return (
    <div className="h-screen overflow-y-auto bg-[#F3F4F6]" style={{ fontFamily: SYSTEM_FONT }}>
      {/* Top bar */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-2" aria-label="Taproot home">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary">
              <Leaf size={18} className="text-white" />
            </span>
            <span className="text-lg font-bold tracking-tight text-gray-900">Taproot</span>
          </Link>
          <Link to="/login" className="text-sm font-semibold text-primary hover:underline">Sign in →</Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-3xl sm:text-4xl font-extrabold text-gray-900">Download Taproot POS</h1>
          <p className="mt-3 text-lg text-gray-500">Available on every device your restaurant runs on.</p>
        </div>

        {/* Auto-detected (highlighted) */}
        <section className="mt-10 max-w-md mx-auto">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-primary text-center mb-3">
            Recommended for your device
          </p>
          <PlatformDetect variant="card" />
        </section>

        {/* All platforms grid */}
        <section className="mt-14">
          <h2 className="text-xl font-bold text-gray-900 text-center mb-6">All platforms</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            {PLATFORMS.map((card) => (
              <PlatformGridCard key={card.os} card={card} highlighted={card.os === os} />
            ))}
          </div>
        </section>

        {/* Web section */}
        <section className="mt-12 bg-white rounded-2xl border border-gray-200 shadow-sm p-7 text-center">
          <div className="w-12 h-12 rounded-xl bg-primary-light flex items-center justify-center mx-auto mb-4">
            <Globe size={24} className="text-primary" />
          </div>
          <h2 className="text-xl font-bold text-gray-900">Already have Taproot? Use it anywhere.</h2>
          <p className="text-sm text-gray-500 mt-2">Works in Chrome, Safari, Edge, Firefox.</p>
          <a
            href="https://taproot-pos.com/login"
            className="mt-5 inline-flex items-center gap-2 bg-primary hover:bg-primary-dark text-white font-semibold rounded-lg px-5 py-3 text-sm transition-colors"
          >
            Sign in at taproot-pos.com <ArrowRight size={16} />
          </a>
        </section>

        {/* Hardware section */}
        <section className="mt-8 bg-white rounded-2xl border border-gray-200 shadow-sm p-7 text-center">
          <h2 className="text-xl font-bold text-gray-900">Need hardware? See our recommendations.</h2>
          <Link
            to="/hardware"
            className="mt-4 inline-flex items-center gap-2 border border-gray-300 text-gray-700 font-semibold rounded-lg px-5 py-3 text-sm hover:bg-gray-50 transition-colors"
          >
            View Hardware Guide <ArrowRight size={16} />
          </Link>
        </section>

        {/* FAQ */}
        <section className="mt-12 max-w-2xl mx-auto">
          <h2 className="text-2xl font-extrabold text-gray-900 text-center mb-8">Frequently asked</h2>
          <div className="divide-y divide-gray-200 border-y border-gray-200 bg-white rounded-lg">
            {FAQS.map((f, i) => (
              <div key={f.q} className="px-5">
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between gap-4 py-4 text-left"
                  aria-expanded={openFaq === i}
                >
                  <span className="font-semibold text-gray-900">{f.q}</span>
                  <ChevronDown
                    size={18}
                    className={clsx('shrink-0 text-gray-400 transition-transform', openFaq === i && 'rotate-180')}
                  />
                </button>
                {openFaq === i && (
                  <p className="text-gray-500 leading-relaxed pb-4 -mt-1 flex items-start gap-2">
                    <Check size={16} className="text-primary shrink-0 mt-0.5" />
                    <span>{f.a}</span>
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>

        <p className="text-center text-xs text-gray-400 mt-12">
          © {new Date().getFullYear()} Taproot POS ·{' '}
          <Link to="/privacy" className="hover:underline">Privacy</Link>{' '}·{' '}
          <Link to="/terms" className="hover:underline">Terms</Link>
        </p>
      </main>
    </div>
  );
}

export default DownloadPage;
