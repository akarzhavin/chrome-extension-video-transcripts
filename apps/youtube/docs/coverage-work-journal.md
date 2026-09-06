# Test coverage work journal

> Written as the work happens, not afterwards. What was done and **why that
> way**, without jargon. The numbers and the detail for whoever goes into the
> code live in the neighbouring files; here only the decisions and their
> reasons.

## What is going on here

The product has a "behaviour map" — a document recording in plain language how
it behaves: what it shows on first run, what it says when there are no
subtitles, and so on. There are about 445 such statements in all.

The task is to reach a state where every statement has an automatic check that
will **fail** if the product stops behaving that way. Not "a test exists" but "a
test will catch the break".

## Assignment of 2026-09-06

Close the holes in coverage. Netflix is separate and not being touched right now
(the user's decision).

## Decisions

*(filled in as the work goes)*

### 1. The translation card: "looking up…"

**What was not checked.** When you hover a word, the card first shows
"Looking up…" with a spinner, and then the translation itself. The behaviour map
mentions this intermediate line, but there was no check for it.

Worse: a check formally existed, but it was built backwards — it **waited for the
spinner to disappear** and only then read the card. Had the spinner stopped
showing altogether, there would have been nothing to wait for, and the check
would have passed instantly and successfully. That is, the break would have been
invisible to it.

**What was done.** Two new checks, one for each side:

- a slow answer **must** raise the "looking up" line;
- a fast answer **must** do without it.

**Why two and not one.** The spinner appears not immediately but after 0.4
seconds — deliberately: the usual answer arrives in 0.27 seconds, and there is no
point flashing for it. If you only check "the spinner appeared", then a product
that shows it instantly on every word also passes the check — and that is
noticeable flicker.

**A mistake along the way, caught by checking the check.** The first version of
the second check looked at the card **after** the answer had arrived. But the
answer overwrites the spinner — if it flashed, by that moment it is no longer
visible. The check stayed green against a deliberately broken product. Rewrote it
so that it watches the card **for the whole wait** rather than glancing at the
end.

**How I made sure it works.** Broke the product deliberately (removed the 0.4 s
delay) — both checks went red. Put it back — both green. The product file was
restored byte-for-byte, without a trace.

### 2. The card does not open until languages are chosen

**What was not checked.** Until the user has chosen a language pair, the
translation card must not open — there is nothing to translate into. A check for
this existed, but was built meaninglessly: it opened the page, **clicked on
nothing**, and confirmed the card was absent. The card would not have been there
either way, whether the ban works or not.

**How that came about.** With no languages chosen there is no subtitle list
either, so on a live page there is nothing to click. The check was written "as it
came out".

**What was done.** Moved the check to where a word can be created artificially and
**actually hovered**. Two halves:

- languages not chosen → hovering yields neither a request nor a card;
- languages chosen → **the same hover** opens the card.

The second half is mandatory: without it the check would also pass on a broken
stand where hovering does nothing at all.

**A mistake along the way.** The first attempt to break the product deliberately
(to make sure the check catches it) was wrong: I removed the ban, but the code
right after it immediately threw for a different reason — and the request did not
go out anyway. The check stayed green, and from that one could have wrongly
concluded that it is useless. Broke it correctly — it went red.

**How I made sure.** Red against a correctly broken product, green against the
whole one, the file restored byte-for-byte. The whole set of checks for this
module — 73 of 73.

### 3. The red "!" badge on the extension icon

**What it is.** When a saved sign-in breaks (the session was revoked, too much
time passed), a red "!" appears on the extension icon in the browser bar. This is
the **only** signal a person gets in that situation, and unlike the line inside
the panel it is visible even when no video is open.

**What was not checked.** Nothing. Not a thing. Across the whole test suite this
badge was mentioned once — as a stub in somebody else's test, asserting nothing.
Had this logic broken, we would have heard about it from a user who had stopped
understanding why words were not being saved.

**What was done.** A new check file, eight of them. What is checked is not only
"the badge appeared" but also the inverse cases:

- saving a word with a broken session → the badge appears;
- the badge is specifically red, not a neutral counter;
- **an ordinary error (network, server failure) does NOT raise the badge** —
  otherwise a person is sent to sign in again for nothing;
- a successful save does not touch the badge;
- signing out clears the badge;
- a session left over from an older version of the extension (with no refresh
  token) is flagged at startup;
- a healthy session and a complete absence of a session at startup are left
  alone.

**Why there are more inverse cases than direct ones.** The check "the badge
appeared" on its own also passes for a product that hangs the badge on any error
whatsoever. It is precisely the inverse halves that tell "works" apart from
"always on".

**How I made sure.** Broke the product four different ways in turn — do not set
the badge; set it on any error; do not clear it on sign-out; do not flag the old
session. Each time exactly the checks that should have gone red did. Put it back
— all eight green, the product file restored byte-for-byte.

### 4. The first-run screen — choosing languages

**What it is.** The very first screen a new user sees: "Choose your languages"
and two dropdowns. Until the pair is chosen the product shows no subtitles at all
— this is the gate in front of everything else.

**What was not checked.** Almost everything. The only check that touched this
screen at all was watching analytics: it chose **both** languages and confirmed
that two events were sent.

Because of that, the screen's main rule stayed unchecked: **until both languages
are chosen, nothing is saved**. The rule could have been deleted from the product
and not one check would have gone red, because the single test always chose both.

Why this matters: half a pair is not "incomplete setup" but a wrong pair. The
product deliberately does not guess the second language, because having guessed
wrong it would silently teach the wrong thing.

**What was done.** A separate file, twelve checks:

- the screen's heading and explanation — in full, not by fragment;
- the labels of both dropdowns;
- **there is no "save" button** — if one is added, it means saving has moved and
  the rule "saved immediately on choosing" has stopped being true;
- the dropdowns open on "Select…", and that placeholder cannot be chosen back;
- all 42 languages are in the lists;
- every language is written **in its own language** ("Español", "Русский", "中文")
  rather than in English — so that a person can find their language by eye while
  still understanding nothing else on the screen;
- **choosing one language saves nothing** (in either order);
- choosing the second saves the pair;
- after the pair is chosen the card goes away;
- a returning user does not see it;
- someone with no pair does.

**A mistake along the way.** Two checks failed at first, and I decided not to
tune them but to find the cause. It turned out the product contains a guard
against a second copy of the extension: if the panel on the page is "not ours",
the method quietly exits. There was no panel in the test stand, and the guard was
firing. I fixed the stand, not the checks — the failure was right.

**How I made sure.** Five product mutations, one at a time: remove the "both are
required" rule; do not remove the card after choosing; write the languages in
English; allow the placeholder to be chosen; do not show the card to a new user.
Each turned exactly its own checks red. Put it back — twelve green, the file
restored byte-for-byte.

### 5. Three small but important fixes

**a) The "Download subtitles" line in the player menu.** Until languages are
chosen, the product hides everything in the menu except the invitation to choose
them. A check for this existed, but it listed four lines out of six — "Download"
and "Settings" were missing from the list. Added. Next to it is a similar check
where the same line must, conversely, be visible (but inactive) — I left a
comment so the two are not merged: these are two different rules about one
element.

