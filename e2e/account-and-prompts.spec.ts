/**
 * Behaviour map §15 (being asked for a review), §23 (the toolbar popup),
 * §25 (the two indicators of account state), §27 (short videos with the panel
 * closed).
 *
 * None of these writes anything: the review card is driven by the diagnostic
 * switch, which shows it without spending its one-shot or touching the saved-
 * word count.
 */
import { test, expect } from './fixtures/extension';
import { preservingUiPrefs } from './fixtures/uiprefs';

const VIDEO = 'https://www.youtube.com/watch?v=aircAruvnKk';

test.describe('being asked for a review', () => {
    /**
     * Shown once per installation after five saved words. The switch renders it
     * without spending the one-shot, so this can run repeatedly against a real
     * account without ever consuming the single chance the product gets to ask.
     */
    test('the card appears, offers both answers, and asks nothing else', async ({ ext }) => {
        await preservingUiPrefs(ext, async () => {
            const page = await ext.open(`${VIDEO}#lingogram_rate=1`);
            try {
                await page.waitForFunction(() => !!document.getElementById('lingogram-rate-prompt'), null, {
                    timeout: 60_000,
                    polling: 250,
                });

                const card = await page.evaluate(() => {
                    const el = document.getElementById('lingogram-rate-prompt')!;
                    return {
                        title: el.querySelector('.lingogram-rate-title')?.textContent?.trim() ?? '',
                        actions: [...el.querySelectorAll('.lingogram-rate-action')].map(
                            (b) => b.textContent?.trim() ?? '',
                        ),
                    };
                });

                expect(card.title.length).toBeGreaterThan(0);
                // Both answers offered: a card that only offered the flattering
                // one would be a rating funnel, not a question.
                expect(card.actions.length).toBeGreaterThanOrEqual(2);
            } finally {
                await page.close().catch(() => {});
            }
        });
    });
});

test.describe('the account row', () => {
    /**
     * Behaviour map §25. Read-only: this asserts what the row says about the
     * state the browser is already in, and changes nothing.
     */
    test('the row states the account state and can be opened', async ({ ext, page }) => {
        await preservingUiPrefs(ext, async () => {
            await page.waitForFunction(() => !!document.querySelector('#lingogram-auth-badge .lingogram-auth-row'), null, {
                timeout: 60_000,
                polling: 250,
            });

            const row = () =>
                page.evaluate(() => {
                    const r = document.querySelector('#lingogram-auth-badge .lingogram-auth-row');
                    return r
                        ? { text: r.textContent?.trim() ?? '', expanded: r.getAttribute('aria-expanded') }
                        : null;
                });

            const before = await row();
            expect(before!.text.length).toBeGreaterThan(0);
            expect(before!.expanded).toBe('false');

            // The panel is REMOVED when closed rather than hidden, so its
            // presence is the state — asking whether it exists is the check.
            await page.evaluate(() =>
                (document.querySelector('#lingogram-auth-badge .lingogram-auth-row') as HTMLElement)?.click(),
            );
            await expect
                .poll(() => page.evaluate(() => !!document.getElementById('lingogram-auth-panel')), {
                    timeout: 20_000,
                })
                .toBe(true);
            await expect.poll(async () => (await row())!.expanded, { timeout: 20_000 }).toBe('true');

            // Pressing again closes it: the row is a toggle.
            await page.evaluate(() =>
                (document.querySelector('#lingogram-auth-badge .lingogram-auth-row') as HTMLElement)?.click(),
            );
            await expect
                .poll(() => page.evaluate(() => !!document.getElementById('lingogram-auth-panel')), {
                    timeout: 20_000,
                })
                .toBe(false);
        });
    });
});

