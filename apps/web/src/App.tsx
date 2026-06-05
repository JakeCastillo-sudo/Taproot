import React, { type ReactNode, useState, useEffect, useRef } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Download, X } from 'lucide-react';
import { queryClient } from './lib/queryClient';
import { LoginPage } from './pages/LoginPage';
import { POSLayout } from './components/layout/POSLayout';
import { InventoryPage } from './pages/InventoryPage';
import { ReportsPage } from './pages/ReportsPage';
import { ImportPage } from './pages/ImportPage';
import { MigrationPage } from './pages/MigrationPage';
import { RegisterPage } from './pages/RegisterPage';
import { BillingPage } from './pages/BillingPage';
import { UpgradePage } from './pages/UpgradePage';
import { LandingPage } from './pages/LandingPage';
import { PrivacyPage } from './pages/PrivacyPage';
import { TermsPage } from './pages/TermsPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { ReceiptPage } from './pages/ReceiptPage';
import { DashboardEditorPage } from './pages/DashboardEditorPage';
import { SettingsLayout } from './components/layout/SettingsLayout';
import { ProductsSettingsPage } from './pages/ProductsSettingsPage';
import { CategoriesSettingsPage } from './pages/CategoriesSettingsPage';
import { ModifiersSettingsPage } from './pages/ModifiersSettingsPage';
import { BusinessSettingsPage } from './pages/BusinessSettingsPage';
import { EmployeesSettingsPage } from './pages/EmployeesSettingsPage';
import { PaymentsSettingsPage } from './pages/PaymentsSettingsPage';
import { OrderHistoryPage } from './pages/OrderHistoryPage';
import { EndOfDayPage } from './pages/EndOfDayPage';
import { FloorPlanEditorPage } from './pages/FloorPlanEditorPage';
import { PublicMenuPage } from './pages/PublicMenuPage';
import { QrCodesSettingsPage } from './pages/QrCodesSettingsPage';
import { OnlineOrderingSettingsPage } from './pages/OnlineOrderingSettingsPage';
import { LoyaltySettingsPage } from './pages/LoyaltySettingsPage';
import { GiftCardsSettingsPage } from './pages/GiftCardsSettingsPage';
import { KitchenDisplayPage } from './pages/KitchenDisplayPage';
import { ReservationsPage } from './pages/ReservationsPage';
import { ToastContainer } from './components/ui/Toast';
import { TrialBanner } from './components/ui/TrialBanner';
import { HelpButton } from './components/ui/HelpButton';
import { TOKEN_KEY, USER_KEY } from './lib/api';

// ─── PWA install banner ───────────────────────────────────────────────────────

const PWA_DISMISS_KEY = 'taproot_pwa_dismiss_until';
const PWA_DISMISS_DAYS = 30;

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function PWAInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const handled = useRef(false);

  useEffect(() => {
    // Check if user dismissed recently
    const until = localStorage.getItem(PWA_DISMISS_KEY);
    if (until && Date.now() < Number(until)) return;

    // Check if already running as installed PWA
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    const handler = (e: Event) => {
      e.preventDefault();
      if (!handled.current) {
        handled.current = true;
        setDeferredPrompt(e as BeforeInstallPromptEvent);
        setVisible(true);
      }
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (!visible || !deferredPrompt) return null;

  const handleInstall = async () => {
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setVisible(false);
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setVisible(false);
    localStorage.setItem(
      PWA_DISMISS_KEY,
      String(Date.now() + PWA_DISMISS_DAYS * 24 * 60 * 60 * 1000),
    );
  };

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[200] w-[calc(100%-2rem)] max-w-sm bg-white rounded-xl shadow-lg border border-gray-100 p-4 flex items-center gap-3 animate-slide-up">
      <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center shrink-0">
        <span className="text-white text-sm font-bold">T</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900">Add Taproot to home screen</p>
        <p className="text-xs text-gray-400 truncate">Works offline · Faster access</p>
      </div>
      <button
        onClick={() => void handleInstall()}
        className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-xs font-semibold rounded-md hover:bg-primary-dark transition-colors"
      >
        <Download size={13} /> Install
      </button>
      <button
        onClick={handleDismiss}
        className="shrink-0 p-1 rounded-full hover:bg-gray-100 transition-colors"
        aria-label="Dismiss"
      >
        <X size={14} className="text-gray-400" />
      </button>
    </div>
  );
}

// ─── Auth guard ───────────────────────────────────────────────────────────────

function getStoredUser(): { firstName: string; lastName: string; role: string; locationIds: string[] } | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isLoggedIn(): boolean {
  return !!localStorage.getItem(TOKEN_KEY);
}

function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  const token    = localStorage.getItem(TOKEN_KEY);

  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

// ─── Error boundary ───────────────────────────────────────────────────────────

interface EBState { error: Error | null }
class ErrorBoundary extends React.Component<{ children: ReactNode }, EBState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error): EBState { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="p-8 text-center">
          <p className="text-red-600 font-semibold">Something went wrong</p>
          <p className="text-sm text-gray-500 mt-1">{this.state.error.message}</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-4 px-4 py-2 text-sm bg-primary text-white rounded-md hover:bg-primary-dark transition-colors"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const user = getStoredUser();
  const loggedIn = isLoggedIn();

