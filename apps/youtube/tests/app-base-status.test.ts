// Chrome stub must exist before the module graph is imported: the shared
// sidebar/i18n modules read chrome.* at import time.
(global as any).chrome = {
    runtime: {
        id: 'test-extension-id',
        getURL: (p: string) => `chrome-extension://test/${p}`,
        sendMessage: jest.fn(),
        getManifest: () => ({ version: '1.0.0' }),
        lastError: undefined,
    },
    i18n: { getMessage: () => '', getUILanguage: () => 'en' }, // force English fallbacks
    storage: {
        local: { get: jest.fn().mockResolvedValue({}), set: jest.fn().mockResolvedValue(undefined) },
        onChanged: { addListener: jest.fn() },
    },
};

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AUTO_PROBE_LIMIT, BaseVttApp, type ReprocessOptions } from '../src/content/app-base';
import type { Subtitle } from '@video-transcripts/shared';

class TestApp extends BaseVttApp {
    videoId: string | null = 'vid1';
    reprocessed = 0;
    reprocessCalls: ReprocessOptions[] = [];

    constructor() {
        super();
        this.init();
    }
    getVideoId(): string | null {
        return this.videoId;
    }
    getOverlayParent(): HTMLElement | null {
        return null;
    }
    seekVideo(): void {}
    // Mirrors the real YouTube adapter: a retry preserves loaded tracks.
    reprocessCurrentVideo(opts: ReprocessOptions = {}): void {
        this.reprocessed++;
        this.reprocessCalls.push(opts);
        this.resetForNewVideo({ preserveTracks: opts.preserveTracks });
    }
    startSite(): void {}
}

const sub = (text: string): Subtitle => ({ startTime: 0, endTime: 1, text });

function makeApp(): TestApp {
    document.body.innerHTML = '';
    const app = new TestApp();
    app.langPrefs = { learning: 'en', native: 'ru' };
    return app;
}

const banner = () => document.getElementById('vtt-status');
const notice = () => document.getElementById('vtt-partial-notice');
const noticeText = () => notice()?.textContent ?? '';
const bannerText = () => banner()?.textContent ?? '';
const actions = () => [...(banner()?.querySelectorAll('button') ?? [])] as HTMLButtonElement[];

describe('the grace period vs a throttle still in flight', () => {
    // Observed live with the diagnostic switch (nothing sent to the network):
    //
    //     0.9s  "Searching for subtitles…"
    //     8.0s  "No subtitles available"     <- wrong, and the user reads this
    //    16.1s  "YouTube is limiting requests"
    //
    // The grace period concludes "no subtitles" at 7s while the requests are
    // still retrying against a Retry-After, so the reader is told the video has
    // no captions when it has them and YouTube is simply refusing to serve
    // them. The right banner does arrive, but only after they have been given a
    // reason to go and find another video.
    //
    // Real throttling behaves the same way: the retry schedule is the site's,
    // not the switch's.
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('a request still retrying is not called "no subtitles"', () => {
        const app = makeApp();

        // A request is out and has not answered yet — exactly the state the
        // grace period fires in.
        app.pendingRequests.set('vid1:English', 'English');
        app.scheduleNoSubtitlesCheck();

        jest.advanceTimersByTime(7000);

        // Assert the banner that SHOULD be there, not only the absence of the
        // wrong one: bannerText() is '' when there is no banner at all, so a
        // bare not.toContain() is equally green on an empty panel — including
        // one left empty by a bug that never rendered anything.
        expect(bannerText()).toContain('Searching');

        // Nothing has come back, so nothing is known about WHY. Claiming the
        // video has no subtitles is a guess presented as a fact.
        expect(bannerText()).not.toContain("doesn't have subtitles");
    });
});

