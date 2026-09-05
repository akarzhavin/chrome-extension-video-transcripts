# Phase 3 — what was left out, and why

Article K of the task's constitution addendum: every phase ends with a list of
what it did not cover. Silence about a gap is the failure this line of work
exists to prevent.

Phase 3 covered the messages the empty panel shows and the differences between
them — the class that had already shipped one defect, one message standing
where another belongs. **All eighteen tasks and Gate 3 are closed**, each unit
check seen red against a break of the line that carries its claim, and the two
live checks green at 8 of 8.

What is recorded here is not a list of what was skipped — there is none — but
what the phase could not reach with the instruments it had, and the three
premises it had to discard along the way. The last of those changed what T3.17
asserts, so it is the substance of this document rather than a footnote to it.

---

## What no local instrument can drive: a one-sided refusal, arranged

**Status:** covered by unit; live, only observable where it already exists.

§18.1's third wording — *"Couldn't load the translation"* — appears when a
signed URL dies while the other track is already playing. Its unit twin is in
`app-base-status.test.ts`; what is missing is a live run through the real
page-script.

**Why it is not reachable — measured, after two wrong explanations.** The
first was that the switch substitutes fetches *in order*, so refusing the
translation means refusing the request before it. True of `@N`, but not the
whole story. The actual reason is broader: `makeForcedFetch` (`page-script.ts`)
replaces the transport for **every** timedtext request, so no form of the flag
can refuse one half of the pair and serve the other. Measured on
`ZbZSe6N_BXs`, English stored and no Russian:

```
no flag    75 lines,  compact line "Translation limited by YouTube"
429 flag    0 lines,  full banner  "YouTube is limiting requests"
```

A one-sided refusal therefore cannot be *arranged* at all — not by a counter,
not by a status, not on any shape of video. It exists only when YouTube itself
refuses one request and serves the other. That banner is already covered, in
`failure-states.spec.ts`.

**This is a limit of the instrument, not of the product.** The product reaches
the state whenever a signed URL expires with one track playing; nothing in it
resists observation. What resists is the switch. The distinction matters
because a reader six months from now would otherwise read this entry as a hole
in the product, and it is recorded in the spec's own comment for that reason.

**What T3.17 does instead.** It stopped trying to arrange a cause. It reads
whatever partial state is present and asserts the **mapping** — that the words
match the cause the product diagnosed, and that the retry is offered exactly
where retrying could help; whichever cause is present, the other two wordings
must not appear. That is the "one message standing where another belongs"
failure stated directly, and it needs no refusal to be manufactured. Where no
partial state is present the check declares itself unrun (Art. F).

**What a stronger version would cost.** A switch that can select which request
to refuse — by track name, by `tlang` presence, or by index — rather than by a
countdown. That is a product-side change to a dev-only path, which Phase 3 was
not scoped to make.

---

## Why `@N` was rejected — and the Principle VII violation written and withdrawn

The first attempt at T3.17 reached for `#lingogram_http=429:5@1`, on the
assumption that it refuses one track and lets the other through. Measured
live, it does not: the flag substitutes exactly **one fetch**, page-script then
mints a pot and retries, and the track completes — 42707 bytes on the retry.
The compact line ended up reading *"Couldn't load the translation"* with no
retry button, i.e. a stale URL, not a limit.

The second attempt raised the counter to `@3`, chosen to span one track's retry
ladder plus its pot retry. **That was a Principle VII violation and it was
withdrawn within the same task.** The cascade's threshold is

```
++emptyAnswers > EMPTY_RETRIES || attempt >= maxAttempts
```

(`timedtext-fetch.ts:286`) — derived from two constants and counted across the
session. Any hand-computed `@N` would be a literal that reads correct today and
drifts silently the moment either constant moves; worse, it would be a literal
standing in for a value the code owns, which is exactly what the principle
forbids.

The loop is worth recording because it is the one the principle exists to
create: a number that looked like a measurement, written, then recognised as a
restatement of two constants and removed before it reached a commit.

**What replaced it was also wrong, twice more.** The second premise: a video
offering exactly **one** caption language makes the other half a machine
translation by construction, so the flag would land on the `tlang` request
alone. Measured on `9bZkp7q19f0` (Korean only), it does not — *both* halves of
the pair become translations, both load, and with the flag both fail and the
full banner comes up.

The third: an **asymmetric** pair — learning language stored, native absent —
does make exactly one request a translation, which is right. But the flag still
refuses both, because it replaces the transport rather than a request. See the
section above.

