/**
 * The one thing that differs between platforms: how to reach a page that is
 * playing something with subtitles.
 *
 * Everything AFTER that is already common and needs no abstraction — the panel
 * is `#vtt-sidebar` and the transcript is `#vtt-list .vtt-item` on every site,
 * because they are this extension's own markup rather than the host's. That is
 * why this file describes arrival and nothing else: a wider interface would be
 * inventing seams instead of finding them.
 *
 * Adding a platform means adding an entry here. A check written against `SITES`
 * then runs on it without being touched.
 */
import type { Page } from '@playwright/test';
import type { ExtensionHandle } from './extension';
import { WATCH_URL } from './watch-page';

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
}

const youtube: Site = {
    name: 'YouTube',
    skipReason: () => null,
    open: (ext) => ext.open(WATCH_URL),
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
};

export const SITES: readonly Site[] = [youtube, netflix];
