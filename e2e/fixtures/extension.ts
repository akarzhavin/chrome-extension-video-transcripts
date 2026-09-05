/**
 * The shared preamble every live script duplicates, as fixtures.
 *
 * Why CDP rather than a launched browser: YouTube answers an automated profile
 * with LOGIN_REQUIRED and returns 200 with an empty body for caption requests,
 * so a fresh Playwright profile cannot observe subtitle loading at all. The
 * only viable target is the human's long-lived signed-in Chrome — see
 * docs/ops/live-debug-cdp.md.
 */
import { test as base, expect, type Page, type BrowserContext } from '@playwright/test';
import { chromium } from 'playwright-core';
import { readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
// Reused as-is: it owns background-tab creation and muting, and the ops doc
// requires every tab-opening script to go through it.
import { openInBackground, mute } from '../../scripts/lib/cdp-background-tab.mjs';

export const CDP_URL = 'http://127.0.0.1:9333';

/**
 * The unpacked build Chrome actually loads. It lives in the main checkout, not
 * in whichever worktree a run is started from, so the path cannot be derived
 * from the process's own location. Override with LINGOGRAM_BUILD_ROOT on a
 * machine that keeps the checkout elsewhere.
 */
export const LOADED_BUILD_ROOT =
    process.env.LINGOGRAM_BUILD_ROOT ?? `${process.env.HOME}/workspace/chrome-extentions/lingogram/apps/youtube`;

const LAUNCH_HINT = `
Cannot reach Chrome on ${CDP_URL}.

Start the test browser first:

  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \\
    --remote-debugging-port=9333 \\
    --user-data-dir=$HOME/chrome-lingogram-test &

It must be signed in to YouTube, and apps/youtube/build must be a dev build.`;

export interface ExtensionInfo {
    id: string;
    name: string;
    state: string;
    path: string | null;
}

/** Read the extension inventory. Only chrome://extensions exposes these APIs. */
async function readExtensions(ctx: BrowserContext): Promise<{ list: ExtensionInfo[]; page: Page }> {
    const page = await openInBackground(ctx, 'chrome://extensions/');
    await page.waitForFunction(() => typeof (globalThis as any).chrome?.developerPrivate !== 'undefined', null, {
        timeout: 15_000,
    });
    const list = (await page.evaluate(
        () =>
            new Promise((resolve) =>
                (globalThis as any).chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true }, (all: any[]) =>
                    resolve(all.map((e) => ({ id: e.id, name: e.name, state: e.state, path: e.path ?? null }))),
                ),
            ),
    )) as ExtensionInfo[];
    return { list, page };
}


/**
 * The MAIN checkout, which is where Chrome loads the unpacked extension from —
 * never a worktree. Derived rather than written down: this file is public, and
 * a hard-coded path would carry one machine's home directory into the
 * repository as well as breaking on every other.
 *
 * `git rev-parse --path-format=absolute --git-common-dir` gives the shared
 * .git directory, which is the main checkout's even when run from a worktree.
 * Override with LINGOGRAM_MAIN_CHECKOUT when the extension is loaded from
 * somewhere else.
 */
function mainCheckout(): string {
    const override = process.env.LINGOGRAM_MAIN_CHECKOUT;
    if (override) return override;
    try {
        const gitCommonDir = execFileSync(
            'git',
            ['rev-parse', '--path-format=absolute', '--git-common-dir'],
            { encoding: 'utf8' },
        ).trim();
        return join(gitCommonDir, '..');
    } catch {
        throw new Error(
            'Could not locate the main checkout (git rev-parse failed).\n' +
                'Set LINGOGRAM_MAIN_CHECKOUT to the checkout Chrome loads the extension from.',
        );
    }
}

const buildDir = (): string => join(mainCheckout(), 'apps/youtube/build');

/**
 * Guard: Chrome loads the unpacked extension from the MAIN checkout, never from
 * a worktree. Running the suite from a worktree therefore verifies whatever was
 * last built in the main checkout — stale code that passes. Fail loudly instead.
 */