test.describe("the extension's own popup", () => {
    /**
     * Behaviour map §23. The only place the languages can be changed after the
     * first run, so it is worth knowing it renders at all.
     *
     * Read-only: the language choices are NOT changed here, because they are
     * the person's own and this check has no business rewriting them.
     */
    test('the popup renders the account state and both language choosers', async ({ ext }) => {
        const page = await ext.open(`chrome-extension://${ext.id}/popup.html`);
        try {
            // It starts on a loading state and resolves — waiting for the
            // resolved shape rather than sampling, which would catch "Loading…".
            await page.waitForFunction(
                () => document.querySelectorAll('#root .lang-select').length === 2,
                null,
                { timeout: 30_000, polling: 250 },
            );

            const shape = await page.evaluate(() => ({
                languageChoosers: document.querySelectorAll('#root .lang-select').length,
                // Signed in shows an address; signed out offers to sign in.
                account:
                    !!document.querySelector('#root .email') || !!document.querySelector('#root .primary'),
                usageSwitch: !!document.querySelector('#root .toggle-box'),
            }));

            expect(shape).toEqual({ languageChoosers: 2, account: true, usageSwitch: true });
        } finally {
            await page.close().catch(() => {});
        }
    });
});

test.describe('short videos with the panel closed', () => {
    /**
     * Behaviour map §27. With the panel closed, nothing is fetched for a short
     * video until it is asked for — the offer stands in for the transcript.
     *
     * The notice element is shared by every message the panel shows, so this
     * asserts the OFFER — a control to start the search — rather than the
     * element's presence, which is true in half a dozen unrelated states.
     */
    test('nothing is fetched until asked, and the offer says so', async ({ ext }) => {
        await preservingUiPrefs(ext, async () => {
            const page = await ext.open(VIDEO);
            try {
                // Close the panel first: the offer only exists in that state.
                await page.waitForFunction(() => !!document.getElementById('vtt-toggle-btn'), null, {
                    timeout: 60_000,
                    polling: 250,
                });
                // Collapse only if it is open: the stored state carries over
                // between runs, and a blind click on an already-collapsed panel
                // opens it.
                await page.evaluate(() => {
                    const sb = document.getElementById('vtt-sidebar');
                    if (!sb?.classList.contains('collapsed')) document.getElementById('vtt-toggle-btn')?.click();
                });
                await expect
                    .poll(
                        () =>
                            page.evaluate(
                                () => document.getElementById('vtt-sidebar')?.classList.contains('collapsed') ?? null,
                            ),
                        { timeout: 20_000 },
                    )
                    .toBe(true);
                await page.close();

                // A short video, opened with the panel already closed.
                // Verified at the moment of use, not trusted from the id: some
                // /shorts/ addresses redirect to a normal watch page, where the
                // deferral correctly does not apply and this check would be
                // measuring nothing.
                const shorts = await ext.open('https://www.youtube.com/shorts/OboNFruntxU');
                try {
                    await shorts.waitForTimeout(12_000);

                    const state = await shorts.evaluate(() => {
                        const banner = document.getElementById('vtt-status');
                        return {
                            lines: document.querySelectorAll('#vtt-list .vtt-item').length,
                            offer: [...document.querySelectorAll('.vtt-empty-state-action')].map(
                                (b) => b.textContent?.trim() ?? '',
                            ),
                            title: banner?.querySelector('.vtt-empty-state-title')?.textContent?.trim() ?? null,
                        };
                    });

                    const stillAShort = await shorts.evaluate(() => location.pathname.startsWith('/shorts/'));
                    test.skip(!stillAShort, 'this address redirected to a watch page, where the deferral does not apply');

                    // A short whose captions the site does not serve reaches
                    // the no-subtitles state without the deferral being
                    // exercised at all. That is not this check's subject, so
                    // it declares itself unrun rather than passing on it.
                    const captionless = state.lines === 0 && state.offer.length === 0 && state.title !== null;
                    test.skip(captionless, `this short has no captions to defer (banner: ${state.title})`);

                    // The deferral itself: nothing was downloaded, and the
                    // offer says so. `lines === 0` is the assertion — accepting
                    // loaded lines here would pass on exactly the failure this
                    // check exists to catch.
                    expect(state.lines, 'a collapsed panel on a short must not fetch').toBe(0);
                    expect(state.offer.join(' ')).toMatch(/find subtitles/i);
                    expect(state.title).toMatch(/ready to load/i);
                } finally {
                    await shorts.close().catch(() => {});
                }
            } finally {
                // page already closed above in the happy path
            }
        });
    });
});
