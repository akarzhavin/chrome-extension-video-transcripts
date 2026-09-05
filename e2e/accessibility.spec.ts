/**
 * Behaviour map §39 (the transcript follows the video and yields while you
 * read), §48 (what screen readers are told), §49 (keyboard-only limits).
 *
 * §49 pins a KNOWN GAP rather than a working feature: the account panel and the
 * in-player menu close on Escape, and the settings, feedback and word screens
 * do not. Pinning it means a partial fix — making one of them behave and not the
 * others — is noticed rather than shipped quietly.
 */
import { test, expect } from './fixtures/extension';
import { waitForLines, playFrom } from './fixtures/subtitles';
import { preservingUiPrefs, readUiPrefs, writeUiPrefs } from './fixtures/uiprefs';

const VIDEO = 'https://www.youtube.com/watch?v=aircAruvnKk';

test.describe('the transcript follows the video', () => {
    /**
     * The list scrolls itself to keep the current line in view, and STOPS while
     * the pointer is over it so the text does not slide out from under someone
     * reading.
     *
     * The freeze is invisible in the markup — it is an internal flag, and the
     * highlight keeps moving either way. So the only honest assertion is
     * behavioural: with the pointer over the list, its scroll position must not
     * move even as the highlight advances. A check on the highlight alone would
     * pass whether or not the freeze exists at all.
     */
    test('the list scrolls itself, and stops while the pointer is over it', async ({ ext }) => {
        await preservingUiPrefs(ext, async () => {
            const page = await ext.open(VIDEO);
            try {
                await waitForLines(page);
                await playFrom(page, 20);

                const scrollTop = () => page.evaluate(() => document.getElementById('vtt-list')?.scrollTop ?? -1);
                const activeIndex = () =>
                    page.evaluate(
                        () =>
                            document.querySelector('.vtt-item.active-sub')?.getAttribute('data-index') ?? null,
                    );

                // It follows on its own.
                await expect.poll(scrollTop, { timeout: 60_000 }).toBeGreaterThan(0);

                // Now hold the pointer over the list and jump far ahead.
                await page.evaluate(() => {
                    const list = document.getElementById('vtt-list');
                    list?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
                    document.getElementById('vtt-sidebar')?.dispatchEvent(
                        new MouseEvent('mouseenter', { bubbles: true }),
                    );
                });

                const frozenAt = await scrollTop();
                const indexBefore = await activeIndex();
                await playFrom(page, 400);

                // The highlight must move — otherwise this proves nothing.
                await expect.poll(activeIndex, { timeout: 45_000 }).not.toBe(indexBefore);

                // ...and the list must not have scrolled while it did.
                expect(
                    await scrollTop(),
                    'the transcript must not slide out from under a reader',
                ).toBe(frozenAt);
            } finally {
                await page.close().catch(() => {});
            }
        });
    });
});

test.describe('what screen readers are told', () => {
    /**
     * Behaviour map §48. Urgency is graded on purpose: something that went
     * wrong interrupts, something routine waits its turn. The grading lives in
     * the announcement's own attributes.
     */
    test('an announcement carries an urgency, and the panel announces its state', async ({ ext }) => {
        await preservingUiPrefs(ext, async () => {
            // `aria-expanded` is asserted to be 'true' below, so the panel has
            // to START expanded. Reading it without setting it made the result
            // a property of whoever's profile ran the suite.
            await writeUiPrefs(ext, { ...((await readUiPrefs(ext)) as object | null), sidebarCollapsed: false });

            const page = await ext.open(VIDEO);
            try {
                await waitForLines(page);

                // The panel's own control states whether it is open, so a
                // screen reader is told what the arrow means.
                const announced = await page.evaluate(() =>
                    document.getElementById('vtt-toggle-btn')?.getAttribute('aria-expanded'),
                );
                expect(announced).toBe('true');

                // The reading-mode controls are announced as a choice between
                // options rather than as unlabelled buttons.
                const roles = await page.evaluate(() =>
                    ['vtt-qm-single', 'vtt-qm-dual', 'vtt-qm-guess'].map((id) =>
                        document.getElementById(id)?.getAttribute('role'),
                    ),
                );
                expect(roles).toEqual(['radio', 'radio', 'radio']);
            } finally {
                await page.close().catch(() => {});
            }
        });
    });
});

test.describe('keyboard-only use has a real limit', () => {
    /**
     * Behaviour map §49, a KNOWN GAP pinned rather than fixed.
     *
     * The settings screen does not close on Escape, unlike the account panel.
     * This asserts today's inconsistency so that changing it — in either
     * direction — is a visible decision rather than a silent drift.
     */
    test('the settings screen does not close on Escape', async ({ ext }) => {
        await preservingUiPrefs(ext, async () => {
            const page = await ext.open(VIDEO);
            try {
                await waitForLines(page);

                const visible = () =>
                    page.evaluate(
                        () => (document.getElementById('vtt-settings-panel')?.getClientRects().length ?? 0) > 0,
                    );

                await page.evaluate(() => document.getElementById('vtt-settings-btn')?.click());
                await expect.poll(visible, { timeout: 20_000 }).toBe(true);

                await page.keyboard.press('Escape');
                await page.waitForTimeout(1500);

                expect(
                    await visible(),
                    'today the settings screen ignores Escape — if this now closes, the gap was fixed and this check should be updated deliberately',
                ).toBe(true);

                await page.evaluate(() => document.getElementById('vtt-settings-btn')?.click());
            } finally {
                await page.close().catch(() => {});
            }
        });
    });
});

