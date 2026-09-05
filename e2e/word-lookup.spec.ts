/**
 * Behaviour map §13 and §42 (looking a word up), §40 (selecting and copying),
 * §38 (the transcript is a navigation control).
 *
 * All graded High: each is a core capability whose failure is silent.
 */
import { test, expect } from './fixtures/extension';
import { waitForLines, playFrom } from './fixtures/subtitles';
import { withPrefs } from './fixtures/prefs';

const STRIP = '#lingogram-lookup-strip';

test.describe('looking a word up', () => {
    /**
     * The card opens on a CLICK in the transcript and on HOVER over the video —
     * two surfaces, two gestures, by design. Four earlier attempts failed by
     * using the wrong gesture on the wrong surface.
     */
    test('clicking a word in the transcript opens a card with content', async ({ page }) => {
        await waitForLines(page);

        const clicked = await page.evaluate(() => {
            const w = document.querySelector('.vtt-main-text span[data-word]') as HTMLElement | null;
            if (!w) return false;
            w.click();
            return true;
        });
        expect(clicked, 'no clickable word in the transcript').toBe(true);

        await expect.poll(() => page.evaluate((s) => !!document.querySelector(s), STRIP), { timeout: 30_000 }).toBe(
            true,
        );

        // Settled: no longer waiting, and not an error.
        const card = await (async () => {
            await page.waitForFunction(
                (s) => {
                    const n = document.querySelector(s);
                    return !!n && !n.querySelector('.vtt-lookup-pending');
                },
                STRIP,
                { timeout: 45_000, polling: 250 },
            );
            return page.evaluate((s) => {
                const n = document.querySelector(s)!;
                return {
                    text: (n.textContent ?? '').trim(),
                    error: !!n.querySelector('.vtt-lookup-error'),
                };
            }, STRIP);
        })();

        expect(card.error).toBe(false);
        expect(card.text.length).toBeGreaterThan(0);
    });

    /**
     * Behaviour map §13's silent guard: with no languages stored the card must
     * decline to open rather than open empty. Restored afterwards regardless.
     */
    test('with no languages set, the card declines to open', async ({ ext, page }) => {
        await waitForLines(page);

        await withPrefs(ext, null, async () => {
            const fresh = await ext.open('https://www.youtube.com/watch?v=aircAruvnKk');
            try {
                // The setup gate stands in for the transcript when no pair is set.
                await expect
                    .poll(() => fresh.evaluate(() => !!document.getElementById('vtt-lang-onboarding')), {
                        timeout: 60_000,
                    })
                    .toBe(true);

                const opened = await fresh.evaluate((s) => !!document.querySelector(s), STRIP);
                expect(opened, 'the word card must not open before languages are chosen').toBe(false);
            } finally {
                await fresh.close().catch(() => {});
            }
        });
    });
});

test.describe('selecting and copying', () => {
    /**
     * Behaviour map §40. A dragged phrase opens the same card a clicked word
     * does, but only when the selection lies inside the language being learned.
     * The translation row is deliberately not a valid source, so a phrase can
     * never be saved out of it.
     *
     * Asserted against the product's actual rule, not a guess: an earlier
     * version of this check looked for a "+ Lingogram" pill, which the card
     * replaced and which now exists only in the marketing embed. That check
     * would have passed without ever exercising anything.
     */
    test('a selection inside the translation opens no card', async ({ page }) => {
        await waitForLines(page);

        const hasTranslation = await page.evaluate(() => !!document.querySelector('#vtt-list .vtt-sub-text'));
        test.skip(!hasTranslation, 'this video loaded one language only, so there is no translation row');

        await page.evaluate((s) => document.querySelector(s)?.remove(), STRIP);

        const selectIn = (selector: string) =>
            page.evaluate((sel) => {
                const node = document.querySelector(sel);
                if (!node) return false;
                const r = document.createRange();
                r.selectNodeContents(node);
                const s = window.getSelection();
                s?.removeAllRanges();
                s?.addRange(r);
                node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                return true;
            }, selector);

        expect(await selectIn('#vtt-list .vtt-sub-text')).toBe(true);
        await page.waitForTimeout(1500);
        expect(
            await page.evaluate((s) => !!document.querySelector(s), STRIP),
            'a phrase selected in the translation must not be offered for lookup',
        ).toBe(false);

        // The control half: the same gesture inside the learning language DOES
        // open the card. Without this the check above would also pass if
        // selection were broken everywhere.
        expect(await selectIn('#vtt-list .vtt-main-text')).toBe(true);
        await expect
            .poll(() => page.evaluate((s) => !!document.querySelector(s), STRIP), { timeout: 30_000 })
            .toBe(true);
    });
});

test.describe('the transcript as a navigation control', () => {
    /** Behaviour map §38: a press on a line moves playback to it. */
    test('clicking a line moves playback to that line', async ({ page }) => {
        await waitForLines(page);
        await playFrom(page, 5);
        await page.waitForTimeout(1000);

        const before = await page.evaluate(() => document.querySelector('video')!.currentTime);

        await page.evaluate(() => {
            const items = [...document.querySelectorAll('#vtt-list .vtt-item')] as HTMLElement[];
            // Far enough away that ordinary playback could not have reached it.
            items[Math.min(60, items.length - 1)]?.click();
        });

        await expect
            .poll(() => page.evaluate(() => document.querySelector('video')!.currentTime), { timeout: 20_000 })
            .toBeGreaterThan(before + 10);
    });
});