**b) A text check that accepted the wrong text.** The check confirmed the menu
says "No subtitles" — but two more live product lines start with those words,
including "No subtitles in your language — original only". That is, the product
could show the wrong message and the check would not notice. Now the whole phrase
is compared, plus it is explicitly asserted that the other line is not there.
Made sure: swapped one line for the other in the product — before this would have
been green, now it is red.

**c) The problem report did not say which languages were needed.** When subtitles
are not found and the person hits the emergency reload, the product sends the
developer a quiet report: which video, which error, how many attempts there were.
It also sends the chosen language pair — without it you cannot tell "these
subtitles do not exist" from "loading broke". The check did not list those two
fields.

Added them — and a **second check** for the case where no pair is chosen at all.
It is needed because of a subtlety: the comparison the test is written with does
not tell "the field is empty" from "the field is absent entirely". For a report
those are different things: an empty field says "there was no pair", an absent one
says nothing. Verified by mutation: the first check does not catch this break, the
second does.

### 6. The reading-modes panel, the live countdown, and the button labels

**a) The modes panel appears only when there is something to switch.** Until the
subtitles are loaded, the "one language / two languages / guess the word" buttons
are hidden — there is nothing to switch. Checked by nothing at all.

Checked both sides: empty → hidden, a track arrived → shown. One side is not
enough: the check "hidden when empty" would also pass on a product where the
panel is **always** hidden — and that is a worse bug than the original.

