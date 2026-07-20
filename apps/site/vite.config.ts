import { defineConfig } from 'vite';
import path from 'node:path';
import { loadLingogramLimits, limitDefines } from '../../packages/shared/vite-limits.mjs';

// Bundles the hero demo, which runs the REAL extension sidebar
// (packages/shared → SidebarUI/AppState). Output lands in build/ next to the
// pages emitted by build.mjs, which also copies the sidebar stylesheet from the
// extension so the demo is styled by the same CSS the extension ships.
export default defineConfig({
  root: path.resolve(__dirname),
  // Build-time constants the shared modules expect (auth/config.ts, limits).
  // The demo never signs in or writes anything — these only need to resolve
  // for the bundle to evaluate, so they mirror the extensions' prod values.
  define: {
    __EXT_ENV__: JSON.stringify('prod'),
    __FIREBASE_PROJECT_ID__: JSON.stringify('lingogram-prod'),
    __FIREBASE_API_KEY__: JSON.stringify(''),
    __IDENTITY_TOOLKIT_URL__: JSON.stringify('https://identitytoolkit.googleapis.com'),
    __SECURE_TOKEN_URL__: JSON.stringify('https://securetoken.googleapis.com'),
    __FIRESTORE_URL__: JSON.stringify('https://firestore.googleapis.com'),
    __FRONTEND_BASE_URL__: JSON.stringify('https://lingogram.ai'),
    __EXT_SOURCE__: JSON.stringify('site-demo'),
    ...limitDefines(loadLingogramLimits()),
  },
  build: {
    outDir: 'build',
    emptyOutDir: false, // build.mjs writes the pages here first
    lib: {
      entry: path.resolve(__dirname, 'src/demo/index.ts'),
      formats: ['iife'],
      name: 'LingogramDemo',
      fileName: () => 'demo.js',
    },
    rollupOptions: {
      output: { extend: true },
    },
    minify: true,
  },
});
