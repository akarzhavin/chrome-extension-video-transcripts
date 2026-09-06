# Live e2e checks

These run against **your own signed-in Chrome**, not a fresh automated browser.
YouTube answers an automated profile with an empty body for every caption
request, so a clean profile cannot observe subtitle loading at all.

## Before running

1. Start the test browser:

   ```bash
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
     --remote-debugging-port=9333 \
     --user-data-dir=$HOME/chrome-lingogram-test &
   ```

2. It must be signed in to YouTube.

3. `apps/youtube/build` **in the main checkout** must be a dev build, made with
   the dictionary address in its environment:

   ```bash
   (cd apps/youtube && EXT_API_BASE_URL="<gateway url>" npm run build:dev)
   ```

   Without that variable the build is silent about it, and every word lookup
   answers "not configured" — the card simply never appears, which looks exactly
   like a broken lookup. A plain `npm run build:dev` during unrelated work
   already caused that once. The fixture checks for it and fails with this
   command rather than letting the checks report a phantom regression.

   Chrome loads unpacked extensions from the main checkout, never from a
   worktree — a suite run from a worktree otherwise verifies stale code and
   passes. The fixture checks the build's age and fails loudly rather than
   quietly testing the wrong thing.

## Running

```bash
npm run test:e2e
```

**Run it in two halves if the whole suite wedges.** Under a long run the browser
has been seen to stop answering, with one check sitting for half an hour while
the rest never started — not a failure of that check, which passes on its own in
two minutes, and not a failure of the product. Splitting the run keeps one stuck
tab from taking the whole thing down:

```bash
npx playwright test e2e/subtitles.spec.ts e2e/word-lookup.spec.ts \
    e2e/failure-states.spec.ts e2e/throttling.spec.ts e2e/signing-in.spec.ts \
    e2e/saving.spec.ts
npx playwright test e2e/reading-modes.spec.ts e2e/settings-and-export.spec.ts \
    e2e/settings-detail.spec.ts e2e/display.spec.ts e2e/accessibility.spec.ts \
    e2e/account-and-prompts.spec.ts e2e/player-modes.spec.ts \
    e2e/fixture-selftest.spec.ts
```

Expect roughly six minutes for the first half and **thirty-five** for the
second — measured 2026-09-05 at 33.5 minutes for 44 checks. The "eighteen" this
line used to say predated several files being added.

**Do not pass `--reporter=list` on the command line.** It REPLACES the config's
reporter list rather than adding to it, and the load counter below goes silent.
A thirty-three-minute run was spent that way and produced no load figure.
Between them the two commands name every spec file; adding a file without adding
it here means it silently stops being run.

**That failure has already happened once.** On 2026-09-05 the first half was run
with `word-lookup.spec.ts` missing from the command — the log said "Running 36
tests" where the file list calls for 40, and four checks went unrun while the
run reported success. Read the count in the log's first line against the count
you expect, every time: a half that runs fewer tests than its file list is the
only symptom this failure has.

## Netflix, and the checks that run on both platforms

Twenty-nine checks are written once and run on EVERY platform. They are not
copies: the describe block is wrapped in `for (const site of SITES)`, and the
check takes its page from `pageFor(site)` instead of the `page` fixture. One
body, one set of assertions, one place to fix a bug in them.

That works because the assertions were never platform-specific — `#vtt-sidebar`,
`#vtt-list`, `#vtt-qm-guess` are this extension's own markup and read the same
on every host. Only three things differ, and all three live in
`e2e/fixtures/sites.ts`: how to reach a playing page, how to put the HOST's own
chrome back (fullscreen, theatre, the advert flag), and which element goes
fullscreen.

**Adding a platform** means adding one entry to `SITES`. Every parameterised
check then runs on it without being edited.

**What deliberately stays YouTube-only**, and why each one is not laziness:

| Check | Why it does not travel |
|---|---|
| `resetting the text appearance` | Asserts the sizes a fresh install sees ON THIS SITE (160%/110%). Per-site by design. |
| `being offline`, `the caption stand-in` | Drive `#lingogram_http=`, read once per load from a YouTube URL. |
| `while an advert plays`, `other player layouts` | Netflix has no advert clock and no theatre mode. |
| the home and search pages | "Every page of the site" is a claim about YouTube's shape. |
| `five line changes ... leave the page where it was` | Needs a document that scrolls. Netflix's player fills the window and `scrollY` stays 0, so the claim would pass against any behaviour. |
| `throttling`, `saving`, the popup checks | Host behaviour, or no page at all. |

