import { defineConfig } from 'vite';
import { resolve } from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { loadLingogramLimits, limitDefines, assertSourceAllowed } from '../../packages/shared/vite-limits.mjs';

const commonConfig = {
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
};

const env = process.env.EXT_ENV ?? 'prod';
const isDev = env === 'dev';

const EXT_SOURCE = 'youtube-extension';
const limits = loadLingogramLimits();
assertSourceAllowed(limits, EXT_SOURCE);

const buildDefines = {
  __EXT_ENV__: JSON.stringify(env),
  __FIREBASE_PROJECT_ID__: JSON.stringify(isDev ? 'demo-lingogram' : 'project-51896e3c-eb11-40-4279f'),
  __FIREBASE_API_KEY__: JSON.stringify(isDev ? 'demo' : 'AIzaSyDeUTNMiBpHeP1Ay52IA_S0jNQjTVny68s'),
  __IDENTITY_TOOLKIT_URL__: JSON.stringify(isDev ? 'http://localhost:9099/identitytoolkit.googleapis.com' : 'https://identitytoolkit.googleapis.com'),
  __SECURE_TOKEN_URL__: JSON.stringify(isDev ? 'http://localhost:9099/securetoken.googleapis.com' : 'https://securetoken.googleapis.com'),
  __FIRESTORE_URL__: JSON.stringify(isDev ? 'http://localhost:8080' : 'https://firestore.googleapis.com'),
  __FRONTEND_BASE_URL__: JSON.stringify(process.env.EXT_FRONTEND_BASE_URL ?? (isDev ? 'http://localhost:5173' : 'https://lingogram-app.web.app')),
  __EXT_SOURCE__: JSON.stringify(EXT_SOURCE),
  ...limitDefines(limits),
};

export default defineConfig(({ command, mode }) => {
  if (command === 'build') {
    const isBackground = mode === 'background';
    const isContent = mode === 'content';
    const isPageScript = mode === 'page-script';
    const isPopup = mode === 'popup';

    return {
      ...commonConfig,
      define: buildDefines,
      build: {
        outDir: 'build',
        emptyOutDir: isBackground,
        minify: true,
        lib: {
          entry: isBackground
            ? resolve(__dirname, 'src/background/background.ts')
            : isContent
              ? resolve(__dirname, 'src/content/index.ts')
              : isPopup
                ? resolve(__dirname, 'src/popup/popup.ts')
                : resolve(__dirname, 'src/content/page-script.ts'),
          formats: [isBackground ? 'es' : 'iife'],
          name: isContent ? 'YtVttContent' : isPageScript ? 'YtPageScript' : isPopup ? 'YtPopup' : undefined,
          fileName: () => {
            if (isBackground) return 'src/background/background.js';
            if (isContent) return 'src/content/index.js';
            if (isPopup) return 'src/popup/popup.js';
            if (isPageScript) return 'src/content/page-script.js';
            return 'bundle.js';
          },
        },
        rollupOptions: {
          output: {
            extend: true,
          },
        },
      },
      plugins: [
        isBackground && viteStaticCopy({
          targets: [
            {
              src: 'manifest.json',
              dest: '.',
              transform: (content) => {
                const manifest = JSON.parse(content);
                manifest.version = process.env.npm_package_version || manifest.version;
                // Strip prod-only placeholders in dev so Chrome can load unpacked.
                if (isDev) {
                  delete manifest.key;
                }
                // Even in prod builds, drop the `key` if it's still the
                // REPLACE_WITH_ placeholder — otherwise Chrome refuses to load
                // the unpacked build (invalid base64).
                if (typeof manifest.key === 'string' && manifest.key.startsWith('REPLACE_WITH_')) {
                  delete manifest.key;
                }
                return JSON.stringify(manifest, null, 2);
              },
            },
            {
              src: '../rezka/src/assets/styles.css',
              dest: 'src/assets',
              rename: { stripBase: true },
            },
            {
              src: '../rezka/src/assets/icons/*.png',
              dest: 'src/assets/icons',
              rename: { stripBase: true },
            },
            {
              src: '../../packages/shared/src/popup/popup.html',
              dest: '.',
              rename: { stripBase: true },
            },
            {
              src: '../../packages/shared/src/popup/popup.css',
              dest: 'src/popup',
              rename: { stripBase: true },
            },
          ],
        }),
        isContent && {
          name: 'remove-export-statement',
          generateBundle(_options: unknown, bundle: Record<string, { type: string; code?: string }>) {
            for (const fileName in bundle) {
              if (fileName.includes('content/index.js')) {
                const chunk = bundle[fileName];
                if (chunk.type === 'chunk' && chunk.code) {
                  chunk.code = chunk.code.replace(/export\s+\{\s*.*?\s*\}?;?/g, '');
                  chunk.code = chunk.code.replace(/export\s+default\s+.*?;?/g, '');
                  chunk.code = `(function() {\n${chunk.code}\n})();`;
                }
              }
            }
          },
        },
      ].filter(Boolean),
    };
  }
  return commonConfig;
});
