/**
 * Behaviour map §17 (throttling by YouTube) and §18 (only the translation
 * failed).
 *
 * These were blocked for a whole round: forcing a refusal produced the
 * no-captions notice instead of the throttling one, and it was not clear
 * whether the fault was the diagnostic switch or the product. It was the
 * product — the grace period concluded "no subtitles" from silence while the
 * requests were still retrying. Fixed, and these checks now guard the fix.
 *
 * Everything here uses the diagnostic switch, which replaces the answer locally.
 * Nothing is sent to YouTube: provoking a real refusal would rate-limit this
 * browser for hours and take every other live check down with it.
 */
import { test, expect, type ExtensionHandle } from './fixtures/extension';
import { readPrefs } from './fixtures/prefs';
import { waitForSettledBanner, currentBanner } from './fixtures/subtitles';
import { preservingUiPrefs } from './fixtures/uiprefs';

const VIDEO = 'https://www.youtube.com/watch?v=aircAruvnKk';

test.describe('throttling by YouTube', () => {
    /**
     * The distinction this protects: "we were refused" is not "this video has
     * no captions". Getting it wrong sends someone off to another video for
     * nothing, and the captions were there all along.
     */
    test('a refused request blames the limit, not the video', async ({ ext }) => {
        await preservingUiPrefs(ext, async () => {
            const page = await ext.open(`${VIDEO}#lingogram_http=429:5`);
            try {
                const banner = await waitForSettledBanner(page, 150_000);

                expect(banner.title).toBe('YouTube is limiting requests');
                expect(banner.text).not.toContain("doesn't have subtitles");
            } finally {
                await page.close().catch(() => {});
            }
        });
    });

    /**
     * The regression guard for the defect these checks uncovered. While the
     * retries are still running the reader must not be told the video has no
     * captions — that claim was measured appearing at 7 seconds and standing
     * for eight, before the correct message replaced it.
     */
    test('the false "no subtitles" never appears while retries are running', async ({ ext }) => {
        await preservingUiPrefs(ext, async () => {
            const page = await ext.open(`${VIDEO}#lingogram_http=429:5`);
            try {
                // Watch continuously rather than sampling at the end: the whole
                // point is a message that appears and then goes away, which a
                // check of the final state cannot see.
                const seen = new Set<string>();
                const deadline = Date.now() + 40_000;
                while (Date.now() < deadline) {
                    const b = await currentBanner(page);
                    if (b?.title) seen.add(b.title);
                    if (b?.title === 'YouTube is limiting requests') break;
                    await page.waitForTimeout(500);
                }

                expect([...seen]).toContain('YouTube is limiting requests');
                expect(
                    [...seen],
                    'a captioned video must never be called caption-less while we are still asking',
                ).not.toContain('No subtitles available');
            } finally {
                await page.close().catch(() => {});
            }
        });
    });

    /**
     * Behaviour map §18: when one language loaded and the other was refused,
     * the reader keeps reading. A full-screen notice would talk over subtitles
     * that are working.
     */
    test('a partial failure does not raise the full notice', async ({ ext }) => {
        await preservingUiPrefs(ext, async () => {
            // Only the FIRST request is refused, so the second track answers
            // normally — the closest the switch gets to a one-sided failure.
            const page = await ext.open(`${VIDEO}#lingogram_http=429:5@1`);
            try {
                await page.waitForFunction(
                    () => document.querySelectorAll('#vtt-list .vtt-item').length > 0,
                    null,
                    { timeout: 150_000, polling: 250 },
                );

                // Something loaded, so the takeover notice must not be up.
                const banner = await currentBanner(page);
                if (banner?.title) expect(banner.title).not.toBe('No subtitles available');
            } finally {
                await page.close().catch(() => {});
            }
        });
    });
});