A trap the audit warned about, and which really would have fired: this suite
contains a "lightweight" stub panel, and a check written against it would quietly
check nothing. Written against the real panel.

**b) The countdown has to actually run.** When YouTube temporarily rate-limits
translations, the menu shows "retry in 12 s", and the number must **go down**. The
existing check rendered a single frame and read "12s" — the same "12s" would be
shown by a product whose countdown does not run at all.

The new check moves the clock and confirms the number changed to 9. Plus,
separately, that closing the menu stops the timer: an invisible countdown is a
leak.

A subtlety: the countdown must not be driven to zero. At zero the product
deliberately stops repainting and leaves the last number — the check would pass
for the wrong reason.

**c) The labels of two buttons in the player bar.** The tooltips "Lingogram menu"
and "Subtitles on video (Shift+O)" were read by nobody.

There was a trap here that would have made a naive check **cement the mistake**:
the text lives in two places — in the code as a fallback and in the translations
file, which is what the user sees. Tests substitute a dummy for the translations,
which means they would be comparing against the fallback while the translations
file could say anything at all.

Made the check read the **real translations file**. Then it goes red both if the
code stopped setting the label and if the translation diverged from the code.
Confirmed with both mutations separately.

Separately I left a warning in the code: the suite already has a similar green
check for the string "On-screen (Shift+O)", but that is a **different** button in
a different place. Without the warning, the new checks will one day be deleted as
a duplicate.

### 7. The retry counter: what resets it and what does not

**The rule.** When subtitles are not found, the product offers "Search again".
After one failed attempt it additionally offers "Reload the page" — the emergency
exit. The attempt counter is zeroed on navigating to **a different video**, but is
NOT zeroed by pressing "Search again".

Get this the wrong way round and the emergency button will be offered forever —
that is, a person will reload the page again and again to no effect.

**What was not checked.** Eight existing checks call the reset directly and
observe that the counter zeroed. But both functions — "reset on a new video" and
"reset on retry" — are called back to back on the real paths, one after the other.
A check that simply looks at "zero at the end" cannot say which of them did it.
And it would have stayed green had the zeroing moved into the wrong function —
which is exactly the mistake the comment in the product itself warns about.

**What was done.** A check in the right **order**: press "Search again" → confirm
the counter survived → change the video → confirm it zeroed.

**How I made sure.** Moved the zeroing into the wrong function — the check went
red. Before, this swap would have passed unnoticed.

---

## What was left unclosed, and why

Three items I deliberately did NOT close now. The reason is the same for all
three: making a check "as it comes out" here would mean getting a green check
that checks nothing — and that is worse than not having one, because the hole
looks closed.

**1. "The statistics choice survives a change of video".** In this test suite the
settings storage is a stub: it always answers "empty" no matter what is written
to it. So the check "the setting was saved" would be green **always**, including
against a broken product. To do it honestly you first have to set up real storage
in this suite — separate work, and useful beyond this case.

