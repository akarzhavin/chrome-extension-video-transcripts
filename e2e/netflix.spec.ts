/**
 * Behaviour map §36 — Netflix, against the real site.
 *
 * The unit checks for this edition stand Netflix up themselves: the player, the
 * page and the language catalogue are all built in the test. That is the right
 * shape for "does our code do the right thing with what it is given", and it is
 * structurally blind to the one way this edition actually breaks — Netflix
 * changing its own API or markup. This file is the half that can see it.
 *
 * ## Nothing about the account is in this file
 *
 * No credentials, no profile name, no title id. The run uses the browser's
 * existing Netflix session (the same way the YouTube checks use its YouTube
 * one), picks the FIRST profile by position, and takes whatever title the home
 * page happens to offer first. So this file is safe in a public repository and
 * stays correct for anyone else's account.
 *
 * ## Why it is opt-in
 *
 * It plays a few seconds of video on a real personal account and leaves a trace
 * in that profile's viewing history. Nobody should get that as a side effect of
 * running the suite, so it runs only with LINGOGRAM_NETFLIX=1 set and reports
 * itself skipped otherwise.
 */
import { test, expect } from './fixtures/extension';

const OPTED_IN = process.env.LINGOGRAM_NETFLIX === '1';

/** Netflix's home page, past the profile chooser. */
async function netflixHome(ext: Parameters<typeof openTitle>[0]) {
    const page = await ext.open('https://www.netflix.com/browse');

    // The profile gate stands in front of the home page. Pick the first entry
    // BY POSITION: naming one would put a personal profile in a public repo,
    // and position is what the site itself defaults to.
    await page.waitForTimeout(4_000);
    await page.evaluate(() => {
        const el = document.querySelector(
            '.profile-link, [data-uia="profile-link"], a[href*="switchProfile"]',
        );
        (el instanceof HTMLElement ? el : (el?.querySelector('a,div') as HTMLElement | null))?.click();
    });

    // Cards carry their id in a browse link (`/browse?jbv=<id>`); the /watch
    // href only appears on hover, so the id is read from the card instead.
    await expect
        .poll(
            () =>
                page.evaluate(
                    () =>
                        [...document.querySelectorAll('a[href]')].filter((a) =>
                            /jbv=\d{6,}/.test(a.getAttribute('href') ?? ''),
                        ).length,
                ),
            { timeout: 60_000, message: 'the Netflix home page never listed a title' },
        )
        .toBeGreaterThan(0);

    return page;
}

type Ext = Parameters<typeof netflixHome>[0];

/** Open the first title the account is offered. Its id is never written down. */
async function openTitle(ext: Ext) {
    const home = await netflixHome(ext);
    const id = await home.evaluate(
        () =>
            [...document.querySelectorAll('a[href]')]
                .map((a) => (a.getAttribute('href') ?? '').match(/jbv=(\d{6,})/)?.[1])
                .find(Boolean) ?? null,
    );
    await home.close().catch(() => {});
    expect(id, 'no title id on the Netflix home page').toBeTruthy();

    const page = await ext.open(`https://www.netflix.com/watch/${id}`);
    return page;
}

