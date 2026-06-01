import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import './styles/design-system.css';

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
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
