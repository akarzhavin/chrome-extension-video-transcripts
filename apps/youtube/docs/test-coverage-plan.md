# Test coverage plan

Companion to `behaviour-map.md`. That document says what the product does; this
one says how important each behaviour is, how we would know it still works, and
how we would know a check is real rather than green by accident.

Written for a product owner. No file names, class names or code in it.

## How the priority was decided

Each behaviour is scored on two axes, and the tier follows mechanically. The
point is that the ranking can be argued with, rather than being a matter of
taste.

**Blast radius** — how much of the product stops being worth using:
*Total* (nothing works) · *Feature* (one capability is gone) · *Cosmetic*.

**Silence** — whether a break announces itself. A silent break deserves more
coverage than a loud one, because the loud one has a person reporting it within
a day and the silent one can run broken for months.

A third input: whether the behaviour depends on **YouTube's own** protocol or
markup, which changes without warning and is exactly what our existing 1356
automated checks cannot see, because they simulate the network rather than use
it.

| Tier | Rule |
|---|---|
| **High** | Blast radius Total · **or** Feature and silent · **or** it depends on YouTube's own behaviour |
| **Medium** | Feature-level with a visible failure, or a break that degrades without blocking |
| **Below average** | Cosmetic, or trivially noticed by a person, or not observable by a machine at sensible cost |

## Every check has to be able to fail

For each behaviour there are two criteria, and the second is the one that
matters:

- **Positive** — what proves the behaviour works.
- **Negative** — a concrete way to *break* it so the check goes red.

A negative criterion has to name the actual method: a diagnostic switch, a
removed precondition, a specific deliberate edit. "It would fail if broken" is
not a criterion, it is a hope. This is not academic — this product has shipped a
defect that four checks failed to catch because they tested an element that no
longer existed, and stayed green.

## What writing these checks actually found

Worth recording, because the ratio is the useful part: **one defect in the
product, five defects in the checks.**

The product defect was real and had shipped — a video whose captions YouTube was
refusing to serve was reported to the reader as having no captions at all, for
eight seconds, before the correct message replaced it. It was found only because
a check disagreed with the product and the disagreement was chased rather than
explained away. Twice it *was* explained away, wrongly, before the right answer.

The five check defects are the reason the ratio matters. Each would have produced
a passing check that tested nothing:

- A check that asserted an element **exists**, where the element exists in every
  state and only its visibility changes. Twice — the settings screen, and the
  panel on pages that are not videos.
- A check that used a diagnostic switch which denies **every** request, to
  produce a state that needs exactly one request denied.
- A check that looked for a control the product had **replaced**, which now
  exists only in the marketing build.
- A file that **claimed** in its own heading to cover a behaviour it did not.
  Caught by counting the checks in the code rather than trusting the tally.

The habit that caught all five: when a check passes, ask what it would take for
it to fail. If the answer is "nothing I can think of", it is not a check yet.

## When a check cannot be run at all

Some behaviours cannot be reached by a machine no matter how much effort is
spent: a site that detects automation and serves a challenge instead of the
page, a login wall, a browser event with no programmatic trigger, or one of our
own diagnostic switches that does not do what it claims.

The rule adopted here is to **stop and record**, not to persist. An attempt that
hits such a wall is written down with what it did and did not establish, and the
next behaviour is taken up. Two reasons:

- Effort spent defeating a defence is effort not spent covering behaviour, and
  the defence usually wins in the end anyway.
- A check that only passes by outwitting a site is a check that starts failing
  the week that site changes its mind — and it fails for a reason that has
  nothing to do with our product, which is the worst kind of alarm to own.

Every such case appears in *What is not covered* below with its reason. An
unrunnable check is a result. A silently dropped one is a gap nobody knows about,
which is the failure this whole plan exists to prevent.

## Summary

| Tier | Behaviours | Covered now |
|---|---|---|
| High | 19 | **19** |
| Medium | 20 | **20** |
| Below average | 13 | **13** |
| **Total** | **52** | **52 covered — all but the signed-out save, left by your decision** |

**45 live checks** against a real browser, plus **15 that need no browser at
all** — the translation-coverage comparison and the pinned gaps, which read the
source and the policy and run in milliseconds.

### The one thing left, deliberately

**Pressing save with no account, and seeing the sign-in message.** It writes
nothing, but it needs the browser signed out, and the browser these checks run in
belongs to someone signed in with real saved words. That was put to them and the
answer was to leave the session alone.