**2. "A stale answer is discarded silently".** When a person has moved to a
different video and the answer for the old one arrives late, the product throws it
away and shows nothing. The check "is the answer stale" is itself covered. But
**the place where it is called** sits in a file that cannot be imported from a
test: on load it starts the entire extension. To close it honestly, a piece of
code has to be lifted into a separate file — as has already been done in this
project with a neighbouring check. That is a change to the product's structure,
and I did not make it unasked.

**3. "The counter is reset by a change of video specifically" — the binding to
the event.** The rule itself is now checked (see above). But the two places it is
called from sit in the same unimportable file. The same reason, the same
solution.

Items 2 and 3 are closed by one and the same extraction. If you decide to do it —
it is roughly 15 lines of moved code with no change in behaviour, and after it
both checks are trivial to write.

### 8. The account line in the panel — the "signed in" state

**What it is.** A thin line in the panel: either "Sign in to save words" or a
green dot with an email address. Clicking expands it: the email, how many words
are saved, a "Sign out" button.

**What was not checked.** Everything relating to the "signed in" state. There
were checks only for the "not signed in" state. The only place the "signed in"
state was mentioned was a live check that requires a real test account and in
this environment **never runs**. So in practice it was checked by nothing.

And a real account is not needed here at all: the line is drawn from what it was
told, and in a test the answer is what you set it to.

**What was done.** Eight checks:

- the line shows the email address, and the invitation to sign in **disappears** —
  rather than sitting next to it (otherwise the product would be inviting someone
  already signed in to sign in);
- the hover tooltip carries both the address and the number of saved words, so
  they are visible without a click;
- the expanded panel shows the address, the counter and the "Sign out" button;
- zero words is written as "0 words saved", not as emptiness;
- signing out closes the panel and brings back the invitation to sign in.

**Separately — the live update.** The product watches for changes: save a word
through the extension icon and the counter in the panel changes by itself, and
vice versa. This was checked by **nobody**: in every test the change subscription
was a stub, meaning the whole mechanism could have been deleted unnoticed.

Now the check pulls the real handler out of the stub and calls it — the way the
browser does. Three cases: a saved word changes the counter; signing in elsewhere
removes the invitation; **an unrelated change touches nothing**.

The last one matters: without it a product that repaints the line at every sneeze
would also pass. And that is flicker on screen and an extra request every time.

**How I made sure.** Five mutations: delete the change subscription; repaint on
everything; remove the counter from the tooltip; remove the sign-out button; do
not show the "signed in" state at all. Each turned exactly its own checks red.

### 9. What counts as "the session broke"

**What it is.** When saving a word fails, the product decides: is this a
temporary failure (we will re-save later) or has the session broken for good (we
have to ask for a fresh sign-in). The decision is taken from the error text —
nine signs.

**Why it matters in both directions.** Getting it wrong is expensive either way:

- **the list is too narrow** → a broken session is not recognised, the person
  silently loses every save and does not understand why;
- **the list is too wide** → a one-second drop in connectivity throws them out of
  their account and demands a sign-in for no reason.

**What was not checked.** Not one of the nine branches. Not one.

**What was done.** Fourteen checks: nine that each sign of a broken session really
does lead to a sign-out and a red badge; five that ordinary failures (a server
error, no network, a timeout, too many requests, and not an error at all) leave
the account **alone**.

**How I made sure.** Two mutations from opposite sides: removed one sign from the
list — exactly the check about it went red; made any error count as a broken
session — every check about ordinary failures went red.

---

## The tally for this pass

**There are now 1701 checks instead of 1649** — 52 new. 71 check files instead of
69.

**The product is not changed by a single line.** Every break I used to convince
myself the checks work was rolled back byte-for-byte — visible by comparison with
the original branch.

### What is closed

