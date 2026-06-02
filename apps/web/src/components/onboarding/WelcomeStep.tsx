import { useEffect, useState } from 'react';
import { clsx } from 'clsx';

interface WelcomeStepProps {
  firstName:    string;
  businessName: string;
  onStart:      () => void;
  onSkip:       () => void;
}

const TIMELINE = [
  { emoji: '📋', label: 'Upload your menu',      time: '3 min' },
  { emoji: '🧮', label: 'Set up recipes',         time: '3 min (optional)' },
  { emoji: '💳', label: 'Connect payments',        time: '2 min' },
  { emoji: '🎉', label: 'Done — take your first sale', time: '' },
];

export function WelcomeStep({ firstName, businessName, onStart, onSkip }: WelcomeStepProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Slight delay for entrance animation
    const t = setTimeout(() => setVisible(true), 100);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className={clsx(
      'text-center transition-all duration-500',
      visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4',
    )}>
      {/* Logo with bounce */}
      <div className="text-6xl mb-5 animate-bounce-in" style={{ animationDelay: '0ms' }}>
        🌿
      </div>

      <h1 className="text-3xl font-extrabold text-gray-900 mb-2">
        Welcome to Taproot, {firstName || 'there'}!
      </h1>
      <p className="text-gray-500 mb-1">
        Let&apos;s get <span className="font-semibold text-gray-700">{businessName || 'your business'}</span> ready to sell.
      </p>
      <p className="text-sm text-gray-400 mb-8">This takes about 10 minutes.</p>

      {/* Timeline */}
      <div className="text-left max-w-xs mx-auto mb-8 space-y-3">
        {TIMELINE.map((item, i) => (
          <div
            key={i}
            className={clsx(
              'flex items-center gap-3 transition-all duration-300',
              visible ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-4',
            )}
            style={{ transitionDelay: `${150 + i * 80}ms` }}
          >
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-base shrink-0">
              {item.emoji}
            </div>
            <div className="flex-1">
              <span className="text-sm font-medium text-gray-800">{item.label}</span>
              {item.time && (
                <span className="ml-2 text-xs text-gray-400">{item.time}</span>
              )}
            </div>
            <div className={clsx(
              'w-2 h-2 rounded-full',
              i === 0 ? 'bg-primary' : 'bg-gray-200',
            )} />
          </div>
        ))}
      </div>

      {/* CTA */}
      <button
        onClick={onStart}
        className="w-full max-w-xs py-3.5 bg-primary text-white font-semibold rounded-xl hover:bg-primary-dark active:scale-[0.98] transition-all shadow-md shadow-primary/20 flex items-center justify-center gap-2 mx-auto"
      >
        Let&apos;s go →
      </button>

      <button
        onClick={onSkip}
        className="mt-4 text-sm text-gray-400 hover:text-gray-600 transition-colors"
      >
        I&apos;ll set up manually
      </button>
    </div>
  );
}
