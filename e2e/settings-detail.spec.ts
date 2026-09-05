/**
 * Behaviour map §11 (moving the captions), §20 (usage statistics), §21
 * (reporting a problem), §43 (accessibility touches), §50 (being offline).
 */
import { test, expect } from './fixtures/extension';
import { waitForLines, playFrom } from './fixtures/subtitles';
import { preservingUiPrefs, readUiPrefs, writeUiPrefs } from './fixtures/uiprefs';

const VIDEO = 'https://www.youtube.com/watch?v=aircAruvnKk';

const openSettings = (page: import('@playwright/test').Page) =>
    page.evaluate(() => document.getElementById('vtt-settings-btn')?.click());

test.describe('moving the captions', () => {
    /**
     * Behaviour map §11. The grip appears only while the settings screen is
     * open, so the captions cannot be dragged away by accident during ordinary
     * watching.
     *
     * The grip is kept in the page whether or not it is usable — the captions
     * are redrawn several times a second, and a control someone is holding
     * cannot be rebuilt under them. So its presence proves nothing and this
     * asserts what the stylesheet actually gates on.
     */
    test('the drag grip is only offered while the settings screen is open', async ({ ext, page }) => {
        await preservingUiPrefs(ext, async () => {
            await waitForLines(page);
            await playFrom(page, 30);
            await expect
                .poll(
                    () =>
                        page.evaluate(
                            () => (document.getElementById('vtt-video-overlay')?.textContent ?? '').trim(),
                        ),
                    { timeout: 45_000 },
                )
                .not.toBe('');

            const adjusting = () =>
                page.evaluate(
                    () =>
                        document
                            .getElementById('vtt-video-overlay')
                            ?.classList.contains('vtt-overlay-adjusting') ?? null,
                );

            expect(await adjusting(), 'captions must not be draggable during ordinary watching').toBe(false);

            await openSettings(page);
            await expect.poll(adjusting, { timeout: 30_000 }).toBe(true);

            // And the grip itself is genuinely reachable in that state,
            // rather than merely present-but-invisible.
            const usable = await page.evaluate(() => {
                const g = document.querySelector('.vtt-overlay-handle');
                return !!g && g.getClientRects().length > 0;
            });
            expect(usable).toBe(true);

            await openSettings(page);
            await expect.poll(adjusting, { timeout: 30_000 }).toBe(false);
        });
    });
});

test.describe('usage statistics', () => {
    /**
     * Behaviour map §20. The switch is a consent control, so what matters is
     * that a choice is offered and that it holds.
     *
     * The person's own choice is read, flipped, and put back — and the guard
     * restores their whole preference blob afterwards regardless.
     */
    test('the choice is offered and is remembered', async ({ ext, page }) => {
        await preservingUiPrefs(ext, async () => {
            await waitForLines(page);
            await openSettings(page);

            await page.waitForFunction(() => !!document.getElementById('vtt-analytics-toggle'), null, {
                timeout: 30_000,
                polling: 250,
            });

            const value = () =>
                page.evaluate(
                    () => (document.getElementById('vtt-analytics-toggle') as HTMLInputElement | null)?.checked ?? null,
                );

            const before = await value();
            expect(before).not.toBeNull();

            await page.evaluate(() => {
                const box = document.getElementById('vtt-analytics-toggle') as HTMLInputElement;
                box.click();
            });
            await expect.poll(value, { timeout: 20_000 }).toBe(!before);

            // It survives a reload, which is what makes it a choice rather
            // than a switch that forgets.
            await page.reload({ waitUntil: 'domcontentloaded' });
            await waitForLines(page);
            await openSettings(page);
            await page.waitForFunction(() => !!document.getElementById('vtt-analytics-toggle'), null, {
                timeout: 30_000,
                polling: 250,
            });
            expect(await value()).toBe(!before);
        });
    });
});

test.describe('reporting a problem', () => {
    /** Behaviour map §21. The form opens over the settings screen and comes back. */
    test('the form opens from settings and can be left again', async ({ ext, page }) => {
        await preservingUiPrefs(ext, async () => {
            await waitForLines(page);
            await openSettings(page);

            await page.waitForFunction(() => !!document.getElementById('vtt-feedback-link'), null, {
                timeout: 30_000,
                polling: 250,
            });

            const formVisible = () =>
                page.evaluate(
                    () => (document.getElementById('vtt-feedback-panel')?.getClientRects().length ?? 0) > 0,
                );

            expect(await formVisible()).toBe(false);

            await page.evaluate(() => document.getElementById('vtt-feedback-link')?.click());
            await expect.poll(formVisible, { timeout: 30_000 }).toBe(true);

            // There is a way back — a screen with no exit is a trap.
            await page.evaluate(() => document.getElementById('vtt-feedback-back-btn')?.click());
            await expect.poll(formVisible, { timeout: 30_000 }).toBe(false);
        });
    });
});

