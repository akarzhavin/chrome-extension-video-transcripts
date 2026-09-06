# Lingogram — how the extension behaves

**What this is.** A description of everything the extension does for the user on
YouTube: what they see, what the product decides on their behalf, and what
happens when things go wrong.

**Who it is for.** Anyone who needs to know how the product actually behaves —
to plan work, to write tests against it, to answer a support question, or to
decide what to change. It is written for a product reader: no code, no internal
names.

**Scope.** The YouTube edition only. The same extension also supports Netflix,
and a separate edition supports another video site; both are out of scope here.

**How to read the evidence labels.** Every statement says how it was
established:

| Label | Meaning |
|---|---|
| **[observed]** | Driven in a real browser and watched happening |
| **[derived]** | Read out of the product's own decision rules |
| **[unconfirmed]** | Neither — stated as an open question, not as fact |

Nothing here is written from memory or assumption. Where the product turned out
to differ from what was expected of it, the difference is called out in
*Corrections to common assumptions* at the end.

---

## Contents

**Getting started**
1. First-run language setup
2. Signing in and the account

**Reading subtitles**
3. Loading subtitles
4. Subtitles on screen
5. The side panel
6. Reading modes
7. Swapping the two languages
8. Keyboard shortcuts
9. The control inside the video player

**Adjusting things**
10. The settings screen
11. Moving the captions
12. Fullscreen

**Learning from what you watch**
13. Looking a word up
14. Saving a word
15. Being asked for a review

**When things go wrong**
16. Subtitles that will not load
17. Throttling by YouTube
18. Only the translation failed

**Everything else**
19. Exporting subtitles
20. Usage statistics
21. Reporting a problem

**Behaviour nobody thinks to ask about**
22. Announcements from the product team
23. The extension's own toolbar popup
24. When the extension updates underneath an open page
25. Two indicators of account state
26. Moving between videos
27. Short-form videos with the panel closed
28. While an advert plays
29. Two copies of the extension installed

**How the transcript actually behaves**
38. The transcript is a navigation control
39. The transcript follows the video, and yields while you read
40. Selecting and copying
41. When the two languages do not line up in time
42. Looking up a word, in more detail
43. Accessibility touches

**What leaves the browser, and what is promised about it**
30. Looking a word up sends that word to a server
31. Installing and uninstalling both open a web page
32. What the usage-statistics switch does not stop
33. What is measured about people, in plain terms
34. Anonymous measurements cannot be deleted on request
35. Diagnostic reports are narrower than the store promises
36. Netflix — named on the storefront, missing from the privacy policy
37. The product runs on every YouTube page, not only videos

**Language, accessibility and the edges**
44. The interface speaks 54 languages — the word card speaks 3
45. Right-to-left languages are not laid out right-to-left
46. Choosing the same language twice leaves one language, silently
47. Automatic captions are not marked as such
48. What screen readers are told
49. Keyboard-only use has a real limit
50. Being offline is not distinguished
51. No layout adaptation for narrow windows
52. Live streams, picture-in-picture and theatre mode

---

# Getting started

## 1. First-run language setup

**Exists.** Confirmed. **[derived]**

Until the user has chosen a language pair, the panel does not show subtitles at
all — it shows a setup gate instead. This gates almost everything else in this
document, which makes it the true beginning of the product. **[derived]**

### What the user sees

A setup card headed **"Choose your languages"**, with the line **"Pick the
language you're learning and your native language to start."** Below it, two
dropdowns labelled **"I'm learning"** and **"My native language"**, each opening
on a placeholder reading **"Select…"**. **[derived]**

The 42 supported languages are listed **by their own name in their own script**
("Español", "Русский", "中文") rather than translated into the interface
language — so a learner can find their target language by sight before
understanding anything else on screen. **[derived]**

### What happens next

There is no confirm or save button. Each dropdown saves the moment it is
changed, but nothing happens until **both** are set — choosing one alone does
nothing visible. Once both exist, the card disappears and the subtitle search
begins immediately. **[derived]**

### Changing it later

Not from the panel. The language pair is changed from the **extension's toolbar
popup**, which offers the same two dropdowns, pre-filled, again saving
instantly. **[derived]**

The pair also appears as a small chip in the panel corner, but that chip only
**swaps** which language leads — it does not change the languages themselves.
**[derived]**

### What stays unavailable until this is done

- No subtitle search is attempted at all. **[derived]**
- The word-meaning card silently declines to open, because there is no language
  to translate into. **[derived]**
- In the player menu, every row except **"Choose languages"** is hidden, and the
  caption on/off button there stays greyed out. **[derived]**
- The language chip does not appear. **[derived]**

### On a later visit

The choice is remembered; the setup card never reappears. It returns only if
the stored pair is genuinely absent. **[derived]**

> **Detail worth knowing.** "Unset" is a real, meaningful state here, distinct
> from any default. The product deliberately does not guess a pair, because a
> wrong guess would silently teach the wrong language pairing.

## 2. Signing in and the account

**Exists.** Confirmed. **[derived]**

There is no sign-up form inside the extension. Signing in always happens **on
the product's own website, in a new browser tab**. **[derived]**

### The journey

Three places start it: the account row above the transcript, the extension's
toolbar popup, and the account row in the menu the product adds to YouTube's
player. **[derived]**

Clicking any of them opens a new tab on the product's website, carrying a
one-time code the extension generated. The user signs in there. The website then
hands the session back to the extension silently — no code is ever shown to the
user to copy. If the sign-in began in the toolbar popup, that popup closes
itself once the tab opens. **[derived]**

### How the user knows it worked

The account row changes from an underlined **"Sign in to save words"** to a small
green dot beside their email address. Opening that row shows **"Signed in as"**,
the email, a line reading **"{count} words saved"**, and a **"Sign out"** button.
The toolbar popup mirrors the same information. **[derived]**

### When it fails

| Situation | What the user is told |
|---|---|
| The sign-in tab could not be opened | **"Couldn't open the sign-in page. Try again."** |
| The hand-back was stale or already used | The user is asked to start again from the extension's popup |
| A working session was later revoked | The extension signs them out and marks its toolbar icon with a red **"!"** |

That last case has **no silent recovery** by design — a revoked session requires
the user to sign in again in a visible tab. **[derived]**

### What signing out does, and does not, do

Signing out clears the credentials from the device. It deliberately **keeps**
the running count of words saved on this installation and the record that the
review prompt has already been shown — on the reasoning that it is still the
same person. **[derived]**

The saved words themselves live with the account on the server and are not
affected. **[derived]**

---

# Reading subtitles

## 3. Loading subtitles

**Exists.** Confirmed. **[observed]**

### What the user sees

On opening a video, the panel appears within a few seconds, then fills with the
transcript. In a measured run: panel present at ~2.6 seconds, first transcript
line at ~4.6 seconds. **[observed]**

