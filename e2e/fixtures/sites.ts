/**
 * What differs between platforms, and nothing else.
 *
 * The checks in this suite are written against `#vtt-sidebar`, `#vtt-list`,
 * `#vtt-qm-guess` and the rest — this extension's OWN markup, which is byte for
 * byte the same on every host. So a check does not need a platform abstraction
 * to make its assertions; it needs one only to reach a page, and to put that
 * page back the way it found it.
 *
 * That is the whole of this interface, and it is why the checks that run on two
 * platforms are ONE check parameterised rather than two copies. A copy per
 * platform would double the maintenance of assertions that were never
 * platform-specific in the first place, and the two copies would drift.
 *
 * Adding a platform means adding an entry here. Every check written against
 * `SITES` then runs on it without being edited.
 */
import { expect, type Page } from '@playwright/test';
import type { ExtensionHandle } from './extension';

export interface Site {
    /** Shown in the check's name, so a failure says which platform failed. */
    readonly name: string;

    /**
     * Why this platform cannot run here, or null when it can.
     *
     * Netflix plays video on a real personal account and leaves a trace in its
     * viewing history, so it is opt-in; Rezka is region-blocked. A platform
     * that cannot run reports itself skipped rather than failing, which is the
     * difference between "not checked" and "broken".
     */
    skipReason(): string | null;

    /** Open a page that is playing something with subtitles. */
    open(ext: ExtensionHandle): Promise<Page>;

    /**
     * The host refused to play, in its own words — or null when it did not.
     *
     * Netflix allows one stream per account at a time and answers a second one
     * with "Pardon the interruption" (error M7375) instead of a player. That
     * page has no <video> and no subtitles, so every check on it fails saying
     * the panel stayed empty — which reads as a defect in this extension and
     * is not one.
     *
     * Naming the refusal turns a misleading failure into an accurate one. It
     * is not skipped: a second stream means the run opened a tab it should not
     * have, and that is worth failing over.
     */
    refusal(page: Page): Promise<string | null>;

    /**
     * Is this still the page we opened, and did the extension attach?
     *
     * Checked before a shared page is handed to the next check. On YouTube the
     * address carries the video id; on Netflix it carries a title id that is
     * deliberately never written down (see `open`), so the two cannot share one
     * expression.
     */
    isOurPage(page: Page): Promise<boolean>;

    /**
     * Put the HOST's own chrome back: fullscreen views, theatre mode, the
     * advert flag. The extension's own state is normalised the same way
     * everywhere and lives in `watch-page.ts`.
     */
    resetPlayerChrome(page: Page): Promise<void>;

    /**
     * The element that goes fullscreen — the host's player container.
     *
     * A CSS selector rather than a handle, because it is used inside
     * page.evaluate. This is the one place a check must name something of the
     * host's, and naming it here keeps the check itself platform-free.
     */
    readonly playerSelector: string;

    /**
     * Drive playback to a position, in whatever way this host survives.
     *
     * MEASURED: on Netflix ANY write to `video.currentTime` — forward or back —
     * makes the player tear the <video> element out of the page for good
     * (videos: 1 -> 0, permanently). Its own player API seeks without that:
     * the element stays, time advances, the transcript follows. So the gesture
     * that means "play from here" is the host's to define.
     */
    playFrom(page: Page, seconds: number): Promise<void>;

    /**
     * May the shared page be rewound to the start between checks?
     *
     * MEASURED, not assumed. On Netflix `video.currentTime = 0` makes the
     * player tear the <video> element out of the page and never put it back
     * (videos: 1 -> 0, permanently), so the cleanup that was meant to hand the
     * next check a tidy page was destroying it instead — and the run then read
     * `paused: null`, called the page unusable and re-opened it. Pausing is
     * fine; only the seek is fatal.
     *
     * YouTube has no such objection, and rewinding there is worth keeping: a
     * check that reads the first lines of the transcript should not inherit
     * the previous check's playback position.
     */
    readonly canRewind: boolean;

    /** Host-owned parts of the clean state, merged into the shared literal. */
    cleanExtras(): Record<string, unknown>;

    /** Read those same fields off the live page. */
    readExtras(page: Page): Promise<Record<string, unknown>>;
}

/**
 * A video whose captions are checked at the moment of use, never trusted from a
 * documented id: a video documented in this repo as reliably caption-free had
 * gained captions by the time it was checked.
 */
export const VIDEO_WITH_CAPTIONS = 'aircAruvnKk';
export const WATCH_URL = `https://www.youtube.com/watch?v=${VIDEO_WITH_CAPTIONS}`;

