import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export function TermsPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-white">
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
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Terms of Service</h1>
        <p className="text-sm text-gray-400 mb-8">Last updated: June 1, 2026</p>

        <div className="prose prose-sm max-w-none text-gray-700 space-y-6">

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">1. Acceptance of Terms</h2>
            <p className="leading-relaxed">
              By accessing or using Taproot POS (&ldquo;Service&rdquo;), you agree to be bound
              by these Terms of Service (&ldquo;Terms&rdquo;). If you are using the Service on
              behalf of a business, you represent that you have authority to bind that business
              to these Terms.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">2. Description of Service</h2>
            <p className="leading-relaxed">
              Taproot POS provides cloud-based point-of-sale software including order management,
              payment processing, inventory management, customer loyalty, and reporting tools.
              The Service is provided on a subscription basis.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">3. Subscriptions & Billing</h2>
            <ul className="list-disc pl-5 space-y-1 leading-relaxed">
              <li>Subscriptions are billed monthly at $199 per location.</li>
              <li>New accounts receive a 14-day free trial (30 days for qualifying referral partners).</li>
              <li>You may cancel your subscription at any time. Access continues through the end of the current billing period.</li>
              <li>Refunds are available within 30 days of the first charge if you are unsatisfied.</li>
              <li>We reserve the right to change pricing with 30 days&apos; notice.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">4. Payment Processing</h2>
            <p className="leading-relaxed">
              Payment processing is provided through Stripe. By using Taproot&apos;s payment
              features, you agree to{' '}
              <a
                href="https://stripe.com/legal"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Stripe&apos;s Terms of Service
              </a>
              . Taproot acts as a technology intermediary and is not a party to payment
              transactions between you and your customers.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">5. Acceptable Use</h2>
            <p className="leading-relaxed mb-2">You agree not to:</p>
            <ul className="list-disc pl-5 space-y-1 leading-relaxed">
              <li>Use the Service for any unlawful purpose</li>
              <li>Attempt to gain unauthorized access to any part of the Service</li>
              <li>Reverse engineer, decompile, or disassemble the software</li>
              <li>Use the Service to process transactions for prohibited business types as defined by Stripe</li>
              <li>Share account credentials or resell access to the Service</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">6. Data Ownership</h2>
            <p className="leading-relaxed">
              You retain ownership of all data you input into the Service, including your product
              catalog, customer data, and transaction records. We do not claim any ownership over
              your business data. You may export your data at any time. Upon account termination,
              you may request a data export within 60 days.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">7. Service Availability</h2>
            <p className="leading-relaxed">
              We strive for 99.9% uptime but do not guarantee uninterrupted availability. The
              Service may be temporarily unavailable for maintenance. Taproot provides offline
              payment capability for periods of internet disruption.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">8. Limitation of Liability</h2>
            <p className="leading-relaxed">
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, TAPROOT SHALL NOT BE LIABLE FOR ANY
              INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES. OUR TOTAL
              LIABILITY SHALL NOT EXCEED THE AMOUNT PAID BY YOU IN THE 12 MONTHS PRECEDING
              THE CLAIM.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">9. Termination</h2>
            <p className="leading-relaxed">
              Either party may terminate these Terms at any time. We may suspend or terminate
              your account immediately if you violate these Terms. Upon termination, your right
              to use the Service ceases.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">10. Governing Law</h2>
            <p className="leading-relaxed">
              These Terms are governed by the laws of the State of Delaware, without regard to
              conflict of law provisions. Disputes shall be resolved by binding arbitration in
              accordance with AAA Commercial Arbitration Rules.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">11. Contact</h2>
            <p className="leading-relaxed">
              Questions about these Terms? Contact us at{' '}
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
