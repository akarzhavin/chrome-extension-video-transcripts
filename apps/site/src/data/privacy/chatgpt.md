# Privacy Policy — Lingogram in ChatGPT

Covers the **Lingogram** plugin for ChatGPT, which connects ChatGPT to your Lingogram
dictionary. Lingogram and the plugin are developed and operated by **Aliaksandr
Karzhavin**, an individual developer ("we", "us"), who is responsible for the data
described here. Contact: **support@lingogram.ai**.

**Effective date:** October 19, 2026
**Last updated:** October 19, 2026

This Privacy Policy explains what the plugin exchanges between ChatGPT and your
Lingogram account, how long it is kept, and the choices you have. The words in your
dictionary are the same ones the Lingogram extensions save; how they are stored is
described in the extension policies, linked from the [privacy page](/privacy/).

*This English version at https://lingogram.ai/privacy/chatgpt/ is the authoritative one.*

---

## TL;DR

* The plugin works only after you sign in to Lingogram from ChatGPT and allow it.
* **Lingogram never receives your ChatGPT conversation.** It receives only what a tool
  call carries: a word to save and the sentence it appeared in, a review grade, or a
  request for your words.
* **ChatGPT receives your saved words** when you ask for them: each word, its
  definition, the sentence it came from, the title and link of the video, and when
  it is next due for review.
* Words you save from ChatGPT join your Lingogram dictionary and are kept until you
  delete them or your account. Besides the connection record, Lingogram keeps only two
  small records for the plugin: your last ChatGPT grade for each word (so a grade can
  be corrected) and a daily count of words saved from ChatGPT (for the daily limit).
* Disconnect the plugin in ChatGPT at any time. Write to **support@lingogram.ai** to
  delete your account and data.

---

## 1. Information We Exchange

### a. Connecting your account

When you connect the plugin, ChatGPT sends you to Lingogram to sign in and asks you to
allow access to your vocabulary. We then keep a record of that connection: which
ChatGPT connection it is, your Lingogram user ID, the permission you granted
(`chatgpt:vocab`, your vocabulary only) and when it was created and last used.
We do not receive your ChatGPT or OpenAI account details.

### b. What ChatGPT sends to Lingogram

Only the arguments of the plugin's four tools:

* **Get words due for review** and **Get recently saved words**: how many words to
  return.
* **Record a review grade**: the word's identifier and a grade from 0 to 5.
* **Save a word**: the word or short phrase, and, if there is one, the exact sentence
  from the conversation where it appeared. The plugin is instructed to call this tool
  only when you ask to save a word and to send nothing else from the conversation.
  The word is saved with the source "ChatGPT".

### c. What Lingogram sends to ChatGPT

Words from your own dictionary, each with its identifier, the word, its definition,
the sentence you saved it with, the title and link of the video it came from when
known, and the date it is next due for review; after a grade, the word's new review
interval. ChatGPT shows these to you and uses them in the conversation.

### d. Records kept for the plugin

* **Grade corrections.** For each word you grade from ChatGPT, Lingogram keeps the
  word's review schedule (interval, ease, repetitions, last grade and next review date)
  from just before and just after your last ChatGPT grade, and when it was given. A
  corrected grade sent within 6 hours then replaces the earlier one instead of adding
  to it. The record holds only these numbers and dates, never conversation text.
* **Daily save count.** For each day, the number of words you saved from ChatGPT, used
  to apply the plugin's daily limit. It holds your Lingogram user ID, the date and the
  number, nothing about which words.

### e. Operational records

The plugin server logs one line per request with the method, the path, the response
status and the duration. It logs no conversation text, no words, no tokens and no
query strings. It also counts, in aggregate, how close requests come to the plugin's
size and time limits, without their content.

---

## 2. How We Use Your Information

We use the information above only to provide the plugin: to show you your words in
ChatGPT, to schedule your reviews, and to save the words you ask to save. We do not
use it for advertising, and we do not sell it.

**Who receives it.** Besides you and ChatGPT (see section 3), your data is handled only
by the infrastructure providers that host Lingogram on our behalf: Google Cloud
(database and Firebase Authentication for sign-in) and OVHcloud (the server that runs
the plugin, in Poland).
They process it only to run the service. We do not share it with anyone else unless
the law requires it.

---

## 3. ChatGPT and OpenAI

The plugin runs inside ChatGPT, a service of OpenAI. Your conversation, and the words
the plugin returns into it, are processed by OpenAI under
[OpenAI's privacy policy](https://openai.com/policies/privacy-policy/). Lingogram does
not control how OpenAI processes conversations.

---

## 4. Data Retention and Deletion

* **Words and review history** saved or graded from ChatGPT are part of your Lingogram
  dictionary and are kept until you delete them or your account, as described in the
  extension policies.
* **The grade-correction record** for a word is replaced by your next ChatGPT grade
  of that word and deleted together with the word or your account.
* **The daily save count** is kept with your account; when you ask us to delete your
  account, we delete it too.
* **The connection record** is kept while the connection is in use. A connection that
  is not used for 90 days stops working and is deleted. A connection that is revoked is
  deleted after 7 days. Single-use sign-in codes and replaced access keys are kept for
  90 days so that a stolen copy can be detected, then deleted.
* **Disconnect** the plugin in ChatGPT's settings at any time; ChatGPT then stops
  calling Lingogram.
* **To delete your account and data**, email **support@lingogram.ai** from the address
  your account uses. We confirm deletion within 30 days.

---

## 5. Security

All traffic uses HTTPS. ChatGPT signs in with OAuth 2.1 and PKCE, and every request
carries a short-lived access key limited to your vocabulary. The plugin server checks
that key on every request and acts only as you.

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
by OpenAI.*
