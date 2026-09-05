/**
 * Behaviour map §6 (reading modes), §5 (the side panel), §8 (keyboard
 * shortcuts).
 *
 * Every check here changes something that belongs to the person whose browser
 * this is — the mode, the panel state — so each runs inside a guard that puts
 * their own preferences back, including when the check fails.
 */
import { test, expect } from './fixtures/extension';
import { waitForLines, playFrom } from './fixtures/subtitles';
import { preservingUiPrefs, readUiPrefs, writeUiPrefs } from './fixtures/uiprefs';

const VIDEO = 'https://www.youtube.com/watch?v=aircAruvnKk';

const modeState = () => ({
    single: document.getElementById('vtt-qm-single')?.classList.contains('active') ?? null,
    dual: document.getElementById('vtt-qm-dual')?.classList.contains('active') ?? null,
    guess: document.getElementById('vtt-qm-guess')?.classList.contains('active') ?? null,
});

test.describe('reading modes', () => {
    /**
     * Dual needs two languages. With one, it must SAY so rather than silently
     * doing nothing — a control that looks available and answers nothing is
     * worse than one that is visibly unavailable.
     */
    test('dual mode makes itself unavailable when only one language loaded', async ({ ext }) => {
        await preservingUiPrefs(ext, async () => {
            // A real video whose captions come in ONE language, rather than a
            // forced failure: the diagnostic switch denies EVERY request, which
            // produces no subtitles at all — a different state, and the first
            // draft of this check failed because of that rather than because of
            // anything in the product.
            const page = await ext.open('https://www.youtube.com/watch?v=kJQP7kiw5Fk');
            try {
                const lines = await waitForLines(page);
                expect(lines).toBeGreaterThan(0);

                // The precondition, verified at the moment of use rather than
                // trusted: a video can gain captions in another language later,
                // and then this check would be asserting nothing.
                expect(
                    await page.evaluate(() => document.querySelectorAll('#vtt-list .vtt-sub-text').length),
                    'this video was chosen because it loads a single language',
                ).toBe(0);

                await expect
                    .poll(
                        () =>
                            page.evaluate(() => ({
                                announced: document.getElementById('vtt-qm-dual')?.getAttribute('aria-disabled'),
                                inert: document.getElementById('vtt-qm-dual')?.disabled ?? null,
                            })),
                        { timeout: 45_000 },
                    )
                    .toEqual({ announced: 'true', inert: true });

                // Unavailable AND inert: pressing it must not leave the reader
                // in a mode whose second row has nothing to show.
                await page.evaluate(() => document.getElementById('vtt-qm-dual')?.click());
                await page.waitForTimeout(1500);
                expect(await page.evaluate(() => document.querySelectorAll('#vtt-list .vtt-sub-text').length)).toBe(0);
            } finally {
                await page.close().catch(() => {});
            }
        });
    });

    /**
     * Practice mode hides the later words of each line and keeps the first one
     * visible. Asserted as a relationship rather than as counts: the numbers
     * depend on the video, the rule does not.
     */
    test('practice mode hides words and keeps the first of each line visible', async ({ ext }) => {
        await preservingUiPrefs(ext, async () => {
            const page = await ext.open(VIDEO);
            try {
                const lines = await waitForLines(page);

                expect(
                    await page.evaluate(() => document.querySelectorAll('.vtt-masked-word').length),
                    'nothing should be hidden before practice mode is chosen',
                ).toBe(0);

                await page.evaluate(() => document.getElementById('vtt-qm-guess')?.click());

                await expect
                    .poll(() => page.evaluate(() => document.querySelectorAll('.vtt-masked-word').length), {
                        timeout: 30_000,
                    })
                    .toBeGreaterThan(0);

                const counts = await page.evaluate(() => ({
                    hidden: document.querySelectorAll('.vtt-masked-word').length,
                    shown: document.querySelectorAll('.vtt-revealed-word').length,
                }));

                // One word of every line is visible from the start, so a reader
                // always has somewhere to begin.
                expect(counts.shown).toBe(lines);
                expect(counts.hidden).toBeGreaterThan(counts.shown);
            } finally {
                await page.close().catch(() => {});
            }
        });
    });
});

