# Dev-only URL flags

These work **in dev builds only** (`EXT_ENV=dev`). In production the branches are
unreachable behind an `__EXT_ENV__ !== 'dev'` guard, so the minifier drops them —
they are not in the bundle at all.

Flags go in the URL **hash**, not the query string. YouTube (an SPA) rewrites the
address bar when the player loads and discards foreign query params before the
content script can read them; HDrezka strips `?…` on redirect. The hash survives
both. The regex in the code accepts `[?#&]`, but the hash form is the reliable one.

## `lingogram_rate=1` — the "rate us" card

```
https://www.youtube.com/watch?v=<id>#lingogram_rate=1
https://rezka.ag/…/12345-….html#t:238-s:1&lingogram_rate=1
```

Forces the rating prompt (P1.8) — the "Enjoying Lingogram?" card in the bottom
right corner. Normally it appears **once per install**, after the 30th saved
word, so without this flag the only way to see it again is clearing
`chrome.storage`.

The flag does not touch state: `rate.savedWordCount` is not incremented and the
`rate.promptShown` one-shot is not burned. No sign-in required.

Both branches are reachable from the card:

- **"Yes!"** → step 2, with a link to the Web Store review page;
- **"Not really"** → the feedback form (textarea + Send). The submit is **real**:
  it writes to Firestore in whichever project the build targets, so watch that it
  is not production. Works signed out too.

Implementation: `applyDevRatePromptOverride()` in
`packages/shared/src/content/quick-add-overlay.ts` (called from
`installQuickAddOverlay`). The production threshold logic lives in `ADD_WORD` in
`packages/shared/src/auth/background.ts`.

### Building against a real backend to test the submit

`npm run build:dev` points Firestore at `localhost:8080` (the emulator)
regardless of `EXT_FIREBASE_PROJECT_ID`. To exercise a write against a real
non-production project you need a hybrid: background in prod mode (real
Firestore) and content in dev (otherwise the flag is compiled out). Order
matters — `--mode background` wipes `build/`, so it always goes first.

Supply your own values: **no project id, key, or host belongs in this
repository**. Take them from the environment (see `english/frontend/.env.*` or
the Firebase Console).

```sh
cd apps/youtube
export EXT_FIREBASE_PROJECT_ID=<project-id>
export EXT_FIREBASE_API_KEY=<web-api-key>
export EXT_FRONTEND_BASE_URL=https://<host>
../../node_modules/.bin/vite build --mode background
EXT_ENV=dev ../../node_modules/.bin/vite build --mode content
../../node_modules/.bin/vite build --mode page-script
../../node_modules/.bin/vite build --mode popup
```

Chrome 138+ ignores `--load-extension`, so an unpacked build is installed into a
persistent profile by hand once and driven over CDP after that — see
`apps/youtube/screenshots/run-all.sh`.

## Backend switch (sidebar)

A dev build shows a full-width bar at the very top of the sidebar, above the
"Subtitles" title, naming the backend it is talking to. Clicking it switches
**at runtime** — no rebuild.

It sits in the header rather than inside Settings on purpose: in the settings
panel it fell below the fold and got missed entirely, which defeats the point of
having it.

The colour follows the **data**, not which slot the build put it in:

- **red** — the live production project. Real users' words and accounts.
- **indigo** — anything else. That is where you are meant to be while testing.

Either target can be production depending on how the build was configured, which
is why the colour is derived from the project id rather than from the slot.

Switching **signs you out**: an ID token only means something inside the project
that issued it. The choice is stored in `chrome.storage.local`
(`dev.targetEnv`) and survives the service worker being torn down and respawned,
which Chrome does aggressively.

If a build was given no second target, the bar still names the current backend
but is inert — there is nothing to switch to.

### No credentials in the repository

Both targets arrive **at build time**, through environment variables. Not one
project id, key, or host is written down in the source — for any environment.
The two sides are deliberately named `home`/`away` rather than `prod`/`preprod`
so that even the environment names stay out of the checkout.

The build's own target comes from the existing `EXT_FIREBASE_*` /
`EXT_FRONTEND_BASE_URL`. The second one comes from `EXT_ALT_*`:

```sh
cd apps/youtube
export EXT_ENV=dev
# what this build targets (home)
export EXT_FIREBASE_PROJECT_ID=<project-a>
export EXT_FIREBASE_API_KEY=<key-a>
export EXT_FRONTEND_BASE_URL=https://<host-a>
# the second target the switch can reach (away)
export EXT_ALT_PROJECT_ID=<project-b>
export EXT_ALT_API_KEY=<key-b>
export EXT_ALT_FRONTEND_BASE_URL=https://<host-b>

ALLOW_UNSHIPPABLE_ZIP=1 npm run build
```

Run it through `npm run build`, not bare `npx vite build`: `npm` is what sets
`npm_package_version`, and without it the manifest is stamped with the monorepo
root's version instead of the extension's. `ALLOW_UNSHIPPABLE_ZIP=1` is needed
because the packaging gate refuses to zip a dev build — see below.

With no `EXT_ALT_*` set there is nothing to switch to and the bar is inert.
That is exactly what a checkout handed no credentials gets.

### What switches and what does not

Firestore, Identity Toolkit, and the frontend URL all switch at runtime: every
consumer reads `config.x` at call time, and nothing caches a field at import.

**`manifest.json` cannot switch.** `externally_connectable` and
`host_permissions` are static, and they are what decides whether a page may talk
to the extension at all. That is why `EXT_ALT_FRONTEND_BASE_URL` writes the
**second origin into the manifest** at build time: without it the data plane
switches but the sign-in handoff on the other side silently never connects.

Note that a locally-loaded build gets a **random extension id** from Chrome, so
its id has to be allow-listed by whichever frontend it signs in against
(`VITE_EXTRA_EXTENSION_IDS`, non-production only). The id changes on every
reinstall unless the manifest ships a `key`.

### Why none of this reaches production

The guard is `__EXT_ENV__ !== 'dev'`. Vite substitutes the literal **before**
minification, so the branch becomes unreachable and is removed wholesale: a
production bundle carries no environment table, no keys, and no `DEV_*` action
names. Verified by scanning every file in the build; all that remains is an
empty `wireEnvSwitch(e){}` stub and CSS rules styling an element that is never
created.

**Guard on `__EXT_ENV__`, never on `isDev`** from `auth/config`. `isDev` is
computed at runtime (`config.env === 'dev'`), so a minifier cannot prove it
constant and keeps the code — which is exactly what happened with an earlier
version of this badge.

**Static imports only.** `await import('./devEnvSwitch')` makes Vite emit
separate `.mjs` chunks next to the bundle, and an MV3 service worker will not
load them — the extension breaks silently. A static import keeps one file, and
the guard still drops the module from production.

Implementation: `packages/shared/src/auth/devEnvSwitch.ts` and `wireEnvSwitch()`
in `packages/shared/src/SidebarUI.ts`.

### The packaging gate

`npm run build` runs `packages/shared/assert-shippable.mjs` between the build and
the zip, and **refuses to write the zip** for anything that must not reach the
Web Store: a compiled-in dev switch, a non-production Firebase project, a
localhost origin, a non-production origin in the manifest, or a placeholder
version (`0.0.0`/`1.0.0`, which is what you get running vite outside npm).

It inspects the build output rather than the env vars that produced it. Env vars
are what people get wrong; the artifact is what actually ships, and it is the one
piece of evidence that cannot be stale. This matters because the zip's *name*
carries no evidence at all — `youtube-v1.0.12.zip` looks like a release whether
it was built for production or pointed at a staging backend with the switch
compiled in.

To package a dev build deliberately (handing one to a tester), set
`ALLOW_UNSHIPPABLE_ZIP=1`. It prints what it waived and reminds you not to
upload the result.

## `lng=<locale>` — locale override (rezka)

```
https://rezka.ag/…/84221-….html#t:238-s:1-e:1&lng=ru
```

Swaps the extension's i18n messages for a locale from
`_locales/<locale>/messages.json` without changing Chrome's own language (which
cannot be set by a flag on macOS). Rezka edition only.

Implementation: `applyDevLocaleOverride()` in `apps/rezka/src/content/index.ts`,
with the `DEV_LOAD_LOCALE` handler in `apps/rezka/src/background/background.ts`.
