/**
 * Behaviour map §3 (loading subtitles) and §4 (subtitles on screen).
 *
 * Graded High: the product's whole purpose, resting on YouTube's own caption
 * protocol. The 1356 unit checks simulate the network and structurally cannot
 * see this contract — it has broken in the field while every one of them stayed
 * green.
 */
import { test, expect, VIDEO_WITH_CAPTIONS } from './fixtures/extension';
import { waitForLines, playFrom } from './fixtures/subtitles';

test.describe('loading subtitles', () => {
    test('lines load for a captioned video', async ({ page }) => {
        const count = await waitForLines(page);
        expect(count).toBeGreaterThan(0);
    });

    /**
     * The strongest assertion available: it holds only if fetching, parsing,
     * timing and highlighting all work together. Measured to settle reliably
     * once playback is driven explicitly.
     */
    test('exactly one line is highlighted, and it follows playback', async ({ page }) => {
        await waitForLines(page);
        await playFrom(page, 30);

        await expect
            .poll(() => page.evaluate(() => document.querySelectorAll('.vtt-item.active-sub').length), {
                timeout: 45_000,
            })
            .toBe(1);

        // Following, not merely present: the highlight must move with the video.
        const first = await page.evaluate(
            () => document.querySelector('.vtt-item.active-sub')?.textContent?.trim() ?? '',
        );
        await playFrom(page, 120);
        await expect
            .poll(
                () => page.evaluate(() => document.querySelector('.vtt-item.active-sub')?.textContent?.trim() ?? ''),
                { timeout: 45_000 },
            )
            .not.toBe(first);
    });

    test('caption text appears over the video and changes as it plays', async ({ page }) => {
        await waitForLines(page);
        await playFrom(page, 30);

        const overlayText = () =>
            page.evaluate(() => document.getElementById('vtt-video-overlay')?.textContent?.trim() ?? '');

        await expect.poll(overlayText, { timeout: 45_000 }).not.toBe('');
        const first = await overlayText();
        await playFrom(page, 120);
        await expect.poll(overlayText, { timeout: 45_000 }).not.toBe(first);
    });

    /**
     * Behaviour map §41. Each line is paired with the translation that overlaps
     * it most; a line carrying two translations means the pairing rule broke.
     * Asserted structurally, which is the part observable without a hand-built
     * fixture of deliberately offset timings.
     */
    test('no line ever carries more than one translation', async ({ page }) => {
        await waitForLines(page);
        const worst = await page.evaluate(() =>
            Math.max(
                0,
                ...[...document.querySelectorAll('#vtt-list .vtt-item')].map(
                    (i) => i.querySelectorAll('.vtt-sub-text').length,
                ),
            ),
        );
        expect(worst).toBeLessThanOrEqual(1);
    });
});

test.describe('the panel', () => {
    test('the panel and its tab are present, and the tab keeps its size', async ({ page }) => {
        await expect.poll(() => page.evaluate(() => !!document.getElementById('vtt-sidebar'))).toBe(true);

        // The COMPUTED box, not the bounding rectangle: a 1px border outside a
        // content-box width already produced a false failure (41x62 vs 40x60).
        const box = await page.evaluate(() => {
            const el = document.getElementById('vtt-toggle-btn');
            if (!el) return null;
            const cs = getComputedStyle(el);
            return { width: cs.width, height: cs.height };
        });
        expect(box).toEqual({ width: '40px', height: '60px' });
    });

    /**
     * Behaviour map §29. Two installed copies render into the same element ids
     * and produce one spliced panel with no explanation. "Exactly one" is the
     * assertion that catches it; "at least one" would not.
     */
    test('exactly one panel exists on the page', async ({ page }) => {
        await waitForLines(page);
        const panels = await page.evaluate(() => document.querySelectorAll('#vtt-sidebar').length);
        expect(panels).toBe(1);
    });
});

test.describe('the control inside the video player', () => {
    /**
     * Behaviour map §9. The only way to reach modes and downloads when the panel
     * is closed, injected into YouTube's own control bar — markup they can move
     * without notice.
     */
    test('the control is present in the player bar', async ({ page }) => {
        await waitForLines(page);
        await expect
            .poll(
                () =>
                    page.evaluate(
                        () => !!document.querySelector('#vtt-ytp-overlay-btn'),
                    ),
                { timeout: 45_000 },
            )
            .toBe(true);
    });
});

test.describe('moving between videos', () => {
    /**
     * Behaviour map §26. Graded High because the failure is silent: a track that
     * arrives for a video the viewer has already left must be discarded, or the
     * previous video's lines appear under the new one with no error at all.
     */
    test('switching videos clears the previous one and does not leak its lines', async ({ page }) => {
        await waitForLines(page);
        const before = await page.evaluate(
            () => [...document.querySelectorAll('#vtt-list .vtt-item')].slice(0, 5).map((i) => i.textContent?.trim()),
        );

        // Navigate the way the site does, without a page load.
        await page.evaluate(() => {
            const link = document.createElement('a');
            link.href = '/watch?v=dQw4w9WgXcQ';
            document.body.appendChild(link);
            link.click();
        });

        await page.waitForFunction(() => location.search.includes('dQw4w9WgXcQ'), null, { timeout: 60_000 });
        await waitForLines(page);

        const after = await page.evaluate(
            () => [...document.querySelectorAll('#vtt-list .vtt-item')].slice(0, 5).map((i) => i.textContent?.trim()),
        );
        expect(after).not.toEqual(before);
    });
});

test.describe('the video under test', () => {
    // Not a behaviour — a precondition. A video documented in this repo as
    // reliably caption-free had gained captions by the time it was checked, so
    // the fixture's own assumption is verified at the moment of use.
    test('still has captions', async ({ page }) => {
        expect(page.url()).toContain(VIDEO_WITH_CAPTIONS);
        expect(await waitForLines(page)).toBeGreaterThan(10);
    });
});