| What | Was | Now |
|---|---|---|
| Two checks that could not fail | counted as working | closed, the register corrected |
| The red "!" badge on the icon | not checked at all | 8 checks |
| What counts as "the session broke" (9 signs) | none | 14 checks |
| The first-run screen | analytics only | 12 checks |
| The account line, "signed in" state | behind the live stand only | 8 checks |
| Live update of the word counter | the subscription could be deleted unnoticed | 3 checks |
| The reading-modes panel | not checked | both sides |
| The live countdown | one frame | ticks + stops |
| The labels of two player buttons | read by nobody | both, through the real translations |
| The retry counter: what resets it | could not be told apart | order tells them apart |
| The "Download" line in the menu | missing from the list | added |
| A text check that accepted the wrong text | green against a swap | goes red |
| Languages in the problem report | not listed | + the "no pair" case |

**Every new check was seen red** against a deliberately broken product — 26
breaks in all, one at a time.

### Three things I did NOT do

Described in detail above. Briefly: two require restructuring the product's code
(lifting a piece into a separate file), one requires reworking the test stand.
Doing them "as it comes out" there would mean getting a green check that checks
nothing — and that is worse than not having one: the hole would look closed.

### A note on the method itself

Worth remembering from this pass: **the summary table of holes is out of date**.
Three of the four entries I checked against it turned out to have been closed long
ago, while the real holes (the icon badge, the live update, the nine signs of a
broken session) were not listed in it at all. The list of holes has to be obtained
by re-reading the code, not from a report — even a fresh one.
---

## Netflix (second pass)

The main point first: **no Netflix account is needed for these checks**, and
there are no credentials in the code. Everything checked here is the extension's
own code, while Netflix is faked: the player, the page and the language list are
built right there in the test.

The project already has a safe pattern in case a real account is ever needed: the
path to the credentials file comes from an environment variable, the file itself
lives **outside the repository**, and the checks that need it simply skip when
the variable is not set. That is how it is done for the test mail account.
Nothing of the kind was needed for Netflix.

### 10. Netflix's native subtitles are turned off, and never turned back on

**What it is.** Netflix has subtitles of its own. If they are not turned off,
ours are drawn on top of them — two sets of text over each other. That is the
worst first impression the product can make.

The converse is a rule too: the product **must not** turn them back on — the
choice of subtitles belongs to the person, and they can bring them back from
Netflix's own menu.

**What was not checked.** Neither of the two. The turn-off function was not
mentioned in a single test.

**What was done.** Five checks: it is specifically the "Off" item that gets
chosen; turning them back on does nothing; if the player is not ready yet, the
product waits and retries (otherwise on a freshly started episode the subtitles
would stay doubled); it waits **not forever** — otherwise the timer would live
for the whole life of the tab; if there is no "Off" item in the list, it touches
nothing rather than picking somebody else's track at random.

**How I made sure.** Four mutations: remove the turn-off; allow turning back on;
do not wait for the player; choose any track instead of "Off". Each turned
exactly its own checks red.

### 11. The panel narrows the player, it does not cover it

**What it is.** On Netflix the subtitle panel does not overlay the picture but
squeezes the player — the video stays fully visible.

**What was not checked.** Nothing: the layout rule was not mentioned in a single
test. Delete it and the panel would start covering the film.

**What was done.** The checks read **the result of applying the styles**, not the
text of the rule. This is a matter of principle: a check that compares the text of
a rule with a copy of itself passes for any rule at all — including one that
matches nothing.

Four cases: the panel is open → the player is narrowed; the panel has not appeared
yet, is collapsed, or it is fullscreen → the player is **not** narrowed (otherwise
there would be a black bar next to the picture).

Plus a separate check that in fullscreen the panel is lifted above Netflix's own
control bar, or it would cover the play button.

**A mistake along the way.** I first wrote that last check through the computed
style — and it failed. The cause was not in the product: the test environment
parses a nested formula incorrectly and hands back garbage. You cannot compare
against garbage, so here I read the rule itself — and wrote why in a comment, so
that it does not look like sloppiness.

