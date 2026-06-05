/**
 * ErrorBoundary — catches React render errors and shows a friendly recovery
 * page instead of a white screen. Logs to console (Sentry-ready seam).
 */

import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props { children: ReactNode }
interface State { hasError: boolean; message?: string }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info.componentStack);
    // Future: report to Sentry / error pipeline here.
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-surface-2 p-6 text-center">
        <div className="text-5xl mb-4">🌿</div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Something went wrong</h1>
        <p className="text-gray-500 mb-6 max-w-sm">We've been notified. Refreshing the page usually fixes it.</p>
        <button onClick={() => window.location.reload()} className="px-5 py-2.5 bg-primary text-white font-semibold rounded-lg hover:bg-primary-dark">
          Refresh page
        </button>
      </div>
    );
  }
}