/**
 * Behaviour map §18.1, §18.4 — the compact line under the language chip, and
 * which of its three wordings a given cause produces.
 *
 * The unit twins in `app-base-status.test.ts` carry the red for these (Art. A):
 * a live check cannot be shown failing against a break we are not allowed to
 * introduce in a signed-in browser. What only the browser can say is that the
 * cause reaches the line at all — the notice is built from the failure record
 * a real page-script writes, and every unit check hands it that record by hand.
 *
 * Refusals are simulated with the local switch. Nothing reaches YouTube: a real
 * refusal holds for hours and takes every other live check down with it
 * (docs/ops/live-debug-cdp.md, third rule).
 *
 * What the first attempt at these got wrong, measured rather than reasoned:
 *
 * - `@1` does NOT refuse one track and let the other through. `remaining--`
 *   fires per fetch (page-script.ts), and a single track spends several — the
 *   empty-answer re-asks, the retry ladder, and one more after page-script
 *   mints a pot. The budget is consumed inside the FIRST track and the second
 *   is served normally. Observed: the refused track then loaded 42707 bytes on
 *   its pot retry, and the line read "Couldn't load the translation".
 * - A larger counter is not the fix. The cascade's threshold is
 *   `++emptyAnswers > EMPTY_RETRIES || attempt >= maxAttempts`
 *   (timedtext-fetch.ts:286) — derived from two constants, counted across the
 *   session. Any hand-computed `@N` here would be a literal that drifts
 *   silently when either constant moves, which is Principle VII exactly.
 * - A total refusal loads no lines at all, and the line only exists while
 *   something IS playing — that path banners instead, and is covered above.
 *
 * - "A video offering exactly ONE caption language" — the second attempt's
 *   premise, and also wrong. Measured on 9bZkp7q19f0 (Korean only): both halves
 *   of the pair become machine translations, both load, and no partial state
 *   arises at all; with the switch on, both fail and the full banner comes up.
 *   The code was read correctly — trackPlan.ts:92-113 does send `tlang=` for
 *   the half with no matching track — and the conclusion simply did not follow,
 *   because on a one-language video that half is both of them.
 *
 * - "The switch refuses only the `tlang=` request" — the third premise, and
 *   also wrong. Measured on ZbZSe6N_BXs, which has English stored and no
 *   Russian: with no flag, 75 lines load and the compact line reads
 *   "Translation limited by YouTube"; with `#lingogram_http=429:5`, ZERO lines
 *   load and the full banner comes up. makeForcedFetch replaces the transport
 *   for every timedtext request, so it cannot refuse one half of the pair.
 *
 * The conclusion, after three discarded premises: a one-sided refusal cannot be
 * SIMULATED at all — not by a counter, not by a status, not on any shape of
 * video. It exists only when YouTube genuinely refuses one request and serves
 * the other, and that is a state to be observed where it is already present,
 * never provoked (docs/ops/live-debug-cdp.md, third rule).
 *
 * So the check below no longer arranges a cause and asserts its wording. It
 * reads whatever partial state is present and asserts the MAPPING — that the
 * words match the cause the product diagnosed, and that the retry is offered
 * exactly where retrying could help. The precondition is read from the
 * profile's own pair, never hard-coded, since the suite does not set it; where
 * no partial state is present the check declares itself unrun (Art. F) rather
 * than passing on a state nobody observed.
 */
