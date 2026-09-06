/**
 * Behaviour map §12 (fullscreen), §28 (while an advert plays), §52 (live
 * streams, picture-in-picture and theatre mode).
 *
 * These are the behaviours a machine can reach least well, and each says which
 * part it covers and which part it does not. Real fullscreen needs a gesture in
 * a focused window and adverts play when YouTube decides — so where the real
 * thing is out of reach, the product's own rule is exercised directly rather
 * than faked and reported as if observed.
 */
import { test, expect } from './fixtures/extension';
import { SITES } from './fixtures/sites';
import { waitForLines, playFrom } from './fixtures/subtitles';
import { preservingUiPrefs } from './fixtures/uiprefs';

/**
 * Only fullscreen runs on every platform, and it names the host's player
 * through `site.playerSelector` rather than writing `#movie_player` in.
 *
 * The other two stay YouTube-only and are meant to: the advert clock is a
 * YouTube behaviour with no Netflix equivalent, and theatre mode is a YouTube
 * view that Netflix does not have. Those are different products, not one
 * product on two sites.
 */

for (const site of SITES) {
    test.describe(`${site.name}: fullscreen`, () => {
        /**
         * Behaviour map §12. Entering fullscreen genuinely requires a gesture in a
         * focused window, which a background tab cannot supply — so the ENTRY is
         * not covered here and is recorded as such.
         *
         * What is covered is the consequence that matters: the panel has to move
         * inside the fullscreen element, because anything left outside it is simply
         * not on screen. This drives the browser's own fullscreen API on the player
         * and checks the panel followed.
         */
        test('the panel moves inside the fullscreen element, rather than being left behind', async ({ ext, pageFor }) => {
            const reason = site.skipReason();
            test.skip(reason !== null, reason ?? '');
            const page = await pageFor(site);

            await preservingUiPrefs(ext, async () => {
                await waitForLines(page);

                // The player container is the ONE thing here that belongs to the
                // host, so it is named by the site rather than written in.
                const entered = await page.evaluate(async (selector) => {
                    const player = document.querySelector(selector);
                    if (!player) return false;
                    try {
                        await player.requestFullscreen();
                        return !!document.fullscreenElement;
                    } catch {
                        return false; // no gesture — expected in a background tab
                    }
                }, site.playerSelector);

                test.skip(
                    !entered,
                    'fullscreen needs a real gesture in a focused window; a background tab cannot give one',
                );

                await expect
                    .poll(
                        () =>
                            page.evaluate(() => {
                                const sb = document.getElementById('vtt-sidebar');
                                const fs = document.fullscreenElement;
                                return !!sb && !!fs && fs.contains(sb);
                            }),
                        { timeout: 20_000 },
                    )
                    .toBe(true);

                await page.evaluate(() => document.exitFullscreen?.());
            });
        });
    });
}

test.describe('while an advert plays', () => {
    /**
     * Behaviour map §28. Whether an advert plays is YouTube's decision, not a
     * test's, so waiting for a real one would make this check fire on a
     * schedule nobody controls.
     *
     * What is checked instead is the product's own rule, driven directly: while
     * the player says an advert is running, the highlight must not follow the
     * advert's clock. Without this, the transcript races ahead during the break
     * and lands somewhere wrong when the video resumes.
     */
    test('the highlight does not follow the advert clock', async ({ ext, page }) => {
        await preservingUiPrefs(ext, async () => {
            await waitForLines(page);
            await playFrom(page, 30);

            const activeIndex = () =>
                page.evaluate(
                    () => document.querySelector('.vtt-item.active-sub')?.getAttribute('data-index') ?? null,
                );

            await expect.poll(activeIndex, { timeout: 45_000 }).not.toBeNull();

            // Tell the page an advert is running, exactly as the site does.
            await page.evaluate(() => document.getElementById('movie_player')?.classList.add('ad-showing'));
            const frozen = await activeIndex();

            // Move the clock a long way, as an advert's playback would.
            await playFrom(page, 400);
            await page.waitForTimeout(4000);

            expect(
                await activeIndex(),
                'the transcript must not race ahead on an advert clock',
            ).toBe(frozen);

            // ...and it picks up again once the advert is over.
            await page.evaluate(() => document.getElementById('movie_player')?.classList.remove('ad-showing'));
            await expect.poll(activeIndex, { timeout: 45_000 }).not.toBe(frozen);
        });
    });
});

test.describe('other player layouts', () => {
    /**
     * Behaviour map §52. Theatre mode was never designed for specifically — the
     * ordinary layout rules just have to keep working. So this pins exactly
     * that: switching layout must not break the panel or the transcript.
     *
     * Picture-in-picture is NOT covered: it needs a real window the browser
     * composites itself, which automation cannot verify.
     */
    test('theatre mode leaves the panel and the transcript working', async ({ ext, page }) => {
        await preservingUiPrefs(ext, async () => {
            const before = await waitForLines(page);

            const switched = await page.evaluate(() => {
                const btn = document.querySelector('.ytp-size-button') as HTMLElement | null;
                if (!btn) return false;
                btn.click();
                return true;
            });
            test.skip(!switched, "this page does not offer YouTube's own size control");

            await page.waitForTimeout(3000);

            const after = await page.evaluate(() => ({
                panel: !!document.getElementById('vtt-sidebar'),
                visible:
                    (document.getElementById('vtt-sidebar')?.getClientRects().length ?? 0) > 0,
                lines: document.querySelectorAll('#vtt-list .vtt-item').length,
            }));

            expect(after.panel).toBe(true);
            expect(after.visible).toBe(true);
            expect(after.lines).toBe(before);

            // Put the layout back the way it was found.
            await page.evaluate(() => (document.querySelector('.ytp-size-button') as HTMLElement | null)?.click());
        });
    });
});
