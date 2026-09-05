# The throttling notice lost a race — found, fixed, covered

Measured 2026-09-03, diagnosed and fixed 2026-09-04. This document went through
two wrong explanations before the right one, and keeps them because the way it
went wrong is the useful part.

## What was seen

Forcing a refused request produced the wrong notice. Timed to the second, with
the response replaced locally so nothing reached YouTube:

```
 0.9s  "Searching for subtitles…"
 8.0s  "No subtitles available"      <- wrong, and the reader acts on it
16.1s  "YouTube is limiting requests"
```

The captions existed. YouTube had refused to serve them. For eight seconds the
reader was told the video had none and invited to go and find another one.

## Two wrong explanations, in order

**First: "the tool re-installs and our requests escape it."** Written up as a
finding. It does not survive inspection — the injected script is registered to
run once per document, and every subtitle request goes through a single wrapped
transport captured when it runs. An assumption presented as a conclusion.

**Second: "unexplained, possibly a product defect."** Better, because it stopped
claiming to know. Still not an answer.

**The answer** came from one measurement that should have been made first: does
the refusal reach the classifier at all? It does, at 28 seconds, correctly
labelled. Nothing was wrong with the diagnostic switch, and nothing was wrong
with the classification. The notice was losing a race.

## The defect

A grace period concluded "this video doesn't have subtitles" seven seconds in,
while the requests were still retrying against a wait the site itself had asked
for. Concluding from silence: a request that has not answered has said nothing,
and "no subtitles" is a guess presented as a fact.

Real throttling behaves identically — the retry schedule belongs to the site,
not to the diagnostic switch — so this was reachable by any user, not only by a
test.

## The fix

While a retry schedule is genuinely still running, the panel goes on saying it is
searching. A verdict that arrives meanwhile is shown at once, as before.

The watchdog was **kept**, not removed. A reply that never comes at all — a
wedged script, a dropped message — must not leave the panel searching for ever,
and the neighbouring timer that covers half-loaded videos deliberately bails when
nothing has loaded. Without keeping it, this would have traded a wrong answer for
no answer. It now waits long enough for the retry budget to finish first.

Changing this changed an existing contract, so its test changed with it and says
why.

## After

```
 0.9s  "Searching for subtitles…"
16.2s  "YouTube is limiting requests"
```

## Covered

Three checks guard it. One watches the notice continuously rather than looking at
the end state — the defect was a message that appeared and was replaced, so a
check of the final state would have seen the correct banner and passed while a
reader was still being sent away.

## The standing rule

A genuine refusal from the site is never provoked. It rate-limits the browser for
hours and takes every other live check down with it, which is a far higher price
than any check is worth. Refusals are simulated, and the simulation replaces the
answer locally without sending anything.

## What this cost, and what it bought

Three rounds of investigation and two withdrawn explanations, to find one defect
that had been shipping. The pattern worth keeping: when a check disagrees with
the product, the cheapest question is usually *does the signal arrive at all*,
and both wrong answers here came from skipping it.