### Two Netflix facts the fixtures encode

Both were measured against the live site after a first migration attempt came
back almost entirely red — and neither is a defect in this extension.

**Writing `video.currentTime` destroys Netflix's player.** Forward or back, the
element is removed and never returns (`videos: 1 -> 0`, permanently); `pause()`
is fine. Netflix's own player API seeks without harm. So "play from here" is
`Site.playFrom` — YouTube writes `currentTime`, Netflix calls its player — and
rewinding between checks is gated on `Site.canRewind`, which is false there.

This was hard to read from the outside: the cleanup destroyed the page, then
saw no player, called the page unusable and re-opened it. Every check reported
"the panel stayed empty", which looks exactly like a broken extension.

**One stream per account.** A second concurrent Netflix tab gets "Pardon the
interruption" (M7375) instead of a player. That is why the Netflix checks take
the shared page rather than opening their own — a correctness requirement, not
a saving. `Site.refusal` recognises that page by its error CODE (the wording is
localised, the code is not) and fails with the reason spelled out.

`e2e/netflix.spec.ts` plus every parameterised check runs only with
`LINGOGRAM_NETFLIX=1`:

```bash
# the Netflix-only checks
LINGOGRAM_NETFLIX=1 npx playwright test e2e/netflix.spec.ts

# every check that runs on both, on Netflix
LINGOGRAM_NETFLIX=1 npx playwright test --grep Netflix
```

Without the variable the Netflix half reports itself SKIPPED, which is the
difference between "not checked" and "broken". **A Netflix line that says
`passed` with the variable unset is a bug in the check, not good news** — it has
happened once, when a multi-line `async ({ ext, page })` escaped the migration
and kept the YouTube fixture under a Netflix name.

It plays a few seconds of video on a real personal account and leaves a trace in
that profile's viewing history, so it is opt-in rather than part of a plain run
— which is also why it is not in either half command above. Roughly 40 seconds
for three checks.

**No credentials are involved**: it uses the browser's existing Netflix session
the way the YouTube checks use its YouTube one, picks the first profile by
position, and takes whichever title the home page offers first. Nothing about
the account appears in the file.

What it covers that the unit checks structurally cannot: that Netflix's own
manifest shape, page markup and player API are still the ones this edition reads.
The units stand all three up themselves, so they stay green through any change
Netflix makes.

## How many pages a run loads

Every run prints what it cost:

```
youtube loads   3  settings-detail.spec.ts
youtube loads   2  accessibility.spec.ts
youtube loads   5  TOTAL (retries included)
```

That number is the suite's cost against a real person's signed-in account, so it
is measured on every run rather than reasoned about. Retries are included: a
retried check loaded the page again, and YouTube served it again.

**Counting the calls in the source does not work.** It cannot see a navigation
inside a page, a reload, or a retry. Measured against counted: `subtitles.spec.ts`
counts 9 and measures 10; the second half counts 39 and measures **47**.

A rise with no failures means a converted check is closing the shared page, or
is discarding it when it need not. See `apps/youtube/docs/shared-page-e2e.md`.

## Checks that can decide not to run

Three checks need a condition the run cannot force: a real fullscreen gesture, a
page that offers YouTube's own size control, and a video that loaded a second
language. Each tests for its condition and reports itself **skipped** rather than
passing without it. A run reporting skips is working correctly — a run reporting
none of them, on a machine that cannot give a gesture, would be the surprise.

**Nine more skip without a stand account.** With `LINGOGRAM_STAND_ACCOUNT`
unset, the whole of `saving.spec.ts` (7) and two checks in `signing-in.spec.ts`
skip — 12% of the suite, and the only checks that exercise a save against a real
backend. So the expected skip count is three on a stand and **twelve** without
one; anything else is worth reading. See
`apps/youtube/docs/stand-dependent-checks.md`.

Never run in CI. A CI job that cannot reach a signed-in browser would report
green having run nothing.

## What these do to your browser

The fixture disables any second copy of the extension, reloads the one under
test, and may temporarily change the stored language pair. All of it is put back
in teardown, including when a check fails.