describe('rate-limited subtitle failures', () => {
    // The whole reason this exists: "no subtitles" was a lie when the real
    // cause was YouTube refusing to serve a track that does exist.
    test('a total 429 blames the rate limit, not the video', () => {
        const app = makeApp();
        app.noteTrackFailure('English', { failure: 'rate-limited', retryAfterMs: 30_000 });

        expect(bannerText()).toContain('limiting requests');
        expect(bannerText()).not.toContain("doesn't have subtitles");
    });

    test('the retry button counts down and is inert while cooling', () => {
        const app = makeApp();
        app.noteTrackFailure('English', { failure: 'rate-limited', retryAfterMs: 30_000 });

        const [btn] = actions();
        expect(btn.textContent).toContain('30');
        expect(btn.disabled).toBe(true);
        btn.click();
        expect(app.reprocessed).toBe(0);
    });

    test('once the cooldown expires the retry goes live again', () => {
        const app = makeApp();
        app.noteTrackFailure('English', { failure: 'rate-limited' });

        const [btn] = actions();
        expect(btn.disabled).toBe(false);
        btn.click();
        expect(app.reprocessed).toBe(1);
    });

    // The common real-world case: one track plays, the other was throttled.
    // A banner here would talk over the subtitles the user is reading.
    test('a partial failure never raises the banner', () => {
        const app = makeApp();
        app.addParsedTrack('English', [sub('hello')]);
        app.noteTrackFailure('Russian', { failure: 'rate-limited', retryAfterMs: 30_000 });

        expect(banner()).toBeNull();
        expect(app.isThrottled()).toBe(true);
    });

    // ...but it must still SAY something. Hiding this in the player menu meant
    // the user saw one language load, the other silently not, and no reason.
    test('a partial failure states the reason in the sidebar', () => {
        const app = makeApp();
        app.addParsedTrack('English', [sub('hello')]);
        app.noteTrackFailure('Russian', { failure: 'rate-limited', retryAfterMs: 30_000 });

        expect(notice()).not.toBeNull();
        expect(noticeText()).toContain('limited by YouTube');
        // No countdown: the wait has no reliable end, so a ticking number
        // would promise precision we don't have.
        expect(noticeText()).not.toMatch(/\d/);
    });

    test('retry stays available during the cooldown — the breaker is what refuses', () => {
        const app = makeApp();
        app.addParsedTrack('English', [sub('hello')]);
        app.noteTrackFailure('Russian', { failure: 'rate-limited', retryAfterMs: 30_000 });

        const btn = notice()!.querySelector('button') as HTMLButtonElement;
        expect(btn).not.toBeNull();
        btn.click();
        expect(app.reprocessed).toBe(1);
    });

    test('an unoffered translation says so plainly, with nothing to retry', () => {
        const app = makeApp();
        app.addParsedTrack('English', [sub('hello')]);
        app.noteTrackFailure('Russian', { failure: 'not-offered' });

        expect(noticeText()).toContain('No translation');
        expect(notice()!.querySelector('button')).toBeNull();
        // A permanent, unfixable outcome is not a warning — colouring it would
        // cry wolf about something the user can neither fix nor wait out.
        expect(notice()!.classList.contains('is-warning')).toBe(false);
    });

    test('rate limiting reads as a warning, being temporary and self-clearing', () => {
        const app = makeApp();
        app.addParsedTrack('English', [sub('hello')]);
        app.noteTrackFailure('Russian', { failure: 'rate-limited', retryAfterMs: 30_000 });

        expect(notice()!.classList.contains('is-warning')).toBe(true);
    });

    // The row truncates to one line, so the tooltip is where the reason lives.
    test('hovering the throttled row explains that waiting is the fix', () => {
        const app = makeApp();
        app.addParsedTrack('English', [sub('hello')]);
        app.noteTrackFailure('Russian', { failure: 'rate-limited', retryAfterMs: 30_000 });

        const hint = notice()!.dataset.tip!;
        expect(hint).toContain('temporarily limited');
        // Honest about duration: the limit has been observed to last 12+
        // hours, so the hint may not promise a recovery time.
        expect(hint).toContain('hours');
        expect(hint).not.toContain('within a minute');
        // It must not read as the user's fault or as a broken extension.
        expect(hint).toContain('not a problem with the extension');
        // The tooltip carries more than the visible line, or it is pointless.
        expect(hint.length).toBeGreaterThan(noticeText().length);
    });

    // The banner made the same false promise ("usually clears in a minute").
    test('the total-failure banner promises no recovery time either', () => {
        const app = makeApp();
        app.noteTrackFailure('English', { failure: 'rate-limited', retryAfterMs: 30_000 });
        expect(bannerText()).not.toContain('minute.');
        expect(bannerText()).toContain('sometimes lasts hours');
    });

    // The Dual chip goes disabled for the same underlying reason, and a
    // disabled control that won't say why reads as broken.
    test('the disabled Dual chip explains itself with the same hint', () => {
        const app = makeApp();
        app.addParsedTrack('English', [sub('hello')]);
        app.noteTrackFailure('Russian', { failure: 'rate-limited', retryAfterMs: 30_000 });

        const dualBtn = document.getElementById('vtt-qm-dual') as HTMLButtonElement;
        // aria-disabled, not `disabled`: a disabled button fires no pointer
        // events, so the tooltip explaining WHY it's off could never appear.
        expect(dualBtn.getAttribute('aria-disabled')).toBe('true');
        expect(dualBtn.disabled).toBe(false);
        expect(dualBtn.classList.contains('vtt-qm-blocked')).toBe(true);
        // The mode's name still leads, so the tooltip answers "what is this?"
        // as well as "why is it off?".
        const [head, ...rest] = dualBtn.dataset.tip!.split('\n');
        expect(head).toBe('Dual (Shift+D)');
        // ...followed by the same explanation the sidebar notice gives — one
        // story, two surfaces.
        expect(rest.join('\n')).toBe(app.missingTrackHint());
        expect(rest.join('\n')).toBe(notice()!.dataset.tip);
    });

    test('the blocked Dual chip still refuses to switch mode', () => {
        const app = makeApp();
        app.addParsedTrack('English', [sub('hello')]);
        app.noteTrackFailure('Russian', { failure: 'rate-limited', retryAfterMs: 30_000 });

        const before = app.state.displayMode;
        (document.getElementById('vtt-qm-dual') as HTMLButtonElement).click();
        expect(app.state.displayMode).toBe(before);
    });

    test('with both tracks loaded the Dual chip keeps its normal tooltip', () => {
        const app = makeApp();
        app.addParsedTrack('English', [sub('hello')]);
        app.addParsedTrack('Russian', [sub('привет')]);

        const dualBtn = document.getElementById('vtt-qm-dual') as HTMLButtonElement;
        expect(dualBtn.disabled).toBe(false);
        expect(dualBtn.getAttribute('aria-disabled')).toBe('false');
        expect(dualBtn.classList.contains('vtt-qm-blocked')).toBe(false);
        expect(dualBtn.dataset.tip).toBe('Dual (Shift+D)');
    });

    // Without a known reason there is nothing to explain, so the chip goes
    // plainly disabled rather than dangling an empty tooltip.
    test('a single-track video disables Dual outright, no tooltip', () => {
        const app = makeApp();
        app.addParsedTrack('English', [sub('hello')]);

        const dualBtn = document.getElementById('vtt-qm-dual') as HTMLButtonElement;
        expect(dualBtn.disabled).toBe(true);
        expect(dualBtn.dataset.tip).toBe('Dual (Shift+D)');
    });

    test('hovering the unoffered row says retrying will not help', () => {
        const app = makeApp();
        app.addParsedTrack('English', [sub('hello')]);
        app.noteTrackFailure('Russian', { failure: 'not-offered' });

        expect(notice()!.dataset.tip).toContain('will not help');
    });

    // The sub-header is a single flex row (language chip | mode buttons); a
    // third child there squeezes both into an unreadable mess.
    test('the notice is its own row, not stuffed into the sub-header', () => {
        const app = makeApp();
        app.addParsedTrack('English', [sub('hello')]);
        app.noteTrackFailure('Russian', { failure: 'rate-limited' });

        const subheader = document.getElementById('vtt-subheader');
        expect(subheader).not.toBeNull();
        expect(subheader!.contains(notice())).toBe(false);
        expect(notice()!.previousElementSibling).toBe(subheader);
    });

    test('the notice clears when the missing track finally loads', () => {
        const app = makeApp();
        app.addParsedTrack('English', [sub('hello')]);
        app.noteTrackFailure('Russian', { failure: 'rate-limited' });
        expect(notice()).not.toBeNull();

        app.addParsedTrack('Russian', [sub('привет')]);
        expect(notice()).toBeNull();
    });

    test('the notice does not survive a video change', () => {
        const app = makeApp();
        app.addParsedTrack('English', [sub('hello')]);
        app.noteTrackFailure('Russian', { failure: 'rate-limited' });

        app.resetForNewVideo();
        expect(notice()).toBeNull();
    });

    // Shorts with a collapsed panel skips fetching, so the panel must explain
    // itself when opened instead of sitting empty — an empty panel reads as
    // "this video has no subtitles", the opposite of what we know.
    test('a deferred search offers a button and cancels the no-subtitles verdict', () => {
        const app = makeApp();
        // The state a video change leaves behind: "Searching…" plus the timer
        // that flips it to "No subtitles" once the grace period is up.
        app.scheduleNoSubtitlesCheck(1);
        expect(bannerText()).toContain('Searching');

        app.offerDeferredSearch();

        expect(bannerText()).toContain('ready to load');
        const labels = actions().map((b) => b.textContent ?? '');
        expect(labels.some((l) => l.includes('Find subtitles'))).toBe(true);

        // The timer must be dead: nothing was searched, so "No subtitles" would
        // be a verdict on a search that never ran.
        expect(app.noSubsTimer).toBeNull();
    });

    // Guards the assertion above: without offerDeferredSearch() the timer is
    // armed, so a null check on it is testing something real.
    test('the no-subtitles timer is armed without the deferral', () => {
        const app = makeApp();
        app.scheduleNoSubtitlesCheck(1000);
        expect(app.noSubsTimer).not.toBeNull();
    });

    test('the offered button runs a real search', () => {
        const app = makeApp();
        app.offerDeferredSearch();
        actions()[0].click();
        expect(app.reprocessed).toBe(1);
    });

    test('an expired link asks to search again rather than declaring defeat', () => {
        const app = makeApp();
        app.noteTrackFailure('English', { failure: 'stale-url' });

        expect(bannerText()).toContain('expired');
        actions()[0].click();
        expect(app.reprocessed).toBe(1);
    });

    // The signed URL is cached in the page, so a retry re-sends the identical
    // dead request. Without the escalation the user is left clicking a button
    // that structurally cannot succeed, with no way out on offer — the reload
    // escalation used to sit below this branch's early return.
    test('an expired link escalates to reload once searching again did not help', () => {
        const app = makeApp();
        app.noteTrackFailure('English', { failure: 'stale-url' });

        // First banner: recovery only, no emergency button yet.
        expect(actions()).toHaveLength(1);

        actions()[0].click();
        app.noteTrackFailure('English', { failure: 'stale-url' });

        const labels = actions().map((b) => b.textContent ?? '');
        expect(labels.some((l) => l.includes('Reload page'))).toBe(true);
        expect(bannerText()).toContain('Reloading the page');
        // Still an expired link, not a caption-less video.
        expect(bannerText()).not.toContain("doesn't have subtitles");
    });

    // Unchanged behaviour: when YouTube genuinely offers no translation, the
    // original copy is the honest one.
    test('an unoffered translation keeps the plain no-subtitles copy', () => {
        const app = makeApp();
        app.noteTrackFailure('Russian', { failure: 'not-offered' });

        expect(bannerText()).toContain('No subtitles available');
        expect(bannerText()).not.toContain('limiting requests');
    });

    test('the cooldown outlives "Search again" but not a new video', () => {
        const app = makeApp();
        app.noteTrackFailure('English', { failure: 'rate-limited', retryAfterMs: 30_000 });

        // resetForNewVideo also runs inside reprocessCurrentVideo(), so a
        // cooldown cleared here would be cleared by the very retry spam it
        // exists to absorb.
        app.resetForNewVideo();
        expect(app.cooldownRemainingMs()).toBeGreaterThan(0);

        app.resetNoSubsRetries();
        expect(app.cooldownRemainingMs()).toBe(0);
    });

    // The cooldown outlives resetForNewVideo() by design, so without a
    // "something actually failed" guard the next caption-less video would be
    // blamed on throttling that never touched it.
    test('a caption-less video during a cooldown is not called throttled', () => {
        const app = makeApp();
        app.noteTrackFailure('Russian', { failure: 'rate-limited', retryAfterMs: 30_000 });
        app.resetForNewVideo();

        expect(app.cooldownRemainingMs()).toBeGreaterThan(0);
        expect(app.isThrottled()).toBe(false);

        app.declareNoSubtitles();
        expect(bannerText()).toContain('No subtitles available');
        expect(bannerText()).not.toContain('limiting requests');
    });

    // The good track landing must not advertise a retry the breaker will
    // silently refuse — the throttled half is still throttled.
    test('one track loading keeps the cooldown while the other is still failing', () => {
        const app = makeApp();
        app.noteTrackFailure('Russian', { failure: 'rate-limited', retryAfterMs: 30_000 });
        app.addParsedTrack('English', [sub('hello')]);

        expect(app.cooldownRemainingMs()).toBeGreaterThan(0);
        expect(app.isThrottled()).toBe(true);
    });

    // One predicate for every surface. The player menu used to hand-list the
    // retryable failures and had already dropped no-pot and network, so those
    // states claimed no translation existed while the sidebar offered a retry.
    test.each(['rate-limited', 'stale-url', 'no-pot', 'network'] as const)(
        '%s counts as recoverable everywhere',
        (failure) => {
            const app = makeApp();
            app.addParsedTrack('English', [sub('hello')]);
            app.noteTrackFailure('Russian', { failure });

            expect(app.isRecoverableFailure()).toBe(true);
            expect(notice()!.querySelector('button')).not.toBeNull();
        },
    );

    test.each(['not-offered', 'unavailable'] as const)('%s is not recoverable', (failure) => {
        const app = makeApp();
        app.addParsedTrack('English', [sub('hello')]);
        app.noteTrackFailure('Russian', { failure });

        expect(app.isRecoverableFailure()).toBe(false);
        expect(notice()!.querySelector('button')).toBeNull();
    });

    test('a loaded track clears the failure record', () => {
        const app = makeApp();
        app.noteTrackFailure('English', { failure: 'rate-limited', retryAfterMs: 30_000 });
        expect(app.dominantFailure()).toBe('rate-limited');

        app.addParsedTrack('English', [sub('hello')]);
        expect(app.dominantFailure()).toBeUndefined();
        expect(app.cooldownRemainingMs()).toBe(0);
    });

    test('rate limiting outranks a plain missing translation', () => {
        const app = makeApp();
        app.noteTrackFailure('English', { failure: 'not-offered' });
        app.noteTrackFailure('Russian', { failure: 'rate-limited', retryAfterMs: 30_000 });
        // The actionable one is what the UI should talk about.
        expect(app.dominantFailure()).toBe('rate-limited');
    });

    test('nothing is declared while requests are still in flight', () => {
        const app = makeApp();
        app.pendingRequests.set('vid1:Russian', 'Russian');
        app.noteTrackFailure('English', { failure: 'rate-limited', retryAfterMs: 30_000 });
        expect(banner()).toBeNull();
    });
});

