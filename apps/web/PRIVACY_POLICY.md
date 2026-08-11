# Privacy Policy — Add words to Lingogram from any website

**Effective date:** June 22, 2026
**Last updated:** August 10, 2026

This Privacy Policy explains what information the **Add words to Lingogram from any
website** browser extension ("the Extension") collects, how it is used, where it is
stored, and the choices you have.

---

## TL;DR

* The Extension does **nothing** until you **select text and choose "Add to
  Lingogram"** from the right-click menu. There is no background reading of the pages
  you visit and no browsing tracking.
* Saving a word requires you to be **signed in** (the word goes to your Lingogram
  inbox). Signing in collects your **email address**. Each saved item also stores the
  selected text and its surrounding sentence.
* **We count anonymous usage, and you can turn it off.** The Extension sends us
  anonymous usage events (for example: the Extension was installed, a word was
  saved) tagged with a **random identifier generated on your device** — not your
  email, not your account. That identifier is never joined to your Lingogram
  account. Open the toolbar popup → **Privacy** → uncheck **"Share anonymous usage
  stats"** and collection stops immediately.
* We do **not** sell your data, show ads, run advertising trackers, build advertising
  profiles, or monitor your browsing.

---

## 1. Page Access and Permissions

This is an "any website" extension, so how it accesses pages matters:

* It requests **no broad website host permissions** — it cannot read arbitrary pages
  in the background.
* It uses `contextMenus` to add the **"Add to Lingogram"** right-click item, and
  `activeTab` + `scripting` to read the text you selected (plus the surrounding
  sentence) **only at the moment you click that item**, and only on the current tab.
* On pages where injection is not allowed (e.g. `chrome://`, the Chrome Web Store,
  PDFs) it simply saves the selected text without the surrounding sentence.

It does not access, read, or transmit page content at any other time.

## 2. Information We Collect

### a. Before you sign in / when you don't use it
Apart from the anonymous usage analytics described in Section 2c (which you can turn
off in one click), the Extension does **not** collect, transmit, or store any
personal data on our servers. Until you sign in and save a word, no personal data
leaves your browser.

### b. When you sign in (required to save words)
Saving to your Lingogram inbox requires an account. When you sign in, we collect and
process:

* **Account data** — your **email address** and a Firebase-generated user ID. These
  identify your account and associate your saved words with you.
* **Saved items** — only the items you explicitly add via the right-click menu. For
  each item we store:
  * the **word or phrase** you selected;
  * the **surrounding sentence or block** of text for context (when available);
  * a **source tag** indicating the Extension that saved it;
  * a **timestamp** and a per-day counter used only to enforce a daily save limit.

We do **not** collect: your browsing history, the contents of pages you do not
explicitly save from (the analytics in Section 2c record only a coarse label for the
Extension itself, `web` — never a hostname, a page address, or page content),
IP-based location tracking, advertising identifiers, or cookies for tracking.

> Your Lingogram account works across our other Lingogram extensions; if you sign in
> with the same account, your saved vocabulary syncs together.

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

**The events we send:**

* `extension_installed`, `extension_updated` — the Extension was installed or
  updated;
* `word_save_attempt`, `word_saved` — you tried to save a word, and it saved;
* `signin_started` — you began the sign-in flow;
* `analytics_opt_out` — you turned this analytics off (sent once, so we know how
  many people opt out);
* `retained_d2`, `retained_d7`, `retained_d14` — the Extension was still in use 2,
  7, and 14 days after install.

**The fields attached to those events**, and nothing else:

* a **coarse platform label** — `web` for this Extension; not a hostname, not a URL;
* **whether you were signed in** — a true/false flag, with no account identifier;
* a **running count of words saved on this device**;
* the **Extension version and edition**;
* on developer test builds only, **which of our own test servers** the build was
  pointed at — a label about our infrastructure, not about you; builds installed
  from the Chrome Web Store never send it;
* **days since install**;
* a **session ID** that groups events from one browsing session.

