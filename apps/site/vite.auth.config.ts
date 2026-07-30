import { defineConfig } from 'vite';
import path from 'node:path';

// Second build pass, separate from vite.config.ts (the IIFE hero demo). Emits
// the two ES-module bundles the auth pages load:
//   - auth.js        (src/auth/entry.ts)  — form logic + DOM glue (imports ./core)
//   - auth-google.js (src/auth/google.ts) — firebase/auth "Continue with Google"
// Kept apart from the demo because a single Vite build emits one module format,
// and the demo must stay an IIFE global while these want ESM. All write into
// build/ with emptyOutDir:false so no pass wipes another or the pages build.mjs
// emitted first. Pure logic lives in src/auth/core.ts + dom.ts and is unit-tested
// directly (tests/), so what ships and what's tested are the same source.
export default defineConfig({
  root: path.resolve(__dirname),
  build: {
    outDir: 'build',
    emptyOutDir: false,
    minify: true,
    rollupOptions: {
      input: {
        auth: path.resolve(__dirname, 'src/auth/entry.ts'),
        'auth-google': path.resolve(__dirname, 'src/auth/google.ts'),
      },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        // Shared chunks (firebase, ./core) land next to the entries in build/.
        chunkFileNames: 'auth-chunk-[hash].js',
      },
    },
  },
});
