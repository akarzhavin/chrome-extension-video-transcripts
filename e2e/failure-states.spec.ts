/**
 * Behaviour map §16 (subtitles that will not load) and §24 (the extension
 * updating underneath an open page).
 *
 * §24 is graded High and is the most valuable check here: before the notice
 * existed, the panel simply died and went on looking correct.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { test, expect } from './fixtures/extension';
import { waitForLines, waitForSettledBanner, pressBannerAction, currentBanner } from './fixtures/subtitles';
import { preservingUiPrefs } from './fixtures/uiprefs';

const VIDEO = 'https://www.youtube.com/watch?v=aircAruvnKk';

/**
 * The English text the extension actually displays.
 *
 * Every `t(key, fallback)` call carries an in-code English string, and
 * `_locales/en/messages.json` carries another for the same key. Both are live,
 * both are correct English, and only the locale ships — chrome.i18n resolves
 * the message and the fallback is reached only when it cannot. So a check that
 * copies the wording out of the source is verifiable, reviewable, and still
 * asserting a string the product never shows.
 *
 * This happened here: the first version of the fourth-state check below took
 * "Still no subtitles. Reloading the page often fixes it." from app-base.ts
 * and failed against the sentence the locale actually carries. Read the
 * winning source instead.
 */
function localeMessage(key: string): string {
    const path = join(__dirname, '..', 'apps', 'youtube', '_locales', 'en', 'messages.json');
    const messages = JSON.parse(readFileSync(path, 'utf8')) as Record<string, { message: string }>;
    const entry = messages[key];
    if (!entry?.message) throw new Error(`no ${key} in _locales/en/messages.json`);
    return entry.message;
}

test.describe('subtitles that will not load', () => {
    /**
     * An expired link and a caption-free video are DIFFERENT states, and saying
     * "this video has no subtitles" for the first is simply false — the captions
     * exist and were refused. Confusing the two sends a viewer off to another
     * video for nothing.
     */
    test('an expired link produces the expired-link notice, not the no-captions one', async ({ ext }) => {
        const page = await ext.open(`${VIDEO}#lingogram_http=403`);
        try {
            const banner = await waitForSettledBanner(page);
            expect(banner.title).toBe("Couldn't load subtitles");
            expect(banner.text).toContain('expired');
            expect(banner.actions.map((a) => a.label).join(' ')).toContain('Search again');
        } finally {
            await page.close().catch(() => {});
        }
    });

    /**
     * The escalation happens after exactly ONE retry, not "a couple" — and the
     * reload is styled as an emergency rather than as a feature, deliberately.
     */
    test('after one retry the notice changes and offers an emergency reload', async ({ ext }) => {
        const page = await ext.open(`${VIDEO}#lingogram_http=403`);
        try {
            const first = await waitForSettledBanner(page);
            expect(first.actions.some((a) => a.emergency), 'no emergency action before retrying').toBe(false);

            await pressBannerAction(page, /Search again/);

            await page.waitForFunction(
                () =>
                    [...document.querySelectorAll('.vtt-empty-state-action')].some((b) =>
                        b.classList.contains('vtt-empty-state-action--emergency'),
                    ),
                null,
                { timeout: 90_000, polling: 250 },
            );

            const after = await currentBanner(page);
            expect(after!.text).not.toBe(first.text);
            expect(after!.actions.find((a) => a.emergency)?.label).toContain('Reload page');
        } finally {
            await page.close().catch(() => {});
        }
    });
});

test.describe('when the extension updates underneath an open page', () => {
    /**
     * Behaviour map §24. The panel stops following the video and cannot recover
     * on its own; without this notice it kept looking perfectly normal, which is
     * why this behaviour is graded High despite affecting only one moment.
     */
    test('the panel says it was updated and offers to reload the page', async ({ ext }) => {
        const page = await ext.open(VIDEO);
        try {
            await waitForLines(page);

            await ext.reload();

            await page.waitForFunction(() => !!document.getElementById('vtt-orphan-notice'), null, {
                timeout: 30_000,
                polling: 250,
            });

            const notice = await page.evaluate(() => {
                const n = document.getElementById('vtt-orphan-notice')!;
                return {
                    title: n.querySelector('.vtt-orphan-notice-title')?.textContent ?? '',
                    text: n.querySelector('.vtt-orphan-notice-text')?.textContent ?? '',
                    action: n.querySelector('.vtt-orphan-notice-action')?.textContent ?? '',
                    // Announced urgently: the panel is dead in every state it
                    // could be in, so this must interrupt rather than queue.
                    role: n.getAttribute('role'),
                };
            });

            expect(notice.title).toBe('Lingogram was updated');
            expect(notice.text).toContain('stopped following the video');
            expect(notice.action).toContain('Reload page');
            expect(notice.role).toBe('alert');
        } finally {
            await page.close().catch(() => {});
        }
    });
});

