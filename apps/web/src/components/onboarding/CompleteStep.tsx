/**
 * CompleteStep — Step 6 (the finish line 🎉)
 *
 * - Fires canvas-confetti on mount
 * - Animated checkmark
 * - Summary of what was set up
 * - 3 action cards
 * - POST /api/v1/onboarding/complete + analytics
 */

import { useEffect, useRef } from 'react';
import { ShoppingCart, Users, Package, ArrowRight } from 'lucide-react';
import confetti from 'canvas-confetti';
import { analytics } from '../../lib/analytics';
import { onboardingApi } from '../../lib/api';

// ─── Props ────────────────────────────────────────────────────────────────────

interface CompleteStepProps {
  itemsImported:       number;
  recipesConfigured:   number;
  stripeConnected:     boolean;
  startedAt:           string;       // ISO string
  onGoToPOS:           () => void;
  onGoToTeam:          () => void;
  onGoToInventory:     () => void;
}

// ─── Action cards ─────────────────────────────────────────────────────────────

function ActionCard({
  icon,
  title,
  desc,
  cta,
  color,
  onClick,
}: {
  icon:    React.ReactNode;
  title:   string;
  desc:    string;
  cta:     string;
  color:   string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3.5 p-4 rounded-xl border border-gray-100 bg-white hover:border-primary/30 hover:bg-primary/5 text-left transition-all active:scale-[0.99] group"
    >
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${color}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800">{title}</p>
        <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
      </div>
      <div className="flex items-center gap-1 text-xs font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {cta}
        <ArrowRight size={12} />
      </div>
    </button>
  );
}

// ─── Animated checkmark ───────────────────────────────────────────────────────

function AnimatedCheck() {
  return (
    <div className="relative w-20 h-20 mx-auto mb-6">
      <svg className="w-full h-full" viewBox="0 0 80 80" fill="none">
        {/* Circle */}
        <circle
          cx="40" cy="40" r="36"
          stroke="#10b981"
          strokeWidth="5"
          strokeDasharray="226"
          strokeDashoffset="0"
          className="animate-[drawCircle_0.6s_ease-out_forwards]"
          style={{ animationFillMode: 'forwards' }}
        />
        {/* Checkmark */}
        <path
          d="M24 40 l12 12 l20 -22"
          stroke="#10b981"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="60"
          strokeDashoffset="60"
          style={{
            animation: 'drawCheck 0.4s ease-out 0.5s forwards',
            animationFillMode: 'forwards',
          }}
        />
      </svg>

      <style>{`
        @keyframes drawCheck {
          to { stroke-dashoffset: 0; }
        }
        @keyframes drawCircle {
          from { stroke-dashoffset: 226; }
          to   { stroke-dashoffset: 0; }
        }
      `}</style>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CompleteStep({
  itemsImported,
  recipesConfigured,
  stripeConnected,
  startedAt,
  onGoToPOS,
  onGoToTeam,
  onGoToInventory,
}: CompleteStepProps) {
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;

    // 🎉 Confetti burst
    void confetti({
      particleCount: 120,
      spread:        70,
      origin:        { y: 0.6 },
      colors:        ['#1D9E75', '#10b981', '#34d399', '#6ee7b7', '#ffffff'],
    });
    setTimeout(() => {
      void confetti({
        particleCount: 60,
        angle:         60,
        spread:        55,
        origin:        { x: 0, y: 0.6 },
        colors:        ['#1D9E75', '#fbbf24', '#f59e0b'],
      });
      void confetti({
        particleCount: 60,
        angle:         120,
        spread:        55,
        origin:        { x: 1, y: 0.6 },
        colors:        ['#1D9E75', '#fbbf24', '#f59e0b'],
      });
    }, 250);

    // Analytics
    const totalSeconds = Math.round((Date.now() - new Date(startedAt).getTime()) / 1000);
    analytics.onboardingCompleted({
      totalTimeSeconds:  totalSeconds,
      itemsImported,
      recipesConfigured,
      stripeConnected,
    });

    // Mark complete on backend (non-blocking)
    onboardingApi.complete().catch(() => { /* ignore */ });
  }, [startedAt, itemsImported, recipesConfigured, stripeConnected]);

  return (
    <div className="text-center">
      <AnimatedCheck />

      <h1 className="text-2xl font-extrabold text-gray-900 mb-2">
        You&apos;re ready to sell! 🌿
      </h1>
      <p className="text-sm text-gray-500 mb-6">
        Your store is set up. Here&apos;s what we did together:
      </p>

      {/* Summary chips */}
      <div className="flex flex-wrap justify-center gap-2 mb-8">
        <Chip active={itemsImported > 0} label={
          itemsImported > 0 ? `${itemsImported} menu items` : 'Menu: not set up yet'
        } />
        <Chip active={recipesConfigured > 0} label={
          recipesConfigured > 0 ? `${recipesConfigured} recipes` : 'Recipes: later'
        } />
        <Chip active={stripeConnected} label={
          stripeConnected ? 'Stripe connected' : 'Payments: not connected'
        } />
      </div>

      {/* Action cards */}
      <div className="space-y-2.5 text-left mb-8">
        <ActionCard
          icon={<ShoppingCart size={20} className="text-primary" />}
          title="Take your first sale"
          desc="Everything is ready — ring up a customer right now"
          cta="Open POS"
          color="bg-primary/10"
          onClick={onGoToPOS}
        />
        <ActionCard
          icon={<Users size={20} className="text-blue-600" />}
          title="Add your team"
          desc="Invite staff with the right roles and permissions"
          cta="Go to Settings"
          color="bg-blue-100"
          onClick={onGoToTeam}
        />
        <ActionCard
          icon={<Package size={20} className="text-purple-600" />}
          title="Check your inventory"
          desc="Set opening stock levels and low-stock alerts"
          cta="Go to Inventory"
          color="bg-purple-100"
          onClick={onGoToInventory}
        />
      </div>

      <button
        type="button"
        onClick={onGoToPOS}
        className="w-full py-3.5 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary-dark transition-all shadow-md shadow-primary/20 active:scale-[0.99]"
      >
        Start selling →
      </button>
    </div>
  );
}

// ─── Summary chip ─────────────────────────────────────────────────────────────

function Chip({ active, label }: { active: boolean; label: string }) {
  return (
    <span className={`
      inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium
      ${active
        ? 'bg-green-100 text-green-700 border border-green-200'
        : 'bg-gray-100 text-gray-500 border border-gray-200'
      }
    `}>
      <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-green-500' : 'bg-gray-400'}`} />
      {label}
    </span>
  );
}
