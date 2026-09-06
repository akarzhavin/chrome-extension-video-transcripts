# Privacy Policy — Lingogram

**Effective date:** June 22, 2026
**Last updated:** September 6, 2026

This Privacy Policy explains what information the **Lingogram** browser extensions
collect, how it is used, where it is stored, and the choices you have. It applies to
both editions published on the Chrome Web Store:

* **Lingogram: Dual Subtitles & Transcript for HDrezka**
* **Lingogram: Dual Subtitles & Transcript for YouTube** — which also works on
  **Netflix**, as its store listing says

Both editions are made by the same developer and share the same optional account
backend, so this single policy covers both ("the Extension"). Where this policy
describes what differs by platform, Netflix is covered by the YouTube edition.

---

## TL;DR

* **Without an account, the Extension stores nothing about you.** The interactive
  transcript, listening challenge, dual subtitles, and local word saving all run
  entirely inside your browser. Two things do leave it, with or without an
  account: **looking a word up** sends that word and its subtitle line to our
  dictionary service (Section 1e), and the anonymous usage counting described
  below, which you can turn off. Neither is tied to your identity.
* **Signing in is optional.** It exists only to sync your saved vocabulary across
  devices. If you choose to sign in, we collect your **email address** and store the
  **words you explicitly save** (with the surrounding subtitle lines) in our cloud
  database.
* **Diagnostics are opt-in, one click.** If subtitles fail to load, an emergency
  **"Reload page"** button (shown only after a failed retry) sends us a one-click
  diagnostic report — the video's address plus technical details — so we can fix
  the problem. The banner says so right next to the button; nothing is reported
  automatically.
* **We count anonymous usage, and you can turn it off.** The Extension sends us
  anonymous usage events (for example: the Extension was installed, subtitles
  loaded, a word was saved) tagged with a **random identifier generated on your
  device** — not your email, not your account. That identifier is never joined to
  your Lingogram account. Open the toolbar popup → **Privacy** → uncheck **"Share
  anonymous usage stats"** and collection stops immediately.
* We do **not** sell your data, show ads, run advertising trackers, build
  advertising profiles, or track your browsing history.

---

## 1. Information We Collect

### a. If you do **not** sign in
The Extension does **not** collect or store any personal data about you on our
servers, and creates no account. Your language and layout preferences and a local
"words saved" counter are kept only in your browser (see Section 3). No account,
email, or saved word ever leaves your device.

Three things are sent even without an account, none of them tied to your identity:

* the **anonymous usage analytics** of Section 1c, which you can turn off in one
  click;
* a **word you look up**, with the subtitle line it came from — Section 1e. This
  is the feature working, not measurement, so the analytics switch does not stop
  it; not looking words up does;
* the **welcome and farewell pages** of Section 1f, which are ordinary visits to
  our website.

### b. If you choose to sign in (optional account)
Signing in enables cross-device sync of your saved vocabulary. When you sign in, we
collect and process:

* **Account data** — your **email address** and a Firebase-generated user ID. These
  identify your account and associate your saved words with you.
* **Saved vocabulary** — only the items you explicitly choose to save while watching.
  For each saved item we store:
  * the **word or phrase** you selected;
  * a small amount of **subtitle context** — the saved subtitle line plus the line
    immediately before and after it, in the video's primary subtitle language only;
  * a **source tag** indicating where it was saved (`rezka`, `youtube`, or
    `netflix`);
  * a **timestamp** and a per-day counter used only to enforce a daily save limit.
* **Diagnostic reports** — only if subtitles fail to load and you explicitly press
  the **"Reload page"** button on the error banner (which states that a report will
  be sent). Each report contains: the website's hostname, the address (URL) or ID of
  the video the failure happened on, the subtitle language pair you selected (the
  language you are learning and your native language), the Extension version, your
  browser's interface language, a source tag identifying the Extension, and a server
  timestamp. Reports
  are sent only while you are signed in, are capped at one per account per day, and
  are used solely to investigate the failure.

We do **not** collect: your browsing history, the videos you watch (beyond the
subtitle text you explicitly save, the subtitle line accompanying a word you look
up as described in Section 1e, and the single video address included in a
diagnostic report you explicitly trigger; the analytics in Section 1c record only a
coarse platform label such as `youtube` or `rezka`, never a video or a URL),
IP-based location tracking, advertising identifiers, or cookies for tracking.

### c. Anonymous usage analytics (on by default, one click to turn off)