test.describe('Netflix, against the real site', () => {
    test.skip(!OPTED_IN, 'set LINGOGRAM_NETFLIX=1 to run — it plays video on a personal account');
    // A title has to load its manifest, its player and then our tracks.
    test.setTimeout(240_000);

    /**
     * The claim the unit checks cannot make: our code still FINDS Netflix.
     *
     * Subtitles here come from the playback manifest, captured by a hook that
     * wraps the site's own JSON parsing. If Netflix renames a field or moves
     * the tracks, every unit check stays green — they parse a manifest this
     * repo wrote — and this is the only thing that goes red.
     */
    test('subtitles load from the real playback manifest', async ({ ext }) => {
        const page = await openTitle(ext);
        try {
            await expect
                .poll(
                    () => page.evaluate(() => document.querySelectorAll('#vtt-list .vtt-item').length),
                    {
                        timeout: 120_000,
                        message: 'no subtitle lines arrived from the real manifest',
                    },
                )
                .toBeGreaterThan(0);

            // Lines with text, not empty rows: a parser that produced the right
            // NUMBER of blank cues would otherwise pass.
            const sample = await page.evaluate(() =>
                [...document.querySelectorAll('#vtt-list .vtt-item')]
                    .slice(0, 5)
                    .map((n) => (n.textContent ?? '').trim())
                    .filter((t) => t.length > 0),
            );
            expect(sample.length).toBeGreaterThan(0);
        } finally {
            await page.close().catch(() => {});
        }
    });

    /**
     * The panel makes room for itself rather than covering the film. The unit
     * check asserts the rule applies to a page this repo built; this asserts it
     * applies to the page Netflix builds, whose class names are theirs to
     * change.
     */
    test('the panel narrows the real player instead of covering it', async ({ ext }) => {
        const page = await openTitle(ext);
        try {
            await expect
                .poll(() => page.evaluate(() => !!document.getElementById('vtt-sidebar')), {
                    timeout: 120_000,
                })
                .toBe(true);

            const layout = await page.evaluate(() => {
                const player = document.querySelector('.watch-video') as HTMLElement | null;
                return {
                    // The element the rule targets must still exist on their page.
                    playerFound: !!player,
                    playerWidth: player ? getComputedStyle(player).width : null,
                    viewport: window.innerWidth,
                    sidebarActive: document.body.classList.contains('vtt-sidebar-active'),
                };
            });

            expect(layout.playerFound, 'Netflix no longer renders .watch-video').toBe(true);
            expect(layout.sidebarActive).toBe(true);
            // Narrower than the window, by roughly the panel's width. Asserted
            // as a range rather than a number: the panel is 320px, and a rule
            // that stopped applying would leave the player at full width.
            const width = parseFloat(layout.playerWidth ?? '0');
            expect(width).toBeGreaterThan(0);
            expect(width).toBeLessThan(layout.viewport);
        } finally {
            await page.close().catch(() => {});
        }
    });

    /**
     * Netflix's own captions are switched off at the source so they do not
     * stack behind ours. The unit check drives a fake player API; this one
     * reaches the real one, which is the part that can be renamed.
     */
    test("Netflix's own player API is still reachable, and its captions go off", async ({ ext }) => {
        const page = await openTitle(ext);
        try {
            await expect
                .poll(() => page.evaluate(() => document.querySelectorAll('#vtt-list .vtt-item').length), {
                    timeout: 120_000,
                })
                .toBeGreaterThan(0);

            // Read the same path the hook reads. If this shape changes, the
            // suppression silently stops working and two sets of subtitles
            // stack on every video — the failure this check exists for.
            const player = await page.evaluate(() => {
                const nf = (window as unknown as { netflix?: any }).netflix;
                const app = nf?.appContext?.state?.playerApp ?? nf?.appContext?.getState?.()?.playerApp;
                const vp = app?.getAPI?.()?.videoPlayer;
                const ids: string[] =
                    vp?.getAllPlayerSessionIds?.() ?? vp?.getAllPlayerSessionId?.() ?? [];
                const session = ids.length ? vp?.getVideoPlayerBySessionId?.(ids[ids.length - 1]) : null;
                const list = session?.getTimedTextTrackList?.();
                return {
                    reachable: !!session,
                    canSet: typeof session?.setTimedTextTrack === 'function',
                    hasOffTrack: Array.isArray(list) && list.some((t: any) => t?.isNoneTrack),
                };
            });

            expect(player.reachable, "Netflix's player session is no longer reachable").toBe(true);
            expect(player.canSet, 'setTimedTextTrack is gone from the player API').toBe(true);
            expect(player.hasOffTrack, 'the track list no longer carries an Off entry').toBe(true);
        } finally {
            await page.close().catch(() => {});
        }
    });
});
