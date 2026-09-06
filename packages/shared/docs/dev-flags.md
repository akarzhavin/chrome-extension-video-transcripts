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
right corner. Normally it appears **once per install**, after the 5th saved
word (`RATE_PROMPT_WORD_THRESHOLD` in `packages/shared/src/auth/storage.ts`), so
without this flag the only way to see it again is clearing `chrome.storage`.

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

## `EXT_FIREBASE_HOSTS=live` — point a dev build at cloud Firebase

`npm run build:dev` resolves Firestore at `http://localhost:8080` and Identity
Toolkit at `http://localhost:9099`, against project `demo-lingogram`. That is the
right default for local work, but it means **anything that writes to Firestore
does nothing unless the emulators are running** — and it fails quietly, because
the callers treat these writes as best-effort. The symptom is a feature that
"works" while the collection stays empty.

Seen in practice: the emergency "Reload page" diagnostic posted to
`localhost:8080` and the handler returned `{ok:false}`. Nothing in the UI said
so; the write simply never reached a real backend.

To exercise the real thing, keep dev analytics but move the hosts:

```sh
EXT_FIREBASE_HOSTS=live ./scripts/build-with-analytics.sh dev
```

That alone still targets `demo-lingogram`, which does not exist in the cloud —
`applySide()` retargets projectId/apiKey/frontendBaseUrl but never the host, so
name the project too:

```sh
EXT_FIREBASE_HOSTS=live \
EXT_FIREBASE_PROJECT_ID=<project-id> \
EXT_FIREBASE_API_KEY=<web-api-key> \
./scripts/build-with-analytics.sh dev
```

`EXT_ENV` stays `dev`, so GA4 still posts to the dev property and the
`lingogram_http` flag survives — only the Firebase host moves. Take the project
id and key from the environment (`english/frontend/.env.preprod` or the Firebase
Console); **prefer preprod over production**, and remember a write that lands in
production lands under your real uid.

Implementation: `useLiveHosts` in `apps/<app>/vite.config.ts`.

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

WRITE_UNSHIPPABLE_ZIP=1 npm run build
```

Run it through `npm run build`, not bare `npx vite build`: `npm` is what sets
`npm_package_version`, and without it the manifest is stamped with the monorepo
root's version instead of the extension's. `WRITE_UNSHIPPABLE_ZIP=1` is needed
because the packaging gate refuses to zip a dev build — see below. The archive
it writes is named `<app>-v<version>-UNSHIPPABLE.zip`.

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
localhost origin, a placeholder version (`0.0.0`/`1.0.0`, which is what you get
running vite outside npm), or a manifest whose origins are not the expected ones.

The gate runs before the zip is deleted, so a refusal leaves any existing
release archive untouched.

Manifest origins are checked against a **fixed list**, not a suspicious-looking
pattern — a pattern only catches the bad origins someone thought of, while an
exact list also catches the ones nobody anticipated:

- `externally_connectable` is pinned exactly. It is the shortest and most
  dangerous list in the manifest: every origin on it can hand the extension a
  signed-in user's SSO token, so an unexpected entry is a security finding.
  A *missing* entry is flagged too — sign-in would simply not connect.
- `host_permissions` is checked in halves. The infrastructure origins
  (identitytoolkit, securetoken, firestore) are pinned exactly. Content-site
  origins are matched by pattern, because Rezka alone ships ~250 mirror domains
  and that list grows whenever a mirror appears — pinning those would make the
  gate fail on routine edits, and a gate that cries wolf stops being read.

  The pattern is deliberately narrow: those 250 entries are only a handful of
  second-level **names** (`rezka`, `hdrezka`) spread across 177 flat TLDs, so
  the name is pinned and only the zone is free. A single TLD label, no second
  dot — otherwise `hdrezka.evil.com` would pass as a mirror. A genuinely new
  zone needs no gate edit; a lookalike domain does not get in.

Both lists live at the top of `assert-shippable.mjs`. Adding a genuinely new
backend means editing them — deliberately, in a reviewed diff.

It inspects the build output rather than the env vars that produced it. Env vars
are what people get wrong; the artifact is what actually ships, and it is the one
piece of evidence that cannot be stale.

The zip's *name* used to carry no evidence either — `youtube-v1.0.12.zip` looked
like a release whether it was built for production or pointed at a staging
backend with the switch compiled in. That is not a hypothetical: youtube 1.0.15
reached the store carrying the dev backend switch, a localhost origin and
`preprod.lingogram.ai` in `externally_connectable`, because a dev run wrote an
archive under the release name.

So the name now carries the verdict. To package a rejected build deliberately
(handing one to a tester), set `WRITE_UNSHIPPABLE_ZIP=1`: the archive is written
as `<app>-v<version>-UNSHIPPABLE.zip`, which cannot be mistaken for a release in
a file picker. A dev run of `build-with-analytics.sh` writes no archive at all —
a dev build is loaded unpacked from `build/`.

Before uploading anything, run the gate against the ARCHIVE rather than against
`build/`, which the next build overwrites:

```bash
npm run verify-zip -- releases/youtube-v1.0.17.zip
```

## `lng=<locale>` — locale override (rezka)

```
https://rezka.ag/…/84221-….html#t:238-s:1-e:1&lng=ru
```

Swaps the extension's i18n messages for a locale from
`_locales/<locale>/messages.json` without changing Chrome's own language (which
cannot be set by a flag on macOS). Rezka edition only.

Implementation: `applyDevLocaleOverride()` in `apps/rezka/src/content/index.ts`,
with the `DEV_LOAD_LOCALE` handler in `apps/rezka/src/background/background.ts`.
