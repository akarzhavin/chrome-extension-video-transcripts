/**
 * The cleanup's own check.
 *
 * Every other file here checks the product. This one checks the machinery the
 * others now depend on: if `normalise` stops working, 29 checks quietly start
 * receiving a page in whatever state the previous one left it, and the failures
 * would look like product regressions scattered across seven files.
 *
 * Written before the cleanup existed and confirmed red first, per the rule that
 * a check nobody has seen fail is not evidence of anything. This suite has
 * already shipped fifteen checks that could not fail.
 */
import { test, expect } from './fixtures/extension';
import { acquireClean, normalise, pageState, CLEAN, WATCH_URL } from './fixtures/watch-page';
import { playFrom } from './fixtures/subtitles';
import { preservingUiPrefs } from './fixtures/uiprefs';

/**
 * Leave the page in every state a real check in this suite leaves it in.
 *
 * Each line here corresponds to a specific check's leftovers, named in the
 * research: the panel screens (settings-and-export:57, settings-detail:124),
 * the word card and a live selection (word-lookup:20, :96), the account panel
 * (signing-in:372), the frozen list (accessibility:28), the advert class
 * (player-modes:81), theatre view (player-modes:127), the scrolled document
 * (accessibility:161), the moved playhead (many), the swapped reading order
 * (display:17) and the collapsed panel (reading-modes:115).
 */
async function dirtyEveryWay(page: import('@playwright/test').Page): Promise<void> {
    await playFrom(page, 200);

    // Collapsing comes FIRST, and the order is load-bearing.
    //
    // Collapsing the panel closes the settings and feedback screens with it —
    // setCollapsed calls closeSettingsPanel (SidebarUI.ts:1655). An earlier
    // version of this collapsed LAST, which undid the two screens it had just
    // opened: the cleanup then had nothing to close, and removing its
    // settings-closing step left this check green. Measured:
    // `AFTER-COLLAPSE {"settingsOpen":false,"feedbackOpen":false,"collapsed":true}`.
    await page.evaluate(() => (document.getElementById('vtt-toggle-btn') as HTMLElement | null)?.click());
    await page.waitForTimeout(500);
    await page.evaluate(() => (document.getElementById('vtt-toggle-btn') as HTMLElement | null)?.click());
    await page.waitForTimeout(500);

    // Open the panel's screens through their real controls, so the page ends up
    // in the state the product actually produces rather than one invented here.
    await page.evaluate(() => {
        (document.getElementById('vtt-settings-btn') as HTMLElement | null)?.click();
    });
    await page.evaluate(() => {
        (document.getElementById('vtt-feedback-link') as HTMLElement | null)?.click();
    });

    // A word card, opened the way a reader opens one.
    await page.evaluate(() => {
        (document.querySelector('.vtt-main-text span[data-word]') as HTMLElement | null)?.click();
    });

    // A live selection, which is what re-opens the card if the cleanup clears
    // it in the wrong order.
    await page.evaluate(() => {
        const node = document.querySelector('#vtt-list .vtt-main-text');
        if (!node) return;
        const r = document.createRange();
        r.selectNodeContents(node);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(r);
    });

    // The account panel.
    await page.evaluate(() => {
        (document.querySelector('#lingogram-auth-badge .lingogram-auth-row') as HTMLElement | null)?.click();
    });

    await page.evaluate(() => {
        // Freeze the transcript's auto-scroll: a synthetic mouseenter with no
        // matching mouseleave, exactly as accessibility.spec.ts leaves it.
        document.getElementById('vtt-sidebar')?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        document.getElementById('movie_player')?.classList.add('ad-showing');
        // Swap the reading order. Collapsing is NOT done here — see the note at
        // the top: it would close the two screens opened above.
        (document.getElementById('vtt-langpair') as HTMLElement | null)?.click();
    });

    // Theatre view is YouTube's own persisted preference — the one piece of
    // dirt that outlives the tab, so the cleanup has to undo it.
    await page.evaluate(() => (document.querySelector('.ytp-size-button') as HTMLElement | null)?.click());
    await page.waitForTimeout(1000);

    // Scrolling comes LAST, and the order is load-bearing for the same reason
    // collapsing comes first: entering theatre view scrolls the page back to
    // the top by itself. Measured — `scrolled 600`, `after-langpair 600`,
    // `after-theatre 0`. Scrolled earlier, this piece of dirt was gone before
    // the cleanup ran, and deleting the cleanup's own scrollTo left this check
    // green.
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(400);
}