**What is never sent:** the pages you visit (no title, no URL), the words you save,
page content, your email address, your Firebase user ID, and your browsing history.

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

## 3. How We Use Your Information

We use the information above **only** to:

* authenticate you and keep you signed in across sessions;
* store the words you add and sync them across your devices so you can review them
  later;
* enforce a reasonable daily limit on saved words to prevent abuse;
* count anonymous, aggregate usage — how many installs, how often saving fails,
  where people stop before finishing setup — so we can fix what is broken and
  improve what is confusing. We never use it to identify you or to build a profile
  of you.

We do not use your information for advertising, profiling, or any purpose beyond
providing the save-and-sync feature and the aggregate usage counting described here.

## 4. Local Storage (On Your Device)

The Extension uses your browser's extension storage (`chrome.storage`) to keep, on
your device only:

* your **analytics on/off setting**, the **random analytics identifier** described in
  Section 2c, the **date you installed** the Extension, and a local count of how many
  words you've saved, plus an analytics **session ID** in session storage;
* if you are signed in: your authentication tokens, your email address, and your user
  ID (so you stay signed in), plus a short-lived sign-in nonce in session storage.

This local data never leaves your browser except where Section 5 describes. Signing
out removes the authentication tokens, email, and user ID from your device.

## 5. Cloud Storage and Third-Party Services

When you are signed in, your account and saved items are stored using **Google
Firebase** (Firebase Authentication, Cloud Firestore, and Secure Token Service),
operated by the developer on Google Cloud infrastructure. Google processes this data
as our service provider; see Google's Privacy Policy at
https://policies.google.com/privacy. Access is restricted by Firestore security
rules so that you can only read and write your own data.

The anonymous usage events described in Section 2c are sent to **Google Analytics 4**
(via the Measurement Protocol) unless you turn analytics off. Google processes those
events for us as our service provider, under the same Google Privacy Policy. Firebase
and Google Analytics are used as two separate services and we do not send anything to
Google Analytics that would let the two be joined together.

The Extension makes no network requests beyond Firebase and — while analytics is on —
Google Analytics.

## 6. Data Sharing and Sale

We do **not** sell, rent, or trade your personal data. We do not share it with any
third party except Google Firebase and Google Analytics as the infrastructure and
analytics providers described in Section 5, or where required by law. We do not use
your data for advertising.

## 7. Data Retention and Deletion

* **Saved items** are retained in the cloud until you delete them or request account
  deletion.
* **Anonymous usage events** are retained by Google Analytics for **2 months**, then
  deleted. Because these events carry no account identifier, **we cannot look up or
  delete the events belonging to a specific person — and neither can you.** There is
  no way for us to tell which events came from you. Turning analytics off in the
  toolbar popup stops any further collection, but it cannot retroactively remove
  events already sent; those expire on the 2-month schedule.
* **Local data** can be cleared at any time by signing out (removes your tokens,
  email, and user ID) or by removing the Extension from your browser (which also
  removes the random analytics identifier).
* To **delete your account and all associated cloud data** (email and saved items),
  contact the developer using Section 10. We will delete it within a reasonable
  period.

## 8. Security

Authentication tokens are kept in your browser's extension storage. All network
requests are made over HTTPS. Cloud data is protected by Firebase Authentication and
Firestore security rules that restrict each user to their own records. No method of
transmission or storage is 100% secure, but we take reasonable measures to protect
your information.

## 9. Children's Privacy

The Extension is not directed to children under 13 (or the equivalent minimum age in
your jurisdiction), and we do not knowingly collect personal data from them.

## 10. Changes to This Policy

We may update this Privacy Policy from time to time. Material changes will be
reflected here with an updated "Last updated" date. Continued use of the Extension
after an update constitutes acceptance of the revised policy.

## 11. Contact

For any questions about this Privacy Policy, or to request deletion of your account
and data, please contact the developer via the project's official repository or
through the Chrome Web Store support page for the Extension.

---

*Lingogram is an independent tool and is not affiliated with, authorized, or endorsed
by the websites it can be used on.*
