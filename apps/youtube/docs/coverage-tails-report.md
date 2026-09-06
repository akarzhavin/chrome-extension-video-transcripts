# The tails of claim-level coverage — report

Branch `test/coverage-tails`, 5 September 2026. The numbers per task, everything
left undone by name, and two decisions that remain the user's.

## The numbers

| | |
|---|---|
| Plan tasks | 38, of which 37 closed |
| Commits | 12 on top of `test/claim-level-coverage` |
| Jest | 69 suites / **1648** tests, green (was 69 / 1641) |
| `npm run type-check` | clean |
| E2E, live run | **60 green, 10 skipped with a reason, 0 red** |
| Map coverage | **314 / 445 = 70.6%** |
| Product edits on this branch | 1 (`nav-guards.ts`, T5.14) |

## Task 1 — run e2e on the merged tree

Both halves were run. The first run gave 59 green, 10 skips and one failure;
after the analysis and the fix — 60 green, 0 red.

**The failure was a defect of the CHECK, not of the product.**
`accessibility.spec.ts` sampled the scroll offset after a fixed 1500 ms — on the
slope of a smooth animation. Measured: after seeking to 120 s the offset reads
0.27 for the first second and settles to 0.13, while the check demanded < 0.25.
Replaced with a poll to the settled value. The full analysis is in
`apps/youtube/docs/centring-check-at-120s.md`.

**The ten skips are honest:** nine require the stand account
(`LINGOGRAM_STAND_ACCOUNT`), and the Phase 6 stand is torn down; one is
fullscreen mode, where the browser needs a gesture and a background tab cannot
supply one.

## Task 2 — measure coverage

Four independent auditors, non-overlapping ranges of the map's sections.
**314 of 445 claims = 70.6%.** SC-001 requires 82% — **not reached**, a gap of
11.4 points, 51 claims.

The denominator is all 445 claims; three ways of arriving at a prettier figure
were rejected and are recorded in `coverage-on-merged-tree.md` along with the
reasons. Even the most generous honest variant (excluding the unverifiable ones)
gives 74.4% — below 82%.

The most expensive hole: **§1, first turn-on and the language pair, 9 uncovered
claims**. Every new user sees this.

## Task 3 — T5.14

Closed. `decideCaptionSearch` was lifted into `nav-guards.ts` alongside the two
guards Phase 5 extracted earlier; `index-guards.test.ts` pins that with an empty
language pair no requests are scheduled at all. The product edit is a separate
commit, with no tests touched in it.

## Task 4 — the thirteen false greens

All thirteen are repaired, each seen red against the break it is meant to catch.
On top of that §12 (reparenting the panel into the fullscreen element) had no
working check at all — the live one always skips — and is now closed by a unit.

**Verified by PRODUCT mutations (T416):** four breaks were introduced into the
sources, rebuilt, and placed where Chrome loads the extension from. Four of four
were caught. The build was restored byte-for-byte, checked against three sha256
values and the config block.

## Found beyond the plan

**Four checks were not running at all.** `word-lookup.spec.ts` is assigned to
the first half of the run, but it never made it into the command: the log said
"Running 36 tests" against a list of 40. The report "all 76 were run" was wrong.
Run separately, and the symptom is recorded in `e2e/README.md` — there is no
other sign of this kind of failure.

**One more empty check.** §50.1 "being offline":
`/offline/i.test(el?.textContent ?? '')` yields `false` when the element is
absent entirely, so the check went green on a page where the panel had not
rendered. Found by re-checking the verdicts (T206), fixed, redness verified.

**The limit of the method.** A fourteenth check of the same class was found
**only by running it** — four audits read it and pronounced it covering, because
in the code it looks correct. Reading tells you what a check names; running
tells you what it does. The 70.6% was measured by reading, which makes it an
**upper** bound.

## A fifteenth empty check — and three wrong diagnoses of it

**T413, `word-lookup.spec.ts` §40.** The task's wording ("remove the empty
half") does not describe the code: the control half is present in the check. The
real defect is that the check was skipping entirely, on every run, and the
summary report counted it as present.

I named the cause wrongly twice, and both times wrote it down as fact: "the
language pair is not set" (it is: `en → ru`) and "the video has a single track"
(there are two). The correct cause is a third one, and it was found only by
measuring the live page: the panel was in **single** mode, and the translation
line is drawn only in dual. The check was reading a state it did not itself
establish — the same class of defect as the other fourteen.

Fixed: the check now turns dual mode on itself and **asserts** that the
translation line appeared, instead of skipping itself when it is absent.

**Redness took three mutations, not one.** The ban on looking up words in the
translation is held by three independent mechanisms, and breaking any single one
changes nothing:

1. `SELECTION_SCOPE_SELECTOR` does not include `.vtt-sub-text`;
2. the translation line is not marked up with `span[data-word]` (measured:
   `subWords: 0` against `mainWords: 4`);
3. `selectionAnchor.alive()` requires `spans.length > 0`, or the card has
   nowhere to render.

The first mutation left the check green, and that was very nearly written down
as "it does not catch anything". Redness came from the pair 1+3. The lesson for
future mutations: green after a single mutation is evidence about the check
*and* about the rule being held by several barriers at once; only reading every
path tells the two apart.

## Two decisions — taken 2026-09-05

1. **`pot.ts` / `page-script.ts` — kept, verified live.** The minting routine was
   lifted out of the MAIN-world closure; behaviour does not change, and the edit
   carries the 17 checks of `pot-mint.test.ts`, which cannot be written without
   the extraction. Unit checks do not confirm work against a live player, so the
   cascade was run in the browser against the extracted code:

   ```
   no pot — briefly enabling native captions to mint one
   captured pot (xhr)
   native captions -> Off (restored)
   retrying with a freshly captured pot for aircAruvnKk:{English,Russian}
   fetched 42707 / 46010 bytes — 286 lines
   ```

   Restoration was verified separately: `.ytp-subtitles-button` returns to
   `aria-pressed=false`, and the flash of native captions does not stay on.

2. **`app-base.ts` — kept, the deadline cut from 30 s to 12 s.** The false "no
   subtitles" verdict after 7 seconds is gone; the watchdog was moved out, not
   deleted.

   The previous justification ("30 s outlasts the retry schedule") is **false**:
   four attempts, each waiting out a `Retry-After` clamped at 60 s, worst case
   about three minutes. No tolerable wait can outlast the schedule. So the
   deadline is measured against the reader instead: 12 s is the limit of how long
   the panel may stay silent. A long throttle will outlast it, and that is
   acceptable because of WHAT is then said: `timeout` — the answer did not
   arrive, rather than a false "there are no subtitles".

   The check held `30_000` as a literal, meaning it would go red on a change to
   the constant and green on an edit to the literal. It was moved to importing
   the constant, the missing half was added (a moment before the deadline there
   is still no verdict) and an assertion about the boundary. Both were seen red.

## Not done, and not in the plan

The branch is not in `main`: there was no push and no PR. The twelve commits
live only locally.
