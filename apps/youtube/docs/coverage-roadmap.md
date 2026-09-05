# Road map: covering the rest of the behaviour map

> **Executed 2026-09-03/05. This document is the forecast, not the outcome.**
> All seven phases ran; 137 of 138 tasks closed. The per-phase estimates below
> ("~18 checks", "75% → 82%") are what was predicted before the work, and
> several are wrong in both directions — the claim counts moved when the audits
> re-split the map, and no single branch was ever expected to show the plan's
> total. For what actually happened, the one open task, and the four things
> still outstanding, read `claim-coverage-outcome.md`. Kept unedited below
> because a plan that is quietly corrected after the fact stops being evidence
> of what anyone believed at the time.


Companion to `test-coverage-plan.md`, which graded all 52 behaviours and covered
the important ones. That plan counted **sections**. This one counts **claims** —
the individual statements the map makes about how the product behaves — because
a section marked "covered" can still carry two dozen claims of which four are
tested.

The map holds **257 tagged claims** across 57 sections, distributed very
unevenly: the settings screen alone carries 24, and half of all claims sit in
ten sections.

---

# Where we actually stand

Four independent audits read every claim against the tests that exist, section
by section, grepping the suites rather than trusting a file's name. Between them
they judged **273 claims** (a slightly higher count than the map's 257, because
several map lines carry more than one assertion):

| | Claims | Share |
|---|---|---|
| **Covered** — a test fails if the behaviour breaks | 128 | **47%** |
| **Partial** — related behaviour tested, this claim survives breaking | 74 | 27% |
| **Not covered** | 65 | 24% |
| **Untestable** — no predicate a check could assert | 6 | 2% |

Covered-or-partial: **74%**.

An earlier sampled estimate put this at 44%. Reading every claim in full moved
it to 47% — the sample was slightly pessimistic, not wrong in kind.

Two measurements deliberately not used as the target:

- **Statement coverage (63%)** cannot see the live checks. `auth-status-badge.ts`
  reads 0% and is exercised by a real browser check. Chasing that number rewards
  unit tests and ignores the checks that catch third-party breakage.
- **Sections covered (52 of 52)** is the figure this document exists to replace.

---

# The honest ceiling

**100% is not reachable, and pursuing it would make the product worse.** Of 257
claims, 44 are blocked by something other than effort:

| Blocked by | Sections | Claims | Who unblocks it |
|---|---|---|---|
| A decision nobody has made | 30, 32, 35, 44, 45, 46, 47, 49, 50, 51 | 17 | You. A test here freezes a gap you may want to close. |
| Real account data | 2, 14 | 18 | You. Needs a throwaway account on the pre-production system — **and a rebuild**, because the second address has to be compiled into the manifest. |
| A gesture only a person can make | 12, 28, 31, 52 | 9 | Nobody. Fullscreen, adverts, install/uninstall. |

The audits added six more claims that no check could assert at all — a
historical statement, a negative existential over the whole interface, and
behaviour belonging to a third party.

Subtracting those, the reachable ceiling is **88%**, not 100%. Everything below
aims there, and the remaining 12% is a list of decisions rather than a backlog.

---

# What the audits actually found

Findings below were each verified in the source rather than taken on the audit's
word — one audit reported a product defect that turned out not to exist (it read
a test running in one scope as describing all scopes), so nothing here is
repeated without checking.

## The most important code has no tests at all

Three files are imported by no test:

- **The native-caption guard** (`SidebarUI.ts`). It turns YouTube's own
  captions off **once per video** — not permanently, so a viewer who switches
  them back on is left alone until the next video. Three separate decisions,
  zero assertions. The failure mode is two sets of subtitles stacked on every
  video: the worst first impression the product can make.
- **The token dance** (`page-script.ts`). Since late August the site refuses
  caption requests without a token, and this is the code that mints one by
  flicking the site's own captions on and off. If its restore step breaks, the
  site's captions stay on underneath ours — which triggers the failure above.
  If its four-second budget drifts, captions visibly flash on every video.
- **The word writer** (`auth/firestoreRest.ts`). It decides what leaves the
  device when someone saves a word. The map states that the video address, its
  title and the language pair are **not** recorded. Nothing checks that.

## Four numbers are checked against themselves

`expect(out.attempts).toBe(MAX_ATTEMPTS)` passes whatever `MAX_ATTEMPTS` is.
The same tautology covers the empty-answer re-asks, their spacing, and the
unattended retry budget; the back-off ladder is only checked to its second rung.

These are politeness budgets toward a third party. Changing four to forty stays
green and earns the multi-hour throttle that blocks all further work.

## The gaps are second halves of paired decisions

The pattern across every audit: where the product makes a decision with two
sides, one side is tested.

- Choosing a position preset clears a manual drag — tested. Reset **not**
  clearing it — untested.
- Signing out clears the credentials — untested that it **keeps** the saved-word
  count. One tidy-up commit adding two keys to that list would re-ask every
  signed-out user for a review, the one thing the review section says must never
  happen.
- The review card offers both answers — tested. That "not really" **never**
  reaches the public review page — untested. A one-character mistake turns the
  product into a rating funnel and every existing check still passes.

## A check that passes when the thing it checks is broken

The short-video deferral check accepts *either* the deferral being in force *or*
lines having loaded. The second branch is satisfied by exactly the failure the
check exists to catch: if the product stops deferring and fetches anyway, lines
load and the check goes green. One test, currently worth nothing.

