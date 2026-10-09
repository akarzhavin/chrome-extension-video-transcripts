# Privacy Policy — Lingogram for YouTube and Netflix

Covers the **Dual Subtitles — Lingogram: Learn Languages on YouTube & Netflix**
extension.

**Effective date:** June 22, 2026
**Last updated:** October 9, 2026

This Privacy Policy explains what information the Extension collects, how it is used,
where it is stored, and the choices you have. It applies to the Extension wherever
it runs: on **YouTube** and **Netflix**, on the web pages where it marks your saved words (Section 1b), and on
translate.google.com when you import your saved phrases (Section 1h).

*This English version at https://lingogram.ai/privacy/youtube/ is the authoritative one.*

---

## TL;DR

* **Without an account, we keep no account and no list of your words.** The
  interactive transcript, listening challenge, dual subtitles, and word saving all
  run inside your browser, and so does downloading a subtitle track as a file. A
  word you save without an account is kept in your browser only (Section 1a). Some
  things do leave it, with or without an account: **looking a word
  up** sends that word and the subtitle lines around it to our dictionary service,
  which may pass them to **OpenAI** to answer, and a
  **phrase you select** goes first to Google Translate, without the subtitle lines
  (Section 1e); a **feedback message you choose to send** reaches us with the text you
  typed (Section 1g); and the anonymous usage counting described below, which
  you can turn off. None of them carries your name, email or account ID, except
  feedback you send while signed in, which carries your user ID so we can reply.
* **Signing in is optional.** It exists only to sync your saved vocabulary across
  devices. Words you saved before you signed in move into your account when you
  sign in (Section 1b). If you choose to sign in, we collect your **email
  address** and **name** and store the
  **words you explicitly save** (with the surrounding subtitle lines, or the
  paragraph around a word you save from the right-click menu on a web page) in our cloud
  database. A list of those words is also kept on your device, so the Extension
  can mark a word you already own without asking our servers (Section 3).
* **Diagnostics are opt-in, one click.** If subtitles fail to load, an emergency
  **"Reload page"** button (shown only after a failed retry) sends us a one-click
  diagnostic report — the video's address plus technical details — so we can fix
  the problem. The banner says so right next to the button; nothing is reported
  automatically.