The on-screen caption can take noticeably longer to appear than the transcript —
in the same run, ~20 seconds. This is not slowness: the caption only shows once
playback actually reaches a line that has text, and the opening stretch of that
video had no dialogue. **[observed]**

Two tracks are fetched: the language being learned, and the translation.
**[observed]**

### What the product does invisibly

When the site refuses the first request because a required permission token is
missing, the product briefly switches YouTube's own captions on — which makes
YouTube issue the token — reads it, switches YouTube's captions back off, and
retries. The whole exchange takes about two seconds and the user is never told
any of it happened. **[observed]**

This silent recovery is bounded: at most one such attempt per video, and at most
four seconds of waiting for the token. **[derived]**

Before concluding that an empty answer means "no translation exists", the
product re-asks up to twice more, about seven-tenths of a second apart, and
re-signs the request each time in case the link had simply expired. **[derived]**

A single track's request is attempted up to four times in total, with growing
gaps between attempts, before it counts as failed. **[derived]**

### When the two tracks disagree in length

Common, and handled rather than left ragged: the two languages are often cut
into differently timed lines, especially when the translation was authored
separately. Each translation line is attached to the single original line it
overlaps most, a translation matching nothing is dropped, and duplicates
collapsed. Described in full under *When the two languages do not line up in
time*. **[derived]**

### Failure

Covered separately in *Subtitles that will not load*, *Throttling by YouTube*,
and *Only the translation failed*.

> **Reliability note.** Subtitle loading is genuinely variable run to run. The
> same video, unchanged, produced three different outcomes across three
> consecutive attempts: both tracks failed; only the translation failed; both
> succeeded. **[observed]** Anyone judging whether this feature works must
> repeat the attempt — a single failure proves nothing.

## 4. Subtitles on screen

**Exists.** Confirmed. **[observed]**

Captions appear over the video and follow playback. The current line is also
highlighted in the panel's transcript, so the two stay in step. **[observed]**

### The site's own captions

The product turns YouTube's own captions off, once per video, so two sets of
subtitles do not stack on top of each other. **[derived]** Observed indirectly:
after loading, YouTube's caption area was present but empty and its caption
button read as off. **[observed]**

This suppression is deliberately **once per video, not permanent**. If the
viewer turns YouTube's captions back on afterwards, the product leaves them
alone for that video. The intent is to prevent an unpleasant first impression,
not to overrule the viewer. It re-arms for the next video. **[derived]**

## 5. The side panel

**Exists.** Confirmed. **[observed]**

The panel can be collapsed and re-opened by its tab, and the state toggles
cleanly in both directions. **[observed]**

**How collapsing looks**: the panel *slides off the right edge of the screen*,
leaving only its tab. It does not shrink or fold — its width is unchanged and its
contents are still laid out, simply off-screen. The tab's arrow flips to point
the other way. **[observed]**

Whether the panel is collapsed is remembered **globally** — across sites and
across browser restarts. **[derived]**

> **Consequence worth knowing.** Because a collapsed panel means the user has
> opted out of the panel, the product will skip loading subtitles for short-form
> videos while it is collapsed, and says so rather than searching. See
> *Subtitles that will not load*, state E.

## 6. Reading modes

**Exists.** Confirmed. Three modes. **[observed]**

| Mode | What the user gets |
|---|---|
| **Single** | One language only — the one being learned |
| **Dual** | Both languages together, learning language first |
| **Guess** | Words hidden, revealed at the user's pace |

**Dual is the default.** **[observed]** In a measured run the transcript line
showed both languages stacked — the original sentence and its translation.
**[observed]**

Switching between all three works, and exactly one is always active — Single is
a mode in its own right, not "both toggles off". **[observed]**

### When a mode cannot be offered

Dual needs a second track. When only one language loaded, Dual cannot engage.
**[derived]**

**The product explains itself rather than failing silently.** The control is
deliberately left reachable instead of being switched off, precisely so that it
can show *why* it is unavailable when the user reaches for it. The explanation
disappears again once a second track is available. **[derived]**

The mode controls are hidden entirely until subtitles have loaded — there is
nothing to switch between yet. **[derived]**

### Guess mode, in detail

Words are hidden and uncovered one at a time. In a measured run, switching to
Guess produced a transcript with thousands of hidden words alongside a few
hundred already showing. **[observed]**

**Every line starts with its first word already visible.** Hiding begins from
the second word onward, so no line is ever a wall of blanks. **[derived]**

**Only real words are hidden.** Punctuation, dashes marking a new speaker,
musical-note symbols and bracketed sound cues are always left visible — so a
sung line still reads as a sung line. **[derived]**

**Hidden words keep their true width.** Each is shown as a frosted capsule
exactly as wide as the word beneath it, so its length is a legitimate clue
without spelling anything out. **[derived]**

**Uncovering is strictly in reading order.** Exactly one word — the next one —
is marked as the live target; later words cannot be jumped to. There is no
"reveal all" and no "give up", and a word once shown cannot be hidden again
except by leaving the mode and returning, or by moving to another video.
**[derived]**

**Uncovering a word replays the line.** Every reveal also seeks the video back
to that line's start, so the learner immediately hears the word in place.
**[derived]**

**Finishing a line unlocks its translation.** Only once every hidden word in a
line has been uncovered does the translation appear beneath it — the payoff for
completing the line, rather than something available all along. **[derived]**

**Languages without spaces are handled properly.** For Chinese, Japanese, Thai,
Khmer, Lao and Burmese the product uses the browser's own word segmentation
rather than splitting on spaces, falling back to hiding one character at a time
where that is unavailable. **[derived]**

There is no score, streak, timer or tally anywhere in this mode. Progress is
simply how much of each line is uncovered, kept for as long as the mode stays
on. **[derived]**

The chosen mode is remembered **globally**, across sites and restarts.
**[derived]**

## 7. Swapping the two languages

**Exists.** Confirmed. **[derived]**

Which language reads first is the user's choice, changed by a control in the
panel and also by a keyboard shortcut. **[derived]**

### How it is triggered

Two ways, doing the same thing: the small language chip in the panel header — a
badge reading something like **"EN ⇄ RU"** — or the Shift+S shortcut.
**[derived]**

### What changes

The two languages trade places: whichever was leading becomes secondary. The
chip reorders its two codes to match, and the transcript and on-screen caption
flip together. The chip plays a brief pulse as confirmation. **[derived]**

### Whether it is remembered — it is not

This is deliberately **session-only**. The order resets to the default
(learning language first) whenever the user moves to a new video, and it is
never written to stored preferences — unlike the reading mode, the on-screen
toggle and the collapsed panel, which are all remembered. **[derived]**

A returning user therefore never finds a previously swapped order still in
place. **[derived]**

### With only one language loaded

