import React, { type ReactNode } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { ClipboardList, Settings2 } from 'lucide-react';
import { queryClient } from './lib/queryClient';
import { LoginPage } from './pages/LoginPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { POSLayout } from './components/layout/POSLayout';
import { InventoryPage } from './pages/InventoryPage';
import { ReportsPage } from './pages/ReportsPage';
import { ImportPage } from './pages/ImportPage';
import { MigrationPage } from './pages/MigrationPage';
import { ToastContainer } from './components/ui/Toast';
import { TOKEN_KEY, USER_KEY } from './lib/api';

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

  const defaultUser = {
    firstName:   user?.firstName   ?? 'Cashier',
    lastName:    user?.lastName    ?? '',
    role:        user?.role        ?? 'cashier',
    locationIds: user?.locationIds ?? [],
  };

  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<LoginPage />} />

          {/* Protected */}
          <Route
            path="/"
            element={
              <RequireAuth>
                <POSLayout user={defaultUser} />
              </RequireAuth>
            }
          />

          <Route
            path="/orders"
            element={
              <RequireAuth>
                <PlaceholderPage title="Orders" icon={<ClipboardList size={28} />} />
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
            path="/settings"
            element={
              <RequireAuth>
                <PlaceholderPage title="Settings" icon={<Settings2 size={28} />} />
              </RequireAuth>
            }
          />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErrorBoundary>

      <ToastContainer />
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
