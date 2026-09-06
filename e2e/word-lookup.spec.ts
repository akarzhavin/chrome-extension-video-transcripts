/**
 * Behaviour map §13 and §42 (looking a word up), §40 (selecting and copying),
 * §38 (the transcript is a navigation control).
 *
 * All graded High: each is a core capability whose failure is silent.
 */
import { test, expect } from './fixtures/extension';
import { waitForLines, playFrom } from './fixtures/subtitles';
import { withPrefs } from './fixtures/prefs';
import { preservingUiPrefs } from './fixtures/uiprefs';

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
     * Behaviour map §1: with no pair stored the panel shows the setup gate
     * instead of a transcript, so there is no word to click at all.
     *
     * That, and ONLY that, is what this check observes. An earlier version also
     * asserted `card is absent` — on a page where nothing had been clicked,
     * which is vacuously true and stayed green however the guard behaved. The
     * guard itself (`if (!prefs?.native) return` in strip.ts) is pinned in
     * packages/shared/tests/lookup.test.ts, where a word can be built and
     * genuinely hovered; both halves are asserted there.
     */
    test('with no languages set, there is no transcript to look a word up in', async ({ ext, page }) => {
        await waitForLines(page);

        await withPrefs(ext, null, async () => {
            const fresh = await ext.open('https://www.youtube.com/watch?v=aircAruvnKk');
            try {
                await expect
                    .poll(() => fresh.evaluate(() => !!document.getElementById('vtt-lang-onboarding')), {
                        timeout: 60_000,
                    })
                    .toBe(true);

                // The gate stands where the transcript would be: no clickable
                // word exists, which is the observable consequence §1 states.
                const words = await fresh.evaluate(
                    () => document.querySelectorAll('.vtt-main-text span[data-word]').length,
                );
                expect(words, 'the setup gate must replace the transcript, not sit beside it').toBe(0);
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
    test('a selection inside the translation opens no card', async ({ ext, page }) => {
        await waitForLines(page);

        // The translation row exists only in the two-language mode, and the
        // mode is whichever one the person left the panel in. This check used
        // to READ that state and skip when it found the one-language mode —
        // which it always did, so the check never once ran while the suite
        // reported it as present.
        await preservingUiPrefs(ext, async () => {
            await page.evaluate(() => document.getElementById('vtt-qm-dual')?.click());

            // Two languages have to have actually arrived: the mode refuses
            // itself with a single track, and there would again be no row to
            // select in. Asserted, so a video that loaded one language fails
            // the check rather than quietly excusing it.
            await expect
                .poll(() => page.evaluate(() => document.querySelectorAll('#vtt-list .vtt-sub-text').length), {
                    timeout: 45_000,
                    message: 'the two-language mode never produced a translation row to select in',
                })
                .toBeGreaterThan(0);

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

            // The control half: the same gesture inside the learning language
            // DOES open the card. Without this the check above would also pass
            // if selection were broken everywhere.
            expect(await selectIn('#vtt-list .vtt-main-text')).toBe(true);
            await expect
                .poll(() => page.evaluate((s) => !!document.querySelector(s), STRIP), { timeout: 30_000 })
                .toBe(true);
        });
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