function assertBuildIsFresh(): void {
    const manifest = join(buildDir(), 'manifest.json');
    let mtime: Date;
    try {
        mtime = statSync(manifest).mtime;
    } catch {
        throw new Error(
            `No build at ${manifest}.\nChrome loads the extension from the main checkout, not from a worktree.\n` +
                `Build it there: (cd apps/youtube && npm run build:dev)`,
        );
    }
    const ageDays = (Date.now() - mtime.getTime()) / 86_400_000;
    if (ageDays > 7) {
        throw new Error(
            `The loaded build is ${ageDays.toFixed(1)} days old (${mtime.toISOString()}).\n` +
                `A stale content script silently verifies the previous build.\n` +
                `Rebuild in the MAIN checkout: (cd apps/youtube && npm run build:dev)`,
        );
    }
}

/**
 * How many video pages this run has loaded.
 *
 * The suite's cost to YouTube is the thing being managed, so it is counted as
 * it happens rather than estimated from the source. A count of `ext.open` calls
 * in the source cannot see a call inside a branch, a check that skipped, or a
 * retry — and every one of those is a page YouTube actually served.
 */
export interface LoadCounter {
    total: number;
}

export interface ExtensionHandle {
    ctx: BrowserContext;
    id: string;
    /** Open a muted background tab. Never steals focus from the human. */
    open(url: string): Promise<Page>;
    /** Reload the extension under any open pages — used by the update-notice check. */
    reload(): Promise<void>;
    /** Video pages loaded so far. Read by the loadAudit fixture, not by checks. */
    loads: LoadCounter;
}

const isYouTube = (url: string): boolean => /^https?:\/\/(www\.)?youtube\.com/.test(url);

