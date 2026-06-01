/**
 * Toast notification system.
 * Wraps react-hot-toast with Taproot styling and typed helpers.
 */

import toast, { Toaster, type ToastOptions } from 'react-hot-toast';

// ─── Typed helpers ────────────────────────────────────────────────────────────

const base: ToastOptions = {
  position: 'top-right',
  style: {
    fontFamily:  'Inter, sans-serif',
    fontSize:    '13px',
    fontWeight:  '500',
    borderRadius: '10px',
    padding:     '12px 16px',
    maxWidth:    '360px',
    boxShadow:   '0 4px 6px -1px rgba(0,0,0,0.10), 0 2px 4px -1px rgba(0,0,0,0.06)',
  },
};

export const showToast = {
  success: (message: string, opts?: ToastOptions) =>
    toast.success(message, {
      ...base,
      duration: 3000,
      style: { ...base.style, background: '#F0FDF4', color: '#15803D', border: '1px solid #BBF7D0' },
      iconTheme: { primary: '#22C55E', secondary: '#fff' },
      ...opts,
    }),

  error: (message: string, opts?: ToastOptions) =>
    toast.error(message, {
      ...base,
      duration: 0, // persistent — must be dismissed
      style: { ...base.style, background: '#FEF2F2', color: '#B91C1C', border: '1px solid #FECACA' },
      iconTheme: { primary: '#E24B4A', secondary: '#fff' },
      ...opts,
    }),

  warning: (message: string, opts?: ToastOptions) =>
    toast(message, {
      ...base,
      duration: 5000,
      icon: '⚠️',
      style: { ...base.style, background: '#FFFBEB', color: '#92400E', border: '1px solid #FDE68A' },
      ...opts,
    }),

  info: (message: string, opts?: ToastOptions) =>
    toast(message, {
      ...base,
      duration: 3000,
      icon: 'ℹ️',
      style: { ...base.style, background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE' },
      ...opts,
    }),

  loading: (message: string) =>
    toast.loading(message, {
      ...base,
      style: { ...base.style, background: '#fff', color: '#0F172A', border: '1px solid #E2E8F0' },
    }),

  dismiss: toast.dismiss,
};

// ─── Container component ──────────────────────────────────────────────────────

export function ToastContainer() {
  return (
    <Toaster
      position="top-right"
      gutter={8}
      containerStyle={{ top: 16, right: 16 }}
      toastOptions={{ ...base }}
    />
  );
}
