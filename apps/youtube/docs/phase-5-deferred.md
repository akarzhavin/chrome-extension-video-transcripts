# Phase 5 — what was left out, and why

Article K of the task's constitution addendum: every phase ends with a list of
what it did not cover. Silence about a gap is the failure this line of work
exists to prevent.

Phase 5 closed 33 of its 34 claims with a check that was seen red against the
product line it covers. One is recorded here as deferred, with the reason and
the price of closing it.

---

## T5.14 (§1.7) — "no subtitle search is attempted before setup"

**Status: CLOSED 2026-09-05.** The second half is covered. `decideCaptionSearch`
was lifted into `nav-guards.ts` beside the two guards this phase had already
extracted, and `index-guards.test.ts` pins that a null language pair plans no
requests at all. What follows is the record of why it was deferred, kept because
the reasoning — one product edit per phase, and saying so rather than widening
scope quietly — is what the deferral was for.

The claim has two halves, and the map states them as two bullets under *What
stays unavailable until this is done*:

| half | where it is asserted |
|---|---|
| the language chip does not appear | `app-base-status.test.ts` — *"no chip at all before a language pair is chosen"* |
| no subtitle search is attempted | **not asserted** |

**Why the second half is not covered.** The gate is
`if (!this.app.langPrefs) { this.app.showLanguageOnboarding(); return; }` in
`YouTubeCaptionDetector.handleCaptionTracks` (`apps/youtube/src/content/index.ts`),
with a second expression of the same rule in `buildTrackRequests` on the same
class (`const prefs = this.app.langPrefs; if (!prefs) return [];`).

`YouTubeCaptionDetector` is not exported, and `index.ts` calls `bootstrap()` at
module scope: importing the file to reach the class runs the whole content
script — it builds a sidebar, installs the player menu, starts the caption
detector's own polling interval and registers `yt-navigate-finish` handlers.
`planTrackRequests` (`trackPlan.ts`) *is* importable and is already covered, but
it takes a non-null `LanguagePrefs`: the guard under test is upstream of it, so
calling it proves nothing about this claim.

**What closing it costs.** A second product edit — exporting the detector, or
lifting the langPrefs gate into `nav-guards.ts` beside the two guards T5.21
extracted. Phase 5 was scoped to exactly one product edit (the T5.21/T5.22
extraction), so a second one is out of scope rather than out of reach. It is a
small, mechanical change and the natural companion to the extraction already
made.

**What is true meanwhile.** The behaviour itself is exercised on the live
browser (§1.7's live twin), and the onboarding banner it raises instead is
covered by `onboarding_shown` in `app-base-analytics.test.ts` — a run that
reached the gate and took the onboarding branch. What is missing is the
negative: that no request was planned on the way past.

---

## Not deferred, but worth recording: three claims whose map text was wrong

Article D — the check follows the code, not the map. Three of Phase 5's claims
were written from map text the source contradicts, and each is pinned to the
code instead:

- **T5.7 (§20.2)** — the map places the "never your account…" sentence in the
  consent row's *text*. It is the row's `title`, deliberately: the footer is a
  one-line-per-row band.
- **T5.11 (§1.6)** — the map says the popup's options carry the language's
  native name alone. They carry `English name — native name` whenever the two
  differ. (The sidebar's onboarding picker *does* use the endonym alone; the two
  pickers genuinely differ, and both are now pinned.)
- **T5.16 (§39.3)** — the map places the hover listeners on `#vtt-list`. They
  are on `#vtt-sidebar`, which is the honest boundary: the pointer is "in the
  panel", not "in the list".
- **T5.25 (§8.4)** — the map places all four mode shortcuts in `app-base.ts`.
  Three are built in `SidebarUI.ts` (the quick-modes bar); only Swap is in
  `app-base.ts`.
- **T5.27 (§43.1)** — the map describes a reveal path that reads the
  reduced-motion query in JS. There is none: the class is written
  unconditionally and the stylesheet cancels the animation.
- **T5.28 (§22.4)** — the task names `notifications.test.ts`; the control is
  built in `content/notification-banner.ts` and pinned in its own suite.

These are corrections to where a claim lives, not to what the product does, so
they did not require a map commit of their own. A reader of the map should treat
the six locations above as stale.
