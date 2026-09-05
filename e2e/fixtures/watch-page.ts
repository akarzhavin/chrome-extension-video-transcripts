/**
 * One video page, shared across the checks that do not care how it loaded.
 *
 * The suite used to open a page per check — around 66 loads per run against a
 * real person's account. Most of them re-loaded the same video to look at a
 * panel that was already on screen.
 *
 * Sharing costs isolation, so it is bought back explicitly. Two mechanisms,
 * covering two different failures:
 *
 *  - A check that FAILS is handled by the runner: Playwright stops the worker
 *    on failure and starts a fresh one for the rest (verified in 1.62.1 at
 *    worker/workerProcessEntry.js:1684 and runner/index.js:5292), so a fresh
 *    handle and a fresh page follow a failure without anything here.
 *  - A check that PASSES but leaves the page dirty is handled below:
 *    `normalise` puts the page back to one canonical state, and `acquireClean`
 *    then ASSERTS that state before handing the page over. A cleanup nobody
 *    verifies is indistinguishable from no cleanup at all.
 */
import { expect, type Page } from '@playwright/test';
import type { ExtensionHandle } from './extension';
import { waitForLines } from './subtitles';

/**
 * A video whose captions are checked at the moment of use, never trusted from a
 * documented id: a video documented in this repo as reliably caption-free had
 * gained captions by the time it was checked.
 *
 * Declared HERE rather than in extension.ts, which re-exports it. The two
 * modules import each other, and a value read at module-evaluation time from
 * the far side of a cycle is `undefined` — which produced a shared page at
 * `?v=undefined` that then failed every usability check. Nothing in this file
 * reads a value from extension.ts at load time any more; only a type.
 */
export const VIDEO_WITH_CAPTIONS = 'aircAruvnKk';

export const WATCH_URL = `https://www.youtube.com/watch?v=${VIDEO_WITH_CAPTIONS}`;

/**
 * The state a check may assume, written out as a literal.
 *
 * Deliberately NOT computed from the page: an assertion has to be expressed in
 * terms the subject does not control, or it passes against anything. This is
 * the whole of Principle VII, and this suite has already shipped fifteen checks
 * that could not fail.
 *
 * Three things are absent on purpose:
 *  - the auto-scroll hover freeze, which lives in a variable rather than the
 *    DOM and is proven behaviourally in the self-check instead;
 *  - the reading mode, which belongs to whoever is running the suite and is not
 *    normalised (a check needing a specific mode establishes it);
 *  - the transcript's own scroll position, which releasing the freeze moves on
 *    purpose.
 */
export const CLEAN = {
    watch: true,
    sidebar: true,
    collapsed: false,
    settingsOpen: false,
    feedbackOpen: false,
    lookupOpen: false,
    strip: false,
    authPanel: false,
    swapped: false,
    onboarding: false,
    hasLines: true,
    fullscreen: false,
    adShowing: false,
    theatre: false,
    adjusting: false,
    scrollY: 0,
    paused: true,
    atStart: true,
    selection: 0,
} as const;

export type PageState = { [K in keyof typeof CLEAN]: (typeof CLEAN)[K] | unknown };

/** Read the same shape off the live page. */
export async function pageState(page: Page): Promise<PageState> {
    return page.evaluate((video) => {
        const sidebar = document.getElementById('vtt-sidebar');
        const v = document.querySelector('video');
        const player = document.getElementById('movie_player');
        const flexy = document.querySelector('ytd-watch-flexy');
        return {
            watch: location.pathname === '/watch' && location.search.includes(`v=${video}`),
            sidebar: !!sidebar,
            collapsed: sidebar?.classList.contains('collapsed') ?? null,
            settingsOpen: document.getElementById('vtt-settings-panel')?.classList.contains('open') ?? false,
            feedbackOpen: sidebar?.classList.contains('vtt-feedback-open') ?? null,
            lookupOpen: sidebar?.classList.contains('vtt-lookup-open') ?? null,
            strip: !!document.getElementById('lingogram-lookup-strip'),
            authPanel: !!document.getElementById('lingogram-auth-panel'),
            swapped: sidebar?.classList.contains('vtt-swapped') ?? null,
            onboarding: !!document.getElementById('vtt-lang-onboarding'),
            hasLines: document.querySelectorAll('#vtt-list .vtt-item').length > 0,
            fullscreen: !!document.fullscreenElement,
            adShowing: player?.classList.contains('ad-showing') ?? false,
            theatre: flexy?.hasAttribute('theater') ?? false,
            adjusting: document.getElementById('vtt-video-overlay')?.classList.contains('vtt-overlay-adjusting') ?? false,
            scrollY: Math.round(window.scrollY),
            paused: v?.paused ?? null,
            atStart: (v?.currentTime ?? 0) < 1,
            selection: window.getSelection()?.rangeCount ?? 0,
        };
    }, VIDEO_WITH_CAPTIONS);
}

/**
 * Put the page back to CLEAN.
 *
 * Every step corresponds to a leftover some check in this suite actually
 * leaves; none is speculative. Three orderings are load-bearing and were found
 * by reading the product rather than by guessing:
 *
 *  1. The selection is cleared BEFORE the dismissing press. The card's mouseup
 *     handler re-reads the selection (strip.ts:621), so a surviving range would
 *     re-open the card the press just closed.
 *  2. The word screen closes BEFORE the panel tab is touched. While
 *     .vtt-lookup-open is set, the tab acts as a close control for that screen
 *     (word-screen.ts:96), so clicking it to expand would do something else.
 *  3. Expanding a collapsed panel WRITES the preference (SidebarUI.ts:1655), so
 *     the run takes its own snapshot — see the ext fixture.
 *
 * Panels are closed through the product's own controls, never by deleting
 * nodes: removeStrip() also clears the anchor marks, releases a layout hold and
 * resumes a video the card paused (strip.ts:248), and none of that happens if
 * the element is simply removed.
 */
