# Privacy Policy — Add words to Lingogram from any website

**Effective date:** June 22, 2026
**Last updated:** June 22, 2026

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
  selected text, its surrounding sentence, and the **URL and title of the page** you
  saved it from.
* We do **not** sell your data, show ads, run third-party advertising or analytics
  trackers, or monitor your browsing.

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
The Extension does **not** collect, transmit, or store any personal data on our
servers. Until you sign in and save a word, nothing leaves your browser.

### b. When you sign in (required to save words)
Saving to your Lingogram inbox requires an account. When you sign in, we collect and
process:

* **Account data** — your **email address** and a Firebase-generated user ID. These
  identify your account and associate your saved words with you.
* **Saved items** — only the items you explicitly add via the right-click menu. For
  each item we store:
  * the **word or phrase** you selected;
  * the **surrounding sentence or block** of text for context (when available);
  * the **URL and title of the page** you saved it from;
  * a **source tag** indicating the Extension that saved it;
  * a **timestamp** and a per-day counter used only to enforce a daily save limit.

We do **not** collect: your browsing history, the contents of pages you do not
explicitly save from, IP-based location tracking, advertising identifiers, cookies
for tracking, or any analytics about how you use the Extension.

> Your Lingogram account works across our other Lingogram extensions; if you sign in
> with the same account, your saved vocabulary syncs together.

## 3. How We Use Your Information

We use the information above **only** to:

* authenticate you and keep you signed in across sessions;
* store the words you add and sync them across your devices so you can review them
  later;
* enforce a reasonable daily limit on saved words to prevent abuse.

We do not use your information for advertising, profiling, or any purpose beyond
providing the save-and-sync feature described here.

## 4. Local Storage (On Your Device)

The Extension uses your browser's extension storage (`chrome.storage`) to keep, on
your device only, your authentication tokens, your email address, and your user ID
(so you stay signed in), plus a short-lived sign-in nonce in session storage. This
local data never leaves your browser except where Section 5 describes. Signing out
removes the authentication tokens, email, and user ID from your device.

## 5. Cloud Storage and Third-Party Services

When you are signed in, your account and saved items are stored using **Google
Firebase** (Firebase Authentication, Cloud Firestore, and Secure Token Service),
operated by the developer on Google Cloud infrastructure. Google processes this data
as our service provider; see Google's Privacy Policy at
https://policies.google.com/privacy. Access is restricted by Firestore security
rules so that you can only read and write your own data. The Extension makes no other
network requests beyond Firebase and the page you explicitly save from.

## 6. Data Sharing and Sale

We do **not** sell, rent, or trade your personal data. We do not share it with any
third party except Google Firebase as the infrastructure provider described in
Section 5, or where required by law. We do not use your data for advertising.

## 7. Data Retention and Deletion

* **Saved items** are retained in the cloud until you delete them or request account
  deletion.
* **Local data** can be cleared at any time by signing out (removes your tokens,
  email, and user ID) or by removing the Extension from your browser.
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
