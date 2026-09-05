# Checks that pass while the behaviour is broken

Found during Phase 5's claim-by-claim coverage measurement (2026-09-04), by four
independent audits reading the suites against one question: *would anything go
red if this specific behaviour broke?*

**None of these are Phase 5's own checks, and none were touched** — they are
outside that phase's task list, and each is recorded here with its address so
the decision to fix them is someone's to make deliberately.

They matter more than any coverage percentage. A green check that can never be
red is worse than no check: it occupies the place where a real one would go, and
it reports the behaviour as covered.

`specs/` is not tracked in git, so this list lives here rather than only in the
phase report.

## Verified by three independent audits

**`packages/shared/tests/SidebarUI.test.ts:314`**
```js
expect(overlay.style.getPropertyValue('--vtt-overlay-nudge') || '0%').toBe('0%')
```
The property is never set on this code path, so `||` substitutes `'0%'` and the
assertion satisfies itself in every run. It cannot distinguish "the reset
worked" from "the property was never written" — which is the only thing it
exists to tell apart. Found independently by three of the four audits.

**`e2e/throttling.spec.ts:93`**
```js
if (banner?.title) expect(banner.title).not.toBe('No subtitles available');
```
A conditional assertion. If no banner renders at all — *including because the
banner system broke* — the test passes having asserted nothing. Found by three
audits.

## The rule re-implemented inside the test

**`apps/youtube/tests/rate-prompt.test.ts`** › "the decision is count AND
one-shot together, so it fires exactly once"

The rule under test is written in the test body:
```js
const wouldAsk = async () =>
    (await bumpSavedWordCount()) >= RATE_PROMPT_WORD_THRESHOLD &&
    !(await getRatePromptShown());
```
The real gate is `packages/shared/src/auth/background.ts:203-207`. Dropping the
`!getRatePromptShown()` term there, or moving `markRatePromptShown()` from the
decision point to the answer handler, leaves this green. It asserts the test's
own arithmetic.

The threshold of 5 *is* pinned correctly elsewhere in the same file. What is
unpinned is the moment the one-shot burns — the map (§15, and the Corrections
section) states the prompt is spent *by being shown*, not by being answered.

## Assertions discarded by their own test

**`e2e/settings-and-export.spec.ts:97`** — `void original;`
The original font value is captured and thrown away. The surviving assertion is
only `not.toBe(changedTo)`, so a reset landing on *any* wrong default passes.

**`e2e/signing-in.spec.ts:56`** — `void before;`
The tab count is captured and discarded. Nothing asserts a sign-in tab ever
opened, which is exactly the claim (§2) the test is named for.

## Assertions that accept more than one outcome

**`packages/shared/tests/lookup.test.ts:939`**
```js
if (!msg) return; // no offer at all is also acceptable here
```
A regression that stops offering any lookup for cross-cue selections passes.

**`apps/youtube/tests/app-base-status.test.ts:676`** — `if (set) expect(set).not.toHaveBeenCalled();`
The whole "a swap is never written to storage" claim sits behind a conditional.
The mock exists today so the guard is always taken; if the chrome stub is ever
refactored to omit `storage.local.set`, the check silently stops asserting.

**`apps/youtube/tests/app-base-analytics.test.ts`** › "the send is given long
enough for a cold service worker" — accepts `2000 ≤ t ≤ 3000` while the map
states 2.5s. A change to 2.9s passes.

## Assertions satisfied by construction

**`packages/shared/tests/notifications.test.ts`** › "serves a fresh cache
without touching the network" — both calls land in the same tick, so
*shortening* `CACHE_TTL_MS` to anything at all still passes. Only lengthening it
is caught, by the sibling refetch test.

**`e2e/word-lookup.spec.ts`** › "with no languages set, the card declines to
open" — the second half, `expect(opened).toBe(false)`, checks a hover card is
absent on a page where nobody hovered. Vacuously true; only the
`#vtt-lang-onboarding` poll above it is load-bearing.

**`e2e/word-lookup.spec.ts`** › "clicking a word…" — waits for
`!n.querySelector('.vtt-lookup-pending')`, satisfied instantly if the pending
state is never rendered. The waiting-state claim survives being deleted.

**`apps/youtube/tests/locale-coverage.test.ts`** › `expect(WORD_CARD_KEYS.length).toBe(18)`
— a constant compared with itself. Harmless in place (three sibling checks do
the real work), but that line proves nothing.

## A check that never runs

**`e2e/player-modes.spec.ts`** › "the panel moves inside the fullscreen element"
— `test.skip(!entered, …)` fires on every run, because a background tab cannot
supply the gesture. This is honest rather than false-green (Article F: a check
that cannot reach its state says so), but the effect is that §12's only
reparenting check never executes, and the claim is uncovered while the suite
reads green.

