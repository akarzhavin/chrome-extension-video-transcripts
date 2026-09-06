/**
 * Behaviour map §7 (swapping the two languages), §37 (running on every YouTube
 * page, not only videos), §4 (subtitles on screen — the on-screen toggle).
 */
import { test, expect } from './fixtures/extension';
import { SITES } from './fixtures/sites';
import { waitForLines, playFrom } from './fixtures/subtitles';
import { preservingUiPrefs } from './fixtures/uiprefs';

/**
 * Three of these five are about the panel rather than about the host, so they
 * run on every platform — one check parameterised over `SITES`, not a copy per
 * site. The two that stay YouTube-only are the home page and the search page:
 * "every page of the site, not only videos" is a claim about YouTube's own
 * shape, and Netflix has no equivalent.
 */

for (const site of SITES) {
    test.describe(`${site.name}: swapping the two languages`, () => {
        /**
         * The swap is expressed as a state on the panel, which the styling reads to
         * flip the visual order. Asserting the state rather than measuring pixel
         * positions: geometry has already produced one false failure in this work.
         */
        test('the shortcut swaps the reading order, and swaps it back', async ({ ext, pageFor }) => {
            const reason = site.skipReason();
            test.skip(reason !== null, reason ?? '');
            const page = await pageFor(site);

            await preservingUiPrefs(ext, async () => {
                await waitForLines(page);

                const swapped = () =>
                    page.evaluate(
                        () => document.getElementById('vtt-sidebar')?.classList.contains('vtt-swapped') ?? null,
                    );

                // Do not assume the starting order: the swap resets per video,
                // but reading it before the panel has settled made this flaky.
                await expect.poll(swapped, { timeout: 30_000 }).toBe(false);

                const pressSwap = async () => {
                    await page.evaluate(() => document.body.focus());
                    await page.keyboard.down('Shift');
                    await page.keyboard.press('KeyS');
                    await page.keyboard.up('Shift');
                };

                await pressSwap();
                await expect.poll(swapped, { timeout: 20_000 }).toBe(true);

                await pressSwap();
                await expect.poll(swapped, { timeout: 20_000 }).toBe(false);
            });
        });
    });
}

for (const site of SITES) {
    test.describe(`${site.name}: the on-screen captions toggle`, () => {
        /**
         * Behaviour map §4. Turning the captions off must remove them from the
         * video, not merely mark a control as off — the point of the control is the
         * captions, and a check on the control alone would pass against a toggle
         * that does nothing.
         */
        test('turning captions off removes them from the video, and back on restores them', async ({ ext, pageFor }) => {
            const reason = site.skipReason();
            test.skip(reason !== null, reason ?? '');
            const page = await pageFor(site);

            await preservingUiPrefs(ext, async () => {
                await waitForLines(page);
                await playFrom(page, 30, site);

                const captionText = () =>
                    page.evaluate(
                        () => document.getElementById('vtt-video-overlay')?.textContent?.trim() ?? '',
                    );

                await expect.poll(captionText, { timeout: 45_000 }).not.toBe('');

                await page.evaluate(() => document.getElementById('vtt-qm-overlay')?.click());
                await expect
                    .poll(
                        () =>
                            page.evaluate(() => {
                                const o = document.getElementById('vtt-video-overlay');
                                if (!o) return true; // gone entirely counts as off
                                return o.getClientRects().length === 0 || (o.textContent ?? '').trim() === '';
                            }),
                        { timeout: 30_000 },
                    )
                    .toBe(true);

                await page.evaluate(() => document.getElementById('vtt-qm-overlay')?.click());
                await expect.poll(captionText, { timeout: 45_000 }).not.toBe('');
            });
        });
    });
}

test.describe('pages that are not videos', () => {
    /**
     * Behaviour map §37. The extension runs everywhere on the site but must
     * build nothing where there is no video. A panel on the home page is an
     * obvious regression; this is the cheap guard against it.
     */
    test('no panel is shown on the home page', async ({ ext }) => {
        const page = await ext.open('https://www.youtube.com/');
        try {
            // Give the content script the same chance to build that it gets on
            // a video page, so an absence here means "did not build" rather
            // than "was not asked yet".
            await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 60_000 });
            await page.waitForTimeout(6000);

            const state = await page.evaluate(() => {
                const sb = document.getElementById('vtt-sidebar');
                return {
                    // The panel is BUILT on every page of the site and hidden
                    // where there is no video, so asking whether it exists is
                    // true everywhere and proves nothing.
                    built: !!sb,
                    visible: !!sb && sb.getClientRects().length > 0 && getComputedStyle(sb).display !== 'none',
                    // The page-level marker the product sets only on a video.
                    marked: document.body.classList.contains('vtt-sidebar-active'),
                };
            });

            expect(state.visible, 'the panel must not be visible where there is no video').toBe(false);
            expect(state.marked, 'the page must not be marked as carrying a panel').toBe(false);
        } finally {
            await page.close().catch(() => {});
        }
    });
});