const youtube: Site = {
    name: 'YouTube',
    skipReason: () => null,
    open: (ext) => ext.open(WATCH_URL),

    isOurPage: (page) =>
        page
            .waitForFunction(
                (video) => location.search.includes(`v=${video}`) && !!document.getElementById('vtt-sidebar'),
                VIDEO_WITH_CAPTIONS,
                { timeout: 60_000, polling: 250 },
            )
            .then(() => true)
            .catch(() => false),

    /**
     * Theatre goes LAST and is polled, not clicked blindly: it is a preference
     * YouTube restores a moment AFTER load, so a check for it on arrival finds
     * nothing and the click never happens. Measured — the page reports
     * `theater` at 8s, and the click clears it within 2.5s.
     */
    async resetPlayerChrome(page) {
        await page.evaluate(() => {
            if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
            document.getElementById('movie_player')?.classList.remove('ad-showing');
        });

        const inTheatre = () =>
            page.evaluate(() => document.querySelector('ytd-watch-flexy')?.hasAttribute('theater') ?? false);
        if (await inTheatre()) {
            await page.evaluate(() => (document.querySelector('.ytp-size-button') as HTMLElement | null)?.click());
            await expect
                .poll(inTheatre, { timeout: 15_000, message: 'the player stayed in theatre view' })
                .toBe(false);
        }
    },

    playerSelector: '#movie_player',
    canRewind: true,

    // YouTube has no per-account stream limit, so nothing to recognise.
    refusal: async () => null,

    playFrom: async (page, seconds) => {
        await page.evaluate((t) => {
            const v = document.querySelector('video') as HTMLVideoElement | null;
            if (!v) throw new Error('no video element on the page');
            v.muted = true;
            v.currentTime = t;
            void v.play();
        }, seconds);
    },

    // `atStart` is asserted here rather than in the shared literal because it
    // is only achievable where rewinding is — see `canRewind`.
    cleanExtras: () => ({ adShowing: false, theatre: false, atStart: true }),

    readExtras: (page) =>
        page.evaluate(() => ({
            adShowing: document.getElementById('movie_player')?.classList.contains('ad-showing') ?? false,
            theatre: document.querySelector('ytd-watch-flexy')?.hasAttribute('theater') ?? false,
            atStart: (document.querySelector('video')?.currentTime ?? 0) < 1,
        })),
};

const netflix: Site = {
    name: 'Netflix',
    skipReason: () =>
        process.env.LINGOGRAM_NETFLIX === '1'
            ? null
            : 'set LINGOGRAM_NETFLIX=1 — it plays video on a personal account',

    /**
     * Netflix takes three steps where YouTube takes one: a profile has to be
     * chosen, and a title id has to be found, because the home page does not
     * link to /watch/ until a card is hovered.
     *
     * Nothing about the account is written down: the FIRST profile is taken by
     * position rather than by name, and the first title the home page offers is
     * taken as it comes. So this stays correct for anyone else's account and
     * carries nothing personal into a public repository.
     */
    open: async (ext) => {
        const home = await ext.open('https://www.netflix.com/browse');
        try {
            await home.waitForTimeout(4_000);
            await home.evaluate(() => {
                const el = document.querySelector(
                    '.profile-link, [data-uia="profile-link"], a[href*="switchProfile"]',
                );
                (el instanceof HTMLElement
                    ? el
                    : (el?.querySelector('a,div') as HTMLElement | null)
                )?.click();
            });

            // Cards carry their id in a browse link (`/browse?jbv=<id>`).
            const id = await home
                .waitForFunction(
                    () =>
                        [...document.querySelectorAll('a[href]')]
                            .map((a) => (a.getAttribute('href') ?? '').match(/jbv=(\d{6,})/)?.[1])
                            .find(Boolean) ?? false,
                    null,
                    { timeout: 60_000, polling: 500 },
                )
                .then((h) => h.jsonValue() as Promise<string>);

            return await ext.open(`https://www.netflix.com/watch/${id}`);
        } finally {
            await home.close().catch(() => {});
        }
    },

    /**
     * Any /watch/ page, with no id named. Which title the account was offered
     * is not knowledge this file may hold — see `open`.
     */
    isOurPage: (page) =>
        page
            .waitForFunction(
                () => /netflix\.com\/watch\//.test(location.href) && !!document.getElementById('vtt-sidebar'),
                null,
                { timeout: 60_000, polling: 250 },
            )
            .then(() => true)
            .catch(() => false),

    /**
     * Netflix has no theatre mode and no advert class of its own — its player
     * IS the page. Only fullscreen can be left behind.
     */
    resetPlayerChrome: async (page) => {
        await page.evaluate(() => {
            if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
        });
    },

    // Netflix's player container. Its own class, so its own to rename — which
    // is exactly why a live check on it is worth having.
    playerSelector: '.watch-video',
    // See `canRewind` on the interface: seeking to 0 destroys the player.
    canRewind: false,

    /**
     * One stream per account. A second concurrent play gets this page rather
     * than a player, and the run must say so plainly instead of blaming the
     * panel. Matched on the error CODE as well as the wording, because the
     * wording is localised and the code is not.
     */
    /**
     * Through Netflix's own player, never through the element: `currentTime`
     * destroys it. Verified on a fresh page — the element survives, the clock
     * advances and the transcript scrolls itself.
     */
    playFrom: async (page, seconds) => {
        const outcome = await page.evaluate((t) => {
            const nf = (window as unknown as { netflix?: any }).netflix;
            const app = nf?.appContext?.state?.playerApp ?? nf?.appContext?.getState?.()?.playerApp;
            const vp = app?.getAPI?.()?.videoPlayer;
            const ids: string[] = vp?.getAllPlayerSessionIds?.() ?? [];
            const session = ids.length ? vp?.getVideoPlayerBySessionId?.(ids[ids.length - 1]) : null;
            if (!session) return 'no player session';
            session.seek(t * 1000); // milliseconds
            session.play?.();
            return null;
        }, seconds);
        if (outcome) throw new Error(`Netflix: ${outcome}`);
    },

    refusal: async (page) => {
        const hit = await page
            .evaluate(() => {
                const text = document.body?.innerText ?? '';
                if (/M7375/.test(text)) return 'M7375';
                if (/Pardon the interruption/i.test(text)) return 'Pardon the interruption';
                return null;
            })
            .catch(() => null);
        return hit
            ? `Netflix refused to play (${hit}). It allows one stream per account at a time, ` +
                  `so a second Netflix tab in the same run gets this page instead of a player. ` +
                  `Nothing is wrong with the extension.`
            : null;
    },

    cleanExtras: () => ({}),
    readExtras: async () => ({}),
};

export const SITES: readonly Site[] = [youtube, netflix];

/** The default for checks that are not parameterised over platforms. */
export const DEFAULT_SITE: Site = youtube;
