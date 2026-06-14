import { useState } from 'react';
import { Link } from 'react-router-dom';
import { HelpCircle, X, Search, ExternalLink, Mail, Bug, LifeBuoy } from 'lucide-react';
import { clsx } from 'clsx';

interface HelpArticle {
  question: string;
  url:      string;
}

const HELP_ARTICLES: HelpArticle[] = [
  { question: 'How do I add products?',         url: 'https://docs.taproot-pos.com/products' },
  { question: 'How do I take a payment?',        url: 'https://docs.taproot-pos.com/payments' },
  { question: 'How do I import my menu?',        url: 'https://docs.taproot-pos.com/import' },
  { question: 'How do I connect Stripe?',        url: 'https://docs.taproot-pos.com/stripe' },
  { question: 'How do I manage inventory?',      url: 'https://docs.taproot-pos.com/inventory' },
  { question: 'How do I set up employees?',      url: 'https://docs.taproot-pos.com/employees' },
];

export function HelpButton() {
  const [open,  setOpen]  = useState(false);
  const [query, setQuery] = useState('');

  const filtered = query.trim()
    ? HELP_ARTICLES.filter((a) =>
        a.question.toLowerCase().includes(query.toLowerCase()),
      )
    : HELP_ARTICLES;

  const bugBody = encodeURIComponent(
    `Describe the bug:\n\n\nSteps to reproduce:\n1. \n2. \n\nExpected behaviour:\n\nActual behaviour:\n\nBrowser/device:\n`,
  );
  const bugUrl = `mailto:support@taproot-pos.com?subject=Bug%20Report%20-%20Taproot%20POS&body=${bugBody}`;

  return (
    <>
      {/* Floating help button */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Open help"
        className={clsx(
          'fixed bottom-24 right-4 z-40 w-11 h-11 rounded-full shadow-lg',
          'bg-white border border-gray-200 flex items-center justify-center',
          'text-gray-500 hover:text-primary hover:border-primary/40 hover:shadow-xl',
          'transition-all duration-200 md:bottom-6',
        )}
      >
        <HelpCircle size={20} />
      </button>

      {/* Help panel overlay */}
      {open && (
        <div
          className="fixed inset-0 z-[120] flex items-end justify-end p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm bg-white rounded-xl shadow-2xl border border-gray-100 overflow-hidden animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <HelpCircle size={16} className="text-primary" />
                <span className="text-sm font-semibold text-gray-800">Help & Support</span>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                aria-label="Close help"
              >
                <X size={15} />
              </button>
            </div>

            {/* Search */}
            <div className="px-4 py-2.5 border-b border-gray-100">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search help articles…"
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-colors"
                />
              </div>
            </div>

            {/* Articles */}
            <div className="max-h-56 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="px-4 py-3 text-xs text-gray-400 text-center">No results found</p>
              ) : (
                filtered.map((article) => (
                  <a
                    key={article.url}
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between px-4 py-2.5 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <span>{article.question}</span>
                    <ExternalLink size={11} className="text-gray-300 shrink-0 ml-2" />
                  </a>
                ))
              )}
            </div>

            {/* Footer links */}
            <div className="border-t border-gray-100 p-3 space-y-1.5">
              <Link
                to="/support"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium text-primary hover:bg-primary/5 transition-colors"
              >
                <LifeBuoy size={13} className="text-primary" />
                View full support page →
              </Link>
              <a
                href="https://docs.taproot-pos.com"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-2 rounded-md text-xs text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <ExternalLink size={13} className="text-gray-400" />
                Full documentation
              </a>
              <a
                href="mailto:support@taproot-pos.com"
                className="flex items-center gap-2 px-3 py-2 rounded-md text-xs text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <Mail size={13} className="text-gray-400" />
                support@taproot-pos.com
              </a>
              <a
                href={bugUrl}
                className="flex items-center gap-2 px-3 py-2 rounded-md text-xs text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <Bug size={13} className="text-gray-400" />
                Report a bug
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