The swap does nothing, silently. The chip stays visible and clickable rather
than hiding or greying out — it simply has nothing to exchange until a second
language arrives. **[derived]**

## 8. Keyboard shortcuts

**Exists.** Confirmed — four shortcuts, active across the page. **[derived]**

| Keys | What it does |
|---|---|
| Shift + D | Switch to (or away from) the two-language view |
| Shift + G | Switch to (or away from) the practice view |
| Shift + O | Turn the on-screen captions on or off |
| Shift + S | Swap which language reads first |

**Discoverability**: three of the four are advertised in the tooltips of their
matching controls — the mode buttons name their shortcut, and so does the swap
control. **[observed]** A user who never hovers those controls has no other
listing to find them in. **[unconfirmed]**

## 9. The control inside the video player

**Exists.** Confirmed. **[derived]**

The product places **two** items into YouTube's own control bar, beside
YouTube's captions button: **[derived]**

- the product's logo button, tooltip **"Lingogram menu"**, which opens a
  dropdown;
- a dedicated captions on/off button, tooltip **"Subtitles on video (Shift+O)"**,
  which toggles on-screen captions in one click without opening anything.

### What the menu offers

In order: **[derived]**

| Row | What it does |
|---|---|
| Account | **"Sign in to save words"** when signed out; the email plus **"{count} words saved"** when signed in |
| Status *(only when relevant)* | Messages such as **"No subtitles for this video"**, **"Translation limited by YouTube — tap to retry"** with a live countdown, or **"No subtitles in your language — original only"** |
| **"Choose languages"** *(only before setup)* | Opens the panel |
| **"Mode"** | Shows the current mode and opens a submenu: "Original only", "Both languages (Shift+D)", "Guess the word (Shift+G)" |
| **"Subtitles on video"** | On/off switch |
| **"Show panel" / "Hide panel"** | Label and arrow follow the panel's actual state |
| **"Download subtitles"** | See *Exporting subtitles* |
| **"Settings"** | Opens the settings screen |

### Why it matters

It is reachable **without the side panel at all**. A user who has hidden the
panel — or never opened it — can still change mode, toggle captions, check their
sign-in and word count, retry a failed search, and download subtitles.
**[derived]**

### It mirrors the real state

The captions button is greyed out whenever there is nothing to show — no
language pair, or no track loaded — so an inert control is never presented as
working. The menu re-renders live: the current mode is ticked, the panel row's
wording matches reality, the download row stays disabled until something is
downloadable, and a cooldown counts down inside the menu. **[derived]**

Before the language pair is set, the menu shows only the account row, the status
row, and **"Choose languages"**. **[derived]**

---

# Adjusting things

## 10. The settings screen

**Exists.** Confirmed. **[derived]**

### Opening and closing

Reached by a gear control in the panel header, and also from the entry the
product adds to YouTube's own player controls. **[derived]**

Settings **takes over the panel** rather than opening a separate window: the
transcript is hidden while settings is open. If the panel was collapsed, opening
settings expands it first. **[derived]**

Closing is by a back control reading **"‹ Subtitles"**, or by the gear again,
which acts as a toggle. There is no separate "done" button. **[derived]**

Whether settings is open is **not** remembered — it always starts closed.
**[derived]**

### What changes while settings is open

Two deliberate behaviours make styling possible:

- The on-screen caption **stays visible even between lines of dialogue**, so
  there is always something to look at while adjusting. If there is no nearby
  line at all, a neutral sample reading **"Subtitles appear here"** is shown
  instead (and **"Translation appears here"** for the second line). **[derived]**
- A drag handle appears on the caption box, labelled **"Drag to move the
  subtitles"**. See *Moving the captions*. **[derived]**

Opening or closing settings also dismisses the feedback screen or a word card if
either was open, so the user never returns to a stale screen. **[derived]**

### The settings themselves

**Appearance of the panel**

| Setting | Options | Default |
|---|---|---|
| Theme | **"Auto"**, **"Light"**, **"Dark"** | **Dark** |

"Auto" follows the system setting and keeps following it live — flipping the
system theme mid-video updates the panel without a reload. **[derived]**

Theme affects **only the extension's own panel**, never the captions over the
video. **[derived]**

The default is Dark rather than Auto on purpose: so that existing users' panels
do not silently change appearance at update time. **[derived]**

**Languages**

The learning language and the native language, as two dropdowns. **[derived]**

**Text**

| Setting | Options | Default |
|---|---|---|
| Font family | "Monospaced Serif", "Proportional Serif", "Monospaced Sans-Serif", "Proportional Sans-Serif", "Casual", "Cursive", "Small Capitals" | Proportional Sans-Serif |
| Size | 50%–400%, in steps of 5% | **160% on YouTube** (100% elsewhere) |
| Colour | Five swatches (white, gold, cyan, green, orange) plus a custom picker | White |
| Translation size | 50%–400%, in steps of 5% | **110% on YouTube** (75% elsewhere) |
| Translation colour | Same five swatches plus custom | Gold |
| Font opacity | "25%", "50%", "75%", "100%" | 100% |

YouTube gets deliberately larger starting sizes than the generic default,
because captions sized for a web page read too small over a video player.
**[derived]**

**Background and position**

| Setting | Options | Default |
|---|---|---|
| Background colour | Black, dark grey, mid grey, white, navy | Black |
| Backdrop | "Off", "Light", "Medium", "Solid" | Medium |
| Position | Three vertical placements (low / middle / high) | Middle |
| Edge | "None", "Shadow", "Outline" | Shadow |

"Off" for Backdrop is a genuinely transparent box, not merely a faint one — at
which point the Edge setting is the only thing keeping text legible over moving
video. **[derived]**

Choosing a Position preset also **clears any manual drag**, returning the
caption to that preset's exact spot. **[derived]**

**Reset controls**

Two separate reset buttons, one for Text and one for Background and position.
Each resets only its own group. Reset restores YouTube's larger starting sizes,
not the smaller generic ones, and never turns subtitles off. **[derived]**

Note: reset does **not** clear a manual drag — only choosing a Position preset
does that. **[derived]**

**Two more rows**

- **"Share anonymous usage stats"** — an on/off switch. See *Usage statistics*.
- **"Report a problem"** — opens the feedback form. See *Reporting a problem*.

### What is remembered, and where

This distinction is a real product decision and worth stating plainly:

- **Per site** — everything about how captions *look*: font, sizes, colours,
  opacity, background colour, backdrop, position preset, manual drag, and edge
  style. Restyling captions on YouTube does not affect another supported site.
  **[derived]**
- **Everywhere** — how the user *reads*: the chosen mode, whether the panel is
  collapsed, the panel theme, and the usage-statistics switch. **[derived]**

All of it survives closing and reopening the browser. **[derived]**

A user who has never opened settings still gets sensible captions, because the
site-specific starting values apply before any generic default. **[derived]**