**How I made sure.** Two mutations: remove the narrowing entirely; narrow always,
regardless of collapsed state and fullscreen. The first turned the "narrowed"
check red, the second all three "not narrowed" checks.

### 12. Languages the film does not have are shown, but inactive

**What it is.** On Netflix the language dropdown is built differently from
YouTube's: it shows **all** supported languages, split into two groups — "this
film has these" and "the rest". The second group is visible but cannot be chosen
from.

That way a person sees that the language is supported in principle, this
particular film just does not have it.

**What was not checked.** The data — which languages are marked available — is
covered well. But the **rendering** was not covered at all: remove one line and
every unavailable language would become selectable, while selecting one would
silently do nothing.

**What was done.** Three checks: the two groups in the right order and with the
right contents; the available ones are selectable, the unavailable ones are not;
and **the other side** — on YouTube, where the list works differently, there must
be no groups at all. Without the last one, a product that always groups would
pass.

**How I made sure.** Two mutations: make the unavailable languages selectable;
swap the groups round. Both caught.

### 13. A live Netflix check — against the real site

**Why, when the unit checks already exist.** The unit checks play Netflix
themselves: the test builds the player, the page and the language list. That is
right for the question "does our code handle correctly what it is given", but
this approach has a blind spot: **if Netflix changes its markup or renames a
method, the unit checks stay green**, because they play by the old rules. The live
check closes exactly that.

**About the account.** There are no credentials anywhere. The check uses the
browser session that is already open — the same way the YouTube checks use the
YouTube session. The profile chosen is **the first one in order**, not one by
name; the film taken is whichever the home page showed first. So the file contains
no profile name, no film title and no film id — the file is safe in a public
repository and will keep working for anybody else.

**Runs only on command.** The check plays a few seconds of video on a live
account and leaves a trace in the viewing history. Nobody should get that as a
side effect of an ordinary run, so without `LINGOGRAM_NETFLIX=1` the checks
honestly report themselves as skipped. Verified: in an ordinary run they skip.

**Three checks, each about something a unit cannot see:**

- the subtitles come from Netflix's **real** manifest (and they are lines with
  text, not the right number of empty ones);
- the panel narrows the **real** player rather than covering it — that is, the
  class our layout relies on still exists on their side;
- the player's **real** programmatic interface is available, the track-switching
  method is in place, and the list contains an "Off" item — without this, turning
  off the native subtitles would quietly stop working and every video would carry
  two sets of text.

**How I made sure it was worth it.** Three green on the first attempt is grounds
for suspicion, not for celebration. So I broke the layout rule **in the built
extension** (not in the source — Chrome loads the build), reran the check: it went
red on the right line, and the player stayed full width. Restored the build from a
copy and checked it over: the rule is in place, the configuration the same (dev,
emulator, dictionary address). Green came back.

### 14. Platform-independent checks — a trial run

**The task.** Find out whether a check can be written once and run on different
platforms (YouTube, Netflix, Rezka), with the platform as a setting.

**The main finding — the abstraction needed is far smaller than it looked.**

I expected to have to describe, per platform, the signs that a page is ready, the
player's selectors, and the way to clean up. It turned out **none of that is
needed**. Everything the checks look at is **our own markup**: the panel and the
list of lines are named the same everywhere, because we draw them, not the site.

Exactly one thing differs: **how to get to the page with the video**. On YouTube
that is just a URL. On Netflix — pick a profile and find a film on the home page.

So the platform description came out tiny: a name, "can it be run right now", and
"how to open the page". Three items instead of the five or six I had planned.

**What was done.** One check — "the panel opens and fills with subtitles" —
expands into two, one per platform. Both green in 29 seconds. Netflix, without its
variable, honestly skips.

**A mistake along the way, an instructive one.** I broke the product to make sure
the check catches the break. Both checks stayed green. Instead of rewriting the
check, I went looking for the cause — and it was not in the check: **I broke the
build in the working copy, while the browser loads the extension from the main
one**. That is precisely the warning written into the live-check instructions, and
I walked straight into it.

