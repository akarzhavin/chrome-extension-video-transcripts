# Nine checks that do not run without a stand

> Found 2026-09-05, during the first attempt to measure coverage by RUNNING the
> suite rather than reading it. Recorded for a later verification pass; nothing
> here is fixed yet.

## What was measured

Starting the first half of the e2e suite, the fifth check reported itself
skipped:

```
-   5 e2e/saving.spec.ts:55:9 › saving a word › a save lands and moves the running total
```

The skip is deliberate and says why — `no stand credentials — this check needs
the phase 6 stand`. It is gated on an environment variable:

```ts
const path = process.env.LINGOGRAM_STAND_ACCOUNT;
if (!path) return null;              // e2e/saving.spec.ts:21
```

`LINGOGRAM_STAND_ACCOUNT` is **not set in this environment** (`env | grep -i
lingogram` returns nothing), so every check behind that gate skips.

## Which checks

**Nine**, counted from the source rather than estimated:

| File | Checks gated | Of the file's total |
|---|---|---|
| `saving.spec.ts` | 7 | 7 — **the entire file** |
| `signing-in.spec.ts` | 2 | 8 |

`saving.spec.ts`
- a save lands and moves the running total
- the same word saved twice becomes two entries
- the count agrees between the panel row and the popup
- a save succeeds with context and without it
- the review card fires on the fifth save and never again
- a save while signed out is refused with the sign-in message
- signing out keeps the saved count and the review one-shot

`signing-in.spec.ts`
- the hand-off puts the signed-in account into the extension
- the signed-in row shows the account, the count and a way out

An earlier count in the same session said **ten**. That was wrong: it counted
`saving.spec.ts:318` (`the stand account must be signed in for real saves`) as a
separate check, when it is a second gate inside one already counted. Nine.

## Why this matters to the coverage figure

Nine of 76 checks — **12%** of the suite — cannot run here. They are not spread
thinly: they are the whole of saved words and most of signing in, i.e. exactly
the behaviour that writes to real account data.

**What is NOT lost.** A first draft of this document said nothing else covers
these claims, on the strength of `grep -rln "savedWordCount\|saveWord"` returning
nothing. That was a bad search and the conclusion was wrong. §14 is in fact
covered by unit checks in some depth — `quick-add-save.test.ts` (§14.5, §14.9,
§48), `firestore-word.test.ts` (§14.2, §14.3, §14.4, §14.8, §14.10) — and §15's
branches by `rate-card-branches.test.ts` (§15.4, §15.5).

**What IS lost** is narrower and worth stating exactly: the end-to-end path
through a real backend. The unit checks assert what the extension *sends* and
what it *renders*; only the nine assert that a save lands in a real account and
comes back as a moved running total, that the same word twice really becomes two
entries, and that the popup and the panel agree about the count. A break between
the extension and the backend is visible to these nine and to nothing else.

So a coverage figure derived from "the check exists" counts nine checks as
present that neither passed nor failed — but the claims behind them are not bare.

This is the same shape as the T413 defect repaired earlier the same day — a
check counted as covering something while never executing — with one important
difference: **this skip is announced, not hidden.** The condition is external and
tested explicitly. What is missing is not honesty in the check, it is a record
that the suite has a second mode with 12% less coverage.

## What the README currently says

> Three checks need a condition the run cannot force: a real fullscreen gesture,
> a page that offers YouTube's own size control, and a video that loaded a
> second language.

Three. It does not mention the nine. A reader following the README expects three
skips and would treat nine more as normal noise.

## Not done

- The suite was **stopped** after 5 of 36 checks in the first half; the run that
  would give a real coverage figure has not happened.
- Whether the stand can be pointed at preprod, and whether these checks should
  write to real account data at all, is an open decision recorded in the e2e
  plan — not settled here.
- The README is not edited yet; it should either name the nine or point here.