  const defaultUser = {
    firstName:   user?.firstName   ?? 'Cashier',
    lastName:    user?.lastName    ?? '',
    role:        user?.role        ?? 'cashier',
    locationIds: user?.locationIds ?? [],
  };

  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        {/* Trial banner — shown inside app when trialing */}
        {loggedIn && <TrialBanner />}

        <Routes>
          {/* ── Public marketing ─────────────────────────────────────────── */}
          <Route
            path="/"
            element={loggedIn
              ? <POSLayout user={defaultUser} />
              : <LandingPage />
            }
          />
          <Route path="/login"    element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/privacy"  element={<PrivacyPage />} />
          <Route path="/terms"    element={<TermsPage />} />

          {/* ── Public QR storefront (no auth) ────────────────────────────── */}
          <Route path="/order/:orgSlug" element={<PublicMenuPage />} />
          <Route path="/order/:orgSlug/table/:tableId" element={<PublicMenuPage />} />

          {/* ── Onboarding wizard ─────────────────────────────────────────── */}
          <Route
            path="/onboarding"
            element={
              <RequireAuth>
                <OnboardingPage />
              </RequireAuth>
            }
          />

          {/* ── Receipt (full-screen, no sidebar) ─────────────────────────── */}
          <Route
            path="/receipt"
            element={
              <RequireAuth>
                <ReceiptPage />
              </RequireAuth>
            }
          />

          {/* ── Protected app routes ──────────────────────────────────────── */}
          <Route
            path="/orders"
            element={
              <RequireAuth>
                <OrderHistoryPage />
              </RequireAuth>
            }
          />

          <Route
            path="/inventory"
            element={
              <RequireAuth>
                <InventoryPage />
              </RequireAuth>
            }
          />

          <Route
            path="/reports"
            element={
              <RequireAuth>
                <ReportsPage />
              </RequireAuth>
            }
          />

          <Route
            path="/reservations"
            element={
              <RequireAuth>
                <ReservationsPage />
              </RequireAuth>
            }
          />

          <Route
            path="/kitchen"
            element={
              <RequireAuth>
                <KitchenDisplayPage />
              </RequireAuth>
            }
          />

          <Route
            path="/reports/end-of-day"
            element={
              <RequireAuth>
                <EndOfDayPage />
              </RequireAuth>
            }
          />

          <Route
            path="/import"
            element={
              <RequireAuth>
                <ImportPage />
              </RequireAuth>
            }
          />

          <Route
            path="/migrate"
            element={
              <RequireAuth>
                <MigrationPage />
              </RequireAuth>
            }
          />

          <Route
            path="/billing"
            element={
              <RequireAuth>
                <BillingPage />
              </RequireAuth>
            }
          />

          <Route
            path="/upgrade"
            element={
              <RequireAuth>
                <UpgradePage />
              </RequireAuth>
            }
          />

          {/* Settings shell with nested admin pages */}
          <Route
            path="/settings"
            element={
              <RequireAuth>
                <SettingsLayout />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="/settings/products" replace />} />
            <Route path="products" element={<ProductsSettingsPage />} />
            <Route path="categories" element={<CategoriesSettingsPage />} />
            <Route path="modifiers" element={<ModifiersSettingsPage />} />
            <Route path="business" element={<BusinessSettingsPage />} />
            <Route path="employees" element={<EmployeesSettingsPage />} />
            <Route path="payments" element={<PaymentsSettingsPage />} />
            <Route path="floor-plan" element={<FloorPlanEditorPage />} />
            <Route path="qr-codes" element={<QrCodesSettingsPage />} />
            <Route path="online-ordering" element={<OnlineOrderingSettingsPage />} />
            <Route path="loyalty" element={<LoyaltySettingsPage />} />
            <Route path="gift-cards" element={<GiftCardsSettingsPage />} />
          </Route>

          {/* Dashboard layout editor — full-screen, customize POS register tiles */}
          <Route
            path="/settings/dashboard"
            element={
              <RequireAuth>
                <DashboardEditorPage />
              </RequireAuth>
            }
          />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErrorBoundary>

      <ToastContainer />
      <PWAInstallBanner />
      {loggedIn && <HelpButton />}
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