Broke the right copy — both platforms went red, and the message names which one:
"YouTube: the panel stayed empty", "Netflix: the panel stayed empty". Restored the
build, checked the configuration — green came back.

**The conclusion for what follows.** Porting is cheaper than I assumed. But so
far **one** check has been tried, and I would not port the rest blind: the next
ones may expose differences this one did not show.

---

## 15. Porting checks onto two platforms: 29 of them, without a single copy

**What was asked.** Port "about 35" checks so that they run on Netflix too. And
separately and explicitly: **no duplicates** — hide the platform behind a shared
mechanism.

### How many it actually came to: 29, not 35

I named the figure 35 by eye. Once I started porting, three groups dropped out,
and each for its own reason rather than "did not get to it":

| What did not port | Why |
|---|---|
| Resetting the text sizes | It checks **different** values for different sites: on YouTube a fresh install gives 160%/110%, not the generic 100%/75%. That is a statement about YouTube, not about the panel. |
| The subtitle stub, "no network" | They use a debug switch that is read once at page load — and only from a YouTube URL. |
| Ads, "theatre" mode | Netflix simply does not have them. These are different products, not one product on two sites. |
| YouTube's home page and search | "Works on every page of the site" is a statement about how YouTube is built. |

That leaves 29. It is less than promised, and it is better to give the honest
figure than to stretch it to 35 with checks that mean nothing on Netflix.

### How it was done: not copies, but a parameter

Duplicates were the main risk: two copies of one check drift apart, and six months
later nobody remembers which is the right one.

It turned out there was nothing to copy. The checks are written against the
**extension's own** markup — `#vtt-sidebar`, `#vtt-list`, `#vtt-qm-guess`. It is
byte-for-byte the same on any site. The only differences are:

1. **how to get to the page** with a playing video;
2. **how to clean up after yourself** the things that belong to the site
   (fullscreen, "theatre", the ad marker);
3. **which element to expand** to fullscreen.

All three went into the platform description (`e2e/fixtures/sites.ts`). The check
itself stayed single: it is wrapped in a "for each platform" loop, and it takes
the page from the shared mechanism by platform name. One check — two runs.

A side gain: each platform has its own shared tab. A run that does not touch
Netflix **never opens it once** — the platform's slot stays empty.

### A hole the machine found, and not me

The automatic replacement substituted the new mechanism following the pattern
`async ({ ext, page })`. One check declared its parameters **in a column**, and
the pattern did not catch it: it got the Netflix name but still the YouTube page.

In the run this looked like **a passing Netflix check with Netflix switched off**.
The very thing: green against broken. I noticed it by one line in the report that
should not have been there, and went through every file searching for the same —
exactly one turned up.

**The lesson:** after a bulk automatic replacement, check not the number of
replacements but the result — in the run report. The line "Netflix passed" with
Netflix switched off is visible to the eye; in a replacement count it is not.

### Checked that the checks catch anything at all

Green on its own proves nothing. So I broke the product one place at a time and
watched whether it went red:

| What I broke | What went red |
|---|---|
| The marking of hidden words | 2 practice-mode checks |
| The collapsed-panel class | 3 checks in two files |
| The word card | 2 word-lookup checks |
| The settings panel | 2 checks in two files |

Nine rednesses from four breaks. After each, the build came back **byte-for-byte**
— I compared the checksum before and after.

### Worth remembering

The port **checks nothing new on YouTube** — the same 29 checks are there. It
checks them **on Netflix**, where there were three live checks. That is what the
whole thing was for.

Netflix has a cost that YouTube does not: every run plays video on a live personal
account and leaves a trace in the viewing history. So Netflix is not on by
default, but behind its own variable.

---

## 16. Two peculiarities of Netflix that stopped the port working at first