The Extension sends anonymous usage events to **Google Analytics 4** so we can see
how many people install it, where the Extension breaks, and which steps people give
up on. This is **on by default**. To turn it off, open the toolbar popup, go to the
**Privacy** section, and uncheck **"Share anonymous usage stats"**. Collection stops
immediately.

**The identifier.** Each event carries a **random identifier generated on your
device** the first time the Extension runs, stored in your browser's local extension
storage. It is not your email, not your Firebase user ID, and not derived from
either. **We never send your account identity to Google Analytics**, so there is no
key that could join your analytics events to your account — the separation is
structural, not just a promise. Clearing the Extension's storage or reinstalling
produces a new, unrelated identifier.

**The events we send** (18 in total):

* `extension_installed`, `extension_updated` — the Extension was installed or
  updated;
* `onboarding_shown`, `languages_configured` — you saw the first-run screen, you
  picked your languages;
* `subtitles_loaded`, `dual_subs_shown`, `no_subtitles`, `subs_partial`,
  `subs_rate_limited`, `subs_recovered` — subtitles loaded, both languages were
  shown, none were found, only part loaded, the platform rate-limited us, or a
  retry succeeded;
* `word_save_attempt`, `word_saved` — you tried to save a word, and it saved;
* `signin_started` — you began the sign-in flow;
* `analytics_opt_out` — you turned this analytics off (sent once, so we know how
  many people opt out);
* `notification_fetch_failed` — the Extension could not reach our service-status
  messages (see Section 1d). Sent only on failure, never on success, and it carries
  only the reason (network error, timeout, HTTP error code, or unreadable response);
* `retained_d2`, `retained_d7`, `retained_d14` — the Extension was still in use 2,
  7, and 14 days after install.

**The fields attached to those events**, and nothing else:

* a **coarse platform label** — one of `youtube`, `netflix`, `rezka`, or `web`; not
  a hostname, not a URL;
* the **subtitle language pair** you picked (for example `"en"` and `"ru"`);
* **how many subtitle tracks** loaded;
* **whether you were signed in** — a true/false flag, with no account identifier;
* a **running count of words saved on this device**;
* the **Extension version and edition**;
* on developer test builds only, **which of our own test servers** the build was
  pointed at — a label about our infrastructure, not about you; builds installed
  from the Chrome Web Store never send it;
* **days since install**;
* a **technical failure code** when subtitles fail;
* for `notification_fetch_failed` only, **why the request failed** and, if the
  server answered, its **HTTP status code**;
* a **session ID** that groups events from one browsing session.

**What is never sent:** the video you are watching (no title, no URL, no ID), the
words you save, subtitle text, page content, your email address, your Firebase user
ID, and your browsing history.

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

When you hover or click a word in the subtitles to see what it means, the Extension
asks our dictionary service for that meaning. The request contains:

* the **word or phrase** you pointed at;
* the **language you want it in** (your native language, as configured);
* the **subtitle line it came from**, so the service can pick the sense that fits
  the sentence rather than the most common one.

**This happens whether or not you are signed in**, and the request carries no
account identifier, no email, no analytics identifier, and nothing that ties one
lookup to another or to you. We use it to answer that lookup, and we do not build
a history of your lookups against any identity.

It is a feature rather than measurement, so the **"Share anonymous usage stats"**
switch does not stop it — that switch governs Section 1c. The way to send no
lookups is not to look words up: the transcript, dual subtitles, listening
challenge and local word saving all work without it. If the Extension was built
without a dictionary endpoint configured, the feature is off entirely.

Answers are cached briefly on your device so the same word is not asked twice.

### f. The welcome and farewell pages

**When you install the Extension**, it opens a tab on our website — a short
welcome page explaining how to start.

**When you uninstall it**, your browser opens a farewell page on the same website.
This is registered with the browser in advance, so the browser opens it on its own;
the Extension is already gone at that point and cannot decide otherwise.

Both addresses carry the **anonymous analytics identifier** of Section 1c, so that
a visit can be counted against the install it belongs to rather than as an
unrelated stranger. If you have turned analytics off, the fixed placeholder
`opted-out` is sent in place of the identifier — the same value for everyone who
opted out, which identifies no one. The farewell page is opened by the browser
regardless of that setting; what changes is that it carries no identifier of yours.

Both are ordinary visits to our website, and like any web request they reach our
site with your IP address, which we do not store.

## 2. How We Use Your Information

We use the information above **only** to:

* authenticate you and keep you signed in across sessions;
* store your saved vocabulary and sync it across your devices so you can review it
  later;
* enforce a reasonable daily limit on saved words to prevent abuse;
* investigate the subtitle-loading failures you explicitly report via the
  **"Reload page"** button, so we can fix them;