test.describe('the side panel', () => {
    /**
     * Behaviour map §5. The class and the state announced to assistive
     * technology must move together — one changing without the other is a real
     * defect, and asserting only the visible half would miss it.
     */
    test('collapsing the panel changes both what is seen and what is announced', async ({ ext }) => {
        await preservingUiPrefs(ext, async () => {
            // Start from a KNOWN state. Reading `collapsed: false` as a given
            // made the outcome depend on whose profile ran it: expanded and it
            // passed, collapsed and it failed, and neither said anything about
            // the product.
            await writeUiPrefs(ext, { ...((await readUiPrefs(ext)) as object | null), sidebarCollapsed: false });

            const page = await ext.open(VIDEO);
            try {
                await waitForLines(page);

                const read = () =>
                    page.evaluate(() => ({
                        collapsed: document.getElementById('vtt-sidebar')?.classList.contains('collapsed') ?? null,
                        announced: document.getElementById('vtt-toggle-btn')?.getAttribute('aria-expanded'),
                    }));

                const before = await read();
                expect(before).toEqual({ collapsed: false, announced: 'true' });

                await page.evaluate(() => document.getElementById('vtt-toggle-btn')?.click());
                await expect.poll(read, { timeout: 20_000 }).toEqual({ collapsed: true, announced: 'false' });

                await page.evaluate(() => document.getElementById('vtt-toggle-btn')?.click());
                await expect.poll(read, { timeout: 20_000 }).toEqual({ collapsed: false, announced: 'true' });
            } finally {
                await page.close().catch(() => {});
            }
        });
    });

    /** The choice is remembered — closing the panel is not undone by a reload. */
    test('the collapsed choice survives a reload', async ({ ext }) => {
        await preservingUiPrefs(ext, async () => {
            // The single click below only collapses the panel if it started
            // expanded. Without setting that, the check asserted `collapsed`
            // after a click that may have EXPANDED an already-collapsed panel.
            await writeUiPrefs(ext, { ...((await readUiPrefs(ext)) as object | null), sidebarCollapsed: false });

            const page = await ext.open(VIDEO);
            try {
                await waitForLines(page);

                // The starting state the click depends on, named rather than assumed.
                expect(
                    await page.evaluate(
                        () => document.getElementById('vtt-sidebar')?.classList.contains('collapsed') ?? null,
                    ),
                    'the panel must start expanded for one click to collapse it',
                ).toBe(false);

                await page.evaluate(() => document.getElementById('vtt-toggle-btn')?.click());
                await expect
                    .poll(
                        () =>
                            page.evaluate(
                                () => document.getElementById('vtt-sidebar')?.classList.contains('collapsed') ?? null,
                            ),
                        { timeout: 20_000 },
                    )
                    .toBe(true);

                await page.reload({ waitUntil: 'domcontentloaded' });

                await expect
                    .poll(
                        () =>
                            page.evaluate(
                                () => document.getElementById('vtt-sidebar')?.classList.contains('collapsed') ?? null,
                            ),
                        { timeout: 60_000 },
                    )
                    .toBe(true);
            } finally {
                await page.close().catch(() => {});
            }
        });
    });
});

test.describe('keyboard shortcuts', () => {
    /**
     * Behaviour map §8. A shortcut that stops working says nothing — the button
     * still works, so nobody reports it. The assertion is that the key produces
     * the same state the button does.
     */
    test('the practice-mode shortcut does what its button does', async ({ ext }) => {
        await preservingUiPrefs(ext, async () => {
            const page = await ext.open(VIDEO);
            try {
                await waitForLines(page);

                // Establish what the BUTTON produces, and read the effect —
                // hidden words — rather than the control's own styling. The
                // effect is what a reader experiences; the styling is one
                // implementation of showing it.
                await page.evaluate(() => document.getElementById('vtt-qm-guess')?.click());
                await expect
                    .poll(() => page.evaluate(() => document.querySelectorAll('.vtt-masked-word').length), {
                        timeout: 30_000,
                    })
                    .toBeGreaterThan(0);

                // Leave practice mode the same way, and wait for it to be gone
                // before pressing the key. An earlier draft asserted on the
                // button's active class instead and was flaky, because the
                // class and the rendered words settle at different moments.
                await page.evaluate(() => document.getElementById('vtt-qm-dual')?.click());
                await expect
                    .poll(() => page.evaluate(() => document.querySelectorAll('.vtt-masked-word').length), {
                        timeout: 30_000,
                    })
                    .toBe(0);

                // The same effect, reached by the key.
                await page.evaluate(() => document.body.focus());
                await page.keyboard.down('Shift');
                await page.keyboard.press('KeyG');
                await page.keyboard.up('Shift');

                await expect
                    .poll(() => page.evaluate(() => document.querySelectorAll('.vtt-masked-word').length), {
                        timeout: 30_000,
                    })
                    .toBeGreaterThan(0);
            } finally {
                await page.close().catch(() => {});
            }
        });
    });
});