// A retry exists to fill in what's missing. It used to run the full new-video
// reset first, so clicking ↻ during a cooldown wiped the playing track, the
// breaker refused the refetch, and the user traded working subtitles for the
// full "limiting requests" banner — without one request being sent.
describe('retry preserves loaded tracks', () => {
    test('clicking ↻ during a cooldown keeps the playing track and stays quiet', () => {
        const app = makeApp();
        app.addParsedTrack('English', [sub('hello')]);
        app.noteTrackFailure('Russian', { failure: 'rate-limited', retryAfterMs: 30_000 });

        (notice()!.querySelector('button') as HTMLButtonElement).click();

        expect(app.reprocessed).toBe(1);
        expect(app.state.tracks).toHaveLength(1); // still playing
        expect(banner()).toBeNull(); // no "limiting requests" takeover
    });

    test('a manual retry keeps tracks; only an auto retry downgrades to a probe', () => {
        const app = makeApp();
        app.retrySubtitleSearch();
        app.retrySubtitleSearch({ auto: true });

        expect(app.reprocessCalls[0]).toMatchObject({ preserveTracks: true, probe: undefined });
        expect(app.reprocessCalls[1]).toMatchObject({ preserveTracks: true, probe: true });
        // Unattended retries don't count toward the "Reload page" escalation.
        expect(app.noSubsRetries).toBe(1);
    });

    /**
     * The discriminating claim, and the regression the product's own comment
     * warns about (app-base.ts:1592): the counter must survive a retry and
     * clear on a video change. Two methods run back-to-back at both real call
     * sites (index.ts:637 and :652), so a check that only reads 0 afterwards
     * cannot say which one did it — and would stay green if the line moved into
     * the wrong method, which is exactly the bug.
     *
     * Hence the ORDER: retry first, assert survival, then the video-change
     * reset, then assert zero.
     */
    test('a retry keeps the escalation counter; only a video change clears it', () => {
        const app = makeApp();
        app.declareNoSubtitles();
        app.retrySubtitleSearch();
        expect(app.noSubsRetries).toBe(1);

        // What a retry round runs. The counter must NOT move: the "Reload page"
        // escalation is offered after one retry, and a counter cleared here
        // would offer it forever.
        app.resetForNewVideo();
        expect(app.noSubsRetries).toBe(1);

        // What a genuine video change runs, additionally.
        app.resetNoSubsRetries();
        expect(app.noSubsRetries).toBe(0);
    });

    test('a genuine video change still starts from scratch', () => {
        const app = makeApp();
        app.addParsedTrack('English', [sub('hello')]);
        app.resetForNewVideo();
        expect(app.state.tracks).toHaveLength(0);
    });
});