### Conditional and hidden items

- The **email field** on the feedback form appears **only for signed-out users**.
  **[derived]**
- The **Dual** mode control can be present but unavailable — see *Reading modes*.
- The **theme control is absent entirely on one other supported site** (not
  YouTube), which is deliberately dark-only. **[derived]**

### Signed-out versus signed-in

Inside settings itself, nothing is hidden or changed by sign-in status. The only
difference is the extra email field on the feedback form. **[derived]**

## 11. Moving the captions

**Exists.** Confirmed. **[derived]**

The captions can be dragged anywhere over the video, but **only while the
settings screen is open** — that is when the drag handle appears. **[derived]**

The handle is a **separate grip beside the caption text**, not the text itself.
This is deliberate: a press on the caption text already means something (reveal
a hidden word, or select a word to look up), and a surface that had to decide
between "move", "reveal" and "select" made all three feel unreliable.
**[derived]**

Fine adjustment is possible with the arrow keys while the grip has focus, and a
larger step with Shift held. **[derived]**

**Position is stored as a share of the player's height, not as a number of
pixels.** This is why a position chosen in fullscreen lands in the same relative
spot on the small inline player, instead of somewhere near the top of it.
**[derived]**

The manual position is cleared by choosing a Position preset in settings, and
**not** by the group's Reset button. **[derived]**

The grip survives the caption box being rebuilt several times a second as new
lines arrive — otherwise it would vanish from under the user's finger mid-drag.
**[derived]**

## 12. Fullscreen

**Exists.** Confirmed. **[derived]**

Captions grow in fullscreen while keeping their shape and their position
relative to the video.

The mechanism, in product terms:

- **Size** is expressed as a percentage of a base size, tuned against a
  reference frame the size of a 1080p video. Because the caption scales with the
  frame rather than being pinned to a fixed pixel size, it grows when the frame
  grows. **[derived]**
- **Position** is stored as a share of the player's height and width, so the
  caption sits at the same relative point on the frame at any size. **[derived]**
- The **panel itself follows into fullscreen** rather than being left behind on
  the page underneath. **[derived]**

> **Not verified live.** Entering fullscreen requires a genuine user gesture in
> a focused window, which the observation method used here (a background tab)
> cannot supply. The attempt confirmed the panel is still present and the
> caption still tracks playback, but fullscreen itself did not engage, so the
> growth and proportion claims above rest on the product's rules alone.
> **[derived, not observed]**

---

# Learning from what you watch

## 13. Looking a word up

**Exists.** Confirmed. **[observed]**

### Two surfaces, two different gestures — on purpose

| Where | How the card opens |
|---|---|
| The transcript in the panel | A **click** on a word |
| The caption over the video | A **hover** over a word |

This asymmetry is deliberate. In the panel the cursor crosses dozens of words on
its way anywhere, so hovering would open cards nobody asked for. Over the video
there is only ever one line, so hover is the lighter gesture. **[derived]**

Selecting a phrase by dragging opens the same card for the whole phrase.
**[derived]**

### What the card shows

Observed live: clicking the word "We're" produced a card reading
**"contraction — Contraction of we + are."** with **Save** and **Details**
actions. **[observed]**

The card has a waiting state while the answer is fetched, and an error state if
it cannot be. **[derived]**

### Two behaviours worth knowing

- Over the video, opening a card **pauses playback**, because reading a
  translation takes a second or two and the line would otherwise be gone by the
  time the user looks up. In the panel nothing is paused — the transcript is
  already standing still. **[derived]**
- The card does not open at all until the language pair is set, since there is
  no language to translate into. It declines silently rather than showing an
  error. **[derived]**

## 14. Saving a word

**Exists.** Confirmed. **[derived]**

### What gets saved

The word or phrase, plus **up to three lines of context** — the line it came
from and the ones before and after — in the language being learned only.
**[derived]**

Also recorded: which edition of the product saved it, and the time. **[derived]**

**Not** recorded: the video, its address, its title, or the language pair. A
saved word does not carry a link back to where it was found. **[derived]**

### What the user sees

A brief confirmation reading **"Saved: {word}"** in the corner. In the
transcript the word gains a highlight and a small **"✓ saved"** badge, and the
card's Save action switches to a filled, saved state. **[derived]**

### Saving the same word twice

Within one open card, a second press does nothing. But that memory lasts only as
long as that card is open — looking the word up again later and saving it again
**creates a second entry**. There is no duplicate detection or merging.
**[derived]**

### Saving while signed out

The attempt is made and fails, with the message **"Sign in via the Lingogram row
above the subtitle list to save words."** **[derived]**

### Where saved words live

**The extension has no dictionary browser** — no list, no search, no way to
review saved words inside the extension. The only place to see them is the
product's website. The extension shows just a running total: **"{count} words
saved"**. **[derived]**

Saved words first land in a holding area per user, which the website imports
from — so they are a staged queue rather than landing directly in a finished
dictionary. *The website's side of this was not examined.* **[unconfirmed]**

### Limits

| Limit | Value |
|---|---|
| Words saved per day | **500** (then: **"Daily limit of 500 words reached. Try again tomorrow."**) |
| Minimum gap between saves | **1 second** |
| Longest term | 256 bytes |
| Longest stored context | 2048 bytes, trimmed from the end so the sentence around the word survives |

No lifetime cap on dictionary size was found. **[derived]**

## 15. Being asked for a review

**Exists.** Confirmed. **[derived]**

### When

After **5** saved words — the current, enforced value. **[derived]**

> A comment elsewhere in the product still says 30. That is stale; the number
> actually applied is 5.

### Once per installation, ever

The one-shot is spent **the moment the card is shown**, not when a button is
pressed. Rating, declining, skipping, or simply closing it all mean the same
thing: it never appears again for that installation. Nothing re-arms it.
**[derived]**

### What it asks

It is a three-step conversation, not a single ask: **[derived]**

**Step 1 — the gate.** **"Enjoying Lingogram?"** / **"You've been saving words
with it for a while."** with **"Not really"** and **"Yes!"**

**If "Yes!"** — **"Glad to hear it"** / **"A quick rating on the Web Store helps
others find it."** with **"Not now"** and **"Rate it"**.

**If "Not really"** — **"What would make it better?"** with a box prompting
**"What went wrong? What would you change?"**, and **"Skip"** / **"Send"**. On
success: **"Thank you, this really helps."** On failure: **"Couldn't send. Try
again?"**, keeping what was typed.

**The design decision worth naming**: an unhappy user is never sent to the
public review page. Dissatisfaction is routed into private feedback instead.
**[derived]**

---

# When things go wrong

## 16. Subtitles that will not load

**Exists.** Confirmed — and it is considerably more elaborate than a single
banner. **[derived]**

