import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),

    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',

      // Point at our hand-crafted manifest
      manifest: false,
      manifestFilename: 'manifest.json',

      workbox: {
        // Offline-first strategy
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],

        // Cache API GET calls (products, categories) for offline browsing
        runtimeCaching: [
          {
            urlPattern: /^\/api\/v1\/(products|categories)/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'taproot-api',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 200, maxAgeSeconds: 86400 },
            },
          },
          // Static assets — stale-while-revalidate
          {
            urlPattern: /\.(png|jpg|svg|ico|woff2)$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'taproot-assets',
              expiration: { maxEntries: 100, maxAgeSeconds: 30 * 86400 },
            },
          },
        ],

        // Skip waiting so the new SW takes over immediately after install
        skipWaiting: true,
        clientsClaim: true,
      },

      devOptions: {
        // Enable in development so we can test offline behaviour
        enabled: false,
        type: 'module',
      },
    }),
  ],

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
