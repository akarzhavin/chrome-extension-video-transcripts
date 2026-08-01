import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { loadLingogramLimits, limitDefines } from '../shared/vite-limits.mjs';

// The extension's own stylesheet, inlined at build time so consumers get the
// component styles from one file. Editing it in the extension updates the embed
// on the next build — the whole point of the package.
const EXTENSION_CSS = resolve(__dirname, '../../apps/rezka/src/assets/styles.css');

const inlineExtensionCss = () => ({
  name: 'lingogram-inline-extension-css',
  resolveId(id: string) {
    return id === 'virtual:extension-css' ? '\0virtual:extension-css' : null;
  },
  load(id: string) {
    if (id !== '\0virtual:extension-css') return null;
    const css = readFileSync(EXTENSION_CSS, 'utf8');
    return `export const EXTENSION_CSS = ${JSON.stringify(css)};`;
  },
});

export default defineConfig({
  plugins: [inlineExtensionCss()],
  // Build-time constants the shared auth/limits modules expect. The embed never
  // signs in or writes, so these only need to resolve.
  define: {
    __EXT_ENV__: JSON.stringify('prod'),
    __FIREBASE_PROJECT_ID__: JSON.stringify('lingogram-prod'),
    __FIREBASE_API_KEY__: JSON.stringify(''),
    __IDENTITY_TOOLKIT_URL__: JSON.stringify('https://identitytoolkit.googleapis.com'),
    __SECURE_TOKEN_URL__: JSON.stringify('https://securetoken.googleapis.com'),
    __FIRESTORE_URL__: JSON.stringify('https://firestore.googleapis.com'),
    __FRONTEND_BASE_URL__: JSON.stringify('https://lingogram.ai'),
    __EXT_SOURCE__: JSON.stringify('embed'),
    ...limitDefines(loadLingogramLimits()),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'Lingogram',
      formats: ['es', 'umd'],
      fileName: (format) => (format === 'es' ? 'lingogram-embed.mjs' : 'lingogram-embed.umd.js'),
    },
    minify: true,
  },
});