So the sequence was: a literal derived from two constants; a video shape that
made both halves translations; a video shape that was correct about the product
and wrong about the instrument. Three premises, each discarded by measurement
rather than by reasoning, and the check that stands asserts something none of
them was reaching for.

---

## The video ids are leads, never evidence

Both live specs verify their candidate **at the moment of use** and call
`test.skip` when none qualifies (Article F) rather than passing on a state
nobody observed.

This is not caution for its own sake. The task sheet names `jNQXAC9IVRw` as a
reliably caption-free video; measured on 2026-09-04 it carries `en` and `de`.
A check written against the id would have been green while asserting nothing.
`1ZYbU82GVz4` was verified caption-free the same day and is listed first among
T3.18's candidates — as a lead, with the same verification applied to it.

---

## Not deferred, but worth recording

### Three claims whose task text the source contradicts

Article D — the check follows the code, not the sheet.

- **T3.4** — the sheet says *"five states, eight messages"*. The source renders
  **seven** distinct bodies: the two throttled halves share one verbatim and are
  told apart only by their action, a live countdown label versus "Search again".
  Seven are pinned as distinct, the deliberate repeat is named so a *new*
  collision cannot hide inside the allowance, and the eighth message is pinned
  where it actually lives — on the button.
- **T3.11** — the sheet says Details calls `openDetail` *with the term*. The
  source passes two arguments, the term and its cue, which the word screen needs
  in order to order senses by the sentence. Pinned as two.
- **T3.16** — the sheet expects the compact notice to name the failed language.
  Read in `updatePartialFailureNotice`, none of its three wordings carries a
  language; the chip beside it already shows the pair. Pinned as the exact
  wording instead.

### An existing check that accepts more than one outcome

`throttling.spec.ts:76` — *"a partial failure does not raise the full notice"*.
It waits for lines, so a run where nothing loaded fails on the timeout rather
than passing; that much is sound. What it then asserts is only the **absence**
of one banner title, and only `if (banner?.title)` — so a run with no banner at
all satisfies it, as does a run where the failure never happened and both tracks
loaded cleanly. Under Principle VII that accepts more than one outcome: it
cannot distinguish "the partial state was reached and handled correctly" from
"the partial state was never reached".

Measured, the second is what actually occurs on this video: `@1` lets the
refused track complete through the pot retry, so the check passes without a
partial failure ever existing.

Phase 5's audits, reading it independently, added a third case this phase had
not named: the guard is also satisfied when the **banner system itself** is
broken and renders nothing at all. So the check is green in three distinct
worlds — the partial state handled correctly, the partial state never reached,
and banners not working. The assertion is not weak; it is *skipped*, by a
condition the product controls.

It predates Phase 3 and is outside this phase's task list, so it was not
touched. It is recorded here so that it is not later read as coverage of the
partial state, which it is not.

The general form — an assertion skipped by a condition the product controls —
was found in several other live checks during this phase's window, by the
phases that own those files. They are catalogued in
`checks-that-cannot-fail.md` rather than repeated here; a cross-reference
cannot drift, and a second copy of someone else's finding would.

### A property of the diagnostic switch that will mislead the next reader

`@N` counts **fetches, not tracks**, and a track that loses its first fetch can
still complete through the pot retry. Anyone reaching for the flag to arrange a
one-sided failure will assume the count applies to the whole load of a track.
It does not.

---

## The two live checks: corrected across three runs, then green

The first live run returned **6 passed, 3 skipped, 1 failed**, and both of this
phase's live tasks came back needing correction rather than confirmation. Two
further runs the next morning, after the throttling window closed, took them to
**8 of 8 passing** across both spec files.

The three failures were three different things, and only the first was about
the product at all. What follows records each, because the second and third are
the kind that would otherwise be rediscovered.

### T3.18 — the product was right, the check was wrong

The run proved the behaviour: on a genuinely caption-free video, one press of
"Search again" changed the copy and raised the emergency reload. The check
failed on the expected *literal*.

`t(key, fallback)` carries an English string in the source; `_locales/en/
messages.json` carries another for the same key. Both are live, both are
correct English, and **only the locale ships**. The check had taken

> "Still no subtitles. Reloading the page often fixes it."

from `app-base.ts`, while the product displays

> "If this video has subtitles but we aren't showing them, reload the page — it
> often helps, and we'll get a report to investigate."

This is the worst trap of the phase, because the author did the correct thing —
did not invent the string, took it from the code — and still took the wrong
source. A check written this way is verifiable, reviewable, and wrong for a
reason invisible without opening the locale file.

The same defect was then found in the *first-check* assertion of the same test.
It had been **passing**, and that is the second floor of this trap:

