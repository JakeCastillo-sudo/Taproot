/**
 * OnboardingPage — full-screen wizard shell
 *
 * Progress bar · Step indicator · Skip · Back · Slide transitions
 * Renders the six step components and manages flow between them.
 */

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, X } from 'lucide-react';
import { clsx } from 'clsx';
import { useOnboardingStore, STEP_ORDER, stepIndex, stepProgress } from '../store/onboarding.store';
import type { OnboardingStep, MenuReviewItem } from '../store/onboarding.store';
import { importsApi } from '../lib/api';
import { analytics } from '../lib/analytics';

// Step components
import { WelcomeStep }      from '../components/onboarding/WelcomeStep';
import { MenuUploadStep }   from '../components/onboarding/MenuUploadStep';
import { MenuReviewStep }   from '../components/onboarding/MenuReviewStep';
import { TeamSetupStep }    from '../components/onboarding/TeamSetupStep';
import { TaxSetupStep }     from '../components/onboarding/TaxSetupStep';
import { StripeConnectStep} from '../components/onboarding/StripeConnectStep';
import { CompleteStep }     from '../components/onboarding/CompleteStep';

// ─── Step meta ────────────────────────────────────────────────────────────────

const STEP_LABELS: Partial<Record<OnboardingStep, string>> = {
  menu_upload:   'Upload menu',
  menu_review:   'Review menu',
  team_setup:    'Add team',
  stripe_connect:'Payments',
  tax_setup:     'Tax rate',
};

// Steps that get a "Step X of N" label (excludes welcome + complete)
const NUMBERED_STEPS: OnboardingStep[] = [
  'menu_upload', 'menu_review', 'team_setup', 'stripe_connect', 'tax_setup',
];

// ─── User info from localStorage ─────────────────────────────────────────────

function getUser(): { firstName: string; lastName: string; orgId?: string; locationIds?: string[] } {
  try {
    const raw = localStorage.getItem('taproot_user');
    if (raw) return JSON.parse(raw) as { firstName: string; lastName: string; orgId?: string; locationIds?: string[] };
  } catch { /* ignore */ }
  return { firstName: '', lastName: '' };
}

// ─── OnboardingPage ───────────────────────────────────────────────────────────