The decision that produces that message is covered at the layer where it is made,
which needs no browser and no account. What is missing is only the page-level
experience of it. It waits for a throwaway account on the pre-production system.

The two that looked out of reach turned out not to be, once the question changed
from "can we do the whole journey" to "what is the part worth guarding":

- **Signing in** ends at a real account, and creating accounts on every run is
  not something a check should do. But the part that matters is the handoff's
  security: the extension hands the website a one-shot challenge and accepts a
  session back only if the reply carries that exact value, unexpired. Covered —
  the minting live, the refusing in isolation.
- **Netflix** is one of the platforms this extension ships for, inside this same
  build. Its own machinery already had coverage; what was missing was the
  disclosure gap, which needs no Netflix account to check.

Nothing else is left. Where a behaviour could not be reached in full, the check
covers the part that can be and says which part it does not: real fullscreen
entry needs a gesture a background tab cannot supply, adverts play when YouTube
decides rather than when a check asks, and picture-in-picture needs a window the
browser composites itself.

### Gaps are pinned, not fixed

Ten of the covered behaviours are gaps between what the product does and what
someone would reasonably expect — the privacy policy's silence on word lookup,
automatic captions never being marked, right-to-left languages, and so on. A
pinned gap fails the day it changes, so closing one becomes a deliberate edit
instead of a drift. Each check says in its own text what would make it fail and
that it should then be updated with intent rather than deleted.

---

# High priority

Nineteen behaviours. Each either breaks everything, breaks something without
telling anyone, or rests on a contract with YouTube that can shift overnight.

### 1. First-run language setup — *Total · visible*
Until both languages are chosen nothing else in the product runs.
- **Positive**: with no languages stored, a video shows the setup card; choosing
  both makes it disappear and a subtitle search begin.
- **Negative**: store only one of the two languages — the setup card must stay
  and no search may start. If subtitles load anyway, the gate is not a gate.
- **Covered**: yes.

### 3. Loading subtitles — *Total · silent · depends on YouTube*
The product's whole reason to exist, resting entirely on YouTube's caption
protocol — which has broken before while every automated check stayed green.
- **Positive**: on a captioned video, lines appear and exactly one line is
  highlighted as the video plays.
- **Negative**: force the caption request to fail; no lines may appear and the
  failure notice must be shown instead.
- **Covered**: yes — this is the single most valuable check in the suite,
  because the highlight only appears if fetching, parsing, timing and display
  all work together.

### 4. Subtitles on screen — *Feature · silent · depends on YouTube*
Includes suppressing YouTube's own captions once per video so the two do not
stack.
- **Positive**: caption text appears over the video and changes as it plays.
- **Negative**: disable the suppression — YouTube's captions and ours appear
  together.
- **Covered**: mostly. The captions appear, follow playback, and can be turned
  off and back on — that last one asserts the captions themselves rather than the
  control, so a switch that changed nothing would fail it. Still not covered:
  suppressing YouTube's own captions, because reading their caption layer inside
  our own check makes any failure ambiguous.

### 2. Signing in — *Feature · depends on the website*
- **Positive**: after signing in on the site, the panel shows the account and
  the word count.
- **Negative**: corrupt the stored session and save a word — the product must
  sign the person out and mark the toolbar icon, not act as if still signed in.
- **Covered**: **yes**, up to the account. Completing a real sign-in would mean
  creating accounts on every run, so what is covered instead is the part that
  protects it: the extension hands the website a one-shot challenge, mints a
  fresh one per attempt, keeps it only for the session, and accepts a session
  back only if the reply carries that exact value and it is under ten minutes
  old. Without that, any page the browser already trusts could push a session at
  the extension.

### 9. The control inside the video player — *Feature · silent · YouTube markup*
The only way to reach modes and downloads when the panel is closed, injected
into YouTube's own control bar.
- **Positive**: the control is present in the player bar and its menu reflects
  the current state.
- **Negative**: with no subtitles loaded, the captions entry must be disabled,
  not clickable-but-inert.
- **Covered**: yes.

### 13. Looking a word up — *Feature · silent*
- **Positive**: clicking a word in the transcript opens a card with a definition
  and a save action.
- **Negative**: remove the stored languages after lines have loaded, then click
  a word — the card must decline to open rather than open empty.
- **Covered**: yes.

