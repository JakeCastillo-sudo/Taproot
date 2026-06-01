import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],

  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },

  build: {
    // esbuild minification — faster than terser, sufficient for production
    minify: 'esbuild',

    // Hidden source maps — uploaded to error monitoring (e.g. Sentry) but
    // NOT served publicly; avoids leaking source code in production.
    sourcemap: mode === 'production' ? 'hidden' : true,

    // Raise warning threshold (recharts alone is ~430 kb)
    chunkSizeWarningLimit: 600,

    rollupOptions: {
      output: {
        // Manual chunk splitting — separates large vendors so users only
        // re-download chunks that actually changed between releases.
        manualChunks: {
          'vendor-react':    ['react', 'react-dom', 'react-router-dom'],
          'vendor-state':    ['zustand', 'immer', '@tanstack/react-query'],
          'vendor-recharts': ['recharts'],
          'vendor-icons':    ['lucide-react'],
        },
      },
    },
  },

  // Drop console.* and debugger in production so no internal details leak.
  esbuild: {
    target: 'es2020',
    drop:   mode === 'production' ? ['console', 'debugger'] : [],
  },
}));