The product distinguishes **five** situations, each with its own wording. Three
of them additionally change their wording after the user has retried, so there
are **eight** distinct messages in total.

### A — Still looking

- Title: **"Searching for subtitles…"**
- Body: **"Looking for captions for this video."**
- No buttons.

Shown while the request is in flight. If nothing arrives within the grace
period, it becomes one of the states below. **[derived]**

### B — YouTube is throttling

Covered in full under *Throttling by YouTube*.

### C — A load failed for a recoverable reason

- Title: **"Couldn't load subtitles"**
- Body, first failure: **"The subtitle link expired. Searching again usually
  fixes it."**
- Body, after a retry: **"Searching again did not help. Reloading the page
  refreshes the subtitle link and usually fixes it."**
- Buttons: **"↻ Search again"** always; **"⟳ Reload page"** added after a retry.

### D — The video genuinely has no subtitles

**This is a normal outcome, not a malfunction.** Not every video has captions.

- Title: **"No subtitles available"**
- Body, first check: **"This video doesn't have subtitles. Try another video —
  not every video has captions."**
- Body, after a retry: **"Still no subtitles. Reloading the page often fixes
  it."**
- Buttons: **"↻ Search again"** always; **"⟳ Reload page"** added after a retry.

### E — The search was deliberately not run

- Title: **"Subtitles are ready to load"**
- Body: **"The panel was closed, so nothing was downloaded for this video yet."**
- Button: **"⌕ Find subtitles"**

This is a deferral, not a failure: for short-form videos with the panel closed,
the product declines to spend a request the user has not asked for. **[derived]**

### How the user tells a fault from a normal outcome

By the wording, which is written to make the distinction. The normal case says
plainly that the video has no captions and suggests trying another. The fault
cases never claim the video lacks subtitles — they say the link expired, or that
the limit is YouTube's. **[derived]**

### The escalation, and its exact trigger

The emergency **"⟳ Reload page"** action appears once the user has clicked
"Search again" **at least once** — a threshold of **one**, not "a couple".
**[derived]**

Automatic retries do **not** advance this counter; only the user's own clicks
do. **[derived]**

The reload action is styled as a quiet emergency measure rather than a normal
feature, because it is a last resort. **[derived]**

### What resets it

Moving to a different video. It deliberately does not reset on clicking "Search
again", or the escalation could never be reached. A successful load also clears
the banner and the counter. **[derived]**

### Retry machinery the user never sees

| Rule | Value |
|---|---|
| Attempts per track before it counts as failed | 4 |
| Extra re-asks when the answer is empty but successful | 2, about 0.7s apart |
| Unattended retries after a throttle expires | 2 per episode |

**[derived]**

### A silent report

When the user clicks the emergency reload, the product sends itself a diagnostic
note recording which languages were wanted, why it failed, and how many attempts
were made. It waits at most 2.5 seconds so it never delays the reload the user
asked for. The user is not shown this. **[derived]**

## 17. Throttling by YouTube

**Exists.** Confirmed. **[observed]**

When YouTube temporarily blocks subtitle requests, the user gets a full banner —
not a short line:

- Title: **"YouTube is limiting requests"**
- Body: **"YouTube temporarily blocked the subtitle request for this video. It's
  a limit on their side, not a missing subtitle — it can clear in minutes, but
  sometimes lasts hours."**
- Button while waiting: a disabled **"Try again in {n}s"**, counting down live.
- Button once the wait is over and automatic retries are spent:
  **"↻ Search again"**.

All observed live, including the live countdown. **[observed]**

Two product decisions are visible in that wording:

1. **The cause is explicitly assigned to the site, not to the product** — "It's
   a limit on their side, not a missing subtitle."
2. **No recovery time is promised.** "It can clear in minutes, but sometimes
   lasts hours" replaced an earlier, more optimistic claim that proved untrue.
   **[derived]**

The waiting period lengthens on repeated throttling: **30 seconds → 1 minute →
2 minutes → 5 minutes**, capped there. **[derived]**

The product retries on its own when the countdown reaches zero — one request per
attempt, at most twice per episode. After that it hands the decision back to the
user. **[derived]**

While this banner is up, the transcript is empty and both language pickers are
empty. **[observed]**

## 18. Only the translation failed

**Exists.** Confirmed. **[observed]**

When one language is already playing and the other fails, the product
deliberately does **not** interrupt with a full banner. Instead a compact line
appears beneath the language picker, reading one of:

- **"Translation limited by YouTube"**
- **"No translation for this video"**
- **"Couldn't load the translation"**

Each expands into a fuller explanation on hover:

- Throttled: **"YouTube has temporarily limited automatic translation for you.
  It's their limit, not a problem with the extension — it can clear in minutes,
  but sometimes lasts hours. The original subtitles keep working meanwhile."**
- None available: **"YouTube offers no automatic translation into this language
  for this video. Retrying will not help — the original subtitles are still
  shown."**
- Recoverable: **"The subtitle link expired before the translation loaded.
  Searching again usually fixes it."**

Three deliberate touches:

- Only the throttled case is given a warning colour. "No translation exists" is
  left plain, because it is a normal outcome rather than a problem. **[derived]**
- A retry control is attached **only when retrying could actually help** — absent
  when no translation exists for that language pair. **[derived]**
- No countdown is shown here, unlike the full banner, because this wait has no
  reliable end and a ticking number would overstate the product's certainty.
  **[derived]**

Observed live: with the translation throttled, both language pickers offered only
the language that had loaded — the failed translation is simply absent rather
than shown as a broken entry. **[observed]**

---

---

# Everything else

## 19. Exporting subtitles

**Exists.** Confirmed. **[derived]**

Two entry points, same action: a download control in the panel header, and the
**"Download subtitles"** row in the player menu. **[derived]**

### What the user gets

A single subtitle file in the common `.srt` format, containing **one language
only** — whichever is currently leading. **[derived]**

The translation is deliberately not offered: the product's reasoning is that the
native-language track is a comprehension aid, not the thing anyone takes away to
study. **[derived]**

Because *Swapping the two languages* changes which language leads, swapping
before downloading changes what is exported. **[derived]**

The file is named after the video and the track.

### When it is unavailable

The control is shown but disabled until a track with actual text has loaded, and
says so: **"Available once subtitles have loaded."** **[derived]**

The two entry points differ on what they need. The panel's control needs only a
loaded track — unlike the mode controls, it does not need a configured language
pair. The player-menu row does: with no pair chosen it is hidden along with
every other row except the invitation to choose languages. **[derived]**

## 20. Usage statistics

**Exists.** Confirmed. **[derived]**

A switch in settings labelled **"Share anonymous usage stats"**, explained as:
**"Counts like \"subtitles loaded\" and \"word saved\". Never your account, the
videos you watch, or the words you save."** **[derived]**

**Default: on**, for both new and existing installations. **[derived]**