export async function normalise(page: Page): Promise<void> {
    // 1-3: player chrome. Fullscreen and theatre are the person's own view,
    // and two checks leave them behind when they fail part-way.
    await page.evaluate(() => {
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
        document.getElementById('movie_player')?.classList.remove('ad-showing');
    });
    // 4-5: the lookup card and the account panel. One press dismisses both —
    // they listen for the same outside mousedown.
    await page.evaluate(() => {
        window.getSelection()?.removeAllRanges();
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    // 6-10: the panel's own screens, outermost first.
    await page.evaluate(() => {
        const sidebar = document.getElementById('vtt-sidebar');
        const click = (id: string) => (document.getElementById(id) as HTMLElement | null)?.click();
        if (sidebar?.classList.contains('vtt-lookup-open')) click('vtt-lookup-back-btn');
        if (sidebar?.classList.contains('vtt-feedback-open')) click('vtt-feedback-back-btn');
        if (document.getElementById('vtt-settings-panel')?.classList.contains('open')) click('vtt-settings-btn');
        if (sidebar?.classList.contains('collapsed')) click('vtt-toggle-btn');
        if (sidebar?.classList.contains('vtt-swapped')) click('vtt-langpair');
    });

    // 11-13: the reading surface. The synthetic mouseenter one check dispatches
    // freezes auto-scroll and is never released, and the freeze is invisible in
    // the DOM — hence a plain mouseleave rather than an assertion.
    await page.evaluate(() => {
        document.getElementById('vtt-sidebar')?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
        window.scrollTo(0, 0);
    });

    // 15: subtitles must be back. A previous check's language-pair restore
    // triggers a full re-fetch, so this can take a while after one of those.
    await expect
        .poll(() => page.evaluate(() => !document.getElementById('vtt-lang-onboarding')), {
            timeout: 60_000,
            message: 'the first-run gate did not go away',
        })
        .toBe(true);
    await waitForLines(page);

    // Theatre and playback go LAST, once the page has settled.
    //
    // Both were originally done first and both failed there, for the same
    // reason: the page had not finished applying its own state yet. Theatre is
    // a preference YouTube restores a moment after load, so a check for it on
    // arrival finds nothing and the click never happens; playback is started by
    // autoplay, so a pause on arrival is undone seconds later. Measured: the
    // page reports `theater` present at 8s, and clicking `.ytp-size-button`
    // clears it within 2.5s.
    if (await page.evaluate(() => document.querySelector('ytd-watch-flexy')?.hasAttribute('theater') ?? false)) {
        await page.evaluate(() => (document.querySelector('.ytp-size-button') as HTMLElement | null)?.click());
        await expect
            .poll(() => page.evaluate(() => document.querySelector('ytd-watch-flexy')?.hasAttribute('theater')), {
                timeout: 15_000,
                message: 'the player stayed in theatre view',
            })
            .toBe(false);
    }

    // Pause and rewind, then hold it: autoplay restarts the video, so this
    // polls until the pause sticks rather than issuing it once.
    await expect
        .poll(
            async () => {
                await page.evaluate(() => {
                    const v = document.querySelector('video');
                    if (!v) return;
                    v.pause();
                    if (v.currentTime >= 1) v.currentTime = 0;
                });
                return page.evaluate(() => {
                    const v = document.querySelector('video');
                    return { paused: v?.paused ?? null, atStart: (v?.currentTime ?? 0) < 1 };
                });
            },
            { timeout: 20_000, message: 'the video would not stay paused at the start' },
        )
        .toEqual({ paused: true, atStart: true });
}

/**
 * The shared page, cleaned and verified, or a fresh one.
 *
 * Polls rather than samples: a previous check's preference restore reaches the
 * page through chrome.storage.onChanged and lands asynchronously, so a single
 * reading can catch the page mid-flight. Sampling after a fixed wait is the
 * mistake this suite has made twice already.
 */
export async function acquireClean(ext: ExtensionHandle): Promise<Page> {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
        const page = await ext.shared.acquire();

        // Still the page we think it is? A check that navigated elsewhere, or a
        // reload of the extension that orphaned the content script, both land
        // here — and both mean this page cannot be cleaned, only replaced.
        //
        // WAITS for the panel rather than sampling for it. A page opened a
        // moment ago has not been injected into yet, and reading once would
        // call a perfectly good page unusable, throw it away, open another, and
        // read that one too early as well — the failure this cost a run to
        // find. Both branches out of the wait are meaningful: the panel arrives
        // (usable), or it does not within the budget (genuinely orphaned).
        const usable = await page
            .waitForFunction(
                (video) =>
                    location.search.includes(`v=${video}`) && !!document.getElementById('vtt-sidebar'),
                VIDEO_WITH_CAPTIONS,
                { timeout: 60_000, polling: 250 },
            )
            .then(() => true)
            .catch(() => false);
        if (!usable) {
            await ext.shared.invalidate();
            continue;
        }

        try {
            await normalise(page);
            await expect
                .poll(() => pageState(page), { timeout: 20_000 })
                .toEqual(CLEAN);
            return page;
        } catch (error) {
            lastError = error;
            await ext.shared.invalidate();
        }
    }

    // Not dirt any more. A page that will not come clean twice running is a
    // broken cleanup, a broken product, or a browser that stopped answering —
    // and saying which fields differ is what makes that answerable.
    throw new Error(
        `The shared watch page could not be normalised, twice running.\n` +
            `This is not a check's leftovers: a fresh page was loaded and failed the same way.\n\n${String(lastError)}`,
    );
}