* count anonymous, aggregate usage — how many installs, how often subtitles fail,
  where people stop before finishing setup — so we can fix what is broken and
  improve what is confusing. We never use it to identify you or to build a profile
  of you.

We do not use your information for advertising, profiling, or any purpose beyond
providing the sync and diagnostics features and the aggregate usage counting
described here.

## 3. Local Storage (On Your Device)

The Extension uses your browser's extension storage (`chrome.storage`) to keep, on
your device only:

* your language and subtitle layout preferences;
* a local count of how many words you've saved;
* your **analytics on/off setting**, the **random analytics identifier** described
  in Section 1c, and the **date you installed** the Extension, plus an analytics
  **session ID** in session storage;
* a cached copy of the **service-status messages** described in Section 1d, when it
  was downloaded, and the identifiers of any messages you dismissed, so a message
  you closed does not come back;
* if you are signed in: your authentication tokens, your email address, and your
  user ID (so you stay signed in), and a short-lived sign-in nonce in session
  storage.

This local data never leaves your browser except where Section 4 describes (saved
words synced to the cloud). Signing out removes the authentication tokens, email, and
user ID from your device. What the Extension sends while you use it is listed in
Sections 1c, 1e and 1f; none of it is read from the storage described here, apart
from the analytics identifier those sections name.

## 4. Cloud Storage and Third-Party Services

When you are signed in, your account and saved vocabulary are stored using **Google
Firebase** (Firebase Authentication, Cloud Firestore, and Secure Token Service),
operated by the developer on Google Cloud infrastructure. Google processes this data
as our service provider; see Google's Privacy Policy at
https://policies.google.com/privacy. Access is restricted by Firestore security
rules so that you can only read and write your own data.

The service-status messages described in Section 1d are downloaded from the same
Firebase project. That collection is public and read-only from the Extension: it
contains only messages we write, no user data, and the Extension can read it but
never write to it.

The anonymous usage events described in Section 1c are sent to **Google Analytics 4**
(via the Measurement Protocol) unless you turn analytics off. Google processes those
events for us as our service provider, under the same Google Privacy Policy. Firebase
and Google Analytics are used as two separate services and we do not send anything to
Google Analytics that would let the two be joined together.

The word lookups described in Section 1e are sent to **our own dictionary
service**, which we operate on Google Cloud infrastructure. It receives the word,
the target language and the subtitle line, and no identifier of yours.

To display subtitles, the Extension fetches subtitle (`.vtt`) files **directly from
your browser** to the relevant video platform's content delivery network — HDrezka /
Voidboost for the HDrezka edition, YouTube or Netflix for the YouTube edition. These
requests:

* are made directly from your browser to the platform, with no intermediate proxy of
  ours;
* contain no account data or saved words;
* are subject to the privacy policies of those platforms.

## 5. Data Sharing and Sale

We do **not** sell, rent, or trade your personal data. We do not share it with any
third party except Google Firebase and Google Analytics as the infrastructure and
analytics providers described in Section 4, or where required by law. The dictionary
service of Section 1e is our own, not a third party. We do not use your data for
advertising.

## 6. Data Retention and Deletion

* **Saved vocabulary** is retained in the cloud until you delete it or request
  account deletion.
* **Diagnostic reports** are kept only for troubleshooting and are covered by
  account deletion requests (they are keyed to your user ID).
* **Word lookups** (Section 1e) are answered and not kept as a history against any
  identity; there is no account or identifier attached to one, so there is nothing
  to look up or delete per person. Operational logs, where they exist, are
  short-lived and serve to keep the service running.
* **Anonymous usage events** are retained by Google Analytics for **2 months**, then
  deleted. Because these events carry no account identifier, **we cannot look up or
  delete the events belonging to a specific person — and neither can you.** There is
  no way for us to tell which events came from you. Turning analytics off in the
  toolbar popup stops any further collection, but it cannot retroactively remove
  events already sent; those expire on the 2-month schedule.
* **Local data** can be cleared at any time by signing out (removes your tokens,
  email, and user ID) or by removing the Extension from your browser (which also
  removes the random analytics identifier).
* To **delete your account and all associated cloud data** (email, saved words, and
  diagnostic reports),
  contact the developer using Section 9. We will delete it within a reasonable
  period.

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
and data, please contact the developer via the project's official repository or
through the Chrome Web Store support page for the Extension.

---

*Lingogram is an independent tool and is not affiliated with, authorized, or endorsed
by HDrezka, Voidboost, YouTube, or any of the video platforms it supports.*
