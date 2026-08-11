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

const FRONTEND_BASE_URL = process.env.EXT_FRONTEND_BASE_URL ?? 'https://lingogram.ai';

// The manifest match pattern for a non-production frontend, or '' when this
// build targets production (whose origins the manifest already lists).
// localhost is excluded too: the manifest carries those entries already, and
// they are deliberately stripped from prod builds just below.
const originMatch = (baseUrl: string, varName: string): string => {
  if (!baseUrl || baseUrl === 'https://lingogram.ai') return '';
  try {
    const { origin, hostname } = new URL(baseUrl);
    return hostname === 'localhost' || hostname === '127.0.0.1' ? '' : `${origin}/*`;
  } catch {
    throw new Error(`${varName} is not a valid URL: ${baseUrl}`);
  }
};

const FRONTEND_ORIGIN_MATCH = originMatch(FRONTEND_BASE_URL, 'EXT_FRONTEND_BASE_URL');
// Second origin for the dev-only backend switch, when a build is given one.
const ALT_ORIGIN_MATCH = originMatch(
  process.env.EXT_ALT_FRONTEND_BASE_URL ?? '',
  'EXT_ALT_FRONTEND_BASE_URL',
);

const EXT_SOURCE = 'youtube-extension';
const limits = loadLingogramLimits();
assertSourceAllowed(limits, EXT_SOURCE);

const buildDefines = {
  __EXT_ENV__: JSON.stringify(env),
  // Firebase project. Overridable so a build can target preprod, whose
  // /auth/extension-token mints a custom token signed by ITS project — and
  // Firebase refuses to exchange a token from one project using another
  // project's API key, so these two must move together with the frontend URL.
  __FIREBASE_PROJECT_ID__: JSON.stringify(
    process.env.EXT_FIREBASE_PROJECT_ID ?? (isDev ? 'demo-lingogram' : 'lingogram-prod'),
  ),
  __FIREBASE_API_KEY__: JSON.stringify(
    process.env.EXT_FIREBASE_API_KEY ?? (isDev ? 'demo' : 'AIzaSyCHQt2zwkO-x8qm7wM5IwWAWrl_n8mlQLI'),
  ),
  __IDENTITY_TOOLKIT_URL__: JSON.stringify(isDev ? 'http://localhost:9099/identitytoolkit.googleapis.com' : 'https://identitytoolkit.googleapis.com'),
  __SECURE_TOKEN_URL__: JSON.stringify(isDev ? 'http://localhost:9099/securetoken.googleapis.com' : 'https://securetoken.googleapis.com'),
  __FIRESTORE_URL__: JSON.stringify(isDev ? 'http://localhost:8080' : 'https://firestore.googleapis.com'),
  // Auth/sign-in web app. Always prod unless EXT_FRONTEND_BASE_URL overrides
  // (e.g. staging or a local Vite server) — dev builds intentionally point at
  // the live site so their "Sign in" flow works without running the SPA.
  __FRONTEND_BASE_URL__: JSON.stringify(FRONTEND_BASE_URL),
  __EXT_SOURCE__: JSON.stringify(EXT_SOURCE),
  // Optional SECOND target for the dev-only backend switch (see
  // packages/shared/src/auth/devEnvSwitch.ts). Supplied at build time only —
  // no environment's project id, key, or host is stored in this repo. Empty
  // in every build that isn't handed them, which leaves the switch inert.
  // Dropped from prod bundles: devEnvSwitch sits behind an __EXT_ENV__ guard.
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
                // Localhost host_permissions are only needed for the Firebase
                // emulator + local frontend in dev. Strip them in prod so the
                // Web Store warning doesn't list http://localhost URLs.
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
                // A build pointed somewhere other than production (preprod, a
                // staging host) has to let that origin talk to the extension:
                // the sign-in handoff is a chrome.runtime message from the
                // page, and externally_connectable is an allow-list, so
                // without this the auth flow silently never connects.
                // ALT_ORIGIN_MATCH is the dev-only switch's second target: the
                // manifest is static, so a build that cannot name both origins
                // up front can move its data plane but never complete a
                // sign-in on the other side.
                for (const origin of [FRONTEND_ORIGIN_MATCH, ALT_ORIGIN_MATCH]) {
                  if (!origin) continue;
                  const add = (list: string[] | undefined) =>
                    list && !list.includes(origin) ? [...list, origin] : list;
                  if (manifest.externally_connectable?.matches) {
                    manifest.externally_connectable.matches =
                      add(manifest.externally_connectable.matches);
                  }
                  manifest.host_permissions = add(manifest.host_permissions);
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
            {
              // _locales/<lang>/messages.json — localizes the extension name
              // and store summary (referenced via __MSG_*__ in the manifest).
              src: '_locales',
              dest: '.',
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