```
locale:    …Try another video — not every video ON YOUTUBE has captions.
fallback:  …Try another video — not every video has captions.
```

The assertion was `toContain("doesn't have subtitles")` — a fragment the two
sources share. They diverge four words after it.

The two failure modes are not the same defect twice:

| | what it does |
|---|---|
| taking the fallback, asserted whole | **fails** once the two strings diverge — visible, fixable |
| taking the fallback, asserted by fragment | **never fails**, because a shared prefix is enough |

So `toContain` with a short fragment does not merely weaken an assertion. It
*conceals which source the literal came from*. The check is green, the literal
exists in the source, the author did not invent it — and nothing in the check,
its output, or a review of it can reveal that it was copied from the string the
product does not display. Only the whole-string comparison exposes it, which is
the argument for making the comparison whole even when a fragment would read
more robustly.

Both assertions now read the winning source at run time.

### T3.17 — three premises discarded before one held

All three cases **skipped** on the first run: no candidate offered exactly one
caption language. Measured afterwards, that precondition was never the right
one — and neither was the one that replaced it.

On a one-language video (`9bZkp7q19f0`, Korean only) **both** halves of the
learning/native pair become machine translations. Both load, no partial state
arises at all; with the refusal switch on, both fail and the *full banner* comes
up instead of the compact line.

`trackPlan.ts:92-113` was read correctly — it does send `tlang=` for whichever
half of the pair has no matching track. The conclusion drawn from it did not
follow, because on a one-language video that half is *both of them*. A correct
reading of a mechanism, wrong about what it implies.

There is a reason this particular misreading is easy, and it is worth naming
because two readers made it independently from the same lines. The two blocks
are **structurally identical** — `:92-101` for the learning half and `:103-113`
for the native half differ only in which pref they name:

```
if (learningTrack) { …stored… } else { …tlang: prefs.learning… }
if (nativeTrack …) { …stored… } else { …tlang: prefs.native… }
```

Reading one branch, the other completes itself in the reader's head as its
*mirror* — as though the two halves were opposed, one taking the track and the
other the translation. They are not opposed; they are the same rule applied
twice. Symmetrical code invites an asymmetrical expectation, and nothing in the
lines contradicts it. The error was in the shape of the reading, not in the
care taken over it.

The shape that actually produces a one-sided failure is an **asymmetric pair**:
the learning language present as a stored track, the native one absent, so
exactly one request carries `tlang=`. Verified live on `ZbZSe6N_BXs`,
`CMNry4PE93Y`, `sTANio_2E0Q` and `7wtfhZwyrcc`.

Two things follow, and both are in the rewritten check:

- candidates are a **list**, each verified at the moment of use, because the
  shape can stop holding exactly as `jNQXAC9IVRw` stopped being caption-free;
- the pair is read from the profile with `readPrefs`, never hard-coded. A check
  asserting `en`/`ru` would depend on state it never establishes — the defect
  class found in three other live checks the same afternoon.

**Article F is what saved this.** The old precondition came from the false
premise, so the check declared itself unrun instead of passing on a video that
could not produce the state. It failed to confirm its claim; it did not lie.

### Recorded against this session: real throttling was provoked

While hunting for a qualifying video, several were opened in quick succession
and **genuine** YouTube throttling resulted — confirmed by opening a video with
no flag at all and seeing the throttled notice on an untouched request.

The standing rule is that a real refusal is never provoked, because it degrades
the browser for every other live check for as long as it lasts. It was broken
here while looking for a way to *simulate* one. The rerun of both checks is
deferred until the window clears.

**Measured roughly an hour later**, with a single probe taken immediately
before an intended rerun rather than in advance: still open. One unflagged
video, `ZbZSe6N_BXs`, produced

```
notice: "Translation limited by YouTube"     tracks: [English]
```

so the rerun was not started. A window is not a resource being consumed while
nobody uses it — it is a state that requests *sustain* — so "nobody else needs
the browser" is not an argument for probing, in either direction. That is why
the probe is taken once, at the moment it would change what happens next.

One thing the probe did establish, at no extra cost: **that reading is exactly
the state T3.17 asserts** — the throttled wording, with the stored track still
playing and the translation slot unfilled. The asymmetric-pair shape is
confirmed correct on a real refusal. What remains unverified is the check
against a *simulated* one, which is the only form permitted.

**Probed again about ninety minutes after that**, under the same rule and as a
single action that would have started the rerun on a clean reading: still
`"Translation limited by YouTube"`. The rerun did not start.

