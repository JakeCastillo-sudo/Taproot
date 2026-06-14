import { defineConfig } from 'vite';

// Vanilla-TS shell for the Tauri desktop app. The local document (src/index.html)
// loads taproot-pos.com and initializes the native bridge. Output → ../dist
// (matches src-tauri/tauri.conf.json `frontendDist`).
export default defineConfig({
  root: 'src',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
});