The choice is remembered **globally** — across sites and browser restarts — and
the same switch appears in the toolbar popup. **[derived]**

## 21. Reporting a problem

**Exists.** Confirmed. **[derived]**

Reached from **"Report a problem"** at the bottom of settings. It opens as a
screen layered over settings, with its own back control reading
**"‹ Settings"**. **[derived]**

**Signed-out users get one extra field**: an optional **"Reply address"**,
prompting **"Email (optional, if you want a reply)"**, so the team can answer.
Signed-in users never see it — their account already identifies them. If
sign-in status cannot be determined, the field is shown. **[derived]**

Opening or closing settings dismisses this screen, so the user never returns to
a half-written form by accident. **[derived]**

---

# Behaviour nobody thinks to ask about

Everything in this part was found by asking what a feature list would miss. None
of it appeared in the original scope, and all of it is user-visible.

## 22. Announcements from the product team

The product can show a message to users **without shipping an update** — for
instance when YouTube changes something and subtitles break for everyone.
**[derived]**

It appears as a titled banner at the top of the panel, in the user's own
language where available. It shows even before the language pair is chosen, so
it reaches brand-new users too. **[derived]**

Some messages can be dismissed with an **"×"** labelled **"Dismiss"**; others
deliberately cannot. A dismissed message never returns, but a different one can
arrive later. Every message carries an expiry, after which it can never be shown
again. The product checks for new ones about every 15 minutes. **[derived]**

Nothing marks these as remotely delivered — to the user they simply look like
part of the product. **[derived]**

## 23. The extension's own toolbar popup

Clicking the extension's toolbar icon opens a small window that works **without
any video page open**. **[derived]**

It shows the product name; either **"Sign in on lingogram"** or the user's email
with **"{count} words saved"** and **"Sign out"**; the two language dropdowns;
and the same usage-statistics switch with the same explanation. Briefly, while
it checks sign-in status, it reads **"Loading…"**. **[derived]**

This is the **only** place the language pair can be changed after setup.
**[derived]**

## 24. When the extension updates underneath an open page

When the browser updates the extension while a video page is open, the page is
cut off from it. The panel keeps *looking* fine — it does not go blank, and the
highlighted line may keep scrolling — while nothing can actually be saved or
fetched any more. **[derived]**

The product notices within about two seconds and says so: **"Lingogram was
updated"** / **"This panel has stopped following the video. Reload the page to
use it again."**, with a **"⟳ Reload page"** button. **[derived]**

Before this existed, a user who was only watching — not saving words — got no
warning at all that the panel had quietly died. **[derived]**

## 25. Two indicators of account state

**In the panel**: a thin row showing either **"Sign in to save words"** or a
green dot with the email. Opening it reveals the email, the saved-word count and
**"Sign out"**. It updates live — a word saved from the toolbar popup changes the
count in the panel, and the reverse. **[derived]**

**On the toolbar icon**: a red **"!"** badge appears when the stored session
breaks and a save fails because of it. It clears on the next successful sign-in.
This one is visible even with no video page open at all. **[derived]**

## 26. Moving between videos

Changing video without reloading the page resets everything belonging to the
old video — transcript, tracks, retry counters, banners — and re-evaluates from
scratch. The language pair, the panel's collapsed state and the statistics
choice all persist, being properties of the user rather than the video.
**[derived]**

A subtitle track that arrives for a video the user has already left is discarded
silently. **[derived]**

## 27. Short-form videos with the panel closed

For short-form videos, the product **deliberately does not search** while the
panel is collapsed, to avoid spending requests on clips the user is scrolling
past — which would also bring on YouTube's rate limiting sooner. **[derived]**

Expanding the panel then shows **"Subtitles are ready to load"** with
**"⌕ Find subtitles"**, rather than pretending nothing exists. Ordinary watch
pages always search automatically. **[derived]**

## 28. While an advert plays

Subtitle highlighting and following quietly pause during a video advert and
resume afterwards. Nothing is shown to the user about it. **[derived]**

## 29. Two copies of the extension installed

If two copies would both build a panel on the same page, the second stands down
rather than corrupting the first. The user sees one working panel and is told
nothing. **[derived]**

---

# How the transcript actually behaves

Detail below the level a feature list reaches, but all of it is felt in use.

## 38. The transcript is a navigation control

**Clicking a line jumps playback to where that line starts.** The transcript is
not only something to read — it is how you move around the video. **[derived]**

In the practice mode the same press means "uncover the next word" instead, and
the product decides between the two by distance: if the playhead is **within 5
seconds** of the clicked line, the press uncovers a word *and* replays the line;
if it is further away, the press only navigates. **[derived]**

This is deliberate: someone skimming ahead can move freely without spending
reveals on lines they are only passing.

## 39. The transcript follows the video, and yields while you read

The list scrolls itself so the current line stays centred. **[derived]**

**It stops following while the pointer is over it**, so text never slides out
from under someone reading, and resumes the moment the pointer leaves.
**[derived]**

Movement is smooth for a nearby line and instant for a distant jump — the
threshold is **20 lines** apart. **[derived]**

Only the list scrolls, never the page, so the page is never yanked back to the
player as lines change. **[derived]**

## 40. Selecting and copying

There is **no search box** in the transcript, **no per-line copy control**, and
**no timestamps shown** beside lines. Copying is ordinary text selection.
**[derived]**

**Selection is restricted to the language being learned.** A selection is only
accepted when it lies entirely within that text — never in the translation row.
Saving a phrase from the translation is therefore impossible by design.
**[derived]**

**A phrase may be dragged across two consecutive lines**, so a sentence broken
by a line break can still be captured whole. **[derived]**

Double- and triple-clicks are deliberately prevented from selecting a word or
line, so that rapid repeated pressing — replaying, or uncovering words — is
never hijacked into a text selection. Ordinary click-and-drag selection still
works. **[derived]**

## 41. When the two languages do not line up in time

Each translation line is attached to the **single** original line it overlaps
most — never split across two, never shown twice. **[derived]**

A translation line overlapping no original line at all is **silently dropped**;
the user sees an original line with nothing beneath it rather than an error.
**[derived]**

Where several translation lines land on one original and some are identical,
the duplicates are collapsed so the same sentence never appears twice.
**[derived]**

## 42. Looking up a word, in more detail

**The two surfaces behave differently on purpose**: over the video, opening a
card **pauses playback** and resumes it when the card closes — but only if the
viewer had not paused it themselves. In the transcript nothing is paused,
because the text is already still. **[derived]**

**Dragging across several words looks up the whole phrase**, treated exactly
like a single word. **[derived]**

**The full word screen shows more than a translation**: the word, its dictionary
form where the product is confident it matches the sense in use, a marker saying
whether the answer came from a dictionary or was generated, the sentence it came
from with the word highlighted, and then each part of speech with numbered
senses, each carrying its own translation, definition and example. **[derived]**