## Sound, despite matching the pattern

**`apps/youtube/tests/known-gaps.test.ts:101`** —
`expect(policy.includes('dictionary') || policy.includes('lookup')).toBe(false)`
is a negated disjunction, i.e. a conjunction of two negatives. Correct. Listed
only so a later reader does not "fix" it.

## Two files that had no test file at all

Recorded as a distinct class: not "too few checks", but no place for a check to
attach. This is invisible to any per-section coverage count, because a section
with no entry point looks the same as a section nobody got to.

- **`apps/youtube/src/content/page-script.ts`** — held the pot-toggle timeout
  (`POT_TOGGLE_TIMEOUT_MS = 4000`), the CC-button restore logic, and the
  `kind: t.kind` pass-through. The timeout could become 40000 with nothing
  turning red, and pot has been mandatory again since August 2026.
- **`packages/shared/src/auth/auth-status-badge.ts`** — which is why the live
  cross-surface saved-word count sync (§25) read as uncovered.

**Both were closed the same day, in Phase 2**, on a branch this measurement's
tree did not contain: the minting routine was lifted into `pot.ts` with
`pot-mint.test.ts` (seventeen checks, the timeout pinned to its literal), and
`auth-status-badge.test.ts` was added as T2.23.

Kept rather than deleted, for two reasons. The gap was real for most of the
project's life, and the *method* generalises past these two files: a source file
with no test file is a coverage hole that section-level counting cannot see, so
it is worth looking for by listing source files against test files rather than
by reading a percentage.

## A class of its own: reading panel state the check never sets

Found by Phase 4 (2026-09-04), on the live suite. Recorded here because this
file is the registry; the addresses are Phase 4's, not Phase 5's, and neither
phase changed them.

These three read whether the panel is open without ever putting it in a known
state. On a profile whose panel starts expanded they pass; on one whose panel
starts collapsed they fail. Neither outcome says anything about the product.

- **`e2e/accessibility.spec.ts:79`** › "an announcement carries an urgency, and
  the panel announces its state" — reads `#vtt-toggle-btn`'s `aria-expanded`
  at :88 and expects `'true'`.
- **`e2e/reading-modes.spec.ts:115`** › "collapsing the panel changes both what
  is seen and what is announced" — opens with
  `expect(before).toEqual({ collapsed: false, announced: 'true' })`.
The third is a **different and worse defect**, not a variant of the first, and
is listed separately below.

### The worse one: a single step from an assumed start

- **`e2e/reading-modes.spec.ts:142`** › "the collapsed choice survives a reload"
  — clicks the tab exactly once, then asserts `collapsed === true`:

```js
await page.evaluate(() => document.getElementById('vtt-toggle-btn')?.click());
await expect.poll(() => page.evaluate(
    () => document.getElementById('vtt-sidebar')?.classList.contains('collapsed') ?? null,
)).toBe(true);
```

The two above read a state nobody set, so their outcome is *arbitrary*: whatever
the profile happened to carry. This one assumes a starting state and takes one
step from it, so on a profile that starts collapsed the click **expands** the
panel and the check asserts the opposite of what just happened. Arbitrary on
half the profiles is bad; *reliably wrong* on half the profiles is worse, and
the fix is different too — reading the state first is enough for the other two,
while this one has to establish the start before it steps.

**Verified in this tree.** `SidebarUI.ts:1649`, inside `applyCollapsed`:

```js
this.elements.toggleBtn?.setAttribute('aria-expanded', String(!collapsed));
```

So `'false'` in the attribute means `collapsed === true` literally. The
alternative reading — "the attribute was never set" — is closed: unset would
read `null`, not `'false'`.

Phase 4's second proof was the profile's own `prefs.v1`, carrying
`sidebarCollapsed: true`. It read that key **once, after the run**, when the
fixture had restored the original: `preservingUiPrefs` writes the same key, so a
read *during* the run would have returned the state of the executing check
rather than the profile's.

That timing rule is a method, not a detail of these three, and it was found by
*refusing* a suggestion: reading during the run was proposed as a way to save a
pass, and it would have produced an intermediate value of the running check
wearing the appearance of a measurement of the profile. State owned by a fixture
can only be read once the fixture is done.

**Why it survived:** the suite had only ever run against a profile with the
panel expanded. A defect of the suite, not of the environment.

**A rejected explanation, recorded so it is not rediscovered.** The first
reading was "a collapsed panel defers the subtitle search". It does — but
`index.ts:693` gates that on `isShortsPage() && isSidebarCollapsed()`, a
conjunction, and all three checks open a watch page. Two true statements
composing into a false explanation. The conclusion survived on a shorter
footing; the mechanism did not.