### 14. Saving a word — *Feature · silent*
- **Positive**: saving shows a confirmation, marks the word, and increases the
  count.
- **Negative**: while signed out, saving must fail with the sign-in message and
  must not increase the count.
- **Covered**: **yes, except the signed-out refusal** — which is the one thing
  deliberately left, because it needs the browser signed out and the browser
  these checks run in belongs to someone signed in with real saved words.

  The write itself is not driven: adding real entries to a real dictionary on
  every run is not something a check should do. Everything around it is covered
  and none of it writes —

  - what the reader sees afterwards: the word is marked, a phrase carries **one**
    badge however many words it spans, and re-saving the same phrase does not
    stack a second one. A badge per attempt would litter the transcript, and a
    phrase can be re-saved from the card, from a selection, or by overlapping it.
  - the limits the save enforces: the phrase length cap, and the refusal of an
    over-long or empty term.
  - the counter behind it: one chance per installation to ask for a review, on
    the fifth word and never again.
  - the refusal when nobody is signed in, at the layer that decides it — the
    part that needs no browser at all.

  What remains uncovered is only the *page-level* signed-out experience: pressing
  save with no account and seeing the sign-in message. It waits for a throwaway
  account on the pre-production system.

### 24. When the extension updates underneath an open page — *Feature · silent*
Previously this failed completely silently: the panel died and looked fine.
- **Positive**: after the extension reloads under an open page, within a couple
  of seconds the panel says it was updated and offers to reload the page.
- **Negative**: reload the extension while a page is open and wait past the
  detection window; if the panel keeps looking normal, the detector is dead.
- **Covered**: yes — and this one is valuable precisely because the failure it
  guards against is invisible.

### 26. Moving between videos — *Feature · silent*
Moving to another video without a page reload must clear the previous video's
state.
- **Positive**: the previous transcript and notices are cleared and a fresh
  search runs, while languages and panel state stay put.
- **Negative**: start a search on one video, switch immediately to another; the
  first video's lines must never appear under the second.
- **Covered**: yes, including the race.

### 29. Two copies of the extension installed — *Feature · silent*
Two copies produce one spliced, broken panel and no explanation.
- **Positive**: with two copies active, exactly one panel exists and works.
- **Negative**: remove the stand-down rule so both build a panel; a duplicated
  panel appears.
- **Covered**: yes — asserted as *exactly one*, which is what catches it.

### 38. The transcript is a navigation control — *Feature · silent*
Clicking a line seeks the video; in practice mode a nearby click reveals a word
instead. Both from one gesture, distinguished by a five-second rule.
- **Positive**: clicking a line moves playback to it.
- **Negative**: change the five-second rule to zero — a nearby click then only
  navigates instead of also revealing.
- **Covered**: yes for seeking. The practice-mode branch — where a nearby press
  reveals a word instead — is **not** checked; it needs the product put into
  practice mode first, which the current checks do not do.

### 40. Selecting and copying — *Feature · silent*
Selection is deliberately confined to the language being learned.
- **Positive**: a selection inside the learning-language text is kept; one
  reaching into the translation is cleared.
- **Negative**: remove the restriction — a selection spanning the translation
  survives, which is what must not happen.
- **Covered**: yes.

### 41. When the two languages do not line up — *Feature · silent · YouTube timing*
Each line is paired with the translation that overlaps it most; unmatched
translations are dropped silently.
- **Positive**: no line shows more than one translation.
- **Negative**: pair by position instead of by overlap — translations appear
  under the wrong lines.
- **Covered**: yes, as a structural check (never more than one translation per
  line), which is the part observable without a hand-built fixture.

### 42. Looking up a word, in more detail — *Feature · silent*
Pausing only if the video was playing; distinguishing "no translation" from
"could not load".
- **Positive**: opening a card over the video pauses it and closing resumes;
  a word with no entry says so rather than reporting a failure.
- **Negative**: swap the two messages — a missing entry then reports a failure,
  telling people to retry something that cannot succeed.
- **Covered**: partly — the card opens and carries content, and it refuses to
  open before languages are chosen. Not checked: the pause-only-if-playing rule,
  and the difference between "no translation" and "could not load" — reaching
  those needs control over the dictionary service that the current diagnostic
  switches do not provide.