/**
 * Behaviour map §16.4 — the fourth state, on a video that genuinely has no
 * captions rather than a simulated refusal.
 *
 * The simulated 403 above reaches the SAME escalation through the recoverable
 * branch. This one reaches it through the other branch entirely — the one that
 * says "this video doesn't have subtitles" — and that branch has no live check
 * at all. Its unit twin in `app-base-status.test.ts` carries the red (Art. A):
 * the break belongs in the source, not in someone's signed-in browser.
 *
 * The video is verified caption-free AT THE MOMENT OF USE, never trusted from
 * a documented id. The one this repo documented as reliably caption-free
 * (jNQXAC9IVRw, "Me at the zoo") had gained en and de tracks when checked.
 * When no candidate is genuinely caption-free the check declares itself unrun
 * rather than passing on a video that would have banner'd for another reason
 * (Art. F).
 */
test.describe('a video that really has no captions', () => {
    /**
     * Candidates, most likely first: long instrumental music, where YouTube's
     * automatic captions have no speech to transcribe. Each is verified before
     * it is used.
     */
    const CANDIDATES = [
        '1ZYbU82GVz4', // instrumental sleep music, verified caption-free 2026-09-04
        'lFcSrYw-ARY',
        'DWcJFNfaw9c',
    ];

    /** Ask the player itself how many caption tracks the video offers. */
    const captionCount = () => {
        const pr = (document.getElementById('movie_player') as any)?.getPlayerResponse?.();
        const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
        return { status: pr?.playabilityStatus?.status ?? '?', count: tracks.length };
    };

    test('after one "Search again" it says still nothing, and offers the emergency reload', async ({ ext }) => {
        await preservingUiPrefs(ext, async () => {
            let page: import('@playwright/test').Page | null = null;
            let chosen: string | null = null;

            // Verify at the moment of use — a documented id is not evidence.
            for (const id of CANDIDATES) {
                const p = await ext.open(`https://www.youtube.com/watch?v=${id}`);
                try {
                    await p.waitForFunction(
                        () => !!(document.getElementById('movie_player') as any)?.getPlayerResponse?.(),
                        null, { timeout: 45_000, polling: 500 });
                    const { status, count } = await p.evaluate(captionCount);
                    if (status === 'OK' && count === 0) {
                        page = p;
                        chosen = id;
                        break;
                    }
                } catch {
                    /* fall through to the next candidate */
                }
                await p.close().catch(() => {});
            }

            // Art. F: a check that cannot reach its state says so; it does not pass.
            test.skip(page === null,
                'no candidate was verified caption-free at this moment — the state was never reached');

            try {
                const first = await waitForSettledBanner(page!, 150_000);

                expect(first.title, `on ${chosen}`).toBe(localeMessage('ytNoSubsTitle'));
                // Same two-source trap as below: the fallback and the locale
                // differ here too ("not every video has captions" versus "not
                // every video on YouTube has captions"). This passed only
                // because it matched on a fragment common to both.
                expect(first.text).toBe(localeMessage('ytNoSubsText'));
                expect(first.actions.some((a) => a.emergency),
                    'no emergency action before retrying').toBe(false);

                // Exactly one press — the escalation is after ONE retry.
                await pressBannerAction(page!, /Search again/);

                await page!.waitForFunction(
                    () =>
                        [...document.querySelectorAll('.vtt-empty-state-action')].some((b) =>
                            b.classList.contains('vtt-empty-state-action--emergency'),
                        ),
                    null, { timeout: 150_000, polling: 250 });

                const after = await currentBanner(page!);

                // The claim is that the wording CHANGES after a retry, so that
                // is what is asserted — not which words it changes to. Pinning
                // a literal here would assert a copy decision nobody committed
                // to keeping stable, and it would be wrong for a reason
                // invisible in the source: `t()`'s in-code fallback and
                // _locales/en/messages.json are both live, both correct, and
                // only the locale ships. The first attempt at this check took
                // the fallback — "Still no subtitles. Reloading the page often
                // fixes it." — which the product never displays.
                expect(after!.text).not.toBe(first.text);
                // ...and it is the retry branch specifically, identified by the
                // message the running extension actually resolves rather than
                // by a phrase copied out of the source.
                expect(after!.text).toBe(localeMessage('ytNoSubsRetryText'));
                expect(after!.actions.find((a) => a.emergency)?.label).toContain('Reload page');
                // The ordinary recovery stays offered beside the escape hatch.
                expect(after!.actions.some((a) => !a.emergency && /Search again/.test(a.label))).toBe(true);
            } finally {
                await page?.close().catch(() => {});
            }
        });
    });
});