test.describe('the page holds still while the transcript moves', () => {
    /**
     * Behaviour map §39.4. Only the list scrolls. The page must never be
     * yanked back to the player as lines change — the failure mode of the
     * obvious implementation, `scrollIntoView`, which scrolls every scrollable
     * ancestor including the document.
     *
     * Its source twin (apps/youtube/tests/rendered-pins.test.ts) pins the call
     * that keeps this true; this observes the consequence on a real page,
     * where the document genuinely can scroll.
     */
    test('five line changes move the list and leave the page where it was', async ({ ext }) => {
        await preservingUiPrefs(ext, async () => {
            const page = await ext.open(VIDEO);
            try {
                await waitForLines(page);

                // Scroll the document away from the top first: at scrollY 0 a
                // yank back to the player is a no-op, and the check would pass
                // against the very bug it exists for.
                await page.evaluate(() => window.scrollTo(0, 600));
                await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 20_000 }).toBeGreaterThan(
                    100,
                );

                await playFrom(page, 20);

                const listTop = () => page.evaluate(() => document.getElementById('vtt-list')?.scrollTop ?? -1);
                const activeIndex = () =>
                    page.evaluate(
                        () => document.querySelector('.vtt-item.active-sub')?.getAttribute('data-index') ?? null,
                    );
                const pageTop = () => page.evaluate(() => window.scrollY);

                const pageBefore = await pageTop();
                const listBefore = await listTop();

                // Five line changes, driven rather than waited for: playback in
                // a background tab is not throttled, but stepping the playhead
                // is deterministic where waiting is not.
                //
                // More marks than changes needed, because a mark can land
                // inside the line the previous one already selected — two of
                // the first five did, and the loop then waited out its timeout
                // for a change that was never coming. The marks are a supply;
                // five DISTINCT lines is the requirement, and the threshold is
                // not lowered to whatever the supply happened to yield.
                const seen = new Set<string>();
                let previous = await activeIndex();
                for (const t of [40, 60, 80, 100, 120, 140, 160, 180, 200, 220]) {
                    if (seen.size >= 5) break;
                    await playFrom(page, t);
                    // Wait for the highlight to CHANGE, not merely to exist:
                    // polling for "not null" is satisfied instantly by the
                    // line that was already highlighted, and the loop then
                    // sampled the same one five times (measured: 2 distinct).
                    // A mark inside the current line simply yields nothing.
                    await expect
                        .poll(activeIndex, { timeout: 20_000 })
                        .not.toBe(previous)
                        .catch(() => {});
                    previous = await activeIndex();
                    if (previous) seen.add(previous);
                }
                // Art. F: a transcript sparse enough that ten marks cannot
                // produce five different lines has not disproved anything, and
                // must not report success on a state nobody reached.
                test.skip(
                    seen.size < 5,
                    `only ${seen.size} distinct lines across ten marks — too sparse to observe five line changes`,
                );
                expect(seen.size, 'the highlight never moved, so this proves nothing').toBeGreaterThanOrEqual(5);

                expect(await listTop(), 'the transcript did not follow the video').not.toBe(listBefore);
                expect(
                    await pageTop(),
                    'the page moved while the transcript scrolled — scrollIntoView is dragging the document',
                ).toBe(pageBefore);
            } finally {
                await page.close().catch(() => {});
            }
        });
    });

    /**
     * Behaviour map §39.1. The current line is kept CENTRED, not merely
     * somewhere in view. The existing check on this asserts `scrollTop > 0`,
     * which any scroll at all satisfies — including one that parks the active
     * line against the top edge, where the lines about to be spoken are off
     * screen.
     *
     * Sampled three times at different points in the video: a single sample
     * can land on the head or the tail of the transcript, where the list
     * cannot scroll far enough to centre anything.
     */
    test('the active line sits near the middle of the list, not merely inside it', async ({ ext }) => {
        await preservingUiPrefs(ext, async () => {
            const page = await ext.open(VIDEO);
            try {
                const lines = await waitForLines(page);
                // Centring needs room on both sides; a short transcript that
                // does not overflow has nothing to centre.
                test.skip(lines < 30, `only ${lines} lines — the list cannot scroll far enough to centre one`);

                const offset = () =>
                    page.evaluate(() => {
                        const list = document.getElementById('vtt-list');
                        const active = list?.querySelector('.vtt-item.active-sub');
                        if (!list || !active) return null;
                        const l = list.getBoundingClientRect();
                        const a = active.getBoundingClientRect();
                        // How far the line's middle sits from the list's
                        // middle, as a share of the list's height. A ratio, not
                        // raw pixels: the panel's height depends on the window.
                        return Math.abs(a.top + a.height / 2 - (l.top + l.height / 2)) / l.height;
                    });

                for (const t of [60, 120, 180]) {
                    await playFrom(page, t);
                    // Wait for the scroll to settle at this line before
                    // measuring — the animation is 'smooth' for a nearby line.
                    await expect
                        .poll(offset, { timeout: 45_000 })
                        .not.toBeNull();
                    await page.waitForTimeout(1500);

                    const off = await offset();
                    expect(off, `no active line at ${t}s`).not.toBeNull();
                    expect(
                        off!,
                        `at ${t}s the current line sits ${(off! * 100).toFixed(0)}% of the list's height from its middle`,
                    ).toBeLessThan(0.25);
                }
            } finally {
                await page.close().catch(() => {});
            }
        });
    });
});
