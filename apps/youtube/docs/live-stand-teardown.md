# Building a live stand against a second environment, and taking it down

Written 2026-09-04 while preparing phase 6 of the claim-level coverage plan.
Everything here is measured, not inferred; the measurements are named so they
can be re-checked when the code moves.

Read this before pointing a build at anything other than the emulators.

## Why this document exists

Chrome loads the unpacked extension from **one** directory —
`…/lingogram/apps/youtube/build` — hardcoded in `e2e/fixtures/extension.ts`.
Every worktree and every phase shares it. A build left there is the build the
next person tests against, and neither of the suite's two guards will notice a
wrong one:

- `assertBuildIsFresh()` compares **mtime only**, never content. A stand build
  is fresh by definition, and so is the ordinary build that replaces it.
- The dictionary guard is `/https:\/\/[a-z0-9.-]*run\.app/` — it matches **any**
  Cloud Run host, so a preprod gateway satisfies it exactly as production does.

So a wrong-environment build passes both guards silently, and the failures it
causes look like a product regression rather than a misconfigured stand. That is
the same failure the dictionary guard was written against: its own comment
records an absent lookup address masquerading as a regression for half an hour.

## The build command defaults to production

```
build     = vite build ×4  (no EXT_ENV)  && npm run zip
build:dev = EXT_ENV=dev vite build ×4    (no zip)
```

`npm run build` therefore produces `env: "prod"`, `projectId: "lingogram-prod"`
and the live `googleapis.com` endpoints. The four `vite build` steps run
**before** `zip`, so a run that dies on the packaging gate (exit 1) has already
overwritten `build/`.

**A red exit does not mean nothing was built.** A production bundle was found in
a worktree on 2026-09-04, produced exactly this way as the by-product of a failed
run — the worst shape of the trap, because the operator sees an error and
concludes nothing happened.

For a stand, export all of: `EXT_ENV=dev`, the three `EXT_ALT_*` values the
switch requires together (`devEnvSwitch.ts` returns `AWAY = null` unless
`EXT_ALT_PROJECT_ID`, `EXT_ALT_API_KEY` **and** `EXT_ALT_FRONTEND_BASE_URL` are
all present), `EXT_ALT_API_BASE_URL` for that environment's lookup API, and
`WRITE_UNSHIPPABLE_ZIP=1` if an archive is wanted. Build through `npm`, not a
bare `npx vite build`, or the manifest is stamped with the monorepo root's
version instead of the extension's.

## Judge a build by its config block, never by a grep

The bundle's active configuration is one object literal in the loaded build's
`src/background/background.js`. Note that the loaded build lives in the **main
checkout** — `…/lingogram/apps/youtube/build/…` — so a bare relative path
resolves to nothing while you are working in a worktree, which is where this
procedure is normally run from:

```
var … = { env, projectId, apiKey, identityToolkitUrl, secureTokenUrl,
          firestoreUrl, frontendBaseUrl, apiBaseUrl, source }
```

Read **that**, keyed by field name. Searching for a bare identifier is not a
check, and gave three false positives in one afternoon:

| Substring | Why the match means nothing |
|---|---|
| `lingogram-prod` | It is the operand inside `isLiveProd()` — `projectId === "lingogram-prod"` — compiled from `devEnvSwitch.ts`. Present in **every** build regardless of target. |
| `…run.app` | Matches any Cloud Run host; preprod and production are indistinguishable. |
| `firestore.googleapis.com` | Also appears as a `host_permissions` declaration, not only as an endpoint. |

A sixth belongs beside them, from a different family: a background watcher that
polled `ps aux | grep …` to decide whether the browser was free reported "free"
while a run was in progress. Its cause is **not established**, and the honest
record of the attempts is more useful than a tidy answer:

- The bracket class is not at fault. `[n]ode.*playwright` matches correctly,
  inside `bash -c` too.
- Self-matching is real but pattern-dependent, and was not the cause here. A
  broad `[p]laywright` picks up the probe's own wrappers — 7 of 10 hits in one
  shell were `zsh -c` snapshot lines from the session doing the asking — while
  the narrower `[n]ode.*playwright` returned 2 hits and 0 self-matches in the
  same shell seconds later. Two sibling worktrees measured 0 self-matches
  throughout.
- Line truncation, and process churn, were both excluded by measurement.