// The user's observed loop — banner, wait ~30s, click, subtitles load — was the
// cooldown expiring with nobody to press the button. Expiry now fires a single
// unattended probe, a bounded number of times, so the common short throttle
// recovers by itself without hammering an endpoint that may still refuse.
describe('auto probe after the cooldown expires', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('the expiring banner cooldown fires one unattended probe', () => {
        const app = makeApp();
        app.noteTrackFailure('Russian', { failure: 'rate-limited', retryAfterMs: 3_000 });
        expect(app.reprocessed).toBe(0);

        jest.advanceTimersByTime(4_000);

        expect(app.reprocessed).toBe(1);
        expect(app.reprocessCalls[0]).toMatchObject({ probe: true });
        expect(app.noSubsRetries).toBe(0);
    });

    test('a throttled translation retries itself when the wait ends, keeping the original', () => {
        const app = makeApp();
        app.addParsedTrack('English', [sub('hello')]);
        app.noteTrackFailure('Russian', { failure: 'rate-limited', retryAfterMs: 2_000 });

        jest.advanceTimersByTime(3_000);

        expect(app.reprocessed).toBe(1);
        expect(app.state.tracks).toHaveLength(1);
    });

    // addParsedTrack clears the cooldown tick as part of its cleanup, so the
    // arming has to survive the "failure first, working track second" ordering.
    test('the probe also arms when the failure lands before the working track', () => {
        const app = makeApp();
        app.pendingRequests.set('vid1:English', 'English');
        app.noteTrackFailure('Russian', { failure: 'rate-limited', retryAfterMs: 2_000 });
        app.addParsedTrack('English', [sub('hello')]);

        jest.advanceTimersByTime(3_000);

        expect(app.reprocessed).toBe(1);
    });

    test('unattended probes stop at the cap; after that recovery is manual', () => {
        const app = makeApp();
        for (let i = 0; i < AUTO_PROBE_LIMIT + 2; i++) {
            app.noteTrackFailure('Russian', { failure: 'rate-limited', retryAfterMs: 1_000 });
            jest.advanceTimersByTime(2_000);
        }

        expect(app.reprocessed).toBe(AUTO_PROBE_LIMIT);
        // …and the budget itself: the line above holds for any value, and
        // this is a limit on how often the product asks YouTube again on its
        // own, without anyone having pressed anything.
        expect(AUTO_PROBE_LIMIT).toBe(2);
        // The user still has a move: the banner is back with a live button.
        expect(bannerText()).toContain('limiting requests');
        const [btn] = actions();
        expect(btn.disabled).toBe(false);
    });

    test('a full recovery ends the episode and restores the probe budget', () => {
        const app = makeApp();
        app.noteTrackFailure('Russian', { failure: 'rate-limited', retryAfterMs: 1_000 });
        jest.advanceTimersByTime(2_000);
        expect(app.autoProbes).toBe(1);

        app.addParsedTrack('English', [sub('hello')]);
        app.addParsedTrack('Russian', [sub('привет')]);
        expect(app.autoProbes).toBe(0);
    });

    test('a new video restores the probe budget too', () => {
        const app = makeApp();
        app.noteTrackFailure('Russian', { failure: 'rate-limited', retryAfterMs: 1_000 });
        jest.advanceTimersByTime(2_000);
        expect(app.autoProbes).toBe(1);

        app.resetNoSubsRetries();
        expect(app.autoProbes).toBe(0);
    });
});

