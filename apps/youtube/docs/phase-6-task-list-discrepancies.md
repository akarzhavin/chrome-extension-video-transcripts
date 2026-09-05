# Phase 6 — where the task list disagrees with the code

Recorded 2026-09-04, before any phase 6 check was written. Each entry was read
in the source, not inferred from the task text. Article D asks for exactly this;
the tally is material for the plan's final report.

Five findings. Two of them would have produced a **false red** — a check failing
against working code, which is worse than no check, because the failure gets
"fixed".

---

## 1. The switch needs three variables, not two — `tasks-phase-6.md` T6.0

T6.0 names `EXT_ALT_FRONTEND_BASE_URL` and an API base URL.
`devEnvSwitch.ts:70-78` requires **all three** of `EXT_ALT_PROJECT_ID`,
`EXT_ALT_API_KEY` and `EXT_ALT_FRONTEND_BASE_URL` together; with any one absent
`AWAY` is `null`, `canSwitch()` is false, and the badge is inert.

**Consequence if followed literally:** no switch at all, and the stand would sit
on the environment it was already built against.

## 2. The lookup variable named is the wrong side — T6.0

T6.0 says `EXT_API_BASE_URL`. That is the **home** side's variable, feeding
`config.apiBaseUrl` (`config.ts:30`). The away side reads
`__EXT_ALT_API_BASE_URL__` (`devEnvSwitch.ts:76`, defined at
`vite.config.ts:104`).

**Consequence:** the data plane switches while lookups keep answering
"not configured" — every card silently fails to appear. This is Article J's
named failure mode.

## 3. The build recipe produces production — T6.0 / the phase brief

The brief says to build with `npm run build` rather than `npx vite build`. True
as far as `npm_package_version` goes, but incomplete: `build` carries **no**
`EXT_ENV`, and production is its default (`build:dev` is the separate script).
`WRITE_UNSHIPPABLE_ZIP=1` is also required, or the packaging gate refuses a dev
build.

**Consequence:** a stand intended for preprod is built against **production** —
an error in the opposite direction from the one everyone is watching for. See
`live-stand-teardown.md`.

## 4. T6.6 names two different surfaces as one

T6.6 asks that "the row shows the green state" **and**, opened, shows four
fields. Those are two surfaces: the collapsed row, and the panel built by
`showSignedInPanel()` (`auth-status-badge.ts:114-141`). The behaviour map keeps
them distinct too (§2, "How the user knows it worked").

**Consequence:** minor — but a check asserting both under one claim cannot say
which surface regressed. Assert them separately.

Worth knowing while writing it: the collapsed row is not merely a dot. Line 212
sets `row.title`, mirrored into `aria-label`, to
`"{Signed in as} {email} — {n words saved}"` — the same four pieces the opened
panel shows. The collapsed state is therefore assertable without opening
anything, and it is also where the accessible name lives.

## 5. T6.8's "exactly five fields" is wrong — **false red**

T6.8 asserts the saved entry's fields are exactly
`term/source/processed/context/addedAt`. `firestoreRest.ts:117-124` says:

- `term`, `source`, `processed` are written unconditionally;
- `context` is written **only** `if (input.context)` — a word saved without
  context has **four** fields;
- `addedAt` is not a written field at all. It is an `updateTransforms` entry
  with `setToServerValue: REQUEST_TIME` (`:137-139`), because a client-side
  timestamp drifts by network latency and breaks the rule `addedAt ==
  request.time`.

The same commit also writes a **second** document (`:140-150`) holding
`dailyCount` / `dayBucket` / `lastAddedAt`; "the entry's fields" has to be scoped
to the word document or the assertion picks up the sentinel.

**Consequence:** the check would fail on a legitimate save — a word saved with no
context — and the red would look like a product defect. Someone would go and
"fix" working code.

**Correct assertion:** the written field set is a subset of
`{term, source, processed, context}`, and the **stored** document carries an
`addedAt` set by the server.

---

## Two conditions the task list does not mention

Neither is a discrepancy, but both decide whether a live run means anything.

**A fresh install is load-bearing for T6.13.** `background.ts:204` reads
`savedWordCount >= RATE_PROMPT_WORD_THRESHOLD` — `>=`, not `==` — and the
one-shot burns at *decision* time (`markRatePromptShown()` runs before anything
is rendered). With a non-zero starting count the fifth save is not the fifth,
and the card fires on whichever save crosses the line: the check still passes
while asserting nothing.

**Saves are rate-limited.** 500 words per day, and a minimum gap of one second
between saves (behaviour map §14, "Limits"). T6.9 and T6.13 save repeatedly;
space them, or the throttle decides the outcome rather than the claim — another
false red of the same family as finding 5.