## Four things the map itself gets wrong

Found by auditing claims against the code. Each must be re-verified before any
check is written against it, because a test written from a wrong map pins the
wrong behaviour:

- **"41 languages"** — there are 42.
- **"Exporting needs no language pair"** — true of the panel's button, false of
  the player-menu row, which hides itself when no pair is set.
- **"Hidden words can still be selected and copied"** — they cannot. The
  stylesheet makes them unselectable, deliberately: it is what stops a click
  meaning both *reveal* and *look up* at once. The source comment states both
  the old claim and the current rule two lines apart; the map copied the stale
  half.
- **Two summary bullets contradict sections corrected the day before** — the
  same-language substitution and the Netflix disclosure, both already retracted
  in the body.

## A test that discards its own assertion

`known-gaps.test.ts` builds the list of files allowed to read the consent flag,
documents it as the point of the check, and then throws it away with
`void readers;`. Two claims read as covered and are not.

---

# The plan

Seven phases. Each is independently valuable and can be stopped after.
Every check must be shown to fail before the code that makes it pass — a green
check that has never been red is not evidence.

## Phase 0 — repair what is already wrong  ·  ~6 checks  ·  no % change

None of this adds coverage; it stops four things from actively misleading.

- Fix the short-video check so its second branch cannot mask the failure.
- Restore the discarded assertion in the consent-flag check.
- Correct the four wrong statements in the map, each re-verified in the code.
- Correct the two summary bullets that contradict their own sections.

Do this first. Everything after builds on the map being right; a phase written
against a wrong claim pins the wrong behaviour and is worse than no test.

## Phase 1 — the untested files  ·  ~26 checks  ·  47% → 56%

The three files no test imports, plus the tautological constants.

- **Native captions** (6): off once per video, not twice; re-armed by a new
  video; re-armed when our own captions are switched off; never touched when
  our captions are off.
- **The token dance** (7): captions restored to their prior state even when the
  read fails; one attempt per video; the four-second budget honoured; the viewer
  never told any of it happened.
- **The word writer** (9): what a saved word carries, and — the highest-value
  assertion in the whole plan — what it **does not**: no video address, no
  title, no language pair. Plus the daily cap, the length limits, and the
  context window.
- **Constants** (4): pin each to its literal.

Entirely unit-testable. No browser, no account.

## Phase 2 — second halves  ·  ~22 checks  ·  56% → 64%

Every paired decision where only one side is asserted. Cheap, and this is where
a silent regression is most likely to survive review, because the reviewer sees
a passing test for the behaviour they just changed.

Includes: reset preserving a manual drag; sign-out preserving the word count;
an unhappy reviewer never reaching the store; the swap never being written to
storage and resetting on a new video; the language chip's click handler (the
discoverable trigger — only the keyboard shortcut is tested today).

## Phase 3 — messages and their differences  ·  ~18 checks  ·  64% → 71%

The class that already produced one shipped defect.

Includes: the post-retry "still no subtitles" wording and its emergency reload —
the escape hatch for the commonest failure of all, tested for its sibling state
but not for this one; the signed-out save message; "no translation" versus
"couldn't load" in the word card; the language pickers being **empty** rather
than showing a ghost entry for a language that failed.

Mostly unit, three live.

## Phase 4 — what only a browser shows  ·  ~12 checks  ·  71% → 75%

Rendered structure that unit tests cannot honestly assert: the word screen's
article, the settings screen's option sets, the theme control's absence on
Netflix, the caption placeholder's second line.

Live checks, run in halves per the existing README. The theme control's
absence on the dark-only site is not here: that site is out of scope, and the
check is a unit one with a stubbed hostname — it sits in Phase 2.

## Phase 5 — the remaining partials  ·  ~18 claims  ·  75% → 82%

Every claim the audits marked *partial* in a section an earlier phase already
touched: the smooth-versus-instant scroll boundary, the five-second reveal reach
pinned to its number rather than its shape, the export naming the leading
language after a swap, the consent wording, and the rest of that list. Unit
throughout; no decision needed.

This phase exists because the first draft of this document credited these
eighteen claims to the account phase — which cannot move them. Eighteen claims
need an account; eighteen of 273 is seven points, not thirteen.

## Phase 6 — the account  ·  ~14 checks  ·  82% → 88%

**Requires a decision from you**, and a rebuild — the pre-production address must
be compiled into the manifest, or the data plane switches while sign-in silently
fails to connect.

A real save, a real duplicate, the signed-in panel, the count syncing across
surfaces, and the signed-out refusal — the last of which is the one case
excluded by your own earlier decision to leave the live session alone.

---

# Recommended order

**Phase 1 first**, and not because of the percentage. It covers the three files
that decide whether subtitles appear at all, whether they double up, and what
leaves the device — and it is the only phase where a defect would be invisible
until a user reported it.

The batch discussed earlier (the sidebar's three failure messages, the caption
styling module, spaceless-script rendering) sits inside phases 2 and 3. It is
worth doing, but it is not the most valuable work available, and the audits are
what showed that: the failure messages turned out to be better covered than they
looked, including a check asserting that two separate surfaces cannot drift
apart in what they say.

Phases 0-5 reach **82%** with no decisions required from anyone. Phase 6 needs
the pre-production account. The remaining 7% is the seventeen claims that
describe gaps rather than behaviour, and those should stay untested until you
decide whether to close them.
