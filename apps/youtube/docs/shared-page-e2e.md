# One page per run instead of a page per check

> 2026-09-05. Recorded here rather than in `specs/`, because that directory is
> in `.gitignore` and leaves with the branch.

## Why

Every check opened its own YouTube page. Measured on the second half of the
suite: **47 loads in 47.7 minutes**, most of them a repeat load of the same
video for the sake of a panel that was already on screen. The run goes against a
person's live account, and this is their allowance being spent.

## What was done

One page is held for the whole run and handed to a check after `normalise` has
returned it to its canonical state — **and that state is asserted** by comparison
with the `CLEAN` literal. The literal is written out in the source rather than
read off the page: an assertion expressed in terms of the thing it checks passes
against anything.

Isolation is bought by two different mechanisms for two different failures:

- **The check failed** — the runner handles this: Playwright discards the worker
  after any failure and starts a new one. Read in the 1.62.1 sources
  (`worker/workerProcessEntry.js:1684`, `runner/index.js:5292`) **and verified by
  measurement**: three checks in a row, the middle one failing deliberately.

  ```
  PROBE-1 loads=1   ← took the shared page
  PROBE-2           ← failed deliberately
  PROBE-3 loads=2   ← got a FRESH page
  ```

  The first two shared one load; after the failure the counter went up — so the
  worker really is discarded and the next check inherited nothing. A fresh
  fixture and a fresh page come for free, at the price of one load per failure.
- **The check passed but left a mess** — cleanup handles this. Fifteen steps,
  each answering a specific trace that a real check in this suite leaves behind.

## Three orderings that must not change

Found by reading the product, not by guessing:

1. **The selection is cleared before the click on the background.** The card's
   `mouseup` handler re-reads the selection (`strip.ts:621`) — a surviving range
   will reopen the card, exactly the one the click has just closed.
2. **The word screen is closed before the panel's tab is touched.** While
   `.vtt-lookup-open` stands, the tab acts as that screen's close button
   (`word-screen.ts:96`).
3. **Theatre and playback go last.** YouTube restores the saved theatre mode a
   second after load, and autoplay cancels the pause. Both steps stood first at
   the beginning and neither worked.

## What the mutations exposed

Every cleanup step was removed one at a time, and the self-check was obliged to
go red. Twice it stayed green — and both times the defect was **in the check**,
not in the cleanup.

### A check that could not fail

The self-check called `acquireClean` twice: to take the page, and to "verify the
cleanup". But `acquireClean` throws away a page it could not verify and loads a
fresh one — and a fresh page is clean whether the cleanup works or not.

The measurement that exposed this is a single line: **`SAME-PAGE false`**. We
were checking a different page from the one we dirtied.

The sixteenth case of this form in the project — and it turned up in the very
tool built to catch the other fifteen.

### Two steps cancelling the same thing

Removing `scrollTo(0, 0)` did not fail the big self-check. But in isolation the
step works: without it the cleanup leaves `scrollY: 600`, with it `0`.

The reason: the big check turns on theatre mode among other things, and
**leaving theatre mode scrolls the page to the top by itself**
(`after-theatre 0`). Two steps cancelling the same thing make one of them
invisible to any check that runs both — so the step doing the real work looks
redundant.

The scroll now has its own check, without theatre.

## The load counter

The run prints how many video pages it loaded, per file and as a total. Retries
are included: a repeated check loaded the page again, and YouTube served it.

The counter immediately found an error in the by-code count:
`subtitles.spec.ts` was predicted as 9 loads and measured as 10 — the last check
navigates to a second video inside the same tab. The second half: the count
promised 39, the measurement gave **47**. The gap is in-tab navigations, reloads
and retries, none of which a count by call sites can see.

## The cost of cleanup

| | |
|---|---|
| First acquisition of a clean page | **105 s** |
| Cleanup of an already-clean page | **0.0 s** |

Hence the check timeout was raised to 240 s — by measurement, not by eye. The
same figures show that the shared page pays off more the more checks reuse it.

## What kept its own page

| Group | How many | Why |
|---|---|---|
| Dev flag in the URL | 9 | the URL is read once at load and **is** the input |
| A different video | 2 | a single-language video; walking candidates without subtitles |
| Not a watch page | 3 | home, search, shorts |
| Popup only | ~13 | nothing to share |
| First run with no languages | 1 | the user's decision: the initialisation path is what is under test |
| Reload / offline | 3 | the page needed is defined by HOW it loads |

## The bottom line on spend

Measured across three files of seven (23 of the 47 baseline loads):

| File | before | after |
|---|---|---|
| settings-detail | 15 | **3** |
| accessibility | 5 | **2** |
| player-modes | 3 | **0** |
| **Total** | **23** | **5** |

A **4.6-fold** reduction. `player-modes` loaded no pages at all: all three of its
checks took the one already open.

The remaining four files were not measured. The same proportion cannot be
carried over to them — that is where the checks that keep their own page are
concentrated (the single-language video, home, search, shorts, two flag URLs). A
cautious estimate: their 24 loads fall to roughly 12–14, so the whole half comes
to about **17–19 against 47**. That is a calculation, not a measurement, and is
marked as such.

### The first half of the suite — measured in full

```
youtube loads    6  throttling.spec.ts
youtube loads    4  failure-states.spec.ts
youtube loads    4  subtitles.spec.ts
youtube loads    3  word-lookup.spec.ts
youtube loads    1  signing-in.spec.ts
youtube loads   18  TOTAL (retries included)
```

25 passed, 0 failed, 1 flaky, **10 skipped** — the stand ones, exactly as many as
are recorded in `stand-dependent-checks.md`.

The gain here is small, and that is expected: the first half is where the checks
that cannot use a shared page are concentrated. Of the six files, `throttling` is
entirely on dev flags, `saving` is wholly behind the stand gate, and
`failure-states` is half flag-driven. There is nothing to share — and that is
visible in the numbers rather than deduced from an argument.

## A side gain: the run got more reliable

| | before | after |
|---|---|---|
| passed | 33 | **42** |
| failed | **2** | **0** |
| flaky | 4 | **1** |
| time | 47.7 min | **33.5 min** |

Both baseline failures were timeouts waiting for subtitles. On a page that is
already loaded and verified there is nothing to wait for — which is why they
disappeared. And that is with more checks than before: 44 against 40.

## The mistake that cost thirty-three minutes

The run was launched with `--reporter=list`. That flag **replaces** the reporter
list from the config rather than adding to it — the load counter never printed,
and the headline number of the work was not captured after 33 minutes of live
running.

`e2e/README.md` now carries a warning. The measurement had to be repeated on
three files instead of all seven.