export const test = base.extend<{ ext: ExtensionHandle; page: Page; loadAudit: void }, {}>({
    // eslint-disable-next-line no-empty-pattern
    ext: async ({}, use) => {
        assertBuildIsFresh();

        const browser = await chromium.connectOverCDP(CDP_URL).catch(() => {
            throw new Error(LAUNCH_HINT);
        });
        const ctx = browser.contexts()[0];
        if (!ctx) throw new Error(LAUNCH_HINT);

        // A browser with no window left cannot open a background tab at all:
        // creating one needs an existing window to attach to, and the whole
        // suite then fails inside the fixture with an error that looks nothing
        // like its cause. This happens easily, because every check here closes
        // the tabs it opened — closing the last one leaves the browser running
        // with no window. Leave a blank tab standing for the run, and close it
        // again in teardown only if we were the ones who opened it.
        let scaffold: Page | null = null;
        if (ctx.pages().length === 0) {
            scaffold = await ctx.newPage();
            await scaffold.goto('about:blank').catch(() => {});
        }

        const { list, page: extPage } = await readExtensions(ctx);

        // Find the build under test BY PATH, never by name: store names change
        // on every rebranding, paths do not.
        const unpacked = list.find((e) => (e.path ?? '').includes('/apps/youtube/build'));
        if (!unpacked) {
            await extPage.close();
            throw new Error(
                'The unpacked youtube build is not loaded in this Chrome.\n' +
                    'Load apps/youtube/build from the MAIN checkout via chrome://extensions.',
            );
        }

        // Two copies share the same element ids and message protocol, producing a
        // spliced UI. Disable any other copy and put it back afterwards.
        const others = list.filter(
            (e) => e.id !== unpacked.id && e.state === 'ENABLED' && /lingogram|dual subtitles/i.test(e.name),
        );
        const setEnabled = (id: string, on: boolean) =>
            extPage.evaluate(
                ([i, o]) =>
                    new Promise((r) => (globalThis as any).chrome.management.setEnabled(i as string, o as boolean, r)),
                [id, on] as [string, boolean],
            );
        for (const o of others) await setEnabled(o.id, false);

        // A cached content script silently verifies the PREVIOUS build.
        await extPage.evaluate(
            (id) =>
                new Promise((r) => (globalThis as any).chrome.developerPrivate.reload(id, { failQuietly: true }, r)),
            unpacked.id,
        );
        await extPage.waitForTimeout(2000);

        // A build made without the dictionary address answers every word lookup
        // with "not configured" and the card silently never appears. That is
        // indistinguishable from a broken lookup, and it cost an investigation:
        // a plain rebuild during unrelated work dropped the address, and the
        // failure looked like a product regression for half an hour.
        //
        // The build command needs EXT_API_BASE_URL in its environment; nothing
        // warns when it is missing, so warn here.
        const buildHasDictionary = (() => {
            try {
                const bg = readFileSync(join(buildDir(), 'src/background/background.js'), 'utf8');
                return /https:\/\/[a-z0-9.-]*run\.app/.test(bg);
            } catch {
                return false;
            }
        })();
        if (!buildHasDictionary) {
            throw new Error(
                'The loaded build carries no dictionary address, so every word lookup\n' +
                    'answers "not configured" and the card never appears.\n\n' +
                    'Rebuild with it set:\n' +
                    '  (cd apps/youtube && EXT_API_BASE_URL="<gateway url>" npm run build:dev)',
            );
        }

        const loads: LoadCounter = { total: 0 };

        const handle: ExtensionHandle = {
            ctx,
            id: unpacked.id,
            loads,
            async open(url) {
                const p = await openInBackground(ctx, url);
                if (isYouTube(url)) {
                    loads.total++;
                    // A reload or a same-tab navigation is another page YouTube
                    // served, and neither goes through open(). Counted from the
                    // main frame's navigations rather than from 'load', because
                    // whether the first 'load' has already fired by the time a
                    // listener is attached is a race; a navigation to a
                    // DIFFERENT document is unambiguous either way.
                    //
                    // Same-document navigations (the History API, which YouTube
                    // uses to move between videos without a fetch) do not count:
                    // no page was served. subtitles.spec.ts:132 is exactly that
                    // case, and it discards the shared page instead.
                    p.on('framenavigated', (frame) => {
                        if (frame === p.mainFrame() && isYouTube(frame.url())) loads.total++;
                    });
                }
                await mute(p);
                return p;
            },
            async reload() {
                await extPage.evaluate(
                    (id) =>
                        new Promise((r) =>
                            (globalThis as any).chrome.developerPrivate.reload(id, { failQuietly: true }, r),
                        ),
                    unpacked.id,
                );
            },
        };

        try {
            await use(handle);
        } finally {
            // Restore the human's browser, whether or not the check passed.
            for (const o of others) await setEnabled(o.id, true).catch(() => {});
            await extPage.close().catch(() => {});
            // Only close ours if something else is left standing — closing the
            // last window puts the browser back in the state that broke the
            // run in the first place.
            if (scaffold && ctx.pages().length > 1) await scaffold.close().catch(() => {});
            await browser.close().catch(() => {});
        }
    },

    /**
     * Attribute the run's page loads to the check that caused them.
     *
     * Runs for every check whether or not it asks for it (`auto`), and records
     * the delta as an annotation the reporter sums up. Annotations belong to a
     * RESULT, not to a check, so a retried check contributes its own — which is
     * what makes the reported total include retries.
     */
    loadAudit: [
        async ({ ext }, use, testInfo) => {
            const before = ext.loads.total;
            await use();
            const spent = ext.loads.total - before;
            testInfo.annotations.push({ type: 'youtube-loads', description: String(spent) });
        },
        { auto: true },
    ],

    page: async ({ ext }, use) => {
        const p = await ext.open('https://www.youtube.com/watch?v=' + VIDEO_WITH_CAPTIONS);
        try {
            await use(p);
        } finally {
            await p.close().catch(() => {});
        }
    },
});

/**
 * A video whose captions are checked at the moment of use, never trusted from a
 * documented id: a video documented in this repo as reliably caption-free had
 * gained captions by the time it was checked.
 */
export const VIDEO_WITH_CAPTIONS = 'aircAruvnKk';

export { expect };