/**
 * The language chip — behaviour map §7.
 *
 * The chip IS the swap control, and it is the discoverable one: Shift+S is the
 * shortcut for people who already know. Only the shortcut had a check, so the
 * chip's own handlers, the order it renders its two codes, its confirmation
 * pulse, and the deliberate decision never to remember a swap were all free to
 * break with every check still green.
 */
describe('the language pair chip', () => {
    const chip = () => document.getElementById('vtt-langpair') as HTMLElement | null;
    const codes = () =>
        [...(chip()?.querySelectorAll('.vtt-langpair-lang') ?? [])].map((s) => s.textContent?.trim());

    function withHeader(): TestApp {
        const app = makeApp();
        // The chip mounts only into our own header slot — deliberately no
        // fallback, so another installed copy's sidebar cannot receive it.
        const header = document.createElement('div');
        header.id = 'vtt-header-top';
        document.body.appendChild(header);
        app.addParsedTrack('English', [sub('hello')]);
        app.addParsedTrack('Russian', [sub('privet')]);
        app.updateLanguagePairChip();
        return app;
    }

    test('it renders the learning language first, then the native one', () => {
        withHeader();
        expect(codes()).toEqual(['EN', 'RU']);
    });

    test('a click swaps which track leads', () => {
        const app = withHeader();
        const before = app.state.swapped;
        chip()!.click();
        expect(app.state.swapped).toBe(!before);
    });

    test('Enter and Space swap too — the chip is reachable by keyboard', () => {
        const app = withHeader();
        chip()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(app.state.swapped).toBe(true);
        chip()!.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
        expect(app.state.swapped).toBe(false);
    });

    test('every swap replays the confirmation pulse', () => {
        // Removed, reflow, re-added. A class left on would animate once and
        // then sit there silently on every swap after the first, and the end
        // state is identical either way — so watch the removal itself by
        // recording each call rather than the value at the end.
        const app = withHeader();
        chip()!.click();
        expect(chip()!.classList.contains('vtt-pulse')).toBe(true);

        const calls: string[] = [];
        const el = chip()!;
        const realRemove = el.classList.remove.bind(el.classList);
        const realAdd = el.classList.add.bind(el.classList);
        jest.spyOn(el.classList, 'remove').mockImplementation((...c: string[]) => {
            if (c.includes('vtt-pulse')) calls.push('remove');
            realRemove(...c);
        });
        jest.spyOn(el.classList, 'add').mockImplementation((...c: string[]) => {
            if (c.includes('vtt-pulse')) calls.push('add');
            realAdd(...c);
        });

        chip()!.click();
        expect(calls).toEqual(['remove', 'add']);
        expect(chip()!.classList.contains('vtt-pulse')).toBe(true);
        expect(app.state.swapped).toBe(false);
    });

    test('a swap is never written to storage', () => {
        // Deliberately session-only, unlike the mode and the panel state. A
        // stray savePrefs here would make a swapped order outlive the video
        // that prompted it.
        const app = withHeader();
        const set = (global as any).chrome.storage.local.set as jest.Mock;
        // The stub must exist for the claim to be checkable at all: behind an
        // `if (set)` the whole assertion silently stopped running the moment
        // the stub was refactored away, and the check stayed green.
        expect(jest.isMockFunction(set)).toBe(true);
        set.mockClear();
        chip()!.click();
        expect(app.state.swapped).toBe(true);
        expect(set).not.toHaveBeenCalled();
    });

    test('with one language loaded the chip stays, and a press does nothing', () => {
        const app = makeApp();
        const header = document.createElement('div');
        header.id = 'vtt-header-top';
        document.body.appendChild(header);
        app.addParsedTrack('English', [sub('hello')]);
        app.updateLanguagePairChip();

        expect(chip()).not.toBeNull();
        expect(chip()!.hasAttribute('disabled')).toBe(false);
        expect(chip()!.getAttribute('aria-disabled')).not.toBe('true');
        chip()!.click();
        expect(app.state.swapped).toBe(false); // silently nothing, not an error
    });

    test('no chip at all before a language pair is chosen', () => {
        const app = makeApp();
        const header = document.createElement('div');
        header.id = 'vtt-header-top';
        document.body.appendChild(header);
        app.langPrefs = null;
        app.updateLanguagePairChip();
        expect(chip()).toBeNull();
    });
});

/**
 * Behaviour map §16.1, §16.4, §16.9 — the banner's fourth state.
 *
 * The empty panel has five states and eight wordings, and the class of defect
 * that already shipped once is one message standing where another belongs: the
 * expired-link escalation used to sit below an early return and never appeared.
 * Its sibling — the caption-less video, retried once — had no check at all, so
 * pointing it at the first-check copy would have been silent.
 */