### 30. Word lookup sends the word to a server — *known gap*
Not a risk of breaking — a mismatch with what is published. The privacy policy
says that without an account nothing is collected, yet every lookup sends the
word and its sentence, signed in or not, statistics on or off.
- **Positive**: pin today's behaviour so any change is noticed.
- **Negative**: stop sending the sentence — the pinned check fails.
- **Covered**: **yes**, as a pinned gap. The check fails the day the policy
   starts describing word lookup — which is exactly when someone should look at
   it. It records today's mismatch; it does not endorse it.

### 32. What the statistics switch does not stop — *known gap*
Turning statistics off does not stop word lookups, the identifier, or the
service check.
- **Covered**: **yes**, as a pinned gap, by scope: the consent flag is read only
   by the analytics code and the two places offering the switch. The day
   something else reads it, that is a deliberate widening and the check says so.

### 35. Problem reports are narrower than the store promises — *known gap*
The store says one click reports a problem; in practice reports are sent only
while signed in and only once per account per day, and a dropped report says
nothing.
- **Covered**: **yes**, as a pinned gap, against the policy text — which is the
   accurate document and the one that has to stay true. If the limits change,
   the check fails and the store listing needs revisiting at the same moment.

### 44. The interface speaks 54 languages, the word card speaks 3 — *known gap*
Fifty-one of the fifty-four locales silently fall back to English on the word
card — exactly eighteen missing pieces of text.
- **Positive**: compare the text available in each language and assert the gap
  is exactly those eighteen.
- **Negative**: translate one of them — the count changes and the check fails.
- **Covered**: **yes**, and it is the only check in the suite that needs no
  browser — it compares the translation files directly and runs in under two
  seconds. It pins the gap in both directions: translating one of the eighteen,
  or a locale losing some other text, both fail it.

### 46. Choosing the same language twice — *Feature · silent*
Nothing stops it; the product quietly substitutes a third language.
- **Positive**: pin that the substitution happens and which language wins.
- **Negative**: remove the substitution — both sides end up the same.
- **Covered**: **yes**, as a pinned gap — and writing it corrected this entry.
   Nothing is "substituted": only one track is requested, so the reader ends up
   in a two-language product showing one, with nothing said about why. Whether
   to refuse the choice, warn about it, or leave it is still yours to decide.

### 47. Automatic captions are not marked — *Feature · silent · YouTube metadata*
YouTube tells us which captions are machine-made; we do not pass that on, so a
learner cannot tell that punctuation and accuracy are lower.
- **Covered**: **yes**, as a pinned gap. The site tells us which captions it
   generated by machine and the product carries that all the way in — then never
   shows it. The check pins that it arrives and is never used.

---

# Medium priority

Twenty behaviours. Real capability, but a break shows itself.

**5. The side panel** — *Covered.* — opening and closing, and remembering the choice.
*Positive*: the tab slides the panel away and back, the arrow flips, and the
choice survives a reload. *Negative*: store an invalid panel state — the panel
must still come up in a sane state rather than stuck.

**6. Reading modes** — *Covered.* — single, dual and practice.
*Positive*: dual shows both languages stacked; practice hides later words.
*Negative*: load only one language and choose dual — it must explain itself
rather than show an empty second row.

**8. Keyboard shortcuts** — *Covered.* — four combinations, three of them discoverable.
*Positive*: each produces the same result as its button. *Negative*: unbind one;
its button still works and the key does nothing.

**10. The settings screen** — *Covered.* — appearance, size, colour, position, reset.
*Positive*: each control changes the sample immediately and survives reopening.
*Negative*: press reset after changing things — anything that does not return to
its default is not wired to reset.

**15. Being asked for a review** — *Covered, driven by the diagnostic switch so the one-shot is never spent.* — once per installation, after five saved words.
*Positive*: the card appears at the fifth word and never again. *Negative*: set
the count to four and save one word — it must appear at five, not four or six.

**16. Subtitles that will not load** — *Covered.* — the notices and their escalation.
*Positive*: the expired-link notice offers to search again; after one attempt it
also offers to reload the page, styled as an emergency. *Negative*: force an
expired link and confirm the wording is the expired-link one and not the
no-captions one — confusing the two sends people to another video for nothing.
*Note*: **this one is implemented**, because it is where the strongest evidence
was available. Counted as Medium, covered anyway.

**17. Throttling by YouTube** — *Covered — and writing it uncovered a real defect, now fixed.* — the "limiting requests" notice and countdown.
*Positive*: the countdown ticks down and becomes a live retry at zero.
*Negative*: force throttling and confirm the notice is not the no-captions one.
**Blocked**: the diagnostic switch for this does not reliably reach the request
— see *What is not covered*.

