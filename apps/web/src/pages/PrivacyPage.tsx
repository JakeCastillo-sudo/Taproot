import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export function PrivacyPage() {
  const navigate = useNavigate();

  return (
    <div className="h-screen overflow-y-auto bg-white">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-gray-100">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-primary flex items-center justify-center">
              <span className="text-white text-xs font-bold">T</span>
            </div>
            <span className="font-semibold text-gray-900 text-sm">Taproot POS</span>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-10">
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Privacy Policy</h1>
        <p className="text-sm text-gray-400 mb-8">Last updated: June 1, 2026</p>

        <div className="prose prose-sm max-w-none text-gray-700 space-y-6">

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">1. Introduction</h2>
            <p className="leading-relaxed">
              Taproot POS (&ldquo;Taproot,&rdquo; &ldquo;we,&rdquo; &ldquo;our,&rdquo; or &ldquo;us&rdquo;)
              is committed to protecting the privacy of the businesses and individuals who use our
              point-of-sale software (&ldquo;Service&rdquo;). This Privacy Policy explains how we
              collect, use, disclose, and safeguard information when you use Taproot.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">2. Information We Collect</h2>
            <p className="leading-relaxed mb-2">We collect information you provide directly to us, including:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Business name, email address, and contact information during registration</li>
              <li>Payment method information (processed and stored securely by Stripe — we never store raw card numbers)</li>
              <li>Order and transaction data generated through use of the Service</li>
              <li>Employee account information (names, emails, roles)</li>
              <li>Customer data you enter, such as names, emails, and loyalty information</li>
            </ul>
            <p className="leading-relaxed mt-2">
              We also automatically collect certain technical information such as IP addresses,
              browser type, device identifiers, and usage data through our analytics service
              (Plausible Analytics — a privacy-respecting, cookie-free analytics provider).
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">3. How We Use Your Information</h2>
            <ul className="list-disc pl-5 space-y-1 leading-relaxed">
              <li>To provide, maintain, and improve the Service</li>
              <li>To process payments and manage your subscription</li>
              <li>To send transactional emails (receipts, account notices, subscription alerts)</li>
              <li>To monitor for security incidents and prevent fraud</li>
              <li>To comply with legal obligations</li>
            </ul>
            <p className="mt-2 leading-relaxed">
              We do <strong>not</strong> sell your data or your customers&apos; data to third parties.
              We do not use your transaction data for advertising purposes.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">4. Data Sharing</h2>
            <p className="leading-relaxed mb-2">We share data only with:</p>
            <ul className="list-disc pl-5 space-y-1 leading-relaxed">
              <li><strong>Stripe</strong> — payment processing and subscription billing</li>
              <li><strong>Anthropic</strong> — AI-powered document parsing (menu imports); your menu data is sent to Claude for classification only</li>
              <li><strong>SendGrid</strong> — transactional email delivery</li>
              <li><strong>Sentry</strong> — anonymized error reporting (request bodies are never sent)</li>
              <li><strong>AWS</strong> — cloud infrastructure hosting</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">5. Data Retention</h2>
            <p className="leading-relaxed">
              We retain account and transaction data for the duration of your subscription plus
              7 years, as required for financial record-keeping. You may request deletion of
              your account at any time by contacting{' '}
              <a href="mailto:support@taprootpos.com" className="text-primary hover:underline">
                support@taprootpos.com
              </a>
              . Deletion requests are processed within 30 days.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">6. Security</h2>
            <p className="leading-relaxed">
              We use industry-standard security measures including TLS encryption in transit,
              AES-256 encryption at rest, and strict access controls. Payment card data is
              never stored on Taproot servers — all card processing is handled by Stripe.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">7. Your Rights (GDPR / CCPA)</h2>
            <p className="leading-relaxed mb-2">
              Depending on your jurisdiction, you may have the right to:
            </p>
            <ul className="list-disc pl-5 space-y-1 leading-relaxed">
              <li>Access the personal data we hold about you</li>
              <li>Correct inaccurate data</li>
              <li>Request deletion of your data (&ldquo;right to be forgotten&rdquo;)</li>
              <li>Object to or restrict certain processing</li>
              <li>Data portability — receive your data in a machine-readable format</li>
            </ul>
            <p className="mt-2 leading-relaxed">
              To exercise these rights, email us at{' '}
              <a href="mailto:support@taprootpos.com" className="text-primary hover:underline">
                support@taprootpos.com
              </a>.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">8. Contact</h2>
            <p className="leading-relaxed">
              If you have questions about this Privacy Policy, please contact us at{' '}
              <a href="mailto:support@taprootpos.com" className="text-primary hover:underline">
                support@taprootpos.com
              </a>.
            </p>
          </section>

        </div>
      </div>
    </div>
  );
}
