# The live run's only failure: centring at the 120th second

`e2e/accessibility.spec.ts` › *"the active line sits near the middle of the
list, not merely inside it"*. Failed in the 5 September run and failed again on
the retry — so not a flake. **Closed: the defect was in the check.** It sampled
after a fixed pause, landing on the slope of a smooth scroll. Below: how that
was measured, and why the first two explanations were wrong.

## What the check demands

At three points in the video (60, 120, 180 s) the active line must sit no
further from the middle of the list than 25% of its height. Between setting the
time and taking the sample sits a fixed `waitForTimeout(1500)`.

## What was measured

| moment | offset (5 consecutive samples) |
|---|---|
| 60 s | 0 0 0 0 0 |
| 120 s | **empty empty empty** — there IS no active line |
| 180 s | 0 0 0 0 0 |

Scroll at 60 s: 950 of 22918. At 180 s: 3845 of 22918. Lines 15 and 50 of 286 —
far from either end of the list, so the check could not have been running into
the scroll limit.

**Centring works perfectly** — exactly 0 at both moments where an active line
exists. The logic in `SidebarUI.scrollActiveIntoView` computes the delta to the
middle and scrolls the list; it reads correctly.

## Two rejected explanations

Both were mine, both failed against measurement — recorded so that nobody starts
from them again.

1. **"Centring is broken."** Refuted: 0 wherever there is anything to measure.
2. **"The scroll had not settled within 1500 ms."** Refuted: the offset does not
   converge to zero over time, because there is nothing to measure — the line is
   absent entirely.

Both would have explained the observed "68% and 80%", and both would have been
accepted had the measurement stopped at a single sample. This is the same class
described in `live-stand-teardown.md`: a mechanism that COULD produce the
symptom is a candidate, not a finding, until what must be true for it to fire
has been checked.

## What it actually was

Sampled after seeking to 120 s, one snapshot every 500 ms:

```
0.27@120.5  0.27@121  0.13@121.5  0.13@122  0.13@122.5  0.13@123  NONE  NONE  NONE
```

The offset is **0.27 for the first second, then settles to 0.13**. The check
measured at exactly 1500 ms — on the slope. Reproduced three times in a row
exactly the way the test does it: `0.69`, `0.69`, `0.69` against a threshold of
`0.25`.

The duration of a smooth scroll is set by the browser, not by us, so **no
constant would have been correct**. The right thing is to wait on a condition.

## The gap between cues is real too, and it matters for a different reason

From 123.3 to 124.7 s there genuinely is no active line — cues 33 and 34 are
separated by a pause. This did not affect the failure (the test measures at
121.5 s), but it does affect the fix: `offset()` returns `null` inside the gap,
and the check must not take that for success. `.toBeLessThan` on `null` throws
inside the poll, the poll continues — that is, it waits for the next cue, which
is what we want.

## The fix

`await page.waitForTimeout(1500)` plus a single sample were replaced with a poll
to the settled value (`expect.poll(...).toBeLessThan(0.25)`).

**Seen red:** a threshold of `0.0001` fails the check with the message
"at 60s the current line never came within 25% of the list's middle".
A threshold of `0.05` passes — at all three moments the offset settles to
practically zero, so the product has fivefold headroom.

Live run after the fix: green, 43.7 s.

## What this teaches

A fixed wait in place of waiting on a condition is the very first mistake
written down in this work's plan ("use auto-retrying expect() throughout; never
a sample after a sleep"). It survived the entire plan and was found only by a
live run on the merged tree — the very run that had never been made before.