**18. Only the translation failed** — *Covered.* — a compact line rather than a full notice.
*Positive*: the first language keeps working and a short line explains the
second. *Negative*: force only the translation to fail and confirm no full
"no subtitles" notice appears — that would be false.

**19. Exporting subtitles** — *Covered.* — a subtitle file for the current language.
*Positive*: the download produces a file named after the video, in the leading
language. *Negative*: swap the languages first — the file must follow the swap,
not the original default.

**22. Announcements from the product team** — *Covered without a browser: a message comes from a server and cannot be summoned on demand, so what is pinned is the contract that matters — a dismissed message never returns, and a message that cannot be fetched is silent rather than an error.*
*Positive*: a message appears and, once dismissed, never returns. *Negative*:
serve the same message again after dismissal — it must stay away.

**23. The extension's own toolbar popup** — *Covered, read-only.* — the only place to change languages
later. *Positive*: changing a language there changes what a video page searches
for. *Negative*: change it and reload — if the page still uses the old language,
the only way to change languages is broken.

**25. Two indicators of account state** — *Covered, read-only.*
*Positive*: saving from the popup updates the count in the panel without a
reload. *Negative*: corrupt the session — the toolbar must mark itself even with
no video page open.

**27. Short videos with the panel closed** — *Covered.* — no search until asked.
*Positive*: nothing is requested while the panel is closed; opening it offers to
find subtitles. *Negative*: remove the guard — a request fires while closed.

**28. While an advert plays** — *Covered by driving the product's own rule; a real advert plays when YouTube decides.* — highlighting stops and resumes.
*Positive*: the highlight freezes during an advert and resumes correctly after.
*Negative*: force the advert check to always say no — the highlight runs against
advert time and jumps. *Note*: whether an advert plays is YouTube's decision, so
this cannot be scheduled reliably.

**33. What is measured about people** — *Covered as a pinned list.*
*Positive*: pin the list of measured events. *Negative*: remove one — the list no
longer matches. *Note*: the retention measurements span days and cannot be
exercised in one run.

**39. The transcript follows the video, and yields while you read** — *Covered — asserted on the scroll position, since the yield has no markup.*
*Positive*: the list keeps the current line centred, and stops the moment the
pointer is over it. *Negative*: remove the yield — the text slides away under
the reader's cursor, which is the whole thing it exists to prevent.

**48. What screen readers are told** — *Covered.* — urgent and routine announcements.
*Positive*: a failed save interrupts; a successful one waits. *Negative*: swap
the two urgencies — the check fails. Worth noting this is testable without a
screen reader.

**49. Keyboard-only use has a real limit** — *Covered as a pinned gap.* — *known gap*. Settings, the feedback
form and the word screen do not trap focus and do not close on Escape, unlike
the account panel which does.
*Positive*: pin today's inconsistency. *Negative*: make settings behave like the
account panel — the pinned check fails, which is how you would notice a partial
fix.

**50. Being offline is not distinguished** — *Covered as a pinned gap.* — *known gap*. Network loss looks like
any other recoverable failure.
*Positive*: pin that the generic retry notice appears. *Negative*: add an
offline-specific message — the pinned check fails.

**52. Live streams, picture-in-picture, theatre mode** — *Theatre mode covered; picture-in-picture needs a window the browser composites itself.* — never designed for.
*Positive*: pin that the panel still builds and nothing throws. *Negative*: break
the layout assumption for theatre mode. *Note*: picture-in-picture needs a real
window and cannot be automated.

---

# Below average

Thirteen behaviours: cosmetic, or a person notices instantly, or a machine
cannot reasonably see them.

**7. Swapping the two languages** — visible in the order of the lines and in the
chip; reset on the next video. *Negative*: unbind the swap and confirm order and
chip do not change.

**11. Moving the captions** — dragging them elsewhere. *Negative*: detach the
grip; dragging must move nothing and store nothing. Simulated dragging is a poor
substitute for a real hand.

**12. Fullscreen** — *Written, and honest about when it cannot run.* — captions
grow with the frame and keep their place.
*Negative*: fix the size in absolute terms and compare two frame sizes — it
stops scaling. Real fullscreen needs a genuine gesture in a focused window,
which a background tab cannot give. So the check asks the player to go
fullscreen and, when the browser refuses, **declares itself unrun** rather than
passing: it never reports success on a frame that never grew. When it is run in
a focused window it asserts that the panel moves inside the fullscreen element
instead of being left behind.