test.describe('the compact notice names the cause', () => {
    /** The notice's terminal state: its wording, and whether a retry is offered. */
    const readNotice = () => {
        const n = document.getElementById('vtt-partial-notice');
        if (!n) return null;
        return {
            text: n.querySelector('span')?.textContent ?? '',
            retry: !!n.querySelector('.vtt-partial-notice-retry'),
            warning: n.classList.contains('is-warning'),
        };
    };

    /**
     * Candidates whose caption tracks carry the LEARNING language but not the
     * native one. Each is verified before use — a video can gain or lose a
     * track, so the id is never taken on faith (the same rule the caption-free
     * check in failure-states.spec.ts follows).
     */
    const LEARNING_ONLY = ['ZbZSe6N_BXs', 'CMNry4PE93Y', 'sTANio_2E0Q', '7wtfhZwyrcc'];

    /** The caption languages the player itself says the video offers. */
    const captionLanguages = () => {
        const pr = (document.getElementById('movie_player') as any)?.getPlayerResponse?.();
        const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
        return {
            status: pr?.playabilityStatus?.status ?? '?',
            langs: tracks.map((t: any) => t.languageCode as string),
        };
    };

    /**
     * Open a video whose tracks cover the learning language but not the native
     * one, and wait for the partial state: the stored track playing, the
     * translation slot unfilled.
     *
     * Why this shape and not "exactly one caption language", which the first
     * attempt at this check used and which is WRONG. planTrackRequests
     * (trackPlan.ts:92-113) sends `tlang=` for whichever half of the PAIR has
     * no matching track. On a one-language video — measured on 9bZkp7q19f0,
     * Korean only — that is BOTH halves: en and ru both arrive as machine
     * translations, both load, and there is no partial state at all; with the
     * switch on, both fail and the full banner comes up instead. The code was
     * read correctly and the conclusion did not follow from it.
     *
     * What produces a one-sided failure is an asymmetric pair: English stored,
     * Russian absent. Then ru is the only `tlang` request, which is the request
     * class YouTube throttles and the only one the breaker is scoped to
     * (timedtext-fetch.ts), so a refusal lands on it while English keeps
     * playing. `hash` drives the refusal; pass '' for the untouched case.
     *
     * Returns null when the state was not reached — no candidate qualified, or
     * nothing loaded. Null is "unrun" (Art. F), never a pass. That is what
     * saved the first version: its precondition was written from the false
     * premise, so it skipped rather than passing on a video that could not
     * produce the state.
     */
    /**
     * The qualifying video, resolved ONCE for the whole block.
     *
     * Measured: searching per test does not fit the budget. Each candidate
     * costs up to 45s just to answer whether it qualifies, and the run has
     * three tests — so three sweeps of four candidates each spent the timeout
     * on repeated searching rather than on the state under test. The symptom
     * was misleading: Playwright tears the context down at the deadline, so
     * the next `ext.open()` reported "the browser has no tabs", which looks
     * like a browser problem and is not one.
     *
     * `undefined` means "not looked for yet"; `null` means "looked, none
     * qualified" — which is unrun (Art. F), not a pass.
     */
    let qualifying: string | null | undefined;

    async function findQualifying(ext: ExtensionHandle): Promise<string | null> {
        if (qualifying !== undefined) return qualifying;

        // The pair belongs to whoever's profile this is; the suite does not set
        // it. Asserting against a hard-coded en/ru would be a check depending
        // on state it never establishes — the defect class found in three live
        // checks the same afternoon.
        const pair = await readPrefs(ext);
        if (!pair) return (qualifying = null);

        for (const id of LEARNING_ONLY) {
            const page = await ext.open(`https://www.youtube.com/watch?v=${id}`);
            try {
                await page.waitForFunction(
                    () => !!(document.getElementById('movie_player') as any)?.getPlayerResponse?.(),
                    null, { timeout: 30_000, polling: 500 });
                const { status, langs } = await page.evaluate(captionLanguages);
                // Verified at the moment of use, not from the id. The shape
                // that matters is the ASYMMETRY, not the count: the learning
                // language stored, the native one absent, so exactly one of the
                // two requests is a machine translation.
                const stored = (code: string) => langs.some((l) => l.startsWith(code));
                if (status === 'OK' && stored(pair.learning) && !stored(pair.native)) {
                    return (qualifying = id);
                }
            } catch {
                /* try the next candidate */
            } finally {
                await page.close().catch(() => {});
            }
        }
        return (qualifying = null);
    }

    async function partialNotice(
        ext: ExtensionHandle,
        hash = '',
    ): Promise<{ text: string; retry: boolean; warning: boolean; tracks: number; id: string } | null> {
        const id = await findQualifying(ext);
        if (!id) return null;

        const page = await ext.open(`https://www.youtube.com/watch?v=${id}${hash}`);
        try {
            // The line only exists while something IS playing, so lines first.
            await page.waitForFunction(
                () => document.querySelectorAll('#vtt-list .vtt-item').length > 0,
                null, { timeout: 90_000, polling: 250 });
            await page.waitForFunction(
                () => !!document.getElementById('vtt-partial-notice'),
                null, { timeout: 60_000, polling: 250 });

            const notice = (await page.evaluate(readNotice))!;
            const tracks = await page.evaluate(
                () => document.querySelectorAll('#vtt-main-select option').length);
            return { ...notice, tracks, id };
        } catch {
            // The state is not present: both halves of the pair loaded, so
            // there is no partial failure to read. That is the ordinary case
            // when YouTube is serving translations normally — it is unrun
            // (Art. F), not a failure, and it is reported as ABSENT rather
            // than collapsed into the "no candidate qualified" answer, which
            // is a different thing and used to be indistinguishable.
            return { text: '', retry: false, warning: false, tracks: 0, id };
        } finally {
            await page.close().catch(() => {});
        }
    }

    /**
     * The one wording this instrument can drive honestly.
     *
     * Measured, and it is the third premise this check has had to discard: the
     * diagnostic switch replaces the transport for EVERY timedtext request, not
     * only the `tlang=` one. So `#lingogram_http=429` on this video refuses the
     * stored English track as well, no lines load, and the FULL banner comes up
     * instead of the compact line:
     *
     *     no flag   lines 75, notice "Translation limited by YouTube"
     *     429 flag  lines  0, banner "YouTube is limiting requests"
     *
     * A one-sided refusal therefore cannot be simulated at all — not by a
     * counter, not by a status, not on any shape of video. It is reachable only
     * when YouTube genuinely refuses one request and serves the other, which is
     * a state to be observed if it happens to be present, never provoked
     * (docs/ops/live-debug-cdp.md, third rule).
     *
     * So this check asserts the wording it finds rather than arranging one: it
     * reads the compact line, and asserts the mapping between the cause the
     * product diagnosed and the words it chose. When no partial state is
     * present it declares itself unrun (Art. F).
     */
    test('the compact line matches the cause the product diagnosed', async ({ ext }) => {
        // A live video load plus the notice wait does not fit the 180s default.
        test.setTimeout(300_000);
        await preservingUiPrefs(ext, async () => {
            const notice = await partialNotice(ext);
            test.skip(notice === null,
                'no candidate had the learning language stored and the native one absent');
            test.skip(notice!.text === '',
                'no partial failure was present: nothing to read the wording of');

            // One language playing, the other slot unfilled — the precondition
            // asserted rather than assumed.
            expect(notice!.tracks, `on ${notice!.id}`).toBe(1);

            // The mapping under test: each cause has its own words, and the
            // retry is offered exactly where retrying could help. Whichever
            // cause is present, the OTHER two wordings must not appear —
            // that is the "one message standing where another belongs"
            // failure this phase exists for.
            const WORDINGS = {
                throttled: 'Translation limited by YouTube',
                absent: 'No translation for this video',
                failed: "Couldn't load the translation",
            } as const;

            const seen = notice!.text;
            expect(Object.values(WORDINGS)).toContain(seen);

            if (seen === WORDINGS.throttled) {
                // Temporary and self-clearing: worth retrying, and the one
                // cause that earns the warning colour.
                expect(notice!.retry).toBe(true);
                expect(notice!.warning).toBe(true);
            } else if (seen === WORDINGS.absent) {
                // Retrying cannot conjure a translation that does not exist.
                expect(notice!.retry).toBe(false);
                expect(notice!.warning).toBe(false);
            } else {
                // An expired link is recoverable, but it is not a limit.
                expect(notice!.retry).toBe(true);
                expect(notice!.warning).toBe(false);
            }
        });
    });

    /**
     * The third wording — the expired link — is deliberately NOT driven here.
     * Recorded rather than approximated (Art. K); its unit twin in
     * `app-base-status.test.ts` covers the wording itself.
     *
     * This is a limit of the INSTRUMENT, not of the product. The product
     * reaches the state whenever a signed URL dies while one track is already
     * playing; what cannot reach it is the switch, which substitutes fetches in
     * order and so cannot refuse the translation without also refusing the
     * request before it (see this block's header). The total refusal it does
     * produce raises the full banner instead of this line, and
     * `failure-states.spec.ts` already owns that.
     *
     * The same distinction the skips above draw: a state nobody observed is
     * reported as unobserved, never as verified (Art. F).
     */
});
