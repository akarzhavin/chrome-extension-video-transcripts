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
    e2e/account-and-prompts.spec.ts e2e/player-modes.spec.ts
```

Expect roughly six minutes for the first half and eighteen for the second.
Between them the two commands name every spec file; adding a file without adding
it here means it silently stops being run.

**That failure has already happened once.** On 2026-09-05 the first half was run
with `word-lookup.spec.ts` missing from the command — the log said "Running 36
tests" where the file list calls for 40, and four checks went unrun while the
run reported success. Read the count in the log's first line against the count
you expect, every time: a half that runs fewer tests than its file list is the
only symptom this failure has.

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
