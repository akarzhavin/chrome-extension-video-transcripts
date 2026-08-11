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
  // Auth/sign-in web app. Always prod unless EXT_FRONTEND_BASE_URL overrides
  // (e.g. staging or a local Vite server) — dev builds intentionally point at
  // the live site so their "Sign in" flow works without running the SPA.
  __FRONTEND_BASE_URL__: JSON.stringify(process.env.EXT_FRONTEND_BASE_URL ?? 'https://lingogram.ai'),
  __EXT_SOURCE__: JSON.stringify(EXT_SOURCE),
  // The alternate backend the dev sidebar can switch to. Empty here and in
  // every build not handed the values, which leaves the switch inert — no
  // environment's project id, key, or host is stored in this repo.
  //
  // These MUST be defined even though this edition has no environment switch in
  // its UI: auth/background.ts imports auth/devEnvSwitch unconditionally, so the
  // identifiers reach the bundle regardless. Left undefined they survive
  // minification and throw a ReferenceError while the service worker evaluates
  // its module — before a single listener is registered, which disables the
  // whole extension with nothing shown on chrome://extensions. That is exactly
  // what happened here: this edition shipped dead from #30 until 2026-08-10.
  // assert-shippable now fails on any unsubstituted __EXT_*__ for this reason.
  __EXT_ALT_PROJECT_ID__: JSON.stringify(process.env.EXT_ALT_PROJECT_ID ?? ''),
  __EXT_ALT_API_KEY__: JSON.stringify(process.env.EXT_ALT_API_KEY ?? ''),
  __EXT_ALT_FRONTEND_BASE_URL__: JSON.stringify(process.env.EXT_ALT_FRONTEND_BASE_URL ?? ''),
  // GA4 Measurement Protocol. The api_secret is a WRITE-ONLY credential: it can
  // send events to our property, not read from it. It ships inside the service
  // worker bundle, so treat a leak as a data-poisoning risk (rotate it in the
  // GA4 admin), not an exfiltration one. Empty by default — analytics-bg's
  // track() early-returns on an empty secret, so a build without
  // EXT_GA4_API_SECRET is a silent no-op rather than a stream of broken hits.
  //
  // Dev and prod use SEPARATE GA4 properties; dev additionally posts to
  // /debug/mp/collect, which validates the payload instead of silently 204-ing.
  __GA4_MEASUREMENT_ID__: JSON.stringify(process.env.EXT_GA4_MEASUREMENT_ID ?? ''),
  __GA4_API_SECRET__: JSON.stringify(process.env.EXT_GA4_API_SECRET ?? ''),
  __GA4_ENDPOINT__: JSON.stringify(
    process.env.EXT_GA4_ENDPOINT ?? 'https://www.google-analytics.com',
  ),
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
