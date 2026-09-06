/**
 * One video page per platform, shared across the checks that do not care how it
 * loaded.
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
 *
 * ## What is platform-specific here, and what is not
 *
 * Almost nothing. The panel, its screens, the transcript and the reading
 * surface are this extension's own markup and are cleaned identically on every
 * host. Only the HOST's chrome differs — theatre mode and the advert flag exist
 * on YouTube and not on Netflix — and that lives behind `Site` rather than in
 * this file. See fixtures/sites.ts.
 */
import { expect, type Page } from '@playwright/test';
import type { ExtensionHandle } from './extension';
import { waitForLines } from './subtitles';
import { DEFAULT_SITE, VIDEO_WITH_CAPTIONS, WATCH_URL, type Site } from './sites';

export { VIDEO_WITH_CAPTIONS, WATCH_URL };

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
 *    purpose;
 *  - the playback POSITION, which only some hosts allow resetting. Netflix
 *    destroys its player when seeked to 0, so `atStart` is contributed by
 *    `Site.cleanExtras` where it is achievable rather than demanded of every
 *    host. See `canRewind` in sites.ts.
 *
 * `watch` is not here either — whether the address is still the right one is
 * the host's own question, answered by `Site.isOurPage` before this is read.
 */
export const CLEAN = {
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
    adjusting: false,
    scrollY: 0,
    paused: true,
    selection: 0,
} as const;

export type PageState = Record<string, unknown>;

/** The clean state for one platform: the shared literal plus its own fields. */
export const cleanFor = (site: Site): PageState => ({ ...CLEAN, ...site.cleanExtras() });

/** Read the same shape off the live page. */
export async function pageState(page: Page, site: Site = DEFAULT_SITE): Promise<PageState> {
    const shared = await page.evaluate(() => {
        const sidebar = document.getElementById('vtt-sidebar');
        const v = document.querySelector('video');
        return {
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
            adjusting:
                document.getElementById('vtt-video-overlay')?.classList.contains('vtt-overlay-adjusting') ?? false,
            scrollY: Math.round(window.scrollY),
            paused: v?.paused ?? null,
            selection: window.getSelection()?.rangeCount ?? 0,
        };
    });
    return { ...shared, ...(await site.readExtras(page)) };
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
export async function normalise(page: Page, site: Site = DEFAULT_SITE): Promise<void> {
    // 1-3: the HOST's chrome — fullscreen everywhere, theatre and the advert
    // flag only where they exist. Two checks leave them behind when they fail
    // part-way. The theatre half runs LAST inside resetPlayerChrome for
    // YouTube's own reason; see sites.ts.
    await page.evaluate(() => {
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
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

    // The host's player view and playback go LAST, once the page has settled.
    //
    // Both were originally done first and both failed there, for the same
    // reason: the page had not finished applying its own state yet. Theatre is
    // a preference YouTube restores a moment after load, so a check for it on
    // arrival finds nothing and the click never happens; playback is started by
    // autoplay, so a pause on arrival is undone seconds later.
    await site.resetPlayerChrome(page);

    // Pause, and hold it: autoplay restarts the video, so this polls until the
    // pause sticks rather than issuing it once.
    //
    // Rewinding is asked of the host rather than done unconditionally. On
    // Netflix `currentTime = 0` tears the <video> element out of the page for
    // good — measured, videos: 1 -> 0 and never back — so the cleanup meant to
    // tidy the page was destroying it, and every later check on that page then
    // failed reading a player that no longer existed.
    await expect
        .poll(
            async () => {
                await page.evaluate((rewind) => {
                    const v = document.querySelector('video');
                    if (!v) return;
                    v.pause();
                    if (rewind && v.currentTime >= 1) v.currentTime = 0;
                }, site.canRewind);
                return page.evaluate(
                    (rewind) => {
                        const v = document.querySelector('video');
                        return {
                            paused: v?.paused ?? null,
                            ...(rewind ? { atStart: (v?.currentTime ?? 0) < 1 } : {}),
                        };
                    },
                    site.canRewind,
                );
            },
            { timeout: 20_000, message: 'the video would not stay paused' },
        )
        .toEqual(site.canRewind ? { paused: true, atStart: true } : { paused: true });
}

/**
 * The shared page for one platform, cleaned and verified, or a fresh one.
 *
 * Polls rather than samples: a previous check's preference restore reaches the
 * page through chrome.storage.onChanged and lands asynchronously, so a single
 * reading can catch the page mid-flight. Sampling after a fixed wait is the
 * mistake this suite has made twice already.
 */
export async function acquireClean(ext: ExtensionHandle, site: Site = DEFAULT_SITE): Promise<Page> {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
        const page = await ext.sharedFor(site).acquire();

        // Still the page we think it is? A check that navigated elsewhere, or a
        // reload of the extension that orphaned the content script, both land
        // here — and both mean this page cannot be cleaned, only replaced.
        //
        // WAITS for the panel rather than sampling for it. A page opened a
        // moment ago has not been injected into yet, and reading once would
        // call a perfectly good page unusable, throw it away, open another, and
        // read that one too early as well — the failure this cost a run to
        // find.
        if (!(await site.isOurPage(page))) {
            // Before calling this a bad page: did the HOST say why? Netflix
            // answers a second concurrent stream with an error page rather
            // than a player, and re-opening cannot fix that — it causes it.
            // Fail with the host's own reason instead of retrying into it.
            const refusal = await site.refusal(page);
            if (refusal) throw new Error(refusal);

            await ext.sharedFor(site).invalidate();
            continue;
        }

        try {
            await normalise(page, site);
            await expect
                .poll(() => pageState(page, site), { timeout: 20_000 })
                .toEqual(cleanFor(site));
            return page;
        } catch (error) {
            lastError = error;
            await ext.sharedFor(site).invalidate();
        }
    }

    // Not dirt any more. A page that will not come clean twice running is a
    // broken cleanup, a broken product, or a browser that stopped answering —
    // and saying which fields differ is what makes that answerable.
    throw new Error(
        `The shared ${site.name} page could not be normalised, twice running.\n` +
            `This is not a check's leftovers: a fresh page was loaded and failed the same way.\n\n${String(lastError)}`,
    );
}
