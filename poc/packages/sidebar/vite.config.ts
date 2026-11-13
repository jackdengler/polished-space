import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The gateway serves `dist/` and proxies same-origin `/api` to the brain, so
// the app only ever calls relative `/api/...` paths. In development the
// fixture server (fixture/server.ts --dev) hosts Vite in middleware mode and
// answers `/api` itself, so no proxy is configured here.
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    // AudioWorklet modules ship as real files (not data: URLs), so a strict CSP can allow them.
    assetsInlineLimit: (file) => (file.includes('.worklet.') ? false : undefined),
  },
});
