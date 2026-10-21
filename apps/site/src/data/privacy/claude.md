# Privacy Policy — Lingogram in Claude

Covers the **Lingogram** plugin and connector for Claude, which connect Claude
(claude.ai, Cowork and Claude Code) to your Lingogram dictionary. Lingogram, the plugin
and the connector are developed and operated by **Aliaksandr Karzhavin**, an
individual developer ("we", "us"), who is responsible for the data described here.
Contact: **support@lingogram.ai**.

**Effective date:** October 21, 2026
**Last updated:** October 21, 2026

This Privacy Policy explains what the plugin exchanges between Claude and your
Lingogram account, what it keeps on your computer, how long data is kept, and the
choices you have. The words in your dictionary are the same ones the Lingogram
extensions save; how they are stored is described in the extension policies, linked
from the [privacy page](/privacy/).

*This English version at https://lingogram.ai/privacy/claude/ is the authoritative one.*

---

## TL;DR

* The plugin works only after you sign in to Lingogram from Claude and allow it.
* **Lingogram never receives your Claude conversation, your code or your files.** It
  receives only what a tool call carries: a word to save and the sentence it appeared
  in, a review grade, or a request for your words.
* **Claude receives your saved words** when it asks for them: each word, its
  definition, the sentence it came from, the title and link of the video, and when it
  is next due for review.
* In Claude Code, the plugin keeps **local statistics on your computer** about which
  of your words Claude used. They never leave your computer.
* Words you save from Claude join your Lingogram dictionary and are kept until you
  delete them or your account.
* Disconnect Lingogram in Claude at any time. Write to **support@lingogram.ai** to
  delete your account and data.

---

## 1. Information We Exchange

### a. Connecting your account

When you connect Lingogram, Claude sends you to Lingogram to sign in and asks you to
allow access to your vocabulary. In Claude Code the sign-in returns to a temporary
address on your own computer. We then keep a record of that connection: which Claude
connection it is, your Lingogram user ID, the permission you granted (`claude:vocab`,
your vocabulary only) and when it was created and last used. We do not receive your
Claude or Anthropic account details.

### b. What Claude sends to Lingogram

Only the arguments of the four Lingogram tools:

* **Get words due for review** and **Get recently saved words**: how many words to
  return.
* **Record a review grade**: the word's identifier and a grade from 0 to 5.
* **Save a word**: the word or short phrase, and, if there is one, the exact sentence
  from the session where it appeared. The plugin instructs Claude to save a word only
  when you ask, and to send nothing else from the session: no code, file paths or
  secrets. The word is saved with the source "Claude".

### c. What Lingogram sends to Claude

Words from your own dictionary, each with its identifier, the word, its definition,
the sentence you saved it with, the title and link of the video it came from when
known, and the date it is next due for review; after a grade, the word's new review
interval. Claude shows these to you and, in work mode, uses some of them in its
replies.

### d. Records kept for the plugin

* **Grade corrections.** For each word you grade from an AI app, Lingogram keeps the
  word's review schedule (interval, ease, repetitions, last grade and next review date)
  from just before and just after your last grade, and when it was given. A corrected
  grade sent within 6 hours then replaces the earlier one instead of adding to it. The
  record holds only these numbers and dates, never conversation text.
* **Daily save count.** For each day, the number of words you saved from AI apps
  (Claude and ChatGPT together), used to apply the daily limit. It holds your Lingogram
  user ID, the date and the number, nothing about which words.

### e. Data kept on your computer (Claude Code only)

The plugin's hooks keep a small file, `work-vocab.json`, in the plugin's data folder
on your computer (or `~/.claude/lingogram/`). It records which of your words were
offered in a session and which Claude used, so that a word that never fits your work
stops being offered. To count them, the hooks read the session transcript that Claude
Code stores on your computer. This file and the transcript are never sent to Lingogram
or anywhere else. Delete the file at any time; turn work mode off with
`LINGOGRAM_WORK_VOCAB=off`.

### f. Operational records

The Lingogram server logs one line per request with the method, the path, the response
status and the duration. It logs no conversation text, no words, no tokens and no
query strings. It also counts, in aggregate, how close requests come to the service's
size and time limits, without their content.

---

## 2. How We Use Your Information

We use the information above only to provide the plugin: to show you your words in
Claude, to schedule your reviews, and to save the words you ask to save. We do not use
it for advertising, and we do not sell it.

**Who receives it.** Besides you and Claude (see section 3), your data is handled only
by the infrastructure providers that host Lingogram on our behalf: Google Cloud
(database and Firebase Authentication for sign-in) and OVHcloud (the server that runs
the connector, in Poland). They process it only to run the service. We do not share it
with anyone else unless the law requires it.

---

## 3. Claude and Anthropic

The plugin runs inside Claude, a service of Anthropic. Your conversation, and the words
Lingogram returns into it, are processed by Anthropic under
[Anthropic's privacy policy](https://www.anthropic.com/legal/privacy). Lingogram does
not control how Anthropic processes conversations.

---

## 4. Data Retention and Deletion

* **Words and review history** saved or graded from Claude are part of your Lingogram
  dictionary and are kept until you delete them or your account, as described in the
  extension policies.
* **The grade-correction record** for a word is replaced by your next grade of that
  word from an AI app and deleted together with the word or your account.
* **The daily save count** is kept with your account; when you ask us to delete your
  account, we delete it too.
* **The connection record** is kept while the connection is in use. A connection that
  is not used for 90 days stops working and is deleted. A connection that is revoked is
  deleted after 7 days. Single-use sign-in codes and replaced access keys are kept for
  90 days so that a stolen copy can be detected, then deleted.
* **Local statistics** stay on your computer until you delete the file or uninstall
  the plugin.
* **Disconnect** Lingogram in Claude's settings at any time; Claude then stops calling
  Lingogram.
* **To delete your account and data**, email **support@lingogram.ai** from the address
  your account uses. We confirm deletion within 30 days.

---

## 5. Security

All traffic uses HTTPS. Claude signs in with OAuth 2.1 and PKCE, and every request
carries a short-lived access key limited to your vocabulary. The Lingogram server
checks that key on every request and acts only as you.

---

## 6. Children's Privacy

The plugin is not directed to children under 13, and we do not knowingly collect
information from them.

---

## 7. Changes to This Policy

We may update this Privacy Policy from time to time. Material changes will be reflected
here with an updated "Last updated" date.

---

## 8. Contact

For any questions about this Privacy Policy, or to request deletion of your account and
data, please email **support@lingogram.ai**.

---

*Lingogram is an independent service and is not affiliated with, authorized, or endorsed
by Anthropic.*
