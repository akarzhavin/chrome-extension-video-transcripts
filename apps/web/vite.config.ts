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

const EXT_SOURCE = 'web-extension';
const limits = loadLingogramLimits();
assertSourceAllowed(limits, EXT_SOURCE);

const buildDefines = {
  __EXT_ENV__: JSON.stringify(env),
  __FIREBASE_PROJECT_ID__: JSON.stringify(isDev ? 'demo-lingogram' : 'lingogram-prod'),
  __FIREBASE_API_KEY__: JSON.stringify(isDev ? 'demo' : 'AIzaSyCHQt2zwkO-x8qm7wM5IwWAWrl_n8mlQLI'),
  __IDENTITY_TOOLKIT_URL__: JSON.stringify(isDev ? 'http://localhost:9099/identitytoolkit.googleapis.com' : 'https://identitytoolkit.googleapis.com'),
  __SECURE_TOKEN_URL__: JSON.stringify(isDev ? 'http://localhost:9099/securetoken.googleapis.com' : 'https://securetoken.googleapis.com'),
  __FIRESTORE_URL__: JSON.stringify(isDev ? 'http://localhost:8080' : 'https://firestore.googleapis.com'),
  __FRONTEND_BASE_URL__: JSON.stringify(process.env.EXT_FRONTEND_BASE_URL ?? (isDev ? 'http://localhost:5173' : 'https://lingogram.ai')),
  __EXT_SOURCE__: JSON.stringify(EXT_SOURCE),
  ...limitDefines(limits),
};

export default defineConfig(({ command, mode }) => {
  if (command === 'build') {
    const isBackground = mode === 'background';
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
            : resolve(__dirname, 'src/popup/popup.ts'),
          formats: [isBackground ? 'es' : 'iife'],
          name: isPopup ? 'WebPopup' : undefined,
          fileName: () => {
            if (isBackground) return 'src/background/background.js';
            if (isPopup) return 'src/popup/popup.js';
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
                if (isDev) {
                  delete manifest.key;
                }
                if (typeof manifest.key === 'string' && manifest.key.startsWith('REPLACE_WITH_')) {
                  delete manifest.key;
                }
                if (!isDev && Array.isArray(manifest.host_permissions)) {
                  manifest.host_permissions = manifest.host_permissions.filter(
                    (p: string) => !p.startsWith('http://localhost'),
                  );
                }
                if (!isDev && manifest.externally_connectable?.matches) {
                  manifest.externally_connectable.matches = manifest.externally_connectable.matches.filter(
                    (p: string) => !p.startsWith('http://localhost'),
                  );
                }
                return JSON.stringify(manifest, null, 2);
              },
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
      ].filter(Boolean),
    };
  }
  return commonConfig;
});
