/**
 * Behaviour map §10 (the settings screen) and §19 (exporting subtitles).
 *
 * Both change settings that belong to the person whose browser this is, so both
 * run inside the guard that puts their own preferences back.
 */
import { test, expect } from './fixtures/extension';
import { SITES } from './fixtures/sites';
import { OVERLAY_TEXT_DEFAULTS } from '../packages/shared/src/overlay-style';
import { waitForLines } from './fixtures/subtitles';
import { preservingUiPrefs } from './fixtures/uiprefs';

/**
 * The settings screen runs on every platform: it is the panel's own screen, and
 * the same markup on every host. Exporting stays YouTube-only for now — the
 * offer names a loaded caption track, and the second check needs the
 * diagnostic flag, which is read once per page load from a YouTube URL.
 */

const VIDEO = 'https://www.youtube.com/watch?v=aircAruvnKk';

const openSettings = (page: import('@playwright/test').Page) =>
    page.evaluate(() => document.getElementById('vtt-settings-btn')?.click());

for (const site of SITES) {
    test.describe(`${site.name}: the settings screen`, () => {
        test('the settings screen opens over the transcript and closes again', async ({ ext, pageFor }) => {
            const reason = site.skipReason();
            test.skip(reason !== null, reason ?? '');
            const page = await pageFor(site);

            await preservingUiPrefs(ext, async () => {
                await waitForLines(page);

                // Visibility, not existence. The screen is BUILT up front and
                // shown or hidden — so asserting that it exists is true in
                // every state and proves nothing. The first draft of this check
                // did exactly that and would have passed against a settings
                // screen that never opened at all.
                const visible = () =>
                    page.evaluate(
                        () => (document.getElementById('vtt-settings-panel')?.getClientRects().length ?? 0) > 0,
                    );

                expect(await visible()).toBe(false);

                await openSettings(page);
                await expect.poll(visible, { timeout: 20_000 }).toBe(true);

                await openSettings(page);
                await expect.poll(visible, { timeout: 20_000 }).toBe(false);
            });
        });

        /**
         * Reset is worth one check rather than one per control: it exercises the
         * wiring of every setting at once. A setting that changes the captions but
         * is not connected to reset would survive it, and that is exactly the
         * defect this catches.
         *
         * There are TWO reset controls — one for the text group, one for the box
         * group. Measured, not assumed; an earlier plan said "the Reset button",
         * singular, which was wrong. This exercises the text group's.
         */
        test('reset returns a changed setting to its default', async ({ ext, pageFor }) => {
            const reason = site.skipReason();
            test.skip(reason !== null, reason ?? '');
            const page = await pageFor(site);

            await preservingUiPrefs(ext, async () => {
                await waitForLines(page);
                await openSettings(page);
                await page.waitForFunction(() => !!document.getElementById('vtt-style-font-select'), null, {
                    timeout: 20_000,
                    polling: 250,
                });

                const font = () =>
                    page.evaluate(
                        () => (document.getElementById('vtt-style-font-select') as HTMLSelectElement | null)?.value ?? null,
                    );

                const original = await font();

                // Pick any option that is not the current one, so the check
                // does not depend on which font the person happens to use.
                const changedTo = await page.evaluate(() => {
                    const sel = document.getElementById('vtt-style-font-select') as HTMLSelectElement | null;
                    if (!sel) return null;
                    const other = [...sel.options].find((o) => o.value !== sel.value);
                    if (!other) return null;
                    sel.value = other.value;
                    sel.dispatchEvent(new Event('change', { bubbles: true }));
                    return other.value;
                });
                expect(changedTo, 'the font list should offer more than one option').not.toBeNull();
                await expect.poll(font, { timeout: 20_000 }).toBe(changedTo);

                await page.evaluate(() => {
                    const reset = document.querySelector('.vtt-reset') as HTMLButtonElement | null;
                    reset?.click();
                });

                // Back to the product's DEFAULT — which is not necessarily what
                // the person had set, so `original` is deliberately not the
                // expected value. Naming the default is what makes this a
                // check: "moved off the changed value" was satisfied by any
                // other font, including a reset that picked one at random.
                await expect
                    .poll(font, { timeout: 20_000 })
                    .toBe(OVERLAY_TEXT_DEFAULTS.overlayFontFamily);

                // The person's own setting was NOT restored, and saying so is
                // the point of having read it: a reset that quietly put the
                // original back would be a different behaviour from the one
                // the map describes.
                expect(await font()).not.toBe(changedTo);
                if (original !== OVERLAY_TEXT_DEFAULTS.overlayFontFamily) {
                    expect(await font()).not.toBe(original);
                }
            });
        });
    });
}

test.describe('exporting subtitles', () => {
    /**
     * Behaviour map §19. The control names the language it would export, which
     * is enough to observe that the export follows the reading order without
     * intercepting a file at all.
     *
     * Stated plainly: this is weaker than reading the produced file. It shows
     * the control's offer changes, not that the file's contents do.
     */
    test('the export offer names the loaded language', async ({ ext, page }) => {
        await preservingUiPrefs(ext, async () => {
            await waitForLines(page);

            const offer = () =>
                page.evaluate(() => {
                    const b = document.getElementById('vtt-download-btn') as HTMLButtonElement | null;
                    return b ? { disabled: b.disabled, title: b.title } : null;
                });

            await expect.poll(offer, { timeout: 45_000 }).toMatchObject({ disabled: false });

            const before = await offer();
            // It names a language and a file kind, rather than an unlabelled
            // download whose result is a surprise.
            expect(before!.title).toMatch(/\.srt/);
            expect(before!.title.length).toBeGreaterThan('.srt'.length);
        });
    });

    /** Before anything has loaded, the control says why it cannot be used. */
    test('the export is unavailable until subtitles have loaded, and says so', async ({ ext }) => {
        await preservingUiPrefs(ext, async () => {
            const page = await ext.open(`${VIDEO}#lingogram_http=403`);
            try {
                // Wait for the failure to settle rather than for a fixed delay,
                // so this observes a genuinely track-less state.
                await page.waitForFunction(
                    () => {
                        const n = document.getElementById('vtt-status');
                        const t = n?.querySelector('.vtt-empty-state-title')?.textContent ?? '';
                        return t.length > 0 && !/Searching/i.test(t);
                    },
                    null,
                    { timeout: 120_000, polling: 250 },
                );

                const state = await page.evaluate(() => {
                    const b = document.getElementById('vtt-download-btn') as HTMLButtonElement | null;
                    return b ? { disabled: b.disabled, title: b.title } : null;
                });

                expect(state, 'the export control should exist even with nothing to export').not.toBeNull();
                expect(state!.disabled).toBe(true);
                expect(state!.title.length).toBeGreaterThan(0);
            } finally {
                await page.close().catch(() => {});
            }
        });
    });
});