Two probes, roughly an hour and two and a half hours after the event, both
open. That is the whole of what is known about the duration — it is a lower
bound on this one window, not a measurement of how long such windows last, and
establishing the latter would mean provoking more of them. The cost of the
mistake is therefore not "an hour": it is unbounded from the inside, and the
only way to learn it is to stop needing to know.

### Why the rule says "never" rather than "sparingly"

`docs/ops/live-debug-cdp.md` gives the cost — a refusal "holds for hours and
blocks all other debugging for that time". That is true and it is the reason
the rule exists, but it is not the reason the rule is absolute, and reading it
as the whole story is what made the mistake available.

Read as a cost, "never provoke a refusal" sounds like a courtesy owed to the
other phases: expensive, therefore avoid it, therefore *permissible when the
browser is idle and nobody is queued*. That inference is what I was one step
from making, and the browser was in fact idle.

The reason it does not follow is that the state **has no observable horizon**.
There is no probe that reports how much of the window is left; there is only
one that reports whether you are still inside it, and each asking sustains it.
So there is no version of "carefully" that improves the position, and no
information to be gained by waiting *and checking* rather than waiting. The
only operation with a known effect is not starting.

A rule whose justification is a cost invites cost–benefit reasoning at its
edges. This one has to be read as a rule about observability instead, or the
edges reappear.

---

## A warning for whoever reconciles this plan

`specs/` is not tracked in git and exists as a hand-made copy in every worktree.
Measured across all six trees, this phase's own task file looks like this:

```
lingogram              ef7fa488  16 [x]  0 [~]
lingogram-phase3       c31bc9db  16 [x]  2 [~]   ← the owner
lingogram-phase4       ef7fa488  16 [x]  0 [~]
lingogram-phase5       ef7fa488  16 [x]  0 [~]
lingogram-phase6       ef7fa488  16 [x]  0 [~]
lingogram-e2e-research ef7fa488  16 [x]  0 [~]
```

Exactly one copy diverges — the owner's — and the five that agree are five
copies of a single stale snapshot, not five observations. **Reconciling by
majority takes the wrong version**, and it does so most confidently where the
agreement is widest.

The direction of the loss matters more than the fact of it. The stale copies do
not overstate progress; they **erase a distinction**. Two tasks whose state is
*written, corrected, awaiting a rerun* read as *not started* — and Gate 3 turns
on precisely that difference. A drifted copy of a status document degrades
states into coarser ones, which is the failure mode least likely to look like
an error.

This was not hypothetical: a mechanical count of the plan's state read this
phase's figures from another tree's copy and reported "16 closed, 3 open"
instead of "16 closed, 2 awaiting rerun, 1 unreachable".

---

## Numbers

The phase is **18 tasks plus Gate 3**, not 19 tasks. Stating it as "19" once
led a mechanical reading of the plan to infer a nineteenth task and ask what
browser-free work remained in it. A nineteenth task might have contained some;
a gate cannot, by construction.

| | |
|---|---|
| Tasks closed | **18 of 18** |
| Gate 3 | **closed** — every clause met |
| Unit suite | 61 suites / 1438 tests → **62 suites / 1480 tests** |
| Live specs | 8 of 8 passing |
| Type-check | clean |

Every unit task was seen red against a break of the line that carries its
claim. The two live tasks carry their red in the unit twins, as their task
text specifies: with the not-offered line pointed at the throttled wording,
`app-base-status.test.ts` goes 2 red / 67 green.

### Three states that are not the same state

The distinction matters because a stale copy of the task file collapses the
first two into "not started", and Gate 3 turns on it:

- **T3.17, T3.18** — written, and corrected *after* the run rather than before
  it. Awaiting a rerun, not unreachable.
- **The expired-link wording** of the compact notice — unreachable in
  principle by the local instrument, recorded as such rather than left as a
  gap. A limit of the instrument, not of the product.
- **Gate 3** — unsatisfiable until the rerun happens.

Every other clause of Gate 3 is met: the suite count, Article I (both spec
files are named in the README's run instructions), the Article K report, every
unit check seen red against a targeted break, and the browser left as found.
It fails on exactly one clause, and that clause is the rerun. The phase is
finished except for a confirmation it is currently forbidden to obtain.

The three T3.17 skips are likewise a **result, not a gap**: they are what a
check does when its precondition cannot be met, and in this case the
precondition itself turned out to be the thing that was wrong.

---

## What Phase 3 did not attempt at all

Nothing in the phase's nineteen tasks was skipped silently. The claims outside
it — the settings screen's option sets, geometry, the account — belong to
Phases 4, 5 and 6 and are recorded in their own files.