for (const site of SITES) {
    test.describe(`${site.name}: collapsing the panel`, () => {
        /**
         * Behaviour map §5.3. Collapsing slides the panel off the right edge; it
         * does not shrink or fold. The width and the layout inside are unchanged,
         * which is why re-opening is instant and nothing reflows.
         *
         * The width is read from the computed style, not from a bounding rect: a
         * rect carries sub-pixel transform effects, and a 40x60 CSS box measuring
         * 41x62 in a rect has already raised one false alarm in this work.
         *
         * Its source twin (apps/youtube/tests/rendered-pins.test.ts) pins the
         * stylesheet rule this observes.
         */
        test('the panel keeps its width and moves instead', async ({ ext, pageFor }) => {
            const reason = site.skipReason();
            test.skip(reason !== null, reason ?? '');
            const page = await pageFor(site);

            await preservingUiPrefs(ext, async () => {
                await waitForLines(page);

                const panel = () =>
                    page.evaluate(() => {
                        const sb = document.getElementById('vtt-sidebar');
                        if (!sb) return null;
                        const cs = getComputedStyle(sb);
                        return {
                            collapsed: sb.classList.contains('collapsed'),
                            width: cs.width,
                            display: cs.display,
                            transform: cs.transform,
                        };
                    });

                // Start from a known state rather than clicking blindly: the
                // collapsed flag is remembered globally, so a blind toggle
                // expands a panel that was already collapsed.
                await page.evaluate(() => {
                    const sb = document.getElementById('vtt-sidebar');
                    if (sb?.classList.contains('collapsed')) document.getElementById('vtt-toggle-btn')?.click();
                });
                await expect.poll(async () => (await panel())?.collapsed, { timeout: 20_000 }).toBe(false);
                // The slide is a 0.4s transition, so the transform is still
                // mid-flight for a moment after the class comes off. Reading
                // it too early captured the collapsed transform as the OPEN
                // one, and the two then compared equal.
                await page.waitForTimeout(1200);

                const open = (await panel())!;
                expect(open.transform, 'the open panel is still mid-slide').toBe('none');

                await page.evaluate(() => document.getElementById('vtt-toggle-btn')?.click());
                await expect.poll(async () => (await panel())?.collapsed, { timeout: 20_000 }).toBe(true);
                // The slide is animated, so read after it has settled.
                await page.waitForTimeout(1200);

                const shut = (await panel())!;

                expect(shut.width, 'a collapsed panel that changed width folded instead of sliding').toBe(open.width);
                expect(shut.display, 'the contents must stay laid out, merely off-screen').toBe(open.display);
                // And it genuinely moved: the transform is what took it away.
                expect(shut.transform).not.toBe(open.transform);
                expect(shut.transform).not.toBe('none');

                // Put it back the way it was found.
                await page.evaluate(() => document.getElementById('vtt-toggle-btn')?.click());
                await expect.poll(async () => (await panel())?.collapsed, { timeout: 20_000 }).toBe(false);
            });
        });
    });
}

test.describe('search results are not a video page either', () => {
    /**
     * Behaviour map §37.2. The extension runs on every page of the site and
     * builds its panel only where it recognises a video. Both halves matter:
     * present (so a video appearing in place — a navigation within the SPA —
     * is noticed) and silent (so a search page looks untouched).
     *
     * The home-page check above computes exactly this `built` and throws it
     * away, asserting only the two negatives. Here it is asserted: without it
     * a content script that failed to run at all would satisfy every other
     * expectation on this page.
     */
    test('the panel is built but silent on a search page', async ({ ext }) => {
        const page = await ext.open('https://www.youtube.com/results?search_query=neural+networks');
        try {
            await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 60_000 });

            // The panel is built asynchronously, so wait for it rather than
            // sampling — an absence read too early is indistinguishable from
            // one that is real.
            await page.waitForFunction(() => !!document.getElementById('vtt-sidebar'), null, {
                timeout: 60_000,
                polling: 250,
            });
            // Give it the same chance to become visible that a video page
            // gives it, so "not visible" means chose not to, rather than
            // has not yet.
            await page.waitForTimeout(6000);

            const state = await page.evaluate(() => {
                const sb = document.getElementById('vtt-sidebar');
                return {
                    built: !!sb,
                    visible: !!sb && sb.getClientRects().length > 0 && getComputedStyle(sb).display !== 'none',
                    marked: document.body.classList.contains('vtt-sidebar-active'),
                };
            });

            expect(state.built, 'the extension must be present and listening on a search page').toBe(true);
            expect(state.visible, 'the panel must not be visible where there is no video').toBe(false);
            expect(state.marked, 'the page must not be marked as carrying a panel').toBe(false);
        } finally {
            await page.close().catch(() => {});
        }
    });
});
