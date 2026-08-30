import { defineConfig } from 'vite';
import path from 'node:path';

// Third build pass, separate from vite.config.ts (the IIFE hero demo) and
// vite.auth.config.ts (the ESM auth bundles). Emits analytics.js: the consent
// banner and the site's own GA4 events, built from src/analytics/.
//
// IIFE, not ESM, on purpose. The pages load it as `<script defer>` ahead of
// main.js, and classic deferred scripts run in document order and all before
// any type="module" script — that is what puts window.lgTrack in place before
// main.js, the demo bundle or the auth bundles can reach for it. A module
// script would run after all of them and lose that guarantee.
//
// Writes into build/ with emptyOutDir:false so no pass wipes another or the
// pages build.mjs emitted first. Note that `npm run dev` (node build.mjs
// --watch) does not run Vite, so it serves pages whose /analytics.js 404s —
// the same is already true of demo.js. Run the full `npm run build -w
// apps/site` once to populate the bundles.
export default defineConfig({
  root: path.resolve(__dirname),
  build: {
    outDir: 'build',
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, 'src/analytics/index.ts'),
      formats: ['iife'],
      name: 'LingogramAnalytics',
      fileName: () => 'analytics.js',
    },
    rollupOptions: {
      output: { extend: true },
    },
    minify: true,
  },
});