describe('the fourth state: retried, and still nothing', () => {
    // The state the user reaches by pressing "Search again" on a video YouTube
    // genuinely offers nothing for.
    function retriedEmpty(): TestApp {
        const app = makeApp();
        app.noteTrackFailure('Russian', { failure: 'not-offered' });
        app.retrySubtitleSearch();
        app.noteTrackFailure('Russian', { failure: 'not-offered' });
        return app;
    }

    test('after one retry the wording changes to "still no subtitles"', () => {
        const app = makeApp();
        app.noteTrackFailure('Russian', { failure: 'not-offered' });
        // First pass: the honest first-check copy, and no claim of a retry.
        expect(bannerText()).toContain("doesn't have subtitles");
        expect(bannerText()).not.toMatch(/still no subtitles/i);

        app.retrySubtitleSearch();
        app.noteTrackFailure('Russian', { failure: 'not-offered' });

        expect(bannerText()).toMatch(/still no subtitles/i);
        expect(bannerText()).toMatch(/reload/i);
        // ...and not the first-check copy, which sends the reader off to
        // another video instead of offering the thing that fixes it.
        expect(bannerText()).not.toContain("Try another video");
    });

    test('the emergency reload appears only after that retry', () => {
        const app = makeApp();
        app.noteTrackFailure('Russian', { failure: 'not-offered' });
        const emergency = () =>
            actions().filter((b) =>
                b.classList.contains('vtt-empty-state-action--emergency'),
            );

        expect(emergency()).toHaveLength(0);

        app.retrySubtitleSearch();
        app.noteTrackFailure('Russian', { failure: 'not-offered' });

        expect(emergency()).toHaveLength(1);
        expect(emergency()[0].textContent).toContain('Reload page');
        // The normal recovery path stays offered beside it, not replaced by it.
        expect(actions().map((b) => b.textContent ?? '')).toEqual(
            expect.arrayContaining([expect.stringContaining('Search again')]),
        );
    });

    test('the emergency action is the only one carrying that class', () => {
        retriedEmpty();
        const plain = actions().filter(
            (b) => !b.classList.contains('vtt-empty-state-action--emergency'),
        );
        expect(plain.map((b) => b.textContent)).toEqual([
            expect.stringContaining('Search again'),
        ]);
    });
});

/**
 * §16.9 — the emergency reload is an escape hatch, not a feature.
 *
 * A source-text pin (the known-gaps.test.ts pattern): the rule is CSS injected
 * as a string, so no jsdom assertion can reach its declarations. What matters
 * is that nobody promotes it to a brand element — the quiet red is the whole
 * point, and a gradient there is exactly the drift this catches.
 */
describe('the emergency reload keeps its quiet-red styling', () => {
    const src = readFileSync(
        join(__dirname, '..', 'src', 'content', 'app-base.ts'),
        'utf8',
    );

    const emergencyRules = () => {
        const rules: string[] = [];
        const marker = '.vtt-empty-state-action--emergency';
        let from = 0;
        for (;;) {
            const at = src.indexOf(marker, from);
            if (at === -1) break;
            const open = src.indexOf('{', at);
            const close = src.indexOf('}', open);
            rules.push(src.slice(at, close + 1));
            from = close + 1;
        }
        return rules;
    };

    test('both rules exist — the resting one and its hover', () => {
        expect(emergencyRules()).toHaveLength(2);
    });

    test('no gradient and no brand accent in either rule', () => {
        for (const rule of emergencyRules()) {
            expect(rule).not.toMatch(/gradient/i);
            expect(rule).not.toMatch(/--vtt-(accent|brand|primary)/);
        }
    });

    test('the red is stated as red, in every declaration that carries a colour', () => {
        // rgba(248,113,113) / rgba(239,68,68) — the red family. A rule that
        // stopped being red would still be a rule; this is what says which one.
        for (const rule of emergencyRules()) {
            const colours = rule.match(/rgba?\([^)]*\)/g) ?? [];
            expect(colours.length).toBeGreaterThan(0);
            for (const c of colours) {
                const [r, g, b] = c
                    .replace(/rgba?\(|\)/g, '')
                    .split(',')
                    .map((n) => Number(n.trim()));
                expect(r).toBeGreaterThan(g);
                expect(r).toBeGreaterThan(b);
            }
        }
    });
});

/**
 * §16.1 — five states, their messages pinned as a set.
 *
 * The task sheet says eight messages; the code says seven bodies. Read in the
 * source (Art. D), the two throttled halves share one body verbatim and are
 * told apart only by their action — a live countdown label versus "Search
 * again". Seven is therefore what is pinned, and the eighth message is pinned
 * where it actually lives: on the button.
 *
 * Individually each wording has a check above. What none of them says is that
 * the seven are *distinct*: pointing the retried copy at the first-check copy
 * leaves every per-state assertion green, because each still finds the string
 * it looks for. This is the assertion that one message standing where another
 * belongs is a failure.
 */
