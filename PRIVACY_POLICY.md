# Privacy Policy — Lingogram

**Effective date:** June 22, 2026
**Last updated:** June 22, 2026

This Privacy Policy explains what information the **Lingogram** browser extensions
collect, how it is used, where it is stored, and the choices you have. It applies to
both editions published on the Chrome Web Store:

* **Lingogram: Dual Subtitles & Transcript for HDrezka**
* **Lingogram: Dual Subtitles & Transcript for YouTube**

Both editions are made by the same developer and share the same optional account
backend, so this single policy covers both ("the Extension").

---

## TL;DR

* **Without an account, the Extension collects nothing about you.** The interactive
  transcript, listening challenge, dual subtitles, and local word saving all run
  entirely inside your browser, and no personal data is sent to us.
* **Signing in is optional.** It exists only to sync your saved vocabulary across
  devices. If you choose to sign in, we collect your **email address** and store the
  **words you explicitly save** (with the surrounding subtitle lines) in our cloud
  database.
* We do **not** sell your data, show ads, run third-party advertising or analytics
  trackers, or track your browsing history.

---

## 1. Information We Collect

### a. If you do **not** sign in
The Extension does **not** collect, transmit, or store any personal data on our
servers. Your language and layout preferences and a local "words saved" counter are
kept only in your browser (see Section 3). No account, email, or saved word ever
leaves your device.

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
  * a **source tag** indicating which edition saved it (HDrezka or YouTube);
  * a **timestamp** and a per-day counter used only to enforce a daily save limit.

We do **not** collect: your browsing history, the videos you watch (beyond the
subtitle text you explicitly save), IP-based location tracking, advertising
identifiers, cookies for tracking, or any analytics about how you use the Extension.

## 2. How We Use Your Information

We use the information above **only** to:

* authenticate you and keep you signed in across sessions;
* store your saved vocabulary and sync it across your devices so you can review it
  later;
* enforce a reasonable daily limit on saved words to prevent abuse.

We do not use your information for advertising, profiling, or any purpose beyond
providing the sync feature described here.

## 3. Local Storage (On Your Device)

The Extension uses your browser's extension storage (`chrome.storage`) to keep, on
your device only:

* your language and subtitle layout preferences;
* a local count of how many words you've saved;
* if you are signed in: your authentication tokens, your email address, and your
  user ID (so you stay signed in), and a short-lived sign-in nonce in session
  storage.

This local data never leaves your browser except where Section 4 describes (saved
words synced to the cloud). Signing out removes the authentication tokens, email, and
user ID from your device.

## 4. Cloud Storage and Third-Party Services

When you are signed in, your account and saved vocabulary are stored using **Google
Firebase** (Firebase Authentication, Cloud Firestore, and Secure Token Service),
operated by the developer on Google Cloud infrastructure. Google processes this data
as our service provider; see Google's Privacy Policy at
https://policies.google.com/privacy. Access is restricted by Firestore security
rules so that you can only read and write your own data.

To display subtitles, the Extension fetches subtitle (`.vtt`) files **directly from
your browser** to the relevant video platform's content delivery network — HDrezka /
Voidboost for the HDrezka edition, YouTube for the YouTube edition. These requests:

* are made directly from your browser to the platform, with no intermediate proxy of
  ours;
* contain no account data or saved words;
* are subject to the privacy policies of those platforms.

## 5. Data Sharing and Sale

We do **not** sell, rent, or trade your personal data. We do not share it with any
third party except Google Firebase as the infrastructure provider described in
Section 4, or where required by law. We do not use your data for advertising.

## 6. Data Retention and Deletion

* **Saved vocabulary** is retained in the cloud until you delete it or request
  account deletion.
* **Local data** can be cleared at any time by signing out (removes your tokens,
  email, and user ID) or by removing the Extension from your browser.
* To **delete your account and all associated cloud data** (email and saved words),
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
