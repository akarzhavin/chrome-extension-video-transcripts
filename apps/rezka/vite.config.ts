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

const EXT_SOURCE = 'rezka-extension';
const limits = loadLingogramLimits();
assertSourceAllowed(limits, EXT_SOURCE);

const buildDefines = {
  __EXT_ENV__: JSON.stringify(env),
  __FIREBASE_PROJECT_ID__: JSON.stringify(isDev ? 'demo-lingogram' : 'lingogram-prod'),
  __FIREBASE_API_KEY__: JSON.stringify(isDev ? 'demo' : 'AIzaSyCHQt2zwkO-x8qm7wM5IwWAWrl_n8mlQLI'),
  __IDENTITY_TOOLKIT_URL__: JSON.stringify(isDev ? 'http://localhost:9099/identitytoolkit.googleapis.com' : 'https://identitytoolkit.googleapis.com'),
  __SECURE_TOKEN_URL__: JSON.stringify(isDev ? 'http://localhost:9099/securetoken.googleapis.com' : 'https://securetoken.googleapis.com'),
  __FIRESTORE_URL__: JSON.stringify(isDev ? 'http://localhost:8080' : 'https://firestore.googleapis.com'),
  // Auth/sign-in web app. Always prod unless EXT_FRONTEND_BASE_URL overrides
  // (e.g. staging or a local Vite server) — dev builds intentionally point at
  // the live site so their "Sign in" flow works without running the SPA.
  __FRONTEND_BASE_URL__: JSON.stringify(process.env.EXT_FRONTEND_BASE_URL ?? 'https://lingogram.ai'),
  __EXT_SOURCE__: JSON.stringify(EXT_SOURCE),
  ...limitDefines(limits),
};

export default defineConfig(({ command, mode }) => {
  if (command === 'build') {
    const isBackground = mode === 'background';
    const isContent = mode === 'content';
    const isInterceptor = mode === 'interceptor';
    const isPopup = mode === 'popup';

    return {
      ...commonConfig,
      define: buildDefines,
      build: {
        outDir: 'build',
        // Important: only empty the dir on the very first pass
        emptyOutDir: isBackground,
        lib: {
          entry: isBackground
            ? resolve(__dirname, 'src/background/background.ts')
            : isContent
              ? resolve(__dirname, 'src/content/index.ts')
              : isPopup
                ? resolve(__dirname, 'src/popup/popup.ts')
                : resolve(__dirname, 'src/content/network-interceptor.ts'),
          formats: [isBackground ? 'es' : 'iife'],
          name: isContent ? 'VttContent' : isInterceptor ? 'VttInterceptor' : isPopup ? 'VttPopup' : undefined,
          fileName: () => {
            if (isBackground) return 'src/background/background.js';
            if (isContent) return 'src/content/index.js';
            if (isInterceptor) return 'src/content/network-interceptor.js';
            if (isPopup) return 'src/popup/popup.js';
            return 'bundle.js';
          }
        },
        rollupOptions: {
          output: {
            extend: true,
          }
        }
      },
      plugins: [
        // Only copy static files on the first pass
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
                // Localhost host_permissions are only needed for the Firebase
                // emulator + local frontend in dev. Strip them in prod so the
                // Web Store warning doesn't list http://localhost URLs.
                if (!isDev && Array.isArray(manifest.host_permissions)) {
                  manifest.host_permissions = manifest.host_permissions.filter(
                    (p) => !p.startsWith('http://localhost'),
                  );
                }
                if (!isDev && manifest.externally_connectable?.matches) {
                  manifest.externally_connectable.matches = manifest.externally_connectable.matches.filter(
                    (p) => !p.startsWith('http://localhost'),
                  );
                }
                return JSON.stringify(manifest, null, 2);
              }
            },
            {
              src: 'src/assets/styles.css',
              dest: 'src/assets',
              rename: { stripBase: true }
            },
            {
              src: 'src/assets/icons/*.png',
              dest: 'src/assets/icons',
              rename: { stripBase: true }
            },
            {
              src: '../../packages/shared/src/popup/popup.html',
              dest: '.',
              rename: { stripBase: true }
            },
            {
              src: '../../packages/shared/src/popup/popup.css',
              dest: 'src/popup',
              rename: { stripBase: true }
            },
            {
              // _locales/<lang>/messages.json — localizes the extension name
              // and store summary (referenced via __MSG_*__ in the manifest).
              src: '_locales',
              dest: '.'
            }
          ],
        }),
        isContent && {
          name: 'remove-export-statement',
          generateBundle(options, bundle) {
            for (const fileName in bundle) {
              if (fileName.includes('content/index.js')) {
                const chunk = bundle[fileName];
                if (chunk.type === 'chunk') {
                  // Remove 'export { ... }' or 'export default ...'
                  chunk.code = chunk.code.replace(/export\s+\{\s*.*?\s*\}?;?/g, '');
                  chunk.code = chunk.code.replace(/export\s+default\s+.*?;?/g, '');
                  // Wrap in IIFE to be safe
                  chunk.code = `(function() {\n${chunk.code}\n})();`;
                }
              }
            }
          }
        }
      ].filter(Boolean),
    };
  }
  return commonConfig;
});