The watcher nonetheless reported IDLE a minute after the same probe reported
BUSY, with the processes unchanged: it fails intermittently, in the dangerous
direction, for a reason none of the above explains.

So the rule survives its own explanation's collapse, and both halves are worth
keeping. A watcher must prove it can report BUSY at the moment it starts, or
refuse to watch — but that self-test only shows the instrument *can* give the
other answer once, not that it does so reliably. The working rule is weaker
sounding and stronger: never act on a watcher's say-so alone. Check by hand
before a decision that matters.

Two further shapes are worth naming, because neither involves a wrong fact.

**Two true statements, one false explanation.** A run's failures were attributed
to the sidebar being collapsed in the test profile. Both halves were true — the
panel *was* collapsed, and a collapsed panel *does* defer the search — but the
gate is a conjunction, `isShortsPage() && isSidebarCollapsed()`
(`apps/youtube/src/content/index.ts:693`), and the failing checks open watch
pages. The comment above it says so outright: "Watch pages are unaffected."
True premises do not compose into a true cause.

**Two correct measurements answering different questions.** A claim about
`ps | grep` self-matching was checked with `[p]laywright` by one party and
`[n]ode.*playwright` by another. Both measured correctly; the counts disagreed
because the broad pattern catches the probe's own shell wrappers and the narrow
one does not. Neither party thought to ask which pattern the other had run. When
two careful measurements conflict, suspect the question before the measurement.

Matching a constant against itself and calling it a check is exactly what
Principle VII forbids. The emulator build reads `projectId: "demo-lingogram"`
with `localhost:8080` / `localhost:9099` — its `lingogram-prod` hit is the
operand, nothing more.

## Check the service before blaming the stand

YouTube throttles. A real 429 window — not one produced by the
`#lingogram_http` dev flag — was observed on the test browser on 2026-09-04,
provoked by opening videos in quick succession. While it lasts, subtitles do
not load, and a check that needs a word to click reports an empty panel. Against
a freshly built stand, on a fresh account, that reads as broken sign-in or
broken saving.

The check for this is itself a request to the throttled mechanism, so it is not
free and must not be run out of curiosity: a probe against an open window
extends it. Do it only when a live run is about to happen anyway and the
alternative is starting blind — then one page load is cheaper than a whole run
spent on a false failure. Open one video with **no** flags in the URL and read
the compact row; "Translation limited by YouTube" means the window is still
open, so wait.

How long a window lasts is unknown and must stay that way. Measuring it means
provoking the limit, which blocks every phase sharing the browser.

## Taking the stand down

The teardown is the **last** action of the browser slot, performed before
announcing that the browser is free — not after.

1. **Before** replacing anything, record what is actually there: the sha256 of
   `manifest.json` and `src/background/background.js` under the main
   checkout's build directory, plus the config block. Spell the path out in
   full: the worktree you are standing in has no `build/` of its own. Do this immediately before the swap. The shared directory
   changes under you: on 2026-09-04 it was replaced three times, twice without
   the phases that were reasoning about it being told.
2. Keep that copy somewhere private to the session. **Not `/tmp`.** A backup
   found in `/tmp` that day turned out to be a build from a *worktree* — its
   bundle carried `../../../lingogram/packages/…` module paths against the main
   checkout's `../../packages/…`, differed by 1.5 KB and whole modules, and
   restoring it would have handed the neighbours a third build nobody asked for.
3. Restore that exact artefact, then verify by config block: `projectId`,
   `firestoreUrl`, `identityToolkitUrl`, `frontendBaseUrl` — by name and value.
4. Only then report the browser as free.

Note that `manifest.json` is a poor identifier: two different builds that day
shared both its sha256 and its mtime, and differed only in the background
bundle.

## Related

- `packages/shared/docs/dev-flags.md` — the `EXT_ALT_*` recipe and why nothing
  reaches production.
- `packages/shared/src/auth/devEnvSwitch.ts` — what the switch can and cannot
  retarget; `externally_connectable` is static and decided at build time.
- A locally-loaded build's extension id is derived from its directory path, so
  it is stable while the path is, and must be allow-listed by whichever frontend
  it signs in against (`VITE_EXTRA_EXTENSION_IDS`, non-production only). That
  id is shared with every other build loaded from the same directory — an
  allow-list entry outlives the stand that needed it.