The first live run of the 29 ported checks on Netflix came back almost entirely
red. Two causes, both outside the extension.

### 16.1. Seeking to the start **destroys** the Netflix player

The cleanup between checks paused the video and rewound it to zero, so that the
next check would get the page in a known state. On YouTube this is harmless.

On Netflix it is not. Measured step by step:

```
pause 1: video in place, sitting at 22.5 s
pause 2: video in place
pause 3: video in place
currentTime = 0  →  <video> elements on the page: 0
6 seconds later  →  <video> elements on the page: 0
```

The player **does not come back**. The pause on its own is harmless; it is the
seek that kills it.

What followed was particularly galling: the cleanup broke the page, then saw for
itself that "there is no player", pronounced the page unusable, opened a new one —
and repeated the whole thing. In the report this looked like "the panel did not
appear", that is, like a defect in the extension.

**How it was fixed.** The right to seek became a property of the platform. YouTube
rewinds, Netflix does not. The requirement "the video is at the start" moved to
YouTube as well: you cannot demand of a platform something it physically does not
allow.

**A lesson broader than the case.** Cleanup that breaks the thing it is cleaning
disguises itself as a product defect. Worth remembering: if "the product is
broken" exactly where we have just been cleaning up — suspect the cleanup first.

### 16.2. One account, one stream

Netflix does not allow two videos to play at once on one account. The second tab
gets the "Pardon the interruption" page with code **M7375** instead of the player.

I did not spot this — the user sent a screenshot.

The consequences are the same: no player, no subtitles, every check failing with
"the panel stayed empty". Again it looks like an extension defect.

**How it was fixed, in two places:**

1. **Do not open a second tab.** The Netflix checks now take the shared page
   rather than starting their own. For YouTube the shared tab was an economy; for
   Netflix it is a condition of working at all. Incidentally: three Netflix checks
   now run in milliseconds instead of minutes.
2. **Name the refusal.** If the page does turn out to be that one, the run says so
   directly: Netflix refused to play (M7375) because it allows one stream per
   account, and there is nothing wrong with the extension. What is searched for is
   the error code, not the text: the text is translated into the interface
   language, the code is not.

The refusal is not skipped but fails the check: a second tab means the run opened
something it should not have, and that is worth noticing.

### 16.3. Seeking forward kills the player just as seeking back does

After the first two fixes, 20 checks of 28 passed on Netflix. The remaining seven
failed for one reason, and it is a refinement of 16.1.

I first decided that what was fatal was seeking **to the start** specifically.
Wrong: what is fatal is **any** write to `video.currentTime`. Measured on a fresh
page:

```
before the seek     : <video> elements — 1, time 32 s
currentTime = 120   : <video> elements — 0
6 seconds later     : <video> elements — 0
```

Six of the seven checks ran playback forward to see how the highlight follows the
video. Each destroyed the player with its very first action.

**The solution was Netflix's own.** Its player has a seek method of its own, and
it does not tear the element down:

```
seek(150000) through the player API
  +3 s: <video> in place, time 152.7, the list scrolled to 1817
  +5 s: <video> in place, time 157.7, the highlight appeared
  +8 s: <video> in place, time 165.7, the list at 2447
```

So "play from such-and-such a second" became an action of the platform: YouTube
writes `currentTime`, Netflix calls its own player. The checks stayed as they
were — they still ask to "play from the 20th second" without knowing how that is
done.

**One check was left unported, and rightly so.** "The page does not jump when the
lines change" starts by scrolling the document by 600 pixels. A Netflix page does
not scroll at all — the player takes the whole window and `scrollY` stays zero.
The assertion becomes empty there: it would pass under any behaviour. Better to
leave such a check to one platform than to gain a second green line that means
nothing.

Its neighbour — "the active line stays in the middle of the list" — is about the
list itself, not about the document, and works on both.

**The tally: 28 ported checks run on both platforms, one stays YouTube-only on
the merits.**
