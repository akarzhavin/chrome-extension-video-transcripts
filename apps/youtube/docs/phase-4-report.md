# Phase 4 — what only a browser shows

Closing report, required by Article K of the task addendum: what this phase
covered, what it left out, and why. Silence about a gap is the failure the
whole line of work exists to prevent.

Branch `test/phase-4-rendered`, 8 commits, 13 tasks plus Gate 4.

---

## What was added

20 checks: 8 unit, 12 live.

| Commit | What | Seen red |
|---|---|---|
| `37f7adc` | `overlay-style.test.ts` — 7 typefaces, both 5-colour palettes | 5 of 5 |
| `fb16e51` | the text reset in the `youtube` scope → 160/110 | 1 of 121 |
| `9faaa73` | source pins: the `.collapsed` rule, `list.scrollTo` | 2 of 2 |
| `27c7474` | six live checks on the settings screen | — |
| `8e5906f` | collapsing keeps its width; the search page | — |
| `330fcf1` | the page holds still; the current line stays centred | — |
| `e889ba8` | Shift+D and Shift+O | — |
| `4e0c0f4` | T4.11: mark supply rather than a lowered threshold | — |

Jest: 61 suites / 1438 tests → **63 / 1446**. The suite count grew; a falling
one would mean a group stopped running. `type-check` clean. Both README
half-suite commands name all 12 spec files (Art. I) — no new spec file was
added, every check joined one the runner already points at.

### Where red came from

No live check can be made red without breaking the browser build, so each one
rests on something that has:

- the option counts (T4.1, T4.2, T4.3, T4.5) → `overlay-style.test.ts`.
  Dropping `smallCaps` from `OVERLAY_FONT_STACK` reddens both typeface checks;
  removing one entry from `OVERLAY_COLORS` and pointing `OVERLAY_BG_COLORS` at
  it reddens all three swatch checks.
- the reset sizes (T4.8) → the youtube-scope test in `SidebarUI.test.ts`.
  Dropping the `PLATFORM_SIZE_DEFAULTS` merge reddens **1 of 121** — this one.
  The other 120 stay green, which is precisely the gap: every existing reset
  test ran in the scope where the site override and the generic default are
  the same number, and an audit reading them reported a defect that does not
  exist.
- the panel sliding rather than folding (T4.9) and the page holding still
  (T4.11) → `rendered-pins.test.ts`. Replacing the transform with `width: 0`
  and swapping `list.scrollTo` for `active.scrollIntoView` reddens 2 of 2.

---

## Live run

Second half, 44.4 minutes: **30 passed, 7 flaky, 3 failed**.

### The three failures are not this phase's, and not the product's

All three read the panel's collapsed state without establishing it:

| Check | What it reads |
|---|---|
| `accessibility.spec.ts:79` | `#vtt-toggle-btn` `aria-expanded`, expects `"true"` |
| `reading-modes.spec.ts:115` | collapsing changes what is seen and announced |
| `reading-modes.spec.ts:142` | the collapsed choice survives a reload |

Proved twice over. By code: `SidebarUI.ts:1649`, inside `applyCollapsed`,
writes `aria-expanded = String(!collapsed)` — so `"false"` *is* `collapsed`,
and an unset attribute would read `null`, not `"false"`. By storage: the
profile's own `prefs.v1` carries `sidebarCollapsed: true` (read once, after
the run, when the fixture had restored the original; reading during a run
would have returned whichever check was mid-flight).

This is the class the phase-5 register `checks-that-cannot-fail.md` owns: a
check whose outcome is decided by the profile rather than by the product. It
passes on a browser with the panel open and fails on one with it closed, and
neither answer is about the code. The register is where these belong; they are
recorded there rather than duplicated here.

Why it survived until now: the suite had only ever been run on a profile with
the panel expanded. That makes it a defect of the suite, not of the
environment.

**A discarded explanation, recorded because it was believable.** The first
account was that a collapsed panel defers the subtitle search. It does — but
`apps/youtube/src/content/index.ts:693` gates that on `isShortsPage() &&
isSidebarCollapsed()`, a conjunction, and all three checks open a watch page.
Two true statements composing into a false explanation. The conclusion
survived on a shorter footing (the attribute is a direct mirror of the state),
but the mechanism did not.

That gate was found by phase 3, not here — noted so that a reader meeting this
paragraph goes to the right people with a question about it.