describe('the empty-panel messages are all different messages', () => {
    const pair = () => [
        banner()?.querySelector('.vtt-empty-state-title')?.textContent ?? '',
        banner()?.querySelector('.vtt-empty-state-text')?.textContent ?? '',
    ];

    function collect(): Record<string, string[]> {
        const out: Record<string, string[]> = {};

        // A — searching.
        const a = makeApp();
        a.scheduleNoSubtitlesCheck(10_000);
        out.searching = pair();

        // E — deferred: the panel was closed, nothing was fetched.
        const e = makeApp();
        e.offerDeferredSearch();
        out.deferred = pair();

        // C — nothing offered, first check; and after one retry.
        const c = makeApp();
        c.noteTrackFailure('Russian', { failure: 'not-offered' });
        out.empty = pair();
        c.retrySubtitleSearch();
        c.noteTrackFailure('Russian', { failure: 'not-offered' });
        out.emptyRetried = pair();

        // D — an expired link, first check; and after one retry.
        const d = makeApp();
        d.noteTrackFailure('English', { failure: 'stale-url' });
        out.stale = pair();
        d.retrySubtitleSearch();
        d.noteTrackFailure('English', { failure: 'stale-url' });
        out.staleRetried = pair();

        // B — throttled, both halves: still cooling, and free to retry.
        const b = makeApp();
        b.noteTrackFailure('English', { failure: 'rate-limited', retryAfterMs: 30_000 });
        out.throttledCooling = pair();
        const b2 = makeApp();
        b2.noteTrackFailure('English', { failure: 'rate-limited' });
        out.throttled = pair();

        return out;
    }

    test('every state produced a title and a body', () => {
        for (const [state, [title, text]] of Object.entries(collect())) {
            expect([state, title === '']).toEqual([state, false]);
            expect([state, text === '']).toEqual([state, false]);
        }
    });

    test('the seven distinct bodies are seven distinct strings', () => {
        const states = collect();
        const bodies = Object.values(states).map(([, text]) => text);
        expect(bodies).toHaveLength(8);
        expect(new Set(bodies).size).toBe(7);
        // The one deliberate repeat, named so a NEW collision cannot hide
        // inside the allowance: same cause, one waiting and one free to retry.
        expect(states.throttledCooling[1]).toBe(states.throttled[1]);
    });

    test('the eighth message is the countdown that separates the two throttled halves', () => {
        // The halves share their body, so the label is the only thing that
        // tells the reader whether pressing anything can help yet.
        const cooling = makeApp();
        cooling.noteTrackFailure('English', {
            failure: 'rate-limited',
            retryAfterMs: 30_000,
        });
        const coolingLabels = actions().map((b) => b.textContent ?? '');
        expect(coolingLabels).toHaveLength(1);
        expect(coolingLabels[0]).toMatch(/Try again in \d+s/);
        expect(actions()[0].disabled).toBe(true);

        const free = makeApp();
        free.noteTrackFailure('English', { failure: 'rate-limited' });
        const freeLabels = actions().map((b) => b.textContent ?? '');
        expect(freeLabels).toHaveLength(1);
        expect(freeLabels[0]).toContain('Search again');
        expect(freeLabels[0]).not.toBe(coolingLabels[0]);
        expect(actions()[0].disabled).toBe(false);
    });

    test('the four titles that must differ do', () => {
        // The two throttled halves share a title by design (same cause, one
        // waiting and one ready); the other four name four different causes.
        const s = collect();
        const titles = [
            s.searching[0],
            s.deferred[0],
            s.empty[0],
            s.stale[0],
            s.throttled[0],
        ];
        expect(new Set(titles).size).toBe(5);
        expect(s.emptyRetried[0]).toBe(s.empty[0]);
        expect(s.staleRetried[0]).toBe(s.stale[0]);
        expect(s.throttledCooling[0]).toBe(s.throttled[0]);
    });
});

/**
 * Behaviour map §17.6, §18.6 — what the two pickers offer when a language
 * refuses to load.
 *
 * The dropdowns are the only place the panel says which languages it actually
 * has. A language that failed must not appear in them at all: an entry the
 * user can select loads nothing, and an entry they cannot select is a promise
 * the product has no way to keep — either way they go on pressing it.
 */
describe('the pickers when a language fails', () => {
    const mainSelect = () => document.getElementById('vtt-main-select') as HTMLSelectElement;
    const subSelect = () => document.getElementById('vtt-sub-select') as HTMLSelectElement;
    const optionsOf = (sel: HTMLSelectElement) =>
        [...sel.querySelectorAll('option')].map((o) => ({
            label: o.textContent ?? '',
            disabled: o.disabled,
        }));

    test('a total refusal leaves both pickers empty', () => {
        const app = makeApp();
        app.noteTrackFailure('English', { failure: 'rate-limited', retryAfterMs: 30_000 });
        app.noteTrackFailure('Russian', { failure: 'rate-limited', retryAfterMs: 30_000 });

        expect(app.state.tracks).toHaveLength(0);
        expect(optionsOf(mainSelect())).toEqual([]);
        expect(optionsOf(subSelect())).toEqual([]);
    });

    test('a refusal on a second video clears what the first one offered', () => {
        // The counter-half, and the one that actually catches a stale list:
        // with nothing ever loaded, "empty" is also what an unbuilt picker
        // looks like. This starts from a picker that DID offer something.
        const app = makeApp();
        app.addParsedTrack('English', [sub('hello')]);
        expect(optionsOf(mainSelect())).toHaveLength(1);

        app.videoId = 'vid2';
        app.resetForNewVideo();
        app.noteTrackFailure('English', { failure: 'rate-limited', retryAfterMs: 30_000 });

        expect(optionsOf(mainSelect())).toEqual([]);
        expect(optionsOf(subSelect())).toEqual([]);
    });

    test('a partial refusal offers the loaded language and only that', () => {
        const app = makeApp();
        app.addParsedTrack('English', [sub('hello')]);
        app.noteTrackFailure('Russian', { failure: 'not-offered' });

        // Exactly one option per picker, and it is the language that loaded.
        expect(optionsOf(mainSelect())).toEqual([{ label: 'English', disabled: false }]);
        expect(optionsOf(subSelect())).toEqual([{ label: 'English', disabled: false }]);
    });

    test('the failed language is not a ghost entry, enabled or disabled', () => {
        const app = makeApp();
        app.addParsedTrack('English', [sub('hello')]);
        app.noteTrackFailure('Russian', { failure: 'not-offered' });

        for (const sel of [mainSelect(), subSelect()]) {
            const labels = optionsOf(sel).map((o) => o.label);
            expect(labels).not.toContain('Russian');
            // Nor disguised: no option is disabled, because there is no
            // half-offer to make.
            expect(optionsOf(sel).some((o) => o.disabled)).toBe(false);
        }
    });

    test('the loss is still stated — in the notice, not the picker', () => {
        // The pickers stay silent about it; the compact notice is where the
        // reason belongs. Without this, "say nothing anywhere" passes above.
        //
        // Art. D: the notice names the LOSS, not the language — read in the
        // source, updatePartialFailureNotice() has no language in any of its
        // three wordings. It is the one line under the chip, and the chip
        // beside it already carries the pair.
        const app = makeApp();
        app.addParsedTrack('English', [sub('hello')]);
        app.noteTrackFailure('Russian', { failure: 'not-offered' });

        expect(noticeText()).toBe('No translation for this video');
        expect(mainSelect().textContent).not.toContain('Russian');
    });

    test('once the missing language loads it takes its place in both pickers', () => {
        const app = makeApp();
        app.addParsedTrack('English', [sub('hello')]);
        app.noteTrackFailure('Russian', { failure: 'rate-limited', retryAfterMs: 1_000 });
        expect(optionsOf(mainSelect())).toHaveLength(1);

        app.addParsedTrack('Russian', [sub('privet')]);

        expect(optionsOf(mainSelect()).map((o) => o.label)).toEqual(['English', 'Russian']);
        expect(optionsOf(subSelect()).map((o) => o.label)).toEqual(['English', 'Russian']);
    });
});