test.describe('being offline', () => {
    /**
     * Behaviour map §50, a KNOWN GAP pinned rather than fixed: losing the
     * network is not distinguished from any other recoverable failure. This
     * asserts today's behaviour so that adding a proper offline message is a
     * deliberate change rather than an accident.
     */
    test('losing the network produces the ordinary recoverable notice, not a special one', async ({ ext }) => {
        await preservingUiPrefs(ext, async () => {
            const page = await ext.open('about:blank');
            try {
                const cdp = await page.context().newCDPSession(page);
                await cdp.send('Network.enable');
                await cdp.send('Network.emulateNetworkConditions', {
                    offline: true,
                    latency: 0,
                    downloadThroughput: -1,
                    uploadThroughput: -1,
                });

                try {
                    await page.goto(VIDEO, { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => {});
                    await page.waitForTimeout(5000);

                    // Offline is not called out anywhere: the product folds it
                    // into its ordinary failure handling. Two things have to be
                    // true for that to mean anything, and the second was
                    // missing: `?? ''` made a MISSING status element satisfy
                    // the regex test, so this passed on a page where the panel
                    // never rendered at all — including a wholly broken build.
                    const status = await page.evaluate(
                        () => document.getElementById('vtt-status')?.textContent ?? null,
                    );
                    expect(
                        status,
                        'the panel must still render its status area while offline',
                    ).not.toBeNull();
                    expect(
                        /offline|no internet|not connected/i.test(status!),
                        'today nothing distinguishes being offline — if this now says so, the gap was closed and this check should be updated deliberately',
                    ).toBe(false);
                } finally {
                    await cdp.send('Network.emulateNetworkConditions', {
                        offline: false,
                        latency: 0,
                        downloadThroughput: -1,
                        uploadThroughput: -1,
                    });
                }
            } finally {
                await page.close().catch(() => {});
            }
        });
    });
});

/**
 * The option sets the style rows are built from — behaviour map §10.16,
 * §10.18, §10.20, §10.21, §10.22.
 *
 * These count what the panel RENDERS. Their unit twin
 * (packages/shared/tests/overlay-style.test.ts) pins the same counts against
 * the constants; that one can be made red, this one confirms the panel
 * actually draws from them. A row silently rendering four of five swatches
 * passes the twin and fails here.
 *
 * Rows carry no ids of their own — the two containers do, and the rows sit
 * inside them in build order (SidebarUI.buildTextStyleControls /
 * buildBoxStyleControls). Addressed by container and position rather than by
 * a guessed selector.
 */
const TEXT_ROWS = '#vtt-style-controls-text .vtt-style-row';
const BOX_ROWS = '#vtt-style-controls-box .vtt-style-row';

/** Open settings only if they are closed — the gear is a toggle, and a blind
 *  click on an already-open panel closes it. */
const ensureSettingsOpen = async (page: import('@playwright/test').Page) => {
    await page.waitForFunction(() => !!document.getElementById('vtt-settings-btn'), null, {
        timeout: 30_000,
        polling: 250,
    });
    await page.evaluate(() => {
        const panel = document.getElementById('vtt-settings-panel');
        if (!panel?.classList.contains('open')) document.getElementById('vtt-settings-btn')?.click();
    });
    await page.waitForFunction(
        () => document.getElementById('vtt-settings-panel')?.classList.contains('open') === true,
        null,
        { timeout: 30_000, polling: 250 },
    );
};

const ensureSettingsClosed = async (page: import('@playwright/test').Page) => {
    await page.evaluate(() => {
        const panel = document.getElementById('vtt-settings-panel');
        if (panel?.classList.contains('open')) document.getElementById('vtt-settings-btn')?.click();
    });
};

test.describe('the style rows and what they offer', () => {
    /**
     * §10.16. Seven typefaces, the CEA-708 set. The values matter as much as
     * the count: the dropdown drives OVERLAY_FONT_STACK by key, so an option
     * whose value is not a key renders in whatever font the browser defaults
     * to, silently.
     */
    test('the typeface list offers the seven CEA-708 classes', async ({ ext, page }) => {
        await preservingUiPrefs(ext, async () => {
            await waitForLines(page);
            await ensureSettingsOpen(page);

            const values = await page.evaluate(() => {
                const sel = document.getElementById('vtt-style-font-select') as HTMLSelectElement | null;
                return sel ? [...sel.options].map((o) => o.value) : null;
            });

            expect(values).not.toBeNull();
            expect(values).toHaveLength(7);
            expect([...values!].sort()).toEqual(
                ['casual', 'cursive', 'monoSans', 'monoSerif', 'propSans', 'propSerif', 'smallCaps'].sort(),
            );

            await ensureSettingsClosed(page);
        });
    });

    /**
     * §10.18 and §10.20. Both text colour rows carry the same five presets
     * plus one custom well — and they are two separate rows, not one row read
     * twice. Visibility is asserted rather than presence: a swatch rendered
     * with no size is a colour nobody can pick.
     *
     * Row order inside #vtt-style-controls-text: font (a -wide row, not
     * matched here), size, colour, translation size, translation colour,
     * opacity. So the swatch rows are the .vtt-style-row entries at index 1
     * and 3 — but they are located by carrying swatches rather than by index,
     * which survives a row being added above them.
     */
    test('both text colour rows carry five swatches and a custom well', async ({ ext, page }) => {
        await preservingUiPrefs(ext, async () => {
            await waitForLines(page);
            await ensureSettingsOpen(page);

            const rows = await page.evaluate((sel) => {
                const visible = (el: Element) => el.getClientRects().length > 0;
                return [...document.querySelectorAll(sel)]
                    .filter((row) => row.querySelector('.vtt-swatch'))
                    .map((row) => ({
                        presets: [...row.querySelectorAll('.vtt-swatch:not(.vtt-swatch-custom)')].length,
                        presetsVisible: [...row.querySelectorAll('.vtt-swatch:not(.vtt-swatch-custom)')].filter(
                            visible,
                        ).length,
                        wells: [...row.querySelectorAll('.vtt-swatch-custom')].length,
                        wellsVisible: [...row.querySelectorAll('.vtt-swatch-custom')].filter(visible).length,
                    }));
            }, TEXT_ROWS);

            // Two rows: the main line's colour and the translation's.
            expect(rows).toHaveLength(2);
            for (const row of rows) {
                expect(row.presets).toBe(5);
                expect(row.presetsVisible).toBe(5);
                expect(row.wells).toBe(1);
                expect(row.wellsVisible).toBe(1);
            }

            // And they are genuinely distinct elements — one row queried
            // twice would satisfy every count above.
            const distinct = await page.evaluate((sel) => {
                const swatchRows = [...document.querySelectorAll(sel)].filter((r) =>
                    r.querySelector('.vtt-swatch'),
                );
                return swatchRows.length === 2 && swatchRows[0] !== swatchRows[1];
            }, TEXT_ROWS);
            expect(distinct).toBe(true);

            await ensureSettingsClosed(page);
        });
    });

    /**
     * §10.21. Four opacity steps, reading 25/50/75/100 — the numbers are the
     * control's whole legend, so a row of four unlabelled buttons would be
     * unusable and would pass a count-only check.
     */
    test('the opacity row offers exactly four labelled steps', async ({ ext, page }) => {
        await preservingUiPrefs(ext, async () => {
            await waitForLines(page);
            await ensureSettingsOpen(page);

            const steps = await page.evaluate((sel) => {
                const row = [...document.querySelectorAll(sel)].find((r) =>
                    [...r.querySelectorAll('.vtt-seg-btn')].some((b) => /%$/.test(b.textContent ?? '')),
                );
                if (!row) return null;
                return [...row.querySelectorAll('.vtt-seg-btn')].map((b) => ({
                    value: (b as HTMLElement).dataset.value ?? null,
                    text: (b.textContent ?? '').trim(),
                }));
            }, TEXT_ROWS);

            expect(steps).not.toBeNull();
            expect(steps!.map((s) => s.value)).toEqual(['25', '50', '75', '100']);
            expect(steps!.map((s) => s.text)).toEqual(['25%', '50%', '75%', '100%']);

            await ensureSettingsClosed(page);
        });
    });

    /**
     * §10.22. The box group: five background colours, three positions, three
     * edge styles — and in each row exactly one option is marked as the
     * current one. A group with no active segment leaves the reader unable to
     * tell what is set; two active segments is the same failure seen from the
     * other side.
     */
    test('the box rows offer five colours, three positions and three edges, each showing its current value', async ({
        ext,
        page,
    }) => {
        await preservingUiPrefs(ext, async () => {
            await waitForLines(page);
            await ensureSettingsOpen(page);

            const shape = await page.evaluate((sel) => {
                const rows = [...document.querySelectorAll(sel)];
                const swatchRow = rows.find((r) => r.querySelector('.vtt-swatch'));
                const segRows = rows.filter((r) => r.querySelector('.vtt-seg-btn'));
                return {
                    colours: swatchRow
                        ? [...swatchRow.querySelectorAll('.vtt-swatch:not(.vtt-swatch-custom)')].length
                        : null,
                    // Backdrop / position / edge, in build order.
                    segs: segRows.map((r) => ({
                        options: [...r.querySelectorAll('.vtt-seg-btn')].length,
                        active: [...r.querySelectorAll('.vtt-seg-btn.active')].length,
                        values: [...r.querySelectorAll('.vtt-seg-btn')].map(
                            (b) => (b as HTMLElement).dataset.value ?? '',
                        ),
                    })),
                    colourActive: swatchRow
                        ? [...swatchRow.querySelectorAll('.vtt-swatch.active')].length
                        : null,
                };
            }, BOX_ROWS);

            expect(shape.colours).toBe(5);

            // Backdrop is four (Off is a real transparent box, not a step),
            // then position and edge at three each.
            expect(shape.segs.map((s) => s.options)).toEqual([4, 3, 3]);
            expect(shape.segs[0].values).toEqual(['off', 'low', 'medium', 'high']);
            expect(shape.segs[1].values).toEqual(['low', 'medium', 'high']);
            expect(shape.segs[2].values).toEqual(['none', 'shadow', 'outline']);

            // Exactly one current value per row — including the colour row,
            // where the custom well counts as the active one when the
            // chosen colour is outside the five presets.
            for (const seg of shape.segs) expect(seg.active).toBe(1);
            expect(shape.colourActive).toBe(1);

            await ensureSettingsClosed(page);
        });
    });

    /**
     * §10.9. The grip is a button with no visible text — the only thing
     * naming it is its label, and without one a screen reader announces an
     * unlabelled button on the one control that moves the captions.
     *
     * Asserted while settings are open, which is the only state the grip is
     * usable in (see the check at the top of this file).
     */
    test('the drag grip carries a name', async ({ ext, page }) => {
        await preservingUiPrefs(ext, async () => {
            await waitForLines(page);
            await playFrom(page, 30);
            await ensureSettingsOpen(page);

            await page.waitForFunction(() => !!document.querySelector('.vtt-overlay-handle'), null, {
                timeout: 45_000,
                polling: 250,
            });

            const name = await page.evaluate(() => {
                const g = document.querySelector('.vtt-overlay-handle');
                if (!g) return null;
                return {
                    aria: g.getAttribute('aria-label'),
                    title: g.getAttribute('title'),
                    text: (g.textContent ?? '').trim(),
                };
            });

            expect(name).not.toBeNull();
            // The label is localised, so the assertion is that a name
            // exists and that the two ways of carrying one agree — not
            // that it reads any particular English words.
            expect((name!.aria ?? '').length).toBeGreaterThan(0);
            expect(name!.title).toBe(name!.aria);
            // It is a name, not visible text: an icon button.
            expect(name!.text).toBe('');

            await ensureSettingsClosed(page);
        });
    });
});

test.describe('the caption stand-in while styling', () => {
    /**
     * §10.8. With settings open there must always be a caption block to aim
     * at, even when the video has nothing to show. Two corrections to the
     * claim as written, both verified against the code and then in the
     * browser:
     *
     * - "no line under the playhead" is not enough. The product prefers the
     *   nearest REAL line and falls back to the neutral stand-in only when
     *   there is no track at all (previewSubtitleFor), so the track-less state
     *   is driven deliberately with the diagnostic flag — a real refusal from
     *   YouTube would block every other check for hours.
     * - the mode cannot be set through the Dual button here. With no tracks
     *   loaded that control is aria-disabled and its handler returns early
     *   (measured: dualDisabled true, the mode never changed). The mode is a
     *   stored preference, and hydrateFromPrefs adopts it without consulting
     *   availability, so it is written before the page opens.
     *
     * The guard restores the person's own preferences either way.
     */
    const standInModes = async (
        ext: import('./fixtures/extension').ExtensionHandle,
        mode: 'dual' | 'single',
    ) => {
        const original = await readUiPrefs(ext);
        await writeUiPrefs(ext, {
            ...(original && typeof original === 'object' ? original : {}),
            displayMode: mode,
            overlayEnabled: true,
        });

        const page = await ext.open(`${VIDEO}#lingogram_http=403`);
        try {
            // Wait for the failure to settle, so this observes a genuinely
            // track-less state rather than one still loading.
            await page.waitForFunction(
                () => {
                    const t =
                        document.getElementById('vtt-status')?.querySelector('.vtt-empty-state-title')
                            ?.textContent ?? '';
                    return t.length > 0 && !/Searching/i.test(t);
                },
                null,
                { timeout: 120_000, polling: 250 },
            );

            await ensureSettingsOpen(page);

            const stand = () =>
                page.evaluate(() => {
                    const shown = (el: Element | null) =>
                        !!el && el.getClientRects().length > 0 && (el.textContent ?? '').trim().length > 0;
                    return {
                        main: shown(document.querySelector('.vtt-overlay-main.vtt-overlay-placeholder')),
                        sub: shown(document.querySelector('.vtt-overlay-sub.vtt-overlay-placeholder')),
                    };
                });

            // The main stand-in first: without it there is no block at all and
            // the second line's absence would mean nothing.
            await expect.poll(stand, { timeout: 60_000 }).toEqual(
                mode === 'dual' ? { main: true, sub: true } : { main: true, sub: false },
            );

            await ensureSettingsClosed(page);
        } finally {
            await page.close().catch(() => {});
            await writeUiPrefs(ext, original).catch(() => {});
        }
    };

    test('in dual mode the stand-in shows its second line', async ({ ext }) => {
        await preservingUiPrefs(ext, () => standInModes(ext, 'dual'));
    });

    /** The other half: single mode is one line, and never grows a second. */
    test('in single mode the stand-in stays one line', async ({ ext }) => {
        await preservingUiPrefs(ext, () => standInModes(ext, 'single'));
    });
});

test.describe('resetting the text appearance', () => {
    /**
     * §10.26. Reset restores the sizes a fresh install sees ON THIS SITE —
     * 160% and 110% on YouTube, not the generic 100/75. An audit reported this
     * as a defect; it is not, and the reason the report was believable is that
     * every unit test of the reset ran in the scope where the two numbers
     * coincide. Its twin now runs in the youtube scope
     * (packages/shared/tests/SidebarUI.test.ts); this is the same claim
     * observed on the real site.
     *
     * The sliders are the reader's view of those numbers, so they are what is
     * read — a stored value nobody rendered would still leave the panel
     * showing 90%.
     */
    test('reset restores the site\'s larger starting sizes, not the generic ones', async ({ ext, page }) => {
        await preservingUiPrefs(ext, async () => {
            await waitForLines(page);
            await ensureSettingsOpen(page);

            await page.waitForFunction(() => !!document.getElementById('vtt-slider-size'), null, {
                timeout: 30_000,
                polling: 250,
            });

            const sizes = () =>
                page.evaluate(() => ({
                    main: (document.getElementById('vtt-slider-size') as HTMLInputElement | null)?.value ?? null,
                    sub:
                        (document.getElementById('vtt-slider-sub-size') as HTMLInputElement | null)?.value ??
                        null,
                }));

            // Let hydration finish first. loadPrefs is async and
            // markActiveStyleButtons rewrites the slider from storage when
            // it lands — a value set before that arrives is overwritten,
            // and the check then compares the person's own size against 90
            // (measured: it read back 165).
            await expect
                .poll(
                    async () => {
                        const a = await sizes();
                        await page.waitForTimeout(700);
                        const b = await sizes();
                        return a.main === b.main && a.sub === b.sub && a.main !== null;
                    },
                    { timeout: 30_000 },
                )
                .toBe(true);

            // Move both away from wherever the person had them, through the
            // control itself rather than storage — this is the path a reset
            // has to undo.
            await page.evaluate(() => {
                for (const [id, v] of [
                    ['vtt-slider-size', '90'],
                    ['vtt-slider-sub-size', '90'],
                ] as const) {
                    const el = document.getElementById(id) as HTMLInputElement;
                    el.value = v;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                }
            });
            await expect.poll(sizes, { timeout: 20_000 }).toEqual({ main: '90', sub: '90' });

            // The Text group's own Reset — located by the group that holds
            // the text controls, since both groups' buttons share a class.
            const pressed = await page.evaluate(() => {
                const group = document
                    .getElementById('vtt-style-controls-text')
                    ?.closest('.vtt-group');
                const btn = group?.querySelector('.vtt-reset') as HTMLButtonElement | null;
                if (!btn) return false;
                btn.click();
                return true;
            });
            expect(pressed, 'no Reset button in the Text group').toBe(true);

            await expect.poll(sizes, { timeout: 20_000 }).toEqual({ main: '160', sub: '110' });

            await ensureSettingsClosed(page);
        });
    });
});