* **We count anonymous usage, and you can turn it off.** The Extension sends us
  anonymous usage events (for example: the Extension was installed, subtitles
  loaded, a word was saved) tagged with a **random identifier generated on your
  device** — not your email, not your account. That identifier is never joined to
  your Lingogram account. Click **Settings** in the toolbar popup (it opens the
  Extension's settings on our website, Section 1f) → **Privacy** → uncheck
  **"Share anonymous usage stats"** and collection stops immediately.
* **Your saved words are marked on the web pages you read.** The page text is
  compared with your saved words inside your browser and is never sent or
  stored; you can switch this off for all websites on the Settings page, or for
  one website in the toolbar popup (Section 1b). Resting the pointer
  on a marked word shows its translation, and only that word is sent to look it up;
  a marked phrase of more than one word goes to Google Translate first (Section 1e).
* **AI translation of the second line is off until you switch it on.** If you
  switch it on while signed in, the subtitle track of the video you watch is sent
  to us and translated by **OpenAI**. The stored track and its translation carry
  no account ID and serve everyone who watches the same subtitles (Section 1i).
* We do **not** sell your data, show ads, run advertising trackers, build
  advertising profiles, or track your browsing history.

---

## 1. Information We Collect

### a. If you do **not** sign in
The Extension does **not** collect or store any personal data about you on our
servers, and creates no account. Your language and layout preferences, a local
"words saved" counter, and **the words you save** are kept only in your browser
(see Section 3). For each saved word that is the word or phrase as you selected
it, the subtitle line or paragraph it came from, a coarse label of where you
saved it (such as `youtube` or `web`), and the time you first saved it. Once you
open the **My words** page, a translation of the word is kept with it (Section 1e).
None of this is uploaded to our servers while you have no account, and no account
or email is sent to us unless you sign in. A saved word does leave your browser
when it is looked up — on the My words page, or when you rest the pointer on it on
a web page — as described in Section 1e: the word alone, without its context.

Four things are sent even without an account, none of them tied to your identity
unless you choose to add it:

* the **anonymous usage analytics** of Section 1c, which you can turn off in one
  click;
* a **word you look up**, with the subtitle lines around it — Section 1e, which
  also says how our dictionary service may pass them to OpenAI. This
  is the feature working, not measurement, so the analytics switch does not stop
  it; not looking words up does. The **My words** page looks up the words it
  lists, without a sentence;
* the **welcome and farewell pages** of Section 1f, which are ordinary visits to
  our website;
* a **feedback message**, only if you write one and press Send — Section 1g. It
  carries what you typed, and a reply address only if you typed one.

### b. If you choose to sign in (optional account)
Signing in enables cross-device sync of your saved vocabulary. When you sign in, we
collect and process:

* **Account data** — your **email address**, your **name** (as you type it when you
  register, or the name on your Google account if you sign in with Google; when
  none is given, the part of your email before the @ is used), and a
  Firebase-generated user ID. These identify your account and associate your saved
  words with you.
* **Saved vocabulary** — only the items you explicitly choose to save, while watching
  or from the right-click menu on any website, or import from Google Translate
  (Section 1h).
  For each saved item we store:
  * the **word or phrase** you selected, both as you selected it and in a
    normalized form (trimmed, lower-cased) that lets your devices agree it is the
    same word;
  * a small amount of **subtitle context** — the saved subtitle line plus the line
    immediately before and after it, in the video's primary subtitle language only;
  * for a word saved from the right-click menu on a web page, the **paragraph of
    text around your selection** (up to 1,000 characters) in place of subtitle
    context. The page's address and title are not stored (see "Saving from the
    right-click menu" below);
  * a **source tag** indicating which edition saved it (YouTube or HDrezka; a word
    saved on Netflix carries the YouTube edition's tag, since it is the same
    Extension);
  * a **timestamp** and a per-day counter used only to enforce a daily save limit.
* **Diagnostic reports** — only if subtitles fail to load and you explicitly press
  the **"Reload page"** button on the error banner (which states that a report will
  be sent). Each report contains: the website's hostname, the address (URL) or ID of
  the video the failure happened on, the subtitle language pair you selected (the
  language you are learning and your native language), the Extension version, your
  browser's interface language, a source tag identifying the Extension, a server
  timestamp, and the technical picture of the failure: a failure code from the
  Extension's own vocabulary (for example "rate-limited" or "not-offered"), the
  HTTP status behind it if there was one, how many attempts had been made, and how
  many subtitle tracks had loaded. Reports
  are sent only while you are signed in, are capped at one per account per day, and
  are used solely to investigate the failure.
* **AI translation**, only if you switch it on — see Section 1i: the subtitle track
  of the video, stored without your user ID, and a daily write counter under it.
* **Feedback** you send while signed in carries your user ID so we can reply — see
  Section 1g, which also covers feedback sent without an account.

**Words kept in your browser.** If you saved words before you signed in (Section
1a), or while your session had expired, they are in your browser. When you sign in,
and each time the Extension starts while you are signed in, it writes them into
your account one by one, oldest first, like any other save: the word and its
subtitle line or paragraph, with the same source tag and daily limit as above.
After each successful write, that word is removed from your browser. A word that
fails to upload stays in your browser and is tried again at the next sign-in,
start, or successful save. The translation kept with a word, its site label and
the time you first saved it are not uploaded. A word too long for your account to
hold is discarded. If your session has expired when you save a word, the word is
kept in your browser the same way, and the Extension records in your browser that
the session needs renewing, so it can tell you to sign in again.

We do **not** collect: your browsing history, the videos you watch or the pages you
read (beyond the subtitle text you explicitly save, the paragraph around a word you
save from the right-click menu, the subtitle lines accompanying a word you look
up as described in Section 1e, the subtitle track of a video you switched AI
translation on for as described in Section 1i, the site name attached to a feedback message you
send, and the single video address included in a
diagnostic report you explicitly trigger; the analytics in Section 1c record only a coarse platform label
such as `youtube` or `netflix`, never a video or a URL),
IP-based location tracking, advertising identifiers, or cookies for tracking.

**Saving from the right-click menu.** When you select text on any web page, the
Extension adds a **"Save to Lingogram"** item to your browser's right-click menu.
The page is read only when you press that item, and only that one page: the
Extension reads the selected text and the paragraph it sits in, saves them as
described above, and shows a short confirmation on the page. Saving never sends anything from a page you did not
press the item on, and never records the page's address or title. If you are not
signed in, the word is kept in your browser, as Section 1a describes, and is
uploaded when you sign in. The analytics in Section 1c count such a save under the
platform label `web`. The
saved word carries the source tag of the edition whose menu item you pressed.
If both editions are installed, only one shows the item: the one you are signed in
to, or the YouTube edition when you are signed in to both or to neither. To agree
on this, each edition asks the other, inside your browser, whether it is installed
and signed in; the answer is a yes or no and carries no other data about you or
the page. The two editions also share, inside your browser, the settings described
below and in Section 1c, so that both follow the same choice.

**Marking your saved words on web pages.** On the web pages you open, the Extension
marks the words and phrases you have saved, so you notice them wherever they
appear. To do this it reads the visible text of each page **inside your browser**
and compares it with the local list of your saved words described in Section 3.
The page text, the words found in it, and the address of the page are **never
sent anywhere** — not to us, not to Google, not to anyone — and nothing about
them is stored. The one exception is a word you point at: resting the pointer on a
marked word opens a card with its translation, and that word, only the word and
not the sentence or the page, is sent to look it up as described in Section 1e —
to our dictionary service for a single word, and first to Google Translate for a
phrase of more than one word. Removing the word from that card, or saving it again, is an ordinary
change to your saved words, as described above; saving it again sends the
paragraph it is in as its context, as the right-click save does. The marks are
drawn by the browser over the text and do not change
the page's content. Because they are drawn on the page, **the website's own
scripts can see which of its words are marked**, and through that, some of the words on
your list. To limit this, only text that is actually shown on the page is
marked, never hidden text. This requires Chrome's permission to run on all
websites. The Extension uses that access only for this marking and for reading the
paragraph around a selection you save from the right-click menu (above); it
does not run on Lingogram's own website. If you have saved no words, nothing is
marked. You can switch it off for all websites with **"Highlight my words on
websites"** on the Extension's Settings page, or for one website with
**"Highlight words on"** that website's name in the toolbar popup. The websites
you switch off this way are kept as a list of their host names (for example
`en.wikipedia.org`) on your device; the list is never sent to our servers or to
anyone else. The Settings page, and the settings page of our website (Section 1f),
show it so you can switch a website back on. If both editions are installed, the
other edition is given the same switch and list inside your browser, so both
follow the same choice, and only the one that shows the menu item marks words.

> Your Lingogram account works across our other Lingogram extensions; if you sign in
> with the same account, your saved vocabulary syncs together.

### c. Anonymous usage analytics (on by default, one click to turn off)

The Extension sends anonymous usage events to **Google Analytics 4** so we can see
how many people install it, where the Extension breaks, and which steps people give
up on. This is **on by default**. To turn it off, click **Settings** in the toolbar
popup. It opens the Extension's settings page on our website (Section 1f); in its
**Privacy** group, uncheck **"Share anonymous usage stats"**. The page passes the
change to the Extension inside your browser, and collection stops immediately. If both Lingogram editions are installed, turning it
off or on in one does the same in the other, inside your browser, and an edition
installed later starts with it off if you had turned it off in the other.

**The identifier.** Each event carries a **random identifier generated on your
device** the first time the Extension runs, stored in your browser's local extension
storage. It is not your email, not your Firebase user ID, and not derived from
either. **We never send your account identity to Google Analytics**, so there is no
key that could join your analytics events to your account — the separation is
structural, not just a promise. Clearing the Extension's storage or reinstalling
produces a new, unrelated identifier.

**The events we send** (24 in total):

* `extension_installed`, `extension_updated` — the Extension was installed or
  updated;
* `onboarding_shown`, `languages_configured` — you saw the first-run screen, you
  picked your languages;
* `subtitles_loaded`, `dual_subs_shown`, `no_subtitles`, `subs_partial`,
  `subs_rate_limited`, `subs_recovered` — subtitles loaded, both languages were
  shown, none were found, only part loaded, the platform rate-limited us, or a
  retry succeeded;
* `subs_missed_with_cc` — the Extension showed no subtitles although the player's
  own captions button says the video has some; this one only ever means our own
  failure;
* `subs_downloaded` — you saved a subtitle track to your computer as a file. The
  file itself is written by your browser and never leaves it;
* `word_save_attempt`, `word_saved`, `word_removed` — you tried to save a word, it
  saved, or you removed one;
* `word_lookup` — the Extension asked our dictionary service about a word (Section
  1e). The event carries the shape of the answer, never the word;
* `signin_started` — you began the sign-in flow, and from where (the toolbar
  popup, the Settings page, the My words page, the status badge, the menu in the
  YouTube player, or the Google Translate import);
* `gt_import_preview`, `gt_import_done` — you started an import from Google
  Translate (Section 1h) and it finished. They carry only counts (phrases found, new,
  already saved, removed earlier, skipped, added, refused by our server, left
  unfinished) and, if the import stopped, a short error code; never a word;
* `analytics_opt_out` — you turned this analytics off, on the Settings page or on
  the settings page of our website (sent once, so we know how many people opt
  out);
* `notification_fetch_failed` — the Extension could not reach our service-status
  messages (see Section 1d). Sent only on failure, never on success, and it carries
  only the reason (network error, timeout, HTTP error code, or unreadable response);
* `retained_d2`, `retained_d7`, `retained_d14` — the Extension was still in use 2,
  7, and 14 days after install.

**The fields attached to those events**, and nothing else:

* a **coarse platform label** — one of `youtube`, `netflix`, `rezka`, `web`, or
  `other`; not a hostname, not a URL;
* the **subtitle language pair** you picked (for example `"en"` and `"ru"`);
* **how many subtitle tracks** loaded;
* **whether you were signed in** — a true/false flag, with no account identifier.
  On a word you save, `false` also means it was kept in your browser;
* a **running count of words saved on this device**;
* the **Extension version and edition**, the **build type** (a store build or one
  of our developer test builds), and on `extension_updated` the version you had
  before;
* on developer test builds only, **which of our own test servers** the build was
  pointed at — a label about our infrastructure, not about you; builds installed
  from the Chrome Web Store never send it;
* **days since install**;
* when subtitles fail: a **technical failure code**, the **HTTP status** behind it
  if any, **how many attempts** had been made, whether a retry had already
  happened, which half of your language pair was missing, and whether the
  platform was throttling us;
* when the platform rate-limits us: whether the request was for an automatic
  translation, how long we were told to wait, and which back-off step the
  Extension was on;
* when subtitles recover: what triggered the recovery (an automatic probe, your
  manual retry, or a late arrival) and how many seconds it took;
* for `languages_configured` only: where you picked them (the first-run screen, the
  sidebar, the welcome page, the Extension's own pages, or the settings page of
  our website);
* for `word_lookup` only: whether the hover strip or the full word screen asked
  (the My words page counts as the hover strip),
  whether the answer came from our cache, a dictionary, a model, or Google
  Translate, or the lookup failed, whether it was empty, and a coarse latency
  bucket;
* for `notification_fetch_failed` only, **why the request failed** and, if the
  server answered, its **HTTP status code**;
* a **session ID** that groups events from one browsing session.

**What is never sent:** the video you are watching (no title, no URL, no ID), the
words you save, look up, or remove, subtitle text, page content, feedback text, your
email address, your Firebase user ID, and your browsing history. This is enforced
by a deny-list in the code, not by convention: a parameter named like any of those
is dropped before the event is built.

**Google's role.** Google Analytics processes these events for us as our service
provider; see Google's Privacy Policy at https://policies.google.com/privacy. On our
Analytics property, **Google Signals is switched off**, so Google does not attach an
age, gender, interest category, or advertising audience to these events and does not
link them across your devices. **Granular location collection is off**: events are
resolved to **country and region only**, never to a city. Google collects
country and region for every property regardless of this setting; what we
switched off is the finer-grained collection on top of it. Every payload is sent with
`non_personalized_ads: true`. Google Analytics is not used to build a profile of you
or to target advertising.

### d. Service-status messages (no data about you is sent)

When a video platform changes something and subtitles stop working, the Extension can
show a short message in its sidebar telling you the problem is known and being fixed,
without waiting for a Chrome Web Store update. To do this it periodically downloads a
small list of current messages from our Firebase database.

**This is a download, not an upload.** The request contains no account data, no
identifier, no video address, and no information about you or what you are watching —
it is the same anonymous request for the same public list that every installation
makes, whether or not you are signed in. Which message applies to your installation
(by Extension version, edition, platform, and interface language) is decided **on your
device**, from the list already downloaded; none of those details are sent to us.

Because it is an anonymous request to Google's servers, Google receives your IP
address as it does for any web request; we neither receive nor store it. The
downloaded list, and the identifier of any message you dismiss with its **×** button,
are kept on your device only (see Section 3).

The only thing we learn is described in Section 1c: if the download **fails**, an
anonymous `notification_fetch_failed` event tells us that our messages are
unreachable, so we can fix it. It is sent only on failure, only if analytics is on,
and carries only the reason for the failure.

### e. Word lookup (the dictionary service)

When you hover or click a word in the subtitles to see what it means, or rest the
pointer on a word marked on a web page (Section 1b), or open the **My words**
page (below), the Extension asks our dictionary service for that meaning. The
request contains:

* the **word or phrase** you pointed at;
* the **language you want it in** (your native language, as configured);
* the **subtitle lines around it** (the line it came from, and the lines just
  before and after it), so the service can pick the sense that fits the sentence
  rather than the most common one. For a word marked on a web page,
  or listed on the My words page, nothing is sent but the word and the language:
  not its sentence, not the page, not the address.

**This happens whether or not you are signed in**, and the request carries no
account identifier, no email, no analytics identifier, and nothing that ties one
lookup to another or to you. We use it to answer that lookup, and we do not build
a history of your lookups against any identity.

**How our dictionary service answers.** The service runs on Google Cloud. It first
looks the word up in Wiktionary data published by **kaikki.org**, sending only the
word, from our server. When that has no entry (typically a phrase, a rare word or a
name), or when the dictionary is unavailable, the service asks an AI model run by
**OpenAI** through the OpenAI API, sending the word or phrase, your language and the
subtitle lines that came with it. Neither receives your IP address, an account
identifier or anything else about you; OpenAI processes the request as our service
provider under its API data-usage terms. The service stores each answer in its
database, keyed by the word, the language and a one-way hash of the subtitle lines,
so the same question is not asked again, and its logs record the word asked (not
the subtitle lines) to monitor answer quality (Section 6).

It is a feature rather than measurement, so the **"Share anonymous usage stats"**
switch does not stop it — that switch governs Section 1c. The way to send no
lookups is not to look words up: the transcript, dual subtitles, listening
challenge and local word saving all work without it. If the Extension was built
without a dictionary endpoint configured, the feature is off entirely.

**Phrases you select go to Google Translate first.** When you drag across more than
one word, the Extension first asks Google's public web translator
(translate.googleapis.com, then translate.google.com) for that phrase, directly
from your browser. That request
contains only the **selected phrase** and the **language you want it in**. It does
not contain the subtitle line, and it carries no account identifier, no email, no
analytics identifier and no cookies. Like any web request, it reaches Google from
your IP address, and Google processes it under its own Privacy Policy
(https://policies.google.com/privacy). The dictionary service is asked about the
phrase, as described above, only when Google gives no answer. The same applies
when you rest the pointer on a saved phrase of more than one word marked on a web
page (Section 1b): only that phrase and your language go to Google Translate.
Hovering or clicking a single word never goes to Google Translate.

Answers are cached briefly on your device so the same word is not asked twice.

**The My words page.** This page of the Extension lists the words kept in your
browser (Section 3). For each word that has no stored translation, it makes the
lookup above, once per visit to the page, with only the word and your native
language, never the sentence the word came from. A phrase of more than one word
goes to Google Translate first, as described above. The answer, up to three
translations, is stored with the word in your browser. It is not uploaded to
your account.

### f. The welcome and farewell pages

**When you install the Extension**, it opens a welcome page on our website. If
the Extension that opened it answers, the page shows three setup steps: choose your
languages, create an account or sign in (optional; on that same page, with the
email and password or Google sign-in described in Section 1b — the account is made
on our website, and the Extension is then handed its own sign-in exactly as from the
sign-in page), and start with a first video, with a switch for marking your
words on web pages. The page passes your choices straight to the Extension inside
your browser, which stores them on your device (Section 3); they are not sent to our
servers. To show the steps, the page asks the Extension for its current settings
and whether you are signed in (and with which email address). The page's
address names the Extension so it can reach it.

**The settings page on our website** talks to the Extension the same way, only
with its own message type and the same check of who is asking. To show its
switches, it asks the Extension for your settings: your two languages, the
languages on offer, whether each video site, the highlighting of your words and
the usage stats (Section 1c) are on, the list of websites where you switched the
marking of your words off (Section 1b), whether you are signed in (a yes or no, not
your email address), and the Extension's version and edition. When you change a
setting there, the page passes the new value to the Extension, which checks it
and stores it on your device (Section 3). The Extension answers only our website,
does not send any of this to our servers, and puts no saved words, tokens or
email address into it. Turning the usage stats off there is reported once, as in
Section 1c.

**When you uninstall it**, your browser opens a farewell page on our website.
This is registered with the browser in advance, so the browser opens it on its own;
the Extension is already gone at that point and cannot decide otherwise.

Both addresses carry the **anonymous analytics identifier** of Section 1c, so that
a visit can be counted against the install it belongs to rather than as an
unrelated stranger. If you have turned analytics off, the fixed placeholder
`opted-out` is sent in place of the identifier — the same value for everyone who
opted out, which identifies no one. The farewell page is opened by the browser
regardless of that setting; what changes is that it carries no identifier of yours.

Visits to our website are ordinary web requests and reach our site with your IP
address, which we do not store.

### g. Feedback you send us

The Extension has a **Send feedback** screen in its sidebar settings, and the
one-time "Enjoying Lingogram?" card offers a short feedback box if you answer
**"Not really"**. Nothing is sent until you press **Send**. When you do, we receive:

* the **text you typed**, up to about 2,000 bytes;
* a **reply address**, only if you are not signed in and chose to type one into
  the optional email field. It is stored as part of your message text;
* your **user ID**, if you are signed in, so we can reply through your account;
* the **hostname** of the site you sent it from (for example `www.youtube.com`),
  the Extension version and edition, your browser's interface language, and a
  server timestamp.

**This works whether or not you are signed in.** The message is stored in our
Firebase database (Section 4) and is read by the developer to understand what
broke and, where you gave us a way to, to reply. It is not used for anything else.
Sending is capped at a fixed number of messages per day across all users
(currently 500), so a message can occasionally fail to send; the screen tells you
if it did.

### h. Importing your Google Translate saved phrases

Only if you start it yourself: with **Import from Google Translate**
on the Extension's Settings page, or with the Lingogram icon the Extension adds
to the toolbar of
the **Saved** panel on translate.google.com. To place that icon, the Extension looks
only at the layout of the Google Translate page, never at its text, and sends nothing
from it. When you start the import, the Extension opens translate.google.com/saved in a background tab, reads
the list of phrases saved in the Google account you are signed in to there, and
closes the tab. The list is read inside your browser; the page itself is not sent to
us, and the Extension does nothing else with your Google account. If you are not
signed in to Lingogram, the list is read only to show you how many phrases were
found, and nothing is saved until you sign in and start the import again.

From each saved pair the Extension keeps only the side in the language you are
learning, compares those words with your Lingogram list, and shows how many are new
before anything is saved. When you confirm, each new word is saved exactly like a
word you save while watching (Section 1b), without subtitle context. Google's
translations, the other side of each pair, and phrases in other languages are not
saved or sent anywhere. Words you removed from Lingogram earlier are not brought
back.

### i. AI translation of the second subtitle line

**Off until you switch it on.** The Extension's sidebar settings have a switch,
**"AI translation of the second line"**. It works only while you are signed in;
without an account nothing is sent. While it is on, the Extension asks our server
to translate the subtitle track in the language you are learning into your native
language, and shows the result as the second line, in place of the site's own
track in your language if it has one. Turning the switch off stops it at once.

**What is sent.** For the video you are watching, the Extension takes the subtitle
track in the language you are learning: the text of each line and its start and
end time, with formatting tags removed. From it, it computes a **fingerprint**, a
one-way hash of the language, the times and the text, which names the track. It then
asks our dictionary service for the translation of a range of lines, sending the
fingerprint, your native language and the line numbers, with your sign-in token.
Lines are asked for around the point you are watching, further ahead as the video
plays, and again after you jump. If no one has sent that track before, the
Extension stores it once in our Firebase database (Section 4) and asks again. The
stored track contains the fingerprint, the language, a label of the site
(`youtube`, `netflix` or `rezka`), the number of lines, the total length, the lines
themselves, and when it was stored and when it expires. It contains **no user ID**,
no video address, title or ID, and nothing else about you.

**A write counter under your user ID.** So that one account cannot fill the
database, each store also updates a small record under your user ID: the time of
your last store, the day, and how many tracks you stored that day (at most 30 a
day, at least 20 seconds apart). It holds no fingerprint and no text.

**How the server translates.** The dictionary service checks the stored track and
copies it into its own database. It then asks an AI model run by **OpenAI**
through the OpenAI API to translate it part by part, sending the text of those
lines, the rest of the track or the stretch of it around them (so names and tone
stay consistent), and the two languages. OpenAI receives no account identifier,
no IP address of yours and nothing about the video beyond its subtitle text, and
processes the request as our service provider under its API data-usage terms.
Every translated part is kept, so a later viewer of the same subtitles, you or
anyone else, gets it without a new request to OpenAI.

**Shared, not tied to you.** The stored track and its translations carry no
account identifier, and the service does not record which account asked for
which track. To keep each account within its daily limit (currently 60,000
translated characters), it counts, per user ID and day, the characters translated
and the model tokens used: numbers only, no fingerprint and no text. Its logs
record the outcome of each request, the language, how many lines were served or
translated, the tokens used and the time taken; never your user ID, the
fingerprint or any subtitle text. Like any web request, a request reaches our
server from your IP address, and the server's request logs may record that address
with the address requested, which contains the fingerprint (Section 6). If one
account is refused many times within ten minutes, the service sends the developer
an alert through **Telegram** naming that account's user ID, so the abuse can be
looked into.

AI translation adds no analytics events (Section 1c). The **"Share anonymous usage
stats"** switch does not stop it; the AI translation switch does.

## 2. How We Use Your Information

We use the information above **only** to:

* authenticate you and keep you signed in across sessions;
* store your saved vocabulary and sync it across your devices so you can review it
  later;
* keep the words you save without an account in your browser, and move them into
  your account when you sign in;
* enforce a reasonable daily limit on saved words to prevent abuse;
* answer the word lookups you make (Section 1e), through our dictionary service and
  the providers it uses (kaikki.org and OpenAI) and, for phrases, Google Translate;
* translate the subtitle track of a video into your language when you switch AI
  translation on (Section 1i), through OpenAI, and keep each account within its
  daily limit;
* investigate the subtitle-loading failures you explicitly report via the
  **"Reload page"** button, so we can fix them;
* read the feedback you send, and reply to it if you are signed in or left a reply
  address;
* count anonymous, aggregate usage — how many installs, how often subtitles fail,
  where people stop before finishing setup — so we can fix what is broken and
  improve what is confusing. We never use it to identify you or to build a profile
  of you.

We do not use your information for advertising, profiling, or any purpose beyond
providing the sync, word lookup, AI translation, diagnostics, and feedback features and the aggregate usage
counting described here.

## 3. Local Storage (On Your Device)

The Extension uses your browser's extension storage (`chrome.storage`) to keep, on
your device only:

* your language and subtitle layout preferences, whether your saved words are
  marked on web pages, whether AI translation of the second line is on (Section
  1i), and which video sites the Extension is switched on for;
* the **list of websites** (host names only, such as `en.wikipedia.org`) where you
  switched the marking of your saved words off from the toolbar popup. It is never
  sent to our servers; it is shown to the settings page of our website and shared
  with the other Lingogram edition, both inside your browser (Sections 1b and 1f);
* how far you got on the setup page (Section 1f): whether you skipped signing in,
  and whether you finished;
* whether the other Lingogram edition is the one that shows the menu item and
  marks words (a yes/no from the check between editions in Section 1b), so that
  only one of them does;
* a local count of how many words you've saved, and a one-time flag recording that
  the Extension has already asked you to rate it;
* your **analytics on/off setting**, the **random analytics identifier** described
  in Section 1c, and the **date you installed** the Extension, plus an analytics
  **session ID** in session storage;
* a cached copy of the **service-status messages** described in Section 1d, when it
  was downloaded, and the identifiers of any messages you dismissed, so a message
  you closed does not come back;
* if you are signed in: your authentication tokens, your email address, and your
  user ID (so you stay signed in), and a short-lived sign-in nonce in session
  storage;
* a flag, set when your session has expired, that says the session needs renewing,
  so the Extension can tell you to sign in again. It is removed when you sign in
  or sign out;
* while an import from Google Translate is running: the words about to be saved
  and the progress, in session storage. It is removed when you close the import's
  result, and with the browser session;
* a **local list of the words you have saved** — each word in its normalized form,
  whether it is currently saved or has been removed, and a marker of how far the
  list has been synced. It exists so the Extension can mark a word you already own
  the moment it appears in a subtitle, without a network round-trip. When you are
  signed in it is filled from your cloud vocabulary (Section 4) and from the words
  you save on this device, including from the right-click menu. Without an account
  it holds the words kept in your browser (next item). It holds no translations,
  subtitle context, page text, or timestamps;
* the **words kept in your browser**, saved without an account or while your
  session had expired: for each, the word or phrase as you saved it, the subtitle
  line or paragraph it came from, a coarse label of the site, the time you first
  saved it, and, once the My words page has looked it up, a translation (Section
  1e). They are not shared with other browsers or devices. They stay until you
  remove a word on the My words page, the Extension uploads it after you sign in
  (Section 1b), or you remove the Extension. Signing out does not delete them.

This local data never leaves your browser except where Section 4 describes (saved
words synced to the cloud, and kept words uploaded when you sign in). Signing out
removes the authentication tokens, email, user ID, and the local list of words
synced from your account from your device; the words kept in your browser stay.

## 4. Cloud Storage and Third-Party Services

When you are signed in, your account and saved vocabulary are stored using **Google
Firebase** (Firebase Authentication, Cloud Firestore, and Secure Token Service),
operated by the developer on Google Cloud infrastructure. Google processes this data
as our service provider; see Google's Privacy Policy at
https://policies.google.com/privacy. Access is restricted by Firestore security
rules so that you can only read and write your own data. The diagnostic reports of
Section 1b and the feedback messages of Section 1g are written to the same
database; the Extension can write them but never read them back. Words kept in
your browser (Section 1b) reach this database only after you sign in.

The service-status messages described in Section 1d are downloaded from the same
Firebase project. That collection is public and read-only from the Extension: it
contains only messages we write, no user data, and the Extension can read it but
never write to it.

Word lookups (Section 1e) go to **our dictionary service**, which we run on Google
Cloud. To answer them it uses Wiktionary data from **kaikki.org** (the word only)
and, when that has no entry, the **OpenAI API** (the word or phrase, your language
and the subtitle lines that came with it), as described in Section 1e. OpenAI
processes these requests as our service provider under its API terms; see
https://openai.com/policies/privacy-policy.

AI translation (Section 1i) stores the subtitle track in the same Firebase
database. The Extension can create a track but never read, change or delete one;
only our dictionary service reads it. The service translates the track with the
**OpenAI API** as described there, and alerts the developer through **Telegram**
(Telegram Messenger Inc., https://telegram.org/privacy) in the case Section 1i
names.

The anonymous usage events described in Section 1c are sent to **Google Analytics 4**
(via the Measurement Protocol) unless you turn analytics off. Google processes those
events for us as our service provider, under the same Google Privacy Policy. Firebase
and Google Analytics are used as two separate services and we do not send anything to
Google Analytics that would let the two be joined together.

To display subtitles, the Extension reads the subtitle (caption) tracks that the
**YouTube player** already provides for the video you are watching, **directly within
your browser**. On **Netflix** it reads the subtitle tracks a title already carries,
again directly within your browser. This subtitle handling:

* happens entirely in your browser, with no intermediate proxy of ours;
* sends no Lingogram account data or saved words to YouTube or Netflix (YouTube
  receives your usual YouTube cookies with these requests, as it does with the
  player's own);
* is subject to YouTube's and Netflix's own privacy policies and terms.

When one of your two languages has no track on YouTube, the Extension asks the YouTube
player for that platform's own automatic translation of a track it already serves —
a request to YouTube, made from your browser like the player's own subtitle
requests, so it carries your usual YouTube cookies; it carries nothing about your
Lingogram account.
No machine translation is involved on Netflix.

A **phrase you select**, or a saved phrase you point at on a web page, is sent to
**Google Translate** (translate.googleapis.com
and translate.google.com) directly from your browser, as described in Section 1e: the phrase and your
language only, without cookies or any identifier of ours. Google handles those
requests under its own Privacy Policy and terms.

The import of Section 1h opens translate.google.com in a background tab. That is
an ordinary visit to Google Translate in your browser, signed in to your Google
account if you are, and Google handles it under its own Privacy Policy. Nothing
from it reaches us except the new words you confirm.

## 5. Data Sharing and Sale

We do **not** sell, rent, or trade your personal data. We do not share it with any
third party except: Google (Firebase, Google Cloud and Google Analytics) as the
infrastructure and analytics providers described in Section 4; Google Translate,
which receives the text of a phrase you select or point at (Section 1e); kaikki.org,
which our dictionary service asks about a looked-up word, and OpenAI, which it asks
about a word or phrase with its subtitle lines when the dictionary has no entry
(Section 1e), and with the subtitle text of a track you switched AI translation on
for (Section 1i); Telegram, which carries the developer's alerts (Section 1i); or
where required by law. None of them receives your name or email from us, and only
that Telegram alert ever carries an account identifier. We do not use your data for advertising.

## 6. Data Retention and Deletion

* **Saved vocabulary** is retained in the cloud until you request account
  deletion. Removing a word from your list marks it as removed in your account
  rather than erasing it, so that syncing or an import from Google Translate does not
  bring it back; the record, with its word and context, stays until the account is
  deleted.
* **Words kept in your browser** stay there until you remove them. Remove one with
  the **Remove** button next to it on the My words page, or remove them all by
  removing the Extension from your browser. When you sign in, each is uploaded
  and then removed from your browser. We hold no copy of a word that is only in
  your browser, so there is nothing for us to delete.
* **Diagnostic reports** are kept only for troubleshooting and are covered by
  account deletion requests (they are keyed to your user ID).
* **Feedback messages** are kept until they have been acted on. Feedback sent while
  signed in carries your user ID and is covered by account deletion requests.
  Feedback sent without an account carries no identifier of yours unless you
  typed a reply address; to have such a message deleted, contact us (Section 10)
  quoting that address.
* **Word lookups** (Section 1e) are not kept as a history against any identity: no
  account or identifier is attached to one, so there is nothing to look up or
  delete per person. The dictionary service's database keeps each answer, keyed by
  the word, the language and a one-way hash of the subtitle lines, and its logs
  record the word asked; as for any web service, the hosting platform's request
  logs also record the IP address of each request. Logs are kept under Google
  Cloud's standard retention (30 days) and serve to keep the service running.
  Requests passed to OpenAI are handled under OpenAI's API data-usage terms.
* **AI translation** (Section 1i): a stored track stays in our Firebase database
  for at most 30 days, then expires on its own. In the dictionary service's
  database, a track and its translations stay until no one has used them for 30
  days. They carry no account identifier, so they cannot be found or deleted per
  person and are not deleted with your account. The daily counts per user ID are
  deleted after 8 days; the write counter under your user ID is covered by account
  deletion requests.
* **Anonymous usage events** are retained by Google Analytics for **2 months**, then
  deleted. Because these events carry no account identifier, **we cannot look up or
  delete the events belonging to a specific person — and neither can you.** There is
  no way for us to tell which events came from you. Turning analytics off on the
  Settings page stops any further collection, but it cannot retroactively remove
  events already sent; those expire on the 2-month schedule.
* **Local data** can be cleared at any time by signing out (removes your tokens,
  email, user ID, and the local list of words synced from your account) or by
  removing the Extension from your browser (which also removes the random analytics
  identifier and any words kept in your browser).
* To **delete your account and all associated cloud data**, email
  **support@lingogram.ai** from the address your account uses (Section 10).
  Deletion is done by hand: we delete your sign-in account (email, name and user
  ID), your saved words wherever we keep them, including words marked as removed,
  your diagnostic reports, feedback sent while signed in, and your AI-translation
  write counter and daily counts, and confirm by email
  within 30 days.

## 7. Security

Authentication tokens are kept in your browser's extension storage. All network
requests are made over HTTPS. Cloud data is protected by Firebase Authentication and
Firestore security rules that restrict each user to their own records. No method of
transmission or storage is 100% secure, but we take reasonable measures to protect
your information.

## 8. Children's Privacy

The Extension is not directed to children under 13 (or the equivalent minimum age in
your jurisdiction), and we do not knowingly collect personal data from them.

## 9. Changes to This Policy

We may update this Privacy Policy from time to time. Material changes will be
reflected here with an updated "Last updated" date. Continued use of the Extension
after an update constitutes acceptance of the revised policy.

## 10. Contact

For any questions about this Privacy Policy, or to request deletion of your account
and data, please email **support@lingogram.ai**. To delete your account, write from
the email address the account uses, so we can confirm it is yours. Please do not
post your email address in a public place, such as a GitHub issue.

---

*Lingogram is an independent tool and is not affiliated with, authorized, or endorsed
by YouTube, Netflix, or any of the video platforms it supports.*