## A partial match hides which source the literal came from

Found by Phase 3 (2026-09-04); the class is theirs, the instance is fixed on
their branch (`ee00b51`). Recorded here as a class, not as an address.

A user-facing string exists twice: as the fallback argument in the code, and as
the entry in `_locales/en/messages.json`. The locale wins at runtime. A check
that quotes the fallback is asserting a string the user never sees.

Quoting the *wrong* one is not the interesting failure — that goes red the
moment the two texts diverge, which is exactly what a check is for. The
interesting failure is quoting a **shared prefix**:

```js
expect(first.text).toContain("doesn't have subtitles")
```

Verified in this tree, `app-base.ts:877` against `_locales/en/messages.json`:

```
fallback:  "This video doesn't have subtitles. Try another video — not every video has captions."
locale:    "This video doesn't have subtitles. Try another video — not every video on YouTube has captions."
```

They agree for the first seven words and diverge four words later. The check is
green, the literal genuinely exists in the source, the author did not invent it
— and no amount of *reading* the check reveals which of the two it is pinning.
Whichever source is dropped, renamed or re-worded past the prefix, the check
carries on passing.

**The counter-intuitive part, which is the whole entry.** The fix is to compare
the whole string precisely where a fragment feels safer — where the text is
long, or looks likely to be re-worded, or where partial matching reads as
tolerance for localisation. The habit that is usually right (do not pin long
prose to a literal) is what creates this defect.

Read as the bare rule — *compare whole strings* — this is advice that should
normally be ignored, and a reader is right to ignore it. It holds only in the
narrow case that produces the defect: **a string with two sources, one of which
wins at runtime.** There, the whole string is the only thing that says which
source you meant; a fragment says nothing, however carefully chosen. Take the
condition away and the advice goes back to being wrong.

## Where the rest of this list lives

This registry is on `test/phase-5-partials`. Two other branches hold addresses
of the same class that are not physically in this file:

- **Phase 4** — the three above, in `phase-4-report.md` on
  `test/phase-4-rendered`, under "The three failures are not this phase's".
- **Phase 3** — `e2e/throttling.spec.ts:93` and the fullscreen `test.skip`,
  in `phase-3-deferred.md` on its own branch.

The merge risk is not a conflict: it is that this file arrives intact while the
other branches' addresses stay in their reports and never join it. After the
branches merge, one person should walk every phase report and fold the
stragglers in.

**When copies disagree, take the owner's.** Measured across six trees the same
day: a task file existed in six copies, and exactly one — the owner's — differed
from the other five. The five agreed with each other and were all stale. Five
identical copies are one observation duplicated, not five independent
confirmations, and counting them as agreement inverts the answer.

The damage is specific and worth naming, because it is not the damage one
expects. A stale copy did not *invent* progress; it **erased a distinction**. A
task standing at "written, corrected, waiting to be re-run" read as "not
started" — and the phase's gate turned on exactly that difference. Staleness
that flatters is easy to distrust; staleness that flattens is not, because the
flattened state looks like an ordinary earlier state.

So: read the file from the tree that owns it, however many copies say otherwise.

## How to write an address so it survives

A line number decays. `index.ts:693` was the collapsed-panel search gate this
morning; by the afternoon T5.21 had lifted that condition into
`nav-guards.ts` as `shouldDeferSearch()`, and every copy of the old address —
in notes, in messages between sessions, in another branch's report — was
silently wrong. Only the person who moved the code could notice, and only
because they moved it.

So an address in this file carries **both**: the line, and something that finds
it again after the line moves — the function name, the text of the condition,
the assertion as written. The line is the convenience; the quoted code is the
address. An entry that has only a number will be wrong eventually, and nothing
will announce it.

The same reasoning is why this list is in `docs/` and not in a chat log or in
`specs/`: a file beside the code gets fixed by whoever moves the code. A line in
a message gets fixed by nobody.

### With parallel branches, a line number is not an address even when fresh

The decay above is the mild version. The sharper one, measured on this same
line while several phases worked on their own branches:

```
this branch, index.ts:693   if (shouldDeferSearch(this.isShortsPage(), this.app.isSidebarCollapsed()))
another branch, index.ts:693  if (this.isShortsPage() && this.app.isSidebarCollapsed())
```

Both are live, both are real code, both are line 693 of the same file. The
address did not go stale — it became **ambiguous**, and which tree was meant
cannot be recovered from the number.

That is worse than staleness in the way that matters: a stale address points at
nothing and the reader notices immediately. An ambiguous one points at plausible
code in every tree, so the reader draws a conclusion and never learns it was
about someone else's version.

The rule is unchanged, but its reason is broader than "lines move over time":
with parallel branches, several different lines carry the same number at the
same moment. Quote the code.