**For English learners only**, a link to an external learner's dictionary is
offered. **[derived]**

**A word the dictionary does not know is not an error.** It shows **"No
translation"**, distinct from **"Couldn't load"**, which is what a genuine
failure shows. While waiting, it reads **"Looking up…"**. **[derived]**

**If the product is built without a dictionary service configured, the card
simply does not exist** rather than showing an error — so "nothing happens" and
"something failed" can look the same to a user. **[derived]**

**The filled "saved" marker only lasts the session.** It is not restored from
the account on a later visit, and there is no history of words merely looked at —
only saved words persist. **[derived]**

## 43. Accessibility touches

The product honours the system setting for **reduced motion**: the turning
animation on hidden words is replaced by an instant swap rather than removed
entirely, so the feedback that something changed survives. **[derived]**

Hidden words cannot be selected or copied. This is deliberate rather than a
side effect of the covering: a press on a hidden word has to mean *reveal* and
nothing else, and a word that could be selected would make the same press mean
*look this up* as well. The letters underneath are the real ones, painted
transparent so the covering is the right width — but they are out of reach
until the word is revealed. **[derived]**

---

# What leaves the browser, and what is promised about it

This part matters commercially: it is what a store reviewer, a regulator or a
privacy-minded user would ask about, and two items below are places where the
product and its own published promise do not line up.

## 30. Looking a word up sends that word to a server

Every time a user hovers or clicks a word for its meaning, the word itself, the
target language and a snippet of the surrounding subtitle line are sent to the
product's dictionary service. This happens for **signed-out users too**, and is
**not** governed by the usage-statistics switch. **[derived]**

**Disclosed since 2026-09-06.** The policy documents this in Section 1e: what
the request carries, that it happens signed out too, that the analytics switch
does not govern it, and that no identifier is attached. The summary line, which
used to read "collects nothing about you", now names the lookup as one of the
things that does leave the browser. **[observed]**

## 31. Installing and uninstalling both open a web page

**On installing**, the extension opens a tab on the product's website — a
welcome page — carrying the anonymous usage identifier so the visit can be
matched to the install. **[derived]**

**On uninstalling**, the browser opens a farewell page on the same website. This
is registered in advance and the browser does it regardless of the product's own
settings, so it happens **even for a user who turned usage statistics off** — in
that case a fixed placeholder is sent in place of the real identifier.
**[derived]**

**Disclosed since 2026-09-06** in the policy's Section 1f, including the
placeholder sent in place of the identifier when analytics is off. **[observed]**

## 32. What the usage-statistics switch does not stop

Turning the switch off stops the usage counting, but three things continue:
**[derived]**

- **word lookups**, which are a feature rather than measurement;
- the **anonymous identifier is still created** at install time, before and
  regardless of the setting — on the reasoning that creating an identifier is
  not the same as sending it;
- the **service-status check**, an always-on anonymous fetch that the policy
  does disclose as happening whether or not the user is signed in.

## 33. What is measured about people, in plain terms

Beyond simple counts, the product measures: **[derived]**

- whether an installation is **still in use after 2, 7 and 14 days**;
- a **setup funnel** — how many people see the first-run screen, choose their
  languages, get subtitles working, try to save a word, and succeed;
- where people **give up before finishing setup**.

This is product-analytics-grade retention and funnel measurement, not merely
error counting. It is anonymous, and the policy describes it in similar terms.
**[derived]**

## 34. Anonymous measurements cannot be deleted on request

Because the measurements carry no account identifier, neither the product team
nor the user can find and delete one person's events. The published policy says
so plainly: **"we cannot look up or delete the events belonging to a specific
person — and neither can you."** The only available lever is stopping future
collection. **[derived]**

This follows from the design: there is no key to search by. It is the stated
trade for events that cannot be traced to a person in the first place.

## 35. When a diagnostic report is actually sent

The store listing says: **"When something breaks, one click on the video reports
it — and we fix it fast."**

The published policy states these reports **"are sent only while you are signed
in, are capped at one per account per day."** **[derived]**

So a signed-out user pressing that button sends nothing, and a signed-in user who
already reported that day is capped without being told. The listing's "one click
reports it" describes the button, not the two conditions behind it. **[derived]**

## 36. How Netflix differs from YouTube

Netflix is named in the store listing's title and description, and the same
installed extension activates there as well as on YouTube, with no separate
explanation once installed. **[observed]**

The privacy policy used to introduce itself as covering two editions, HDrezka and
YouTube, and to describe a saved word's source tag as "HDrezka or YouTube" — so a
reader checking whether Netflix was covered found it only as one value in a list
of labels. **Since 2026-09-06** the policy names Netflix in its list of editions
and in the source tag. **[observed]**

Netflix differs in ways a user would notice: **[derived]**

- **There is no machine translation at all.** Only the languages a title
  actually ships can be shown; an unavailable language can never be obtained, so
  retrying can never help — unlike YouTube, where a translation can fail and
  then succeed.
- The language dropdowns are therefore a **track picker**: languages the title
  offers are selectable, the rest are shown but unavailable.
- **The product can turn Netflix's own subtitles off but never back on.**
  Restoring them is left to the viewer, through Netflix's own menu, on the
  reasoning that their caption choice is theirs.
- The panel **makes room by narrowing Netflix's player** rather than overlapping
  it.

## 37. The product runs on every YouTube page, not only videos

The extension loads on the home page, search results and channel pages as well
as watch pages. It only builds its panel once it recognises a video, so those
pages look untouched — but it is present and listening on all of them.
**[derived]**

---

# Language, accessibility and the edges

## 44. The interface speaks 54 languages — the word card speaks 3

The extension's own interface is translated into **54 languages**, chosen
automatically from the browser's language with English as the fallback. There is
no language picker for the interface itself. **[derived]**

> **A real product gap, verified directly.** Of those 54 languages, only
> **English, Russian and Ukrainian** carry the word-card vocabulary. The other
> **51 languages are missing exactly 18 pieces of text** — the whole of the word
> card: its loading and error states, the Save control, the labels saying
> whether an answer came from a dictionary or was generated, and all ten
> parts of speech (noun, verb, adjective, adverb, pronoun, preposition,
> conjunction, interjection, numeral, phrase). **[derived]**
>
> Those users get a sidebar in their own language and then, on the product's
> central learning feature, English. It fails quietly — there is no error, the
> English simply appears.
>
> Checked by comparing the translation files directly rather than accepting the
> claim: 162 pieces of text in the three complete languages, 144 in every other.

## 45. Right-to-left languages are not laid out right-to-left

Arabic, Hebrew, Persian and Urdu all have translated interfaces, but the panel
is never mirrored for them. The text renders right-to-left inside a
left-to-right layout, with buttons and panels in their original order.
**[derived]**