/**
 * Phase 5 — §22.6, §26.1 and §8.4.
 *
 * Three claims about what survives, what runs early, and what the mode chips
 * say about themselves. Appended as their own blocks rather than folded into
 * the ones above: each carries its own fixture.
 */
describe('the announcement is fetched before the pair is set', () => {
    // §22.6, T5.15. Deliberately fired from init() rather than from
    // updateOnboardingState(), so it also reaches users who have not picked
    // languages yet. A stuck new user is exactly who an outage announcement is
    // for; gating it on the pair would hide it from them.
    const notificationCalls = () =>
        (chrome.runtime.sendMessage as jest.Mock).mock.calls
            .map((c) => c[0])
            .filter((m) => m?.action === 'GET_NOTIFICATION');

    test('a first-run app with no pair still asks for one', () => {
        (chrome.runtime.sendMessage as jest.Mock).mockClear();
        document.body.innerHTML = '';
        const app = new TestApp();
        app.langPrefs = null;

        expect(app.langPrefs).toBeNull();
        expect(notificationCalls()).toHaveLength(1);
    });

    // The other side: having a pair does not make it fetch twice. init() is
    // the single site, so the count is one either way.
    test('a configured app asks exactly once too', () => {
        (chrome.runtime.sendMessage as jest.Mock).mockClear();
        makeApp();
        expect(notificationCalls()).toHaveLength(1);
    });
});

describe('the pair and the collapse survive a video change', () => {
    // §26.1, T5.20. resetForNewVideo() clears what belongs to the video that
    // just ended. The language pair and where the panel is sitting belong to
    // the USER, and nulling either would re-run onboarding — or slam the panel
    // open over the video — on every navigation.
    test('the language pair is untouched', () => {
        const app = makeApp();
        app.addParsedTrack('English', [sub('hello')]);

        app.resetForNewVideo();

        expect(app.langPrefs).toEqual({ learning: 'en', native: 'ru' });
    });

    test('a collapsed panel stays collapsed', () => {
        const app = makeApp();
        app.ui.toggleCollapsed();
        expect(app.isSidebarCollapsed()).toBe(true);

        app.resetForNewVideo();

        expect(app.isSidebarCollapsed()).toBe(true);
    });

    // Both sides: an open panel is equally the user's choice and must not be
    // collapsed by the reset either.
    test('an open panel stays open', () => {
        const app = makeApp();
        expect(app.isSidebarCollapsed()).toBe(false);

        app.resetForNewVideo();

        expect(app.isSidebarCollapsed()).toBe(false);
    });

    // What the reset IS for, asserted alongside — otherwise "nothing changed"
    // would satisfy the two checks above just as well as the real behaviour.
    test('the tracks and the pending requests are cleared', () => {
        const app = makeApp();
        app.addParsedTrack('English', [sub('hello')]);
        app.pendingRequests.set('k1', 'Russian');

        app.resetForNewVideo();

        expect(app.state.tracks).toHaveLength(0);
        expect(app.pendingRequests.size).toBe(0);
    });
});

describe('every mode control advertises its shortcut', () => {
    // §8.4, T5.25. Only Shift+D was asserted, on the Dual chip. The other three
    // shortcuts existed in the product and in nobody's check, so any of them
    // could be dropped from its tooltip — leaving a keyboard affordance that
    // nothing on screen mentions — with the suite still green.
    //
    // Article D: the map places all four in app-base.ts. Three of them are
    // built in SidebarUI.ts (the quick-modes bar); only Swap is here. Pinned
    // where each actually lives, by reading the built panel.
    const tipOf = (id: string): string =>
        (document.getElementById(id) as HTMLElement).dataset.tip ?? '';

    beforeEach(() => {
        makeApp();
    });

    test('Dual says Shift+D', () => {
        expect(tipOf('vtt-qm-dual')).toBe('Dual (Shift+D)');
    });

    test('Guess says Shift+G', () => {
        expect(tipOf('vtt-qm-guess')).toBe('Guess (Shift+G)');
    });

    test('On-screen says Shift+O', () => {
        expect(tipOf('vtt-qm-overlay')).toBe('On-screen (Shift+O)');
    });

    // The swap control is the language chip, whose tooltip is a native title —
    // the chip predates the data-tip mechanism the bar uses.
    test('Swap says Shift+S', () => {
        const app = makeApp();
        const header = document.createElement('div');
        header.id = 'vtt-header-top';
        document.body.appendChild(header);
        app.updateLanguagePairChip();
        expect(document.getElementById('vtt-langpair')!.title).toBe('Swap (Shift+S)');
    });

    // Single is the one mode with no shortcut, and its tooltip is the label
    // alone. Pinned so "add a shortcut" cannot happen silently, and so the
    // three above are not merely matching a template that appends anything.
    test('Single carries its label with no shortcut', () => {
        expect(tipOf('vtt-qm-single')).toBe('Single');
    });
});
