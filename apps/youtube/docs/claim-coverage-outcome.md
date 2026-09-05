# Claim-level coverage — what the seven phases closed, and the one they did not

Written 2026-09-05, after all seven phases reported. This is the plan's closing
record: it exists because every phase's own report lives in `specs/`, which is
gitignored, inside a worktree that gets deleted. Article K asks each phase to
say what it left out; nothing asked anyone to say it in a place that survives.

The per-phase detail that *is* committed sits beside this file:
`phase-3-deferred.md`, `phase-4-report.md`, `phase-5-deferred.md`,
`phase-6-task-list-discrepancies.md`, `live-stand-teardown.md`,
`checks-that-cannot-fail.md`.

---

## The tally

137 of 138 tasks closed, each with a check seen red against a break of the line
it covers (Article A). Counted from each phase's owning worktree — the copies in
the other five trees are stale by design, since `specs/` is not shared.

| Phase | Tasks | Closed | Gate |
|---|---|---|---|
| 0 · repair | 8 | 8 | passed |
| 1 · files no test imports | 27 | 27 | passed |
| 2 · second halves | 25 | 25 | passed |
| 3 · messages and their differences | 18 | 18 | Gate 3 passed |
| 4 · what only a browser shows | 13 | 13 | passed |
| 5 · the remaining partials | 33 | 32 | see below |
| 6 · the account | 14 | 14 | passed |

The task-list headers say 8/28/26/19/14/34/15 = 144. The actual ids number 138.
The difference is the planning document's arithmetic, not lost work: each
header was written before the tasks under it were enumerated.

Unit baseline moved 52 suites / 1356 tests → **62 / 1456** (measured in the
phase-6 tree, green).

## The one open task

**T5.14, second half — "no subtitle search is attempted before setup" (§1.7).**
Marked `[~]`, not `[x]`, and written up in full in `phase-5-deferred.md`.

The chip half is covered. The planner half is not: the gate sits in
`YouTubeCaptionDetector.handleCaptionTracks`, the class is not exported, and
`index.ts` calls `bootstrap()` at module scope — so importing the file to reach
the gate runs the whole content script. Closing it needs a **second** product
extraction (lifting the `langPrefs` gate into `nav-guards.ts`, beside the two
guards T5.21 already moved there). Phase 5 was scoped to exactly one product
edit, so this is out of scope rather than out of reach: a small, mechanical
change and the natural companion to the extraction already made.

Meanwhile the behaviour is exercised live, and the onboarding branch it takes
instead is covered by `onboarding_shown` in `app-base-analytics.test.ts`. What
is missing is the negative — that no request was planned on the way past.

## What "closed" does not mean

Three things are true at once, and the plan reads wrong if any is dropped.

**1. SC-001's 82% was not demonstrated on any single tree.** Phase 5 measured
69.8% on its own branch and said so; phase 6 measured 84.6% on the plan's
273-claim denominator. Both are honest and they are not comparable: each tree
holds only its own phases' work, and the audits' denominator moved from 273 to
321 when the same 252 tagged lines were re-split. **Only the ratio is
comparable, and the plan's real figure is measurable only after the branches
merge.** Nobody has measured it on a merged tree. That measurement is the
plan's last unrun step, and it is not a formality — it is the only number that
answers SC-001.

**2. Thirteen pre-existing checks were found that pass while the behaviour is
broken**, none of them any phase's own work. They are named with addresses in
`checks-that-cannot-fail.md` and were deliberately left alone: widening scope
unasked is the thing the T5.14 deferral exists to avoid. They are a decision
waiting to be made, not open work.

**3. Six places where the behaviour map names the wrong location** (phase 5)
and six where the task list disagreed with the code (phase 6). Two of the
latter would have produced a **false red** — a check failing against working
code, which is worse than no check, because someone then "fixes" the code.
Both sets are recorded in the files beside this one.

## What no instrument could reach

Not skipped — unreachable with what exists, and each recorded where it was met:

- **A one-sided refusal, arranged.** `makeForcedFetch` replaces the transport
  for *every* timedtext request, so no form of the `#lingogram_http` flag can
  refuse one track and serve the other. Covered by unit; live only where it
  already occurs. (Phase 3.)
- **The stored word document read back.** `allow read` needs an unscoped token;
  the extension holds a scoped, write-only one by design. Asserted instead that
  both shapes §14 accepts are accepted. (Phase 6, T6.8.)
- **Pointer-gesture geometry** — overlay drag is covered as a stored value that
  survives a reset, not as a gesture. (Phase 2, and the road map's ceiling.)
- **`fetchVtt`'s retry cascade** and `ccToggleForMinting`'s two-surface order —
  still closure-bound in `page-script.ts`. (Phase 1.)

## The rule the whole plan kept re-learning

Stated once, because it was met independently in five phases and cost real time
each time: **look at a result, not at a representation of it.**

`lingogram-prod` in a bundle is the operand inside `isLiveProd()`, present in
every build. `run.app` matches preprod and production alike.
`firestore.googleapis.com` is also a manifest declaration. A stale `specs/` copy
looks like a genuine earlier state. `manifest.json`'s sha256 was identical
between two different builds. A watcher's `ps | grep` matched its own command
line. An MV3 service worker asleep looks like an extension uninstalled.

Its live-testing corollary, from the throttling incident of 2026-09-04: **the
cost of checking is unbounded from the inside.** There is no probe that reports
how much of a rate-limit window remains — only whether you are still in it — and
each asking sustains it. That is why the standing rule reads *never provoke*,
not *provoke sparingly*.

## What remains

| | |
|---|---|
| T5.14 second half | one product extraction; scoped out, not blocked |
| Merge the five branches | measured: phases 4 and 6 clean; 3 and 5 conflict in `packages/shared/tests/word-screen.test.ts` only, where three branches appended different `describe` blocks — keep all |
| ~~Measure coverage on the merged tree~~ | **done: 71.0%** — see `coverage-measured.md`. SC-001's 82% is not met, and no honest denominator reaches it |
| The thirteen false-green checks | named, addressed, awaiting a decision |