export function OnboardingPage() {
  const navigate = useNavigate();
  const store    = useOnboardingStore();
  const user     = getUser();

  // Local transition state
  const [displayStep,  setDisplayStep]  = useState<OnboardingStep>(store.currentStep);
  const [transitioning, setTransitioning] = useState(false);
  const [direction,    setDirection]    = useState<'forward' | 'back'>('forward');
  const stepViewedRef  = useRef<string | null>(null);
  const stepStartRef   = useRef<number>(Date.now());

  // Sync display step when store changes
  useEffect(() => {
    if (store.currentStep === displayStep) return;

    const isForward = stepIndex(store.currentStep) > stepIndex(displayStep);
    setDirection(isForward ? 'forward' : 'back');
    setTransitioning(true);

    const t = setTimeout(() => {
      setDisplayStep(store.currentStep);
      setTransitioning(false);
      stepStartRef.current = Date.now();
    }, 200);
    return () => clearTimeout(t);
  }, [store.currentStep, displayStep]);

  // Analytics: track each step view
  useEffect(() => {
    if (stepViewedRef.current !== displayStep) {
      stepViewedRef.current = displayStep;
      analytics.onboardingStepViewed(displayStep);
    }
  }, [displayStep]);

  // ── Navigation helpers ────────────────────────────────────────────────────────
  const goForward = (to?: OnboardingStep) => {
    const next = to ?? STEP_ORDER[stepIndex(store.currentStep) + 1];
    if (!next) return;
    const timeSpent = Math.round((Date.now() - stepStartRef.current) / 1000);
    analytics.onboardingStepCompleted(store.currentStep, timeSpent);
    store.setStep(next);
  };

  const goBack = () => {
    const prev = STEP_ORDER[stepIndex(store.currentStep) - 1];
    if (!prev) return;
    store.setStep(prev);
  };

  const skipStep = () => {
    const timeSpent = Math.round((Date.now() - stepStartRef.current) / 1000);
    analytics.onboardingStepSkipped(store.currentStep);
    analytics.onboardingStepCompleted(store.currentStep, timeSpent);
    store.skipStep(store.currentStep);
  };

  const goToPOS = () => {
    analytics.onboardingAbandoned(
      store.currentStep,
      Math.round((Date.now() - new Date(store.startedAt).getTime()) / 1000),
    );
    navigate('/', { replace: true });
  };

  // ── Step-specific handlers ────────────────────────────────────────────────────

  const handleMenuUploadComplete = (items: MenuReviewItem[], jobId: string) => {
    store.updateMenuUpload({
      items,
      jobId,
      status:    'ready',
      itemCount: items.length,
      filename:  null,
    });
    goForward('menu_review');
  };

  const handleMenuReviewComplete = async (approvedItems: MenuReviewItem[], editedCount: number) => {
    store.updateMenuUpload({ items: approvedItems, status: 'applied', itemCount: approvedItems.length });
    analytics.menuItemsApproved(approvedItems.length, editedCount);

    // Confirm the import job in the background (only for real file/URL imports)
    const { jobId } = store.menuUpload;
    const locationId = user.locationIds?.[0] ?? '';
    if (jobId && jobId !== 'manual' && jobId !== 'demo' && locationId) {
      importsApi.confirm(jobId, { locationId }).catch(() => { /* non-blocking */ });
    }

    goForward('team_setup');
  };

  const handleTeamNext = () => { goForward('stripe_connect'); };
  const handleTeamSkip = () => { store.skipStep('team_setup'); };

  const handleStripeComplete = () => {
    store.updateStripeConnect({ status: 'connected' });
    analytics.stripeConnected();
    goForward('tax_setup');
  };

  const handleStripeSkip = () => {
    store.updateStripeConnect({ status: 'skipped' });
    goForward('tax_setup');
  };

  const handleTaxNext = () => { store.completeOnboarding(); };
  const handleTaxSkip = () => { store.skipStep('tax_setup'); store.completeOnboarding(); };

  // ── UI state ────────────────────────────────────────────────────────────────
  const progress         = stepProgress(store.currentStep);
  const stepNum          = NUMBERED_STEPS.indexOf(store.currentStep) + 1;
  const showStepNum      = NUMBERED_STEPS.includes(store.currentStep);
  const showBack         = stepIndex(store.currentStep) > 0 && store.currentStep !== 'complete';
  const showSkip         = store.currentStep !== 'welcome' && store.currentStep !== 'complete';
  const showProgressBar  = store.currentStep !== 'complete';

  // Transition classes
  const contentClass = transitioning
    ? clsx(
        'opacity-0 transition-all duration-200',
        direction === 'forward' ? 'translate-x-4' : '-translate-x-4',
      )
    : 'opacity-100 translate-x-0 transition-all duration-200';

  return (
    <div className="fixed inset-0 bg-white z-50 flex flex-col overflow-hidden">
      {/* ── Top bar ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 pt-4 pb-0 shrink-0">
        {/* Back button */}
        <div className="w-24">
          {showBack && (
            <button
              type="button"
              onClick={goBack}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 transition-colors"
              aria-label="Go back"
            >
              <ChevronLeft size={16} />
              Back
            </button>
          )}
        </div>

        {/* Step counter */}
        <div className="text-center">
          {showStepNum && (
            <p className="text-xs font-medium text-gray-400">
              {STEP_LABELS[store.currentStep] ? (
                <>
                  <span className="text-gray-600 font-semibold">{STEP_LABELS[store.currentStep]}</span>
                  {' '}· Step {stepNum} of {NUMBERED_STEPS.length}
                </>
              ) : `Step ${stepNum} of ${NUMBERED_STEPS.length}`}
            </p>
          )}
          {store.currentStep === 'welcome' && (
            <p className="text-xs font-medium text-gray-400">Getting started</p>
          )}
        </div>

        {/* Skip / Exit */}
        <div className="w-24 flex justify-end gap-3">
          {showSkip && (
            <button
              type="button"
              onClick={skipStep}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              Skip →
            </button>
          )}
          {store.currentStep !== 'complete' && (
            <button
              type="button"
              onClick={goToPOS}
              aria-label="Exit onboarding"
              className="p-1 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              title="Go to POS"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* ── Progress bar ─────────────────────────────────────────────────────── */}
      {showProgressBar && (
        <div className="px-4 pt-3 pb-0 shrink-0">
          <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* ── Step content ─────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className={clsx('max-w-lg mx-auto px-4 py-6', contentClass)}>
          {displayStep === 'welcome' && (
            <WelcomeStep
              firstName={user.firstName}
              businessName={store.businessInfo.name}
              onStart={() => {
                analytics.onboardingStarted();
                goForward('menu_upload');
              }}
              onSkip={goToPOS}
            />
          )}

          {displayStep === 'menu_upload' && (
            <MenuUploadStep
              locationId={user.locationIds?.[0] ?? ''}
              onComplete={handleMenuUploadComplete}
              onSkip={() => {
                store.updateMenuUpload({ status: 'skipped' });
                skipStep();
              }}
            />
          )}

          {displayStep === 'menu_review' && (
            <MenuReviewStep
              items={store.menuUpload.items}
              onComplete={(items, editedCount) => void handleMenuReviewComplete(items, editedCount)}
              onSkip={skipStep}
            />
          )}

          {displayStep === 'team_setup' && (
            <TeamSetupStep onNext={handleTeamNext} onSkip={handleTeamSkip} />
          )}

          {displayStep === 'stripe_connect' && (
            <StripeConnectStep
              onComplete={handleStripeComplete}
              onSkip={handleStripeSkip}
            />
          )}

          {displayStep === 'tax_setup' && (
            <TaxSetupStep onNext={handleTaxNext} onSkip={handleTaxSkip} />
          )}

          {displayStep === 'complete' && (
            <CompleteStep
              itemsImported={store.menuUpload.itemCount}
              recipesConfigured={store.recipeSetup.recipeCount}
              stripeConnected={store.stripeConnect.status === 'connected'}
              startedAt={store.startedAt}
              onGoToPOS={() => navigate('/', { replace: true })}
              onGoToTeam={() => navigate('/settings', { replace: true })}
              onGoToInventory={() => navigate('/inventory', { replace: true })}
            />
          )}
        </div>
      </div>
    </div>
  );
}