test.describe('the shared page is handed over clean', () => {
    /**
     * The whole contract in one check: dirty the page every way the suite is
     * known to dirty it, ask for it again, and require the canonical state.
     *
     * Asserted against the CLEAN literal, not against a reading taken before
     * the mess: comparing the page with itself would pass on a cleanup that
     * does nothing at all.
     */
    test('every kind of leftover is cleaned before the next check sees it', async ({ ext }) => {
        await preservingUiPrefs(ext, async () => {
            const page = await acquireClean(ext);
            await dirtyEveryWay(page);

            // Prove the mess actually landed. Without this, a dirtying step
            // that silently did nothing would make the check below pass for the
            // wrong reason — the failure mode this whole file exists to catch.
            const dirty = await pageState(page);
            expect(dirty, 'the page under test was supposed to be left dirty').not.toEqual(CLEAN);

            // normalise() directly, NOT acquireClean().
            //
            // acquireClean discards a page it cannot verify and loads a fresh
            // one — which is right in the suite and useless here: a freshly
            // loaded page is clean whether or not the cleanup does anything.
            // This check went green with a cleanup step deleted for exactly
            // that reason, and the measurement that exposed it was a single
            // line: the page it verified was not the page it had dirtied
            // (`SAME-PAGE false`).
            await normalise(page);
            await expect.poll(() => pageState(page), { timeout: 20_000 }).toEqual(CLEAN);
        });
    });

    /**
     * The page scroll gets its own check, apart from the one above.
     *
     * Leaving theatre view scrolls the page to the top by itself, and the big
     * check leaves theatre view — so the cleanup's own scrollTo is masked
     * there: deleting it changes nothing and the check stays green. Measured:
     * with only a scroll to dirty the page, cleanup leaves `scrollY: 600`
     * without the step and `0` with it; inside the big check both readings are
     * `0`.
     *
     * The lesson is not about scrolling. Two cleanup steps that undo the same
     * thing make one of them invisible to any check that triggers both, which
     * is how a step that does real work can look unnecessary.
     */
    test('a scrolled page is put back to the top', async ({ ext }) => {
        await preservingUiPrefs(ext, async () => {
            const page = await acquireClean(ext);

            await page.evaluate(() => window.scrollTo(0, 600));
            await expect
                .poll(() => page.evaluate(() => Math.round(window.scrollY)), { timeout: 10_000 })
                .toBe(600);

            await normalise(page);
            expect(
                await page.evaluate(() => Math.round(window.scrollY)),
                'the cleanup left the page scrolled where the last check had left it',
            ).toBe(0);
        });
    });

    /**
     * The auto-scroll freeze lives in a variable, not in the DOM, so the
     * canonical state cannot include it and the check above cannot see it. It
     * is the one leftover that has to be observed by behaviour: a frozen list
     * stops following the video.
     */
    test('the transcript follows the video again after cleanup', async ({ ext }) => {
        await preservingUiPrefs(ext, async () => {
            const page = await acquireClean(ext);

            await page.evaluate(() =>
                document.getElementById('vtt-sidebar')?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })),
            );
            await normalise(page);

            const scrollTop = () => page.evaluate(() => document.getElementById('vtt-list')?.scrollTop ?? -1);
            const before = await scrollTop();
            await playFrom(page, 200);

            await expect
                .poll(scrollTop, {
                    timeout: 30_000,
                    message: 'the list never moved — the hover freeze was not released',
                })
                .not.toBe(before);
        });
    });

    /**
     * The load counter is the feature's only evidence, so it gets its own
     * check: a counter that under-reports would make any later comparison
     * meaningless.
     */
    test('a page open and a reload each count as one load', async ({ ext }) => {
        const before = ext.loads.total;

        const page = await ext.open(WATCH_URL);
        try {
            expect(ext.loads.total - before, 'opening a video page counts once').toBe(1);

            await page.reload({ waitUntil: 'domcontentloaded' });
            expect(ext.loads.total - before, 'a reload is another page YouTube served').toBe(2);
        } finally {
            await page.close().catch(() => {});
        }
    });
});
