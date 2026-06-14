import { Link } from 'react-router-dom';
import { Leaf, Clock, AlertTriangle, Mail, MessageCircle, Infinity as InfinityIcon, ArrowRight } from 'lucide-react';

/**
 * SupportPage — public (logged in or out) at /support.
 * Honest, founder-led support story. Warm, human, no corporate-policy tone.
 */
const SUPPORT_EMAIL = 'support@taproot-pos.com';

const HOURS = [
  {
    icon: Clock,
    tone: 'text-primary bg-primary/10',
    title: 'During service hours',
    sub: '11am–10pm, any timezone',
    response: 'Within 2 hours',
    body: 'If your POS is down during service, this is treated as an emergency. I will drop what I’m doing.',
  },
  {
    icon: MessageCircle,
    tone: 'text-gray-700 bg-gray-100',
    title: 'Outside service hours',
    sub: 'Mornings, afternoons, evenings',
    response: 'Within 8 hours',
    body: 'I check messages in the morning, afternoon, and evening. You won’t wait until the next day.',
  },
  {
    icon: AlertTriangle,
    tone: 'text-amber-600 bg-amber-100',
    title: 'Critical — POS completely down',
    sub: 'Mark the subject URGENT',
    response: 'Within 30 minutes',
    body: 'Mark your email URGENT in the subject line. I mean it.',
  },
];

const FAQ = [
  {
    q: 'Can I call someone?',
    a: 'Not yet — we’re a small team and phone support doesn’t scale well. Email lets us think carefully about your problem and give you a real answer. We may add scheduled calls for complex setup issues.',
  },
  {
    q: 'What if I need help setting up?',
    a: 'Email us before you start. We’ll walk you through the whole setup — menu import, tax config, employee PINs, Stripe connection. Takes about 30 minutes.',
  },
  {
    q: 'What about after-hours emergencies?',
    a: 'Mark your email URGENT. That goes to my phone. If your POS is down during service, I will answer.',
  },
  {
    q: 'Is the AI helpdesk good?',
    a: 'For how-to questions, yes. It knows Taproot inside and out. For anything account-specific, billing-related, or unusual — email Jake.',
  },
];

export function SupportPage() {
  return (
    <div className="h-screen overflow-y-auto bg-white">
      {/* Top bar */}
      <nav className="border-b border-gray-100">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary">
              <Leaf size={18} className="text-white" />
            </span>
            <span className="font-bold text-gray-900">Taproot POS</span>
          </Link>
          <Link to="/login" className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">Sign in</Link>
        </div>
      </nav>

      {/* Header */}
      <header className="bg-primary text-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-14 text-center">
          <h1 className="text-3xl sm:text-4xl font-extrabold">Support &amp; Help</h1>
          <p className="text-white/85 mt-3 text-lg">We’re here. Real answers. Real fast.</p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12 space-y-14">

        {/* Section 1 — Who answers */}
        <section>
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Who does support at Taproot?</h2>
          <div className="space-y-4 text-gray-600 leading-relaxed">
            <p><strong className="text-gray-900">Right now — Jake Castillo, the founder.</strong></p>
            <p>
              I built Taproot because my wife’s restaurant was treated like an afterthought by their
              POS company. When something broke on a Friday night, nobody answered. I’m changing that.
            </p>
            <p>
              You get my personal attention. Not a ticket queue. Not someone reading from a script.
              Someone who actually cares whether your restaurant runs smoothly.
            </p>
            <p>
              As Taproot grows, every support person we hire will have restaurant experience. We will
              never outsource to someone who doesn’t understand what a Friday dinner rush feels like.
            </p>
          </div>
        </section>

        {/* Section 2 — Hours + response times */}
        <section>
          <h2 className="text-2xl font-bold text-gray-900 mb-5">When can I reach you?</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {HOURS.map((h) => {
              const Icon = h.icon;
              return (
                <div key={h.title} className="rounded-xl border border-gray-100 shadow-sm p-5">
                  <span className={`inline-flex items-center justify-center w-10 h-10 rounded-lg mb-3 ${h.tone}`}>
                    <Icon size={20} />
                  </span>
                  <h3 className="font-semibold text-gray-900 text-sm">{h.title}</h3>
                  <p className="text-xs text-gray-400 mb-2">{h.sub}</p>
                  <p className="text-primary font-bold text-sm">{h.response}</p>
                  <p className="text-sm text-gray-600 mt-2 leading-snug">{h.body}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Section 3 — How to reach us */}
        <section className="rounded-xl bg-[#E1F5EE] p-6 sm:p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-3">How to reach us</h2>
          <a href={`mailto:${SUPPORT_EMAIL}`} className="inline-flex items-center gap-2 text-primary font-semibold text-lg hover:text-primary-dark transition-colors">
            <Mail size={20} /> {SUPPORT_EMAIL}
          </a>
          <div className="mt-4 text-sm text-gray-600 space-y-1">
            <p className="font-medium text-gray-900">Subject line tips:</p>
            <p>• <span className="font-mono">URGENT: [issue]</span> — for anything blocking service</p>
            <p>• <span className="font-mono">[Restaurant name]: [issue]</span> — for faster routing</p>
          </div>
          <p className="text-sm text-gray-600 mt-5 leading-relaxed">
            The <strong className="text-gray-900">AI help button</strong> (bottom right when logged in) can
            answer most how-to questions instantly — menu setup, tax config, employee management. For anything
            it can’t handle, it routes to Jake.
          </p>
        </section>

        {/* Section 4 — Capped or unlimited */}
        <section>
          <div className="flex items-center gap-3 mb-4">
            <span className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 text-primary">
              <InfinityIcon size={20} />
            </span>
            <h2 className="text-2xl font-bold text-gray-900">Is support really unlimited?</h2>
          </div>
          <div className="space-y-4 text-gray-600 leading-relaxed">
            <p>
              <strong className="text-gray-900">Yes.</strong> There is no ticket limit. No “premium support”
              tier. No paying extra for faster responses.
            </p>
            <p>
              Every Taproot subscriber gets the same support — because if your POS is broken, your business
              is broken. That’s not something to upsell.
            </p>
            <p>
              The only thing we ask: be specific about the problem. “It doesn’t work” is hard to fix.
              “The modifier sheet isn’t saving changes on iPad Chrome” is easy to fix.
            </p>
          </div>
        </section>

        {/* Section 5 — FAQ */}
        <section>
          <h2 className="text-2xl font-bold text-gray-900 mb-5">FAQ</h2>
          <div className="space-y-5">
            {FAQ.map((f) => (
              <div key={f.q}>
                <h3 className="font-semibold text-gray-900">{f.q}</h3>
                <p className="text-gray-600 mt-1 leading-relaxed">{f.a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="text-center pb-4">
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="inline-flex items-center gap-2 bg-primary text-white font-semibold rounded-lg px-6 py-3 hover:bg-primary-dark transition-colors"
          >
            Email {SUPPORT_EMAIL} <ArrowRight size={18} />
          </a>
          <p className="mt-6 text-sm text-gray-400">
            <Link to="/" className="hover:underline">← Back to home</Link>
          </p>
        </section>
      </main>
    </div>
  );
}

export default SupportPage;