**20. Usage statistics on and off** — the switch and where it is mirrored.
*Negative*: turn it off and confirm nothing is sent for an action that normally
would. Proving silence over a network is expensive, which is why this sits here
rather than higher.

**21. Reporting a problem** — the form and its conditional reply field.
*Negative*: make the sign-in state indeterminate and confirm the reply field is
shown, per the documented fallback.

**31. Installing and uninstalling open a web page** — **cannot be automated**;
these are real browser events with no programmatic trigger.

**34. Anonymous measurements cannot be deleted on request** — the only testable
part is that events carry no personal identifier. *Negative*: add one and the
check fails.

**37. The product runs on every YouTube page, not only videos** — no panel
should appear on the home page. *Negative*: remove the video check and a panel
appears where it should not. Cheap and visible; a person spots it at once.

**43. Accessibility touches** — no turning animation when the system asks for
reduced motion, and hidden words stay selectable. *Negative*: remove the
reduced-motion check — the animation runs anyway.

**45. Right-to-left languages are not mirrored** — *known gap*. Text runs
right-to-left inside a left-to-right layout.
*Negative*: add mirroring and the pinned check fails.

**51. No adaptation for narrow windows** — *known gap*, an absence rather than a
behaviour. There is nothing to verify, only an absence to pin, which is worth
little.

**36. Netflix — named on the storefront, missing from the policy** — *Covered,
and the map's wording was wrong.* The extension does not run on Netflix "without
saying so": the storefront names Netflix in both its title and its description.

The real gap is narrower and sits in the privacy policy, which introduces itself
as covering two editions — HDrezka and YouTube — and describes a saved word's
source tag as "HDrezka or YouTube", while the same extension runs on Netflix and
labels data `netflix`. Someone checking whether the policy covers the Netflix
they were promised on the storefront finds the platform named once, as one
possible value in a list of labels, and nowhere in the description of what the
product is.

Pinned, so the day the policy names Netflix the check fails and this entry gets
revisited with it. Watching Netflix itself is still out of scope — that needs an
account on a site that resists automation — but its own machinery already has
coverage, and the disclosure gap needed none.

---

# What is not covered, and why

Silence about a gap is the failure mode this whole plan exists to prevent, so
each exclusion is named.

**Cannot be reached by a machine**
- *Picture-in-picture* (52) needs a window the browser composites itself.
- *Installing and uninstalling* (31) are real browser events with no trigger.
- *Adverts* (28) run when YouTube decides, not when a test asks.

**Written, but skips itself rather than lying**
Three checks depend on a condition the run cannot force. Each tests that
condition first and marks itself unrun when it is absent, so a green run never
means more than it should:
- *Fullscreen* (12) — a background tab cannot produce the gesture the browser
  demands. Run it in a focused window and it asserts for real.
- *YouTube's own size control* — absent on some page layouts.
- *The translation row* — absent whenever a video loads only one language, which
  is a legitimate state, not a fault.
Counting these as covered would be the same mistake as counting a check that
was never run.

**Would change real data** — *now covered, on a stand*

A throwaway account on the pre-production system was set up and this whole
group was checked live; see `specs/claim-level-coverage/phase-6-report.md` and,
for the stand itself, `live-stand-teardown.md`.

- *Saving a word successfully* (14) — covered. Real writes, against the
  pre-production backend, from a disposable account.
- *Signing in* (2) — covered end to end, including completing the hand-off. The
  earlier entry said this needed "a real account"; what it needed was a
  disposable one.
- The **refusal** path of saving — covered. The earlier decision to leave the
  browser's live session alone was the right one, and it is no longer the
  binding constraint: a disposable session can be signed out freely.
- One claim in this group remains genuinely unreachable, for a different
  reason. The *fields of a stored word* cannot be read back: `allow read` on
  `/inbox/{uid}/words/{id}` requires an unscoped token and the extension holds
  a scoped one — write-only by design. What is asserted instead is that both
  shapes the map fixes are accepted, with the backend's own schema gate
  rejecting anything else.

**Out of scope by instruction**
- *Netflix* (36), and everything on the other supported site.

**Blocked by a site defending itself**
- Nothing in the implemented set hit this, because everything runs inside the
  viewer's own already-signed-in browser rather than a fresh automated one —
  which is the whole reason that approach was chosen.