test.describe('the other two shortcuts', () => {
    /**
     * Behaviour map §8.3. Shift+D and Shift+O are advertised in the tooltips
     * of their buttons and nowhere else, so one that stopped working would go
     * unreported: the button still does the job, and nobody who never presses
     * the key would notice.
     *
     * Follows the pattern of the practice-mode check above — the key must
     * produce the same state the button produces, and produce it back again.
     */
    test('the two-language shortcut does what its button does', async ({ ext }) => {
        await preservingUiPrefs(ext, async () => {
            const page = await ext.open(VIDEO);
            try {
                await waitForLines(page);

                const dual = () =>
                    page.evaluate(
                        () => document.getElementById('vtt-qm-dual')?.classList.contains('active') ?? null,
                    );

                const pressDual = async () => {
                    await page.evaluate(() => document.body.focus());
                    await page.keyboard.down('Shift');
                    await page.keyboard.press('KeyD');
                    await page.keyboard.up('Shift');
                };

                // Establish what the BUTTON produces, from a known start: dual
                // is a toggle, so a blind press would assert against whichever
                // mode the person left the panel in.
                await page.evaluate(() => {
                    const btn = document.getElementById('vtt-qm-dual');
                    if (btn?.classList.contains('active')) document.getElementById('vtt-qm-single')?.click();
                });
                await expect.poll(dual, { timeout: 30_000 }).toBe(false);

                await page.evaluate(() => document.getElementById('vtt-qm-dual')?.click());
                await expect.poll(dual, { timeout: 30_000 }).toBe(true);

                // Leave it again, and reach the same state with the key.
                await page.evaluate(() => document.getElementById('vtt-qm-single')?.click());
                await expect.poll(dual, { timeout: 30_000 }).toBe(false);

                await pressDual();
                await expect.poll(dual, { timeout: 30_000 }).toBe(true);

                // And back — a shortcut that only switches one way is half a
                // shortcut, and §8 says both of these toggle.
                await pressDual();
                await expect.poll(dual, { timeout: 30_000 }).toBe(false);
            } finally {
                await page.close().catch(() => {});
            }
        });
    });

    /**
     * §8.3 again, for the on-screen captions. Read through the captions
     * themselves rather than the switch's styling: the control exists for the
     * captions, and a check on the class alone would pass against a toggle
     * that flips its own appearance and nothing else.
     */
    test('the on-screen shortcut does what its button does', async ({ ext }) => {
        await preservingUiPrefs(ext, async () => {
            const page = await ext.open(VIDEO);
            try {
                await waitForLines(page);
                await playFrom(page, 30);

                const captions = () =>
                    page.evaluate(() => {
                        const o = document.getElementById('vtt-video-overlay');
                        if (!o) return false;
                        return o.getClientRects().length > 0 && (o.textContent ?? '').trim().length > 0;
                    });

                // Start from captions on, whatever the person had.
                await page.evaluate(() => {
                    const btn = document.getElementById('vtt-qm-overlay');
                    if (btn && !btn.classList.contains('active')) btn.click();
                });
                await expect.poll(captions, { timeout: 60_000 }).toBe(true);

                const pressOverlay = async () => {
                    await page.evaluate(() => document.body.focus());
                    await page.keyboard.down('Shift');
                    await page.keyboard.press('KeyO');
                    await page.keyboard.up('Shift');
                };

                await pressOverlay();
                await expect.poll(captions, { timeout: 45_000 }).toBe(false);

                await pressOverlay();
                await expect.poll(captions, { timeout: 45_000 }).toBe(true);
            } finally {
                await page.close().catch(() => {});
            }
        });
    });
});
