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
// they are deliberately stripped from prod builds further down.
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
// Our own API (POST /dictionary/lookup). Empty = the feature is off and no
// origin is added anywhere. The worker's fetch needs host_permissions to
// bypass CORS (the edge's allow-list has no chrome-extension:// origin), so
// the origin goes into the manifest below, not only into the define.
const API_BASE_URL = process.env.EXT_API_BASE_URL ?? '';
const API_ORIGIN_MATCH = (() => {
  if (!API_BASE_URL) return '';
  try {
    return `${new URL(API_BASE_URL).origin}/*`;
  } catch {
    throw new Error(`EXT_API_BASE_URL is not a valid URL: ${API_BASE_URL}`);
  }
})();
// Second origin for the dev-only backend switch, when a build is given one.
const ALT_ORIGIN_MATCH = originMatch(
  process.env.EXT_ALT_FRONTEND_BASE_URL ?? '',
  'EXT_ALT_FRONTEND_BASE_URL',
);

// EXT_FIREBASE_HOSTS=live keeps a dev build on the cloud Firebase hosts. The
// emulators are the right default for local work, but they are also the reason
// a dev build cannot reach a cloud project: applySide() retargets projectId,
// apiKey and frontendBaseUrl, never the host, so a switch to a cloud project
// would otherwise still resolve against localhost.
const useLiveHosts = !isDev || process.env.EXT_FIREBASE_HOSTS === 'live';
const identityToolkitUrl = useLiveHosts
  ? 'https://identitytoolkit.googleapis.com'
  : 'http://localhost:9099/identitytoolkit.googleapis.com';
const secureTokenUrl = useLiveHosts
  ? 'https://securetoken.googleapis.com'
  : 'http://localhost:9099/securetoken.googleapis.com';
const firestoreUrl = useLiveHosts ? 'https://firestore.googleapis.com' : 'http://localhost:8080';

const EXT_SOURCE = 'rezka-extension';
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
  // Firebase hosts. A dev build defaults to the local emulators, but can be
  // pointed at the live ones — the env switch retargets the project, not the
  // host, so switching to a CLOUD project needs these to be cloud too.
  __IDENTITY_TOOLKIT_URL__: JSON.stringify(identityToolkitUrl),
  __SECURE_TOKEN_URL__: JSON.stringify(secureTokenUrl),
  __FIRESTORE_URL__: JSON.stringify(firestoreUrl),
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
  // Lookup API for this side and (dev switch) the other one. Empty = off.
  __EXT_API_BASE_URL__: JSON.stringify(API_BASE_URL),
  __EXT_ALT_API_BASE_URL__: JSON.stringify(process.env.EXT_ALT_API_BASE_URL ?? ''),
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
                if (useLiveHosts && Array.isArray(manifest.host_permissions)) {
                  manifest.host_permissions = manifest.host_permissions.filter(
                    (p) => !p.startsWith('http://localhost'),
                  );
                }
                if (!isDev && manifest.externally_connectable?.matches) {
                  manifest.externally_connectable.matches = manifest.externally_connectable.matches.filter(
                    (p) => !p.startsWith('http://localhost'),
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
                // API_ORIGIN_MATCH goes into host_permissions only — unlike
                // the frontend origins it never talks TO the extension, so it
                // has no business in externally_connectable.
                if (API_ORIGIN_MATCH && Array.isArray(manifest.host_permissions)
                    && !manifest.host_permissions.includes(API_ORIGIN_MATCH)) {
                  manifest.host_permissions = [...manifest.host_permissions, API_ORIGIN_MATCH];
                }
                for (const origin of [FRONTEND_ORIGIN_MATCH, ALT_ORIGIN_MATCH]) {
                  if (!origin) continue;
                  const add = (list) =>
                    list && !list.includes(origin) ? [...list, origin] : list;
                  if (manifest.externally_connectable?.matches) {
                    manifest.externally_connectable.matches =
                      add(manifest.externally_connectable.matches);
                  }
                  manifest.host_permissions = add(manifest.host_permissions);
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