The only right-to-left mirroring that exists serves the screenshot tooling, not
real users. **[derived]**

## 46. Choosing the same language twice leaves one language, silently

**Corrected 2026-09-04.** An earlier version of this section said the product
"quietly puts some other loaded track in the second pane". It does not, and
writing a check for it is what established that.

Nothing prevents the learning language and the native language from being set to
the same one. When that happens the product asks for **one** track instead of
two. **[observed]**

So the reader is left in a product built around two languages showing one, with
nothing said about why — no warning, no refusal, and no substitution.
**[observed]**

Whether to refuse the choice, warn about it, or leave it as it is remains a
product decision. What is not in doubt is what happens today.

## 47. Automatic captions are not marked as such

The product prefers human-written captions over YouTube's automatic ones when
both exist, and falls back to automatic only when there is nothing else.
**[derived]**

**This distinction is never shown to the user.** Someone learning from
automatically generated captions — often unpunctuated and less accurate — is not
told that is what they are reading. **[derived]**

## 48. What screen readers are told

The product announces state changes deliberately, and grades their urgency:
**[derived]**

- announcements from the team interrupt only when marked critical, and are read
  politely otherwise;
- a failed word save interrupts; a successful one waits its turn;
- the remaining character count in the feedback form is announced as a phrase
  rather than a bare number, so a screen reader does not read a meaningless
  digit on every keystroke;
- a word-card error is announced as an alert.

## 49. Keyboard-only use has a real limit

The account panel and the in-player menu both close on Escape, and the menu
supports arrow-key navigation. **[derived]**

But the settings screen, the feedback form and the word screen are **not**
treated as dialogs: they do not trap focus and do not close on Escape. A
keyboard user tabbing through settings can tab straight out into the YouTube
page behind it. Closing them requires operating their back control.
**[derived]**

## 50. Being offline is not distinguished

There is no separate "you appear to be offline" state. A failure to reach the
network is grouped with other recoverable failures and shown through the same
retry flow. **[derived]**

## 51. No layout adaptation for narrow windows

No responsive rules for narrow screens were found; the panel's behaviour in a
small window is whatever falls out of its fixed width. **[unconfirmed]** —
absence of a rule, not an observed outcome.

## 52. Live streams, picture-in-picture and theatre mode

No specific handling for live streams, premieres, the mini player,
picture-in-picture or theatre mode was found. Behaviour in those states is
whatever the ordinary layout logic produces, rather than something designed.
**[unconfirmed]**

---

## What is still not established

Listed rather than left silent, because a silent gap is indistinguishable from
a finished answer.

**Established from the product's rules but never watched happening:**

- **Fullscreen growth and position.** Entering fullscreen needs a real gesture in
  a focused window, which the observation method used here could not provide.
  The rules are clear and are described; the behaviour itself was not seen.
- **The recovery flow's four message pairs.** Two were seen live; the rest are
  described from the product's own branching.

**Genuinely unknown:**

- **The website's half of the saved-word journey** — how the holding area a
  saved word lands in becomes a dictionary the user can read. Only the
  extension's side was examined.
- **Behaviour in a narrow window**, in picture-in-picture, in theatre mode, on
  a live stream or during a premiere. No rules for these were found, which means
  the outcome is whatever the ordinary layout produces — not that it is fine.
- **Whether anything lists the keyboard shortcuts** beyond the tooltips of the
  matching controls. None was found.

**Deliberately out of scope:** the Netflix experience is described only where it
differs materially from YouTube; the other supported site was not examined at
all.

## Corrections to common assumptions

Places where the product turned out to differ from what was expected of it.

**The throttling notice is not "a short line".** It is a full banner with a
title, a two-sentence explanation, and a live countdown. A short line does exist,
but it is a different thing entirely — the quiet notice used when only the
translation failed. **[observed]**

**The failure flow is not one banner.** It is five situations and eight distinct
messages. **[derived]**

**The escalation trigger is one retry, not "a couple".** **[derived]**

**Collapsing the panel does not shrink it.** It slides off the right edge at
full width. **[observed]**

**An unavailable mode is not silently disabled.** The control stays reachable
specifically so it can explain why it is unavailable. **[derived]**

**Native-caption suppression is not permanent.** It happens once per video, and
the viewer can turn YouTube's captions back on afterwards without the product
overruling them. **[derived]**

**The language pair cannot be changed from the panel.** Despite the two
dropdowns living in settings, changing the pair after setup is done from the
extension's toolbar popup. **[derived]**

**Swapping the languages is not remembered.** Unlike every other reading
preference, it resets on the next video. **[derived]**

**Saving the same word twice creates two entries.** There is no duplicate
detection. **[derived]**

**The review prompt is spent by being shown, not by being answered.** Closing it
without touching a button uses it up permanently. **[derived]**

**The extension cannot show you your saved words.** It reports a count; the
words themselves are only visible on the website. **[derived]**

**A stale comment in the product still says the review threshold is 30.** The
enforced value is 5. **[derived]**

## Things a product owner would want to decide about

Found while checking what the map had missed. Each is a real mismatch between
what the product does and what it says, or a gap large enough to be a decision
rather than a detail.

**The privacy policy does not mention word lookup.** Its summary says that
without an account the extension "collects nothing about you", while hovering a
word sends that word and its surrounding line to a server, with no account and
regardless of the usage-statistics setting. **[derived]**

**The store listing promises more than the product delivers.** "One click on the
video reports it" is true only for signed-in users, and only once per day.
**[derived]**

**The main learning feature is untranslated for 51 of 54 languages.** Everything
else is translated; the word card is not. **[derived]**

**Right-to-left languages have translations but no mirrored layout.**
**[derived]**

**Netflix is named on the storefront but missing from the privacy policy.**
The listing says the extension works there; the policy introduces only two
editions and never mentions the third site the same installed extension serves.
**[derived]**

**Automatically generated captions are not marked**, so a learner cannot tell
whether the text they are studying was written or machine-transcribed.
**[derived]**

**Setting both languages the same leaves one language, silently.** Only one
track is asked for, and nothing is substituted in place of the second — the
reader is told nothing about why the second language never arrives.
**[derived]**

---

## How this was established

Two independent sources for every area: the product's own decision rules, and
live observation in a real browser on real videos.

Where the two disagreed, the disagreement is reported rather than resolved
quietly. Negative findings were repeated before being written — subtitle loading
proved variable enough that a single failed attempt means nothing.

Five separate false alarms occurred during this work, and every one of them was
a fault in how the product was being observed rather than in the product: a
wrong target, a wrong moment in the loading sequence, a wrong basis for a
measurement, the wrong one of two surfaces, and a test video whose captions had
changed since it was documented. This is why claims here carry evidence labels,
and why anything unconfirmed is named rather than filled in.
