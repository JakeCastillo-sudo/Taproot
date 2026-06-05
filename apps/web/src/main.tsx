import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import * as Sentry from '@sentry/react';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';
import './styles/design-system.css';
import './styles/ios.css';
import './styles/animations.css';
import './styles/print.css';

// ── Sentry error monitoring (production only) ────────────────────────────────
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn:               import.meta.env.VITE_SENTRY_DSN as string,
    environment:       import.meta.env.MODE,
    tracesSampleRate:  0.1,
    replaysOnErrorSampleRate: 0,  // no session replay (privacy)
    beforeSend(event) {
      // Never send form data — may contain passwords or card numbers
      if (event.request?.data) delete event.request.data;
      if (event.request?.headers?.Authorization) {
        event.request.headers.Authorization = '[REDACTED]';
      }
      return event;
    },
  });
}

// ── iOS Safari viewport fix ───────────────────────────────────────────────────
// Sets --vh = 1% of the real inner height so `calc(var(--vh,1vh)*100)` works
// correctly when the browser chrome collapses/expands.
function setVh() {
  document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
}
setVh();
window.addEventListener('resize', setVh, { passive: true });

// ── Prevent accidental double-tap zoom on touch devices (POS / PWA) ──────────
let _lastTap = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  const tag  = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (now - _lastTap < 300) e.preventDefault();
  _lastTap = now;
}, { passive: false });

const root = document.getElementById('root');
if (!root) throw new Error('#root element not found');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