- It is the expected obstacle for anything on the other supported site, whose
  pages are served behind a network that challenges traffic it thinks is
  automated, and for the account pages if they are ever approached from a clean
  profile.
- The standing rule when it happens: **stop and write it down**, do not try to
  get around it. See *When a check cannot be run at all* above.

**Was blocked, now resolved — it was a real defect**
- Throttling (17) and only-the-translation-failed (18) were held back for a
  round: forcing a refusal produced the no-captions notice instead of the
  throttling one, and it was not established whether our own diagnostic tooling
  or the product was at fault.
- It was the product. A grace period concluded "this video doesn't have
  subtitles" seven seconds in, while the requests were still retrying against a
  wait the site itself had asked for. The captions existed; YouTube had refused
  to serve them. The correct message did arrive — after the reader had spent
  eight seconds being told to go and find another video. Real throttling behaves
  the same way, so this reached users, not only tests.
- Fixed, and both behaviours are now covered. The full account, including two
  wrong explanations that were withdrawn along the way, is in
  `dev-flag-429-not-reliable.md` alongside this document.

**Deliberately not pinned**
- The known gaps (30, 32, 35, 44, 46, 47) describe behaviour that may well need
  to change. A test would make each harder to change, and would record a decision
  that has not been made. They are listed as decisions, not as coverage.

---

# What the implemented suite actually asserts

Sixty-two checks: **47** against a real browser and **15** that need none.
Three of the live ones declare themselves unrun when the browser cannot give
them the condition they need — see *What is not covered*. Every one
was demonstrated red under its own break before being accepted — a green check
that has never been seen to fail is not evidence of anything.

**Subtitles arriving and being usable**
Lines load for a captioned video · exactly one line is highlighted and the
highlight moves with the video · caption text appears over the video and changes
as it plays · no line ever carries more than one translation · the video used for
these checks genuinely still has captions, verified at the moment of use.

**The panel, the player control, and where they appear**
The panel exists and its tab keeps its size · exactly one panel exists, which is
what catches a second installed copy · the control inside YouTube's own player
bar is present · collapsing changes both what is seen and what is announced ·
the collapsed choice survives a reload · no panel appears where there is no
video · the panel follows the video into fullscreen · theatre mode leaves
everything working.

**Reading**
With one language loaded, dual mode makes itself unavailable and stays inert ·
practice mode hides words and keeps the first of each line visible · the
practice shortcut matches its button · the reading order swaps and swaps back ·
the transcript scrolls itself and stops while the pointer is over it · the
highlight does not race ahead on an advert clock.

**Words**
Clicking a word opens a card with content · with no languages chosen the card
declines rather than opening empty · a phrase selected in the translation opens
no card while the same gesture in the learning language does · clicking a line
moves playback there.

**Settings, captions and export**
The settings screen opens and closes · reset returns a changed setting to its
default · the on-screen captions can be turned off and back on — asserted on the
captions themselves, so a control that changed nothing would fail · the drag grip
is offered only while settings are open · the usage-statistics choice is offered
and remembered · the problem-report form opens and has a way back · the export
names its language, and says why it cannot be used when nothing is loaded.

**Account and prompts**
The review card appears and offers both answers · the account row states the
state and opens and closes · the popup renders the account and both language
choosers · a short video with the panel closed still says what it is doing.

**When things go wrong**
An expired link produces the expired-link notice, not the no-captions one · after
one retry the wording changes and an emergency reload appears · a refused request
blames the limit rather than the video · the false "no subtitles" never appears
while retries are still running · a partial failure does not raise the full
notice · switching videos never leaks the previous one's lines · when the
extension updates underneath an open page the panel says so.

**Without a browser at all**
The word card is translated in exactly three locales, the other fifty-one are
missing exactly the same eighteen pieces of text, none is missing anything else,
and none is missing the card only partly. Plus eleven pinned gaps: right-to-left
languages, narrow windows, the install and uninstall pages, the policy's silence
on word lookup, automatic captions never being marked, the reach of the
usage-statistics switch, what is measured, the deny-list that keeps measurements
anonymous, choosing the same language twice, the diagnostic-report limits, and
dismissed announcements never returning.

Each run leaves the browser as it found it: the language pair, the reading mode,
the panel state, the caption styling and which copies of the extension are
enabled are all restored, including when a check fails partway through. Verified
after a full run rather than assumed.