### The seven flaky ones passed on retry

`retries: 1` exists for exactly this. Six were pre-existing (Escape, swapping,
fullscreen, theatre, practice-mode) and one was this phase's Shift+D. Three of
them were `waitForLines` timeouts, clustered in the later part of a 44-minute
run — consistent with the briefing's warning about long runs, though nothing
here measured the cause, so no claim is made about it.

### T4.4 was a collision, not YouTube being flaky

The opacity-row check failed inside a series at 17:34 and passed alone in 39
seconds. The first reading was "YouTube is genuinely shaky". It was not:
phase 3 was running its own suite on the same browser in that window. In the
final run — the browser held by this phase alone — T4.4 did not appear in
either the failed or the flaky list.

Recorded because the wrong version was nearly written down, and a reader
trusting it would go looking for instability that is not there.

---

## Two places the task list disagreed with the code

Both verified in the source and then in the browser (Art. D), both recorded in
`27c7474`.

1. **§10.8 needs no track, not merely no line.** The task says the stand-in
   appears when there is "no line under the playhead". `previewSubtitleFor`
   prefers the nearest *real* line and falls back to the neutral placeholder
   only when there is no track at all. On a video with subtitles the
   placeholder never appears, so the check drives the track-less state with
   the diagnostic flag instead.

2. **The mode for that state cannot be set through the Dual button.** With no
   tracks loaded it is `aria-disabled` and its handler returns early —
   measured live: `dualDisabled: true`, the class never changed. `displayMode`
   is a stored preference and `hydrateFromPrefs` adopts it without consulting
   availability, so the check writes it before the page opens and restores it
   after.

---

## Three defects in this phase's own checks, found by running them

Each passed on first write and was wrong anyway. Listed because "the check was
green" is not evidence until it has been red for the right reason.

- **The slider read 165, not 90.** `loadPrefs` is async and
  `markActiveStyleButtons` rewrites the control when it lands, overwriting the
  value the check had just set. Fixed by waiting for hydration to settle
  first.
- **The transform was sampled mid-slide.** The panel's 0.4s transition was
  still running when the "open" transform was read, so open and collapsed
  compared equal and the check went red against working code. Fixed by
  asserting `transform: none` outright rather than comparing the two — which
  also settles, permanently, which of the two candidate explanations was true.
- **`poll(...).not.toBe(null)` waited for nothing.** It is satisfied instantly
  by the line already highlighted, so a loop meant to observe five line
  changes sampled the same line five times. Fixed by polling for a change from
  the previous value.

A fourth, found by the final run: five fixed playhead marks yielded only four
distinct lines, because two landed inside one line. Fixed by offering ten
marks and still requiring five distinct lines — **not** by lowering the
threshold to four, which would have removed the margin that makes five a
behaviour rather than a coincidence.

---

## What this phase did not cover

- **Nothing was skipped by Article F.** T4.11 and T4.12 each carry a
  declared-unrun condition (a transcript too sparse for five distinct lines; a
  transcript too short to centre anything). Neither fired — the conditions
  held. Worth stating plainly, because a passing report renders the two cases
  identically: "it passed" says nothing about the next run, while "it can
  declare itself unrun" means that when the conditions do not hold, the check
  will say so rather than go green. That is a property of the suite, not of
  this run, and a summary loses it.
- **The three failing checks were not fixed.** They are pre-existing, they
  belong to the phase-5 register, and repairing them was not this phase's
  task. Their addresses and the proof are above.
- **The `waitForLines` timeouts were not diagnosed.** Three of them, clustered
  late in a long run. They cleared on retry; the cause was not measured, and
  no explanation is offered here rather than a plausible one that has not been
  checked.

---

## State left behind

- The live checks run against a build in the main checkout, because Chrome
  loads the unpacked extension from there and never from a worktree. Swapping
  that build for another is worth announcing: two dev builds are
  indistinguishable by `manifest.json` and by mtime, and differ only inside
  `background.js`, so a session that snapshots "the current build" can end up
  holding someone else's without either side noticing. Keep the displaced one
  somewhere durable until the run that replaced it is finished with.
- The browser was left as found (R4). Every check that touches settings ran
  inside `preservingUiPrefs`, including the two that write `displayMode`
  deliberately.
- No real refusal was ever provoked from YouTube. The track-less state came
  from `#lingogram_http=403`, which substitutes the transport inside the page
  and sends nothing to the network.
