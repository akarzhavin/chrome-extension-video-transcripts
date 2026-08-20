/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://www.youtube.com/watch?v=abc"}
 */

// Content-script analytics: which events fire, and — the part that actually
// breaks — how often.
//
// Every seam here is called many times per video: noteTrackFailure() runs once
// per failed track, evaluateSubtitleOutcome() once per evaluation cycle, and
// addParsedTrack() once per track. Without the one-shots a single throttling
// incident turns into dozens of hits and the data becomes unreadable. The
// subtle half is WHERE the one-shots reset: resetForNewVideo() also runs on
// every manual "Search again", so resetting there would report the same video
// once per retry.

(global as any).chrome = {
    runtime: {
        id: 'test-extension-id',
        getURL: (p: string) => `chrome-extension://test/${p}`,
        sendMessage: jest.fn(),
        getManifest: () => ({ version: '1.0.0' }),
        lastError: undefined,
    },
    i18n: { getMessage: () => '', getUILanguage: () => 'en' },
    storage: {
        local: { get: jest.fn().mockResolvedValue({}), set: jest.fn().mockResolvedValue(undefined) },
        onChanged: { addListener: jest.fn() },
    },
};

import { BaseVttApp, type ReprocessOptions } from '../src/content/app-base';
import type { Subtitle } from '@video-transcripts/shared';

class TestApp extends BaseVttApp {
    videoId: string | null = 'vid1';
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
    reprocessCurrentVideo(opts: ReprocessOptions = {}): void {
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

/** Every analytics message posted to the worker, in order. */
function sent(): Array<{ event: string; params: Record<string, unknown> }> {
    return (chrome.runtime.sendMessage as jest.Mock).mock.calls
        .map((c) => c[0])
        .filter((m) => m && m.action === 'TRACK_EVENT');
}

const eventsNamed = (name: string) => sent().filter((m) => m.event === name);

beforeEach(() => {
    (chrome.runtime.sendMessage as jest.Mock).mockClear();
});

describe('subtitles_loaded / dual_subs_shown', () => {
    // subtitles_loaded is debounced so track_count can count every track, so
    // these drive the timer rather than waiting on wall-clock.
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    /** Let the settle window elapse so a pending subtitles_loaded is sent. */
    const settle = () => jest.advanceTimersByTime(2_000);

    test('one subtitles_loaded per video however many tracks arrive', () => {
        const app = makeApp();
        app.addParsedTrack('English', [sub('a')]);
        app.addParsedTrack('Russian', [sub('b')]);
        app.addParsedTrack('German', [sub('c')]);
        settle();
        expect(eventsNamed('subtitles_loaded')).toHaveLength(1);
    });

    test('track_count counts every track, not just the first', () => {
        // Regression: the event used to be sent from the first track, freezing
        // track_count at 1. Measured on Netflix, the second track lands ~100ms
        // later — so every dual load was reported as a single-track one, and
        // the funnel understated the product working.
        const app = makeApp();
        app.addParsedTrack('English', [sub('a')]);
        jest.advanceTimersByTime(100);
        app.addParsedTrack('Russian', [sub('b')]);
        settle();
        expect(eventsNamed('subtitles_loaded')[0].params.track_count).toBe(2);
    });

    test('a track arriving late still pushes the count up', () => {
        const app = makeApp();
        app.addParsedTrack('English', [sub('a')]);
        jest.advanceTimersByTime(1_200);   // inside the window
        app.addParsedTrack('Russian', [sub('b')]);
        settle();
        const evs = eventsNamed('subtitles_loaded');
        expect(evs).toHaveLength(1);
        expect(evs[0].params.track_count).toBe(2);
    });

    test('dual_subs_shown waits for the second track', () => {
        const app = makeApp();
        app.addParsedTrack('English', [sub('a')]);
        expect(eventsNamed('dual_subs_shown')).toHaveLength(0);
        app.addParsedTrack('Russian', [sub('b')]);
        expect(eventsNamed('dual_subs_shown')).toHaveLength(1);
    });

    test('dual_subs_shown fires once, not once per later track', () => {
        const app = makeApp();
        app.addParsedTrack('English', [sub('a')]);
        app.addParsedTrack('Russian', [sub('b')]);
        app.addParsedTrack('German', [sub('c')]);
        expect(eventsNamed('dual_subs_shown')).toHaveLength(1);
    });

    test('carries the platform label and language pair, never a hostname', () => {
        const app = makeApp();
        app.addParsedTrack('English', [sub('a')]);
        app.addParsedTrack('Russian', [sub('b')]);
        const params = eventsNamed('dual_subs_shown')[0].params;
        expect(params.site).toBe('youtube');
        expect(params.learning).toBe('en');
        expect(params.native).toBe('ru');
    });

    test('a manual retry does NOT re-arm the one-shots', () => {
        // The whole reason the reset lives in resetNoSubsRetries() rather than
        // resetForNewVideo(): "Search again" runs the latter.
        const app = makeApp();
        app.addParsedTrack('English', [sub('a')]);
        app.addParsedTrack('Russian', [sub('b')]);
        settle();
        app.retrySubtitleSearch();
        app.addParsedTrack('English', [sub('a')]);
        app.addParsedTrack('Russian', [sub('b')]);
        settle();
        expect(eventsNamed('dual_subs_shown')).toHaveLength(1);
        expect(eventsNamed('subtitles_loaded')).toHaveLength(1);
    });

    test('a video change cancels a still-pending subtitles_loaded', () => {
        // Otherwise the count captured for the old video would be attributed to
        // the new one — worse than losing the event.
        const app = makeApp();
        app.addParsedTrack('English', [sub('a')]);
        app.resetNoSubsRetries();
        settle();
        expect(eventsNamed('subtitles_loaded')).toHaveLength(0);
    });

    test('a genuine video change does re-arm them', () => {
        const app = makeApp();
        app.addParsedTrack('English', [sub('a')]);
        app.addParsedTrack('Russian', [sub('b')]);
        app.resetNoSubsRetries();
        app.resetForNewVideo();
        app.addParsedTrack('English', [sub('a')]);
        app.addParsedTrack('Russian', [sub('b')]);
        expect(eventsNamed('dual_subs_shown')).toHaveLength(2);
    });
});

describe('subs_rate_limited', () => {
    test('fires on a throttled track with its diagnostics', () => {
        const app = makeApp();
        app.noteTrackFailure('Russian', {
            failure: 'rate-limited',
            attempts: 4,
            retryAfterMs: 30_000,
            breakerStep: 2,
            translation: true,
        });
        const ev = eventsNamed('subs_rate_limited');
        expect(ev).toHaveLength(1);
        expect(ev[0].params).toMatchObject({
            site: 'youtube',
            translation: true,
            attempts: 4,
            retry_after_s: 30,
            breaker_step: 2,
        });
    });

    test('one event per video, not one per failed track', () => {
        const app = makeApp();
        for (const name of ['Russian', 'German', 'French', 'Spanish', 'Italian']) {
            app.noteTrackFailure(name, { failure: 'rate-limited', attempts: 4 });
        }
        expect(eventsNamed('subs_rate_limited')).toHaveLength(1);
    });

    test('does not fire for a non-throttle failure', () => {
        const app = makeApp();
        app.noteTrackFailure('Russian', { failure: 'not-offered' });
        expect(eventsNamed('subs_rate_limited')).toHaveLength(0);
    });
});

describe('subs_partial', () => {
    test('fires when one track plays and another failed', () => {
        const app = makeApp();
        app.addParsedTrack('English', [sub('a')]);
        app.noteTrackFailure('Russian', { failure: 'rate-limited' });
        expect(eventsNamed('subs_partial')).toHaveLength(1);
    });

    test('distinguishes throttling from an unavailable translation', () => {
        // The entire reason these are separate params: identical to the user,
        // completely different fixes.
        const throttled = makeApp();
        throttled.addParsedTrack('English', [sub('a')]);
        throttled.noteTrackFailure('Russian', { failure: 'rate-limited' });
        expect(eventsNamed('subs_partial')[0].params).toMatchObject({
            failure: 'rate-limited',
            throttled: true,
        });

        (chrome.runtime.sendMessage as jest.Mock).mockClear();

        const notOffered = makeApp();
        notOffered.addParsedTrack('English', [sub('a')]);
        notOffered.noteTrackFailure('Russian', { failure: 'not-offered' });
        expect(eventsNamed('subs_partial')[0].params).toMatchObject({
            failure: 'not-offered',
            throttled: false,
        });
    });

    test('does not fire when nothing loaded at all', () => {
        // That case is no_subtitles' — a total failure is not a partial one.
        const app = makeApp();
        app.noteTrackFailure('English', { failure: 'network' });
        expect(eventsNamed('subs_partial')).toHaveLength(0);
    });

    test('one event per video however many evaluations run', () => {
        const app = makeApp();
        app.addParsedTrack('English', [sub('a')]);
        app.noteTrackFailure('Russian', { failure: 'rate-limited' });
        app.evaluateSubtitleOutcome();
        app.evaluateSubtitleOutcome();
        expect(eventsNamed('subs_partial')).toHaveLength(1);
    });
});

describe('subs_recovered', () => {
    test('fires when the missing track finally lands', () => {
        const app = makeApp();
        app.addParsedTrack('English', [sub('a')]);
        app.noteTrackFailure('Russian', { failure: 'rate-limited' });
        app.addParsedTrack('Russian', [sub('b')]);
        expect(eventsNamed('subs_recovered')).toHaveLength(1);
    });

    test('labels an automatic probe against a manual retry', () => {
        // This is what says whether AUTO_PROBE_LIMIT is set high enough.
        const auto = makeApp();
        auto.addParsedTrack('English', [sub('a')]);
        auto.noteTrackFailure('Russian', { failure: 'rate-limited' });
        auto.retrySubtitleSearch({ auto: true });
        auto.addParsedTrack('Russian', [sub('b')]);
        expect(eventsNamed('subs_recovered')[0].params.via).toBe('auto_probe');

        (chrome.runtime.sendMessage as jest.Mock).mockClear();

        const manual = makeApp();
        manual.addParsedTrack('English', [sub('a')]);
        manual.noteTrackFailure('Russian', { failure: 'rate-limited' });
        manual.retrySubtitleSearch();
        manual.addParsedTrack('Russian', [sub('b')]);
        expect(eventsNamed('subs_recovered')[0].params.via).toBe('manual_retry');
    });

    test('does not fire on a clean load that never failed', () => {
        const app = makeApp();
        app.addParsedTrack('English', [sub('a')]);
        app.addParsedTrack('Russian', [sub('b')]);
        expect(eventsNamed('subs_recovered')).toHaveLength(0);
    });

    test('a retry that clears trackFailures does not fake a recovery', () => {
        // resetForNewVideo() empties the map, so keying off "the map became
        // empty" would report a recovery that never happened.
        const app = makeApp();
        app.addParsedTrack('English', [sub('a')]);
        app.noteTrackFailure('Russian', { failure: 'rate-limited' });
        (chrome.runtime.sendMessage as jest.Mock).mockClear();
        app.retrySubtitleSearch(); // clears trackFailures, recovers nothing
        expect(eventsNamed('subs_recovered')).toHaveLength(0);
    });

    test('a second throttle on the same video does not re-report', () => {
        // The one-shot is per video, not per episode: after a recovery the
        // scope has not changed, so a fresh failure stays quiet until the user
        // actually moves to another video.
        const app = makeApp();
        app.addParsedTrack('English', [sub('a')]);
        app.noteTrackFailure('Russian', { failure: 'rate-limited' });
        app.addParsedTrack('Russian', [sub('b')]);
        expect(eventsNamed('subs_rate_limited')).toHaveLength(1);

        app.noteTrackFailure('German', { failure: 'rate-limited' });
        expect(eventsNamed('subs_rate_limited')).toHaveLength(1); // still one

        app.resetNoSubsRetries(); // genuine video change
        app.noteTrackFailure('German', { failure: 'rate-limited' });
        expect(eventsNamed('subs_rate_limited')).toHaveLength(2);
    });

    test('a recovery re-arms hadFailures so the next episode is measurable', () => {
        const app = makeApp();
        app.addParsedTrack('English', [sub('a')]);
        app.noteTrackFailure('Russian', { failure: 'rate-limited' });
        app.addParsedTrack('Russian', [sub('b')]);
        expect(app.hadFailures).toBe(false); // consumed by the recovery
        app.noteTrackFailure('German', { failure: 'network' });
        expect(app.hadFailures).toBe(true); // set again by the new failure
    });

    test('reports how long the user waited', () => {
        const app = makeApp();
        app.addParsedTrack('English', [sub('a')]);
        app.noteTrackFailure('Russian', { failure: 'rate-limited' });
        app.firstFailureAt = Date.now() - 45_000;
        app.addParsedTrack('Russian', [sub('b')]);
        expect(eventsNamed('subs_recovered')[0].params.waited_s).toBeGreaterThanOrEqual(44);
    });
});

describe('no_subtitles', () => {
    test('carries the reason, not just the absence', () => {
        const app = makeApp();
        app.noteTrackFailure('English', {
            failure: 'rate-limited',
            status: 429,
            attempts: 4,
        });
        app.declareNoSubtitles();
        const ev = eventsNamed('no_subtitles');
        expect(ev).toHaveLength(1);
        expect(ev[0].params).toMatchObject({
            site: 'youtube',
            failure: 'rate-limited',
            status: 429,
            attempts: 4,
        });
    });

    test('records whether the user had already retried', () => {
        const app = makeApp();
        app.retrySubtitleSearch();
        app.declareNoSubtitles();
        expect(eventsNamed('no_subtitles')[0].params.retried).toBe(true);
    });

    test('fires once even if the banner is re-declared', () => {
        const app = makeApp();
        app.declareNoSubtitles();
        app.declareNoSubtitles();
        expect(eventsNamed('no_subtitles')).toHaveLength(1);
    });

    // The '' regression: 71% of production events carried an empty failure,
    // silently merging "video has no subs" with real load breakage. The
    // resolution order is dominantFailure() ?? cause ?? 'unknown'.
    test('never sends an empty failure', () => {
        const app = makeApp();
        app.declareNoSubtitles();
        expect(eventsNamed('no_subtitles')[0].params.failure).toBe('unknown');
    });

    test.each([
        ['no-tracks'],
        ['no-language-match'],
        ['not-attempted'],
        ['timeout'],
    ] as const)('a structural cause is reported: %s', (cause) => {
        const app = makeApp();
        app.declareNoSubtitles(cause);
        expect(eventsNamed('no_subtitles')[0].params.failure).toBe(cause);
    });

    test('a recorded real failure outranks the cause', () => {
        const app = makeApp();
        app.noteTrackFailure('English', { failure: 'rate-limited', status: 429 });
        app.declareNoSubtitles('not-attempted');
        expect(eventsNamed('no_subtitles')[0].params.failure).toBe('rate-limited');
    });

    test('an aborted-only failure map resolves to unknown, not empty', () => {
        // dominantFailure() deliberately skips 'aborted' — the map is non-empty
        // yet yields undefined, the sneakiest path to the old empty string.
        const app = makeApp();
        app.noteTrackFailure('English', { failure: 'aborted' });
        app.declareNoSubtitles();
        expect(eventsNamed('no_subtitles')[0].params.failure).toBe('unknown');
    });

    test('carries the language pair', () => {
        const app = makeApp();
        app.declareNoSubtitles('no-tracks');
        expect(eventsNamed('no_subtitles')[0].params).toMatchObject({
            learning: 'en',
            native: 'ru',
        });
    });

    describe('grace timer', () => {
        beforeEach(() => jest.useFakeTimers());
        afterEach(() => jest.useRealTimers());

        test('nothing attempted → not-attempted', () => {
            const app = makeApp();
            app.scheduleNoSubtitlesCheck(7_000);
            jest.advanceTimersByTime(7_000);
            expect(eventsNamed('no_subtitles')[0].params.failure).toBe('not-attempted');
        });

        test('requests still in flight → timeout', () => {
            // A wedged page-script is a reply that never came, not a video
            // nobody asked about — schedulePendingTrackCheck only covers the
            // half-loaded case, so this is the all-empty watchdog.
            const app = makeApp();
            app.pendingRequests.set('k1', 'English');
            app.scheduleNoSubtitlesCheck(7_000);
            jest.advanceTimersByTime(7_000);
            expect(eventsNamed('no_subtitles')[0].params.failure).toBe('timeout');
        });
    });
});

describe('onboarding_shown', () => {
    test('fires once when the picker is actually rendered', () => {
        const app = makeApp();
        const sidebar = document.createElement('div');
        sidebar.id = 'vtt-sidebar';
        document.body.appendChild(sidebar);
        app.showLanguageOnboarding();
        app.showLanguageOnboarding(); // early-returns: banner already present
        expect(eventsNamed('onboarding_shown')).toHaveLength(1);
    });

    test('does not fire when there is no sidebar to render into', () => {
        const app = makeApp();
        // makeApp() wipes the body, but init() re-injects the sidebar; remove
        // it so this exercises the genuine no-sidebar early return.
        document.getElementById('vtt-sidebar')?.remove();
        (chrome.runtime.sendMessage as jest.Mock).mockClear();
        app.showLanguageOnboarding();
        expect(eventsNamed('onboarding_shown')).toHaveLength(0);
    });
});

describe('silent second track (the timeout backstop)', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    // Production order matters here and these tests enforce it: requestVtt()
    // arms the timer for BOTH tracks up front, and the first reply arrives
    // afterwards. Arming last (as an earlier version of these tests did) hides
    // the case where landing a track cancels the backstop that was watching the
    // other one.
    test('a request that never answers becomes a visible failure', () => {
        // Without this the app sits in a half-loaded state forever: Dual is
        // disabled, no notice explains why, and nothing is recorded anywhere.
        const app = makeApp();
        app.pendingRequests.set('key-en', 'English');
        app.pendingRequests.set('key-ru', 'Russian');
        app.schedulePendingTrackCheck(1000);
        app.takePending('key-en'); // English replies
        app.addParsedTrack('English', [sub('a')]);
        expect(app.trackFailures.size).toBe(0);

        jest.advanceTimersByTime(1000);

        expect(app.trackFailures.get('Russian')?.failure).toBe('timeout');
        expect(eventsNamed('subs_partial')).toHaveLength(1);
        expect(eventsNamed('subs_partial')[0].params.failure).toBe('timeout');
    });

    test('does not fire once the reply actually arrives', () => {
        const app = makeApp();
        app.pendingRequests.set('key-en', 'English');
        app.pendingRequests.set('key-ru', 'Russian');
        app.schedulePendingTrackCheck(1000);
        app.takePending('key-en');
        app.addParsedTrack('English', [sub('a')]);
        app.takePending('key-ru'); // the slow reply landed after all
        app.addParsedTrack('Russian', [sub('b')]);
        jest.advanceTimersByTime(1000);
        expect(app.trackFailures.size).toBe(0);
    });

    test('a new video drops the backstop armed for the old one', () => {
        const app = makeApp();
        app.pendingRequests.set('key-ru', 'Russian');
        app.schedulePendingTrackCheck(1000);
        app.resetForNewVideo();
        app.pendingRequests.set('key-de', 'German'); // next video's request
        jest.advanceTimersByTime(1000);
        // The old timer must not report the new video's still-young request.
        expect(app.trackFailures.size).toBe(0);
    });

    test('stays out of the way when nothing loaded at all', () => {
        // That is declareNoSubtitles' territory, not a partial failure.
        const app = makeApp();
        app.pendingRequests.set('key-en', 'English');
        app.schedulePendingTrackCheck(1000);
        jest.advanceTimersByTime(1000);
        expect(app.trackFailures.size).toBe(0);
    });
});

describe('waited_s', () => {
    test('measures from the FIRST failure, not the last', () => {
        // A throttle episode that takes three failures to clear should report
        // the whole wait, not just the tail of it.
        const app = makeApp();
        app.addParsedTrack('English', [sub('a')]);
        app.noteTrackFailure('Russian', { failure: 'rate-limited' });
        const first = Date.now() - 60_000;
        app.firstFailureAt = first;
        app.noteTrackFailure('Russian', { failure: 'rate-limited' }); // later failure
        expect(app.firstFailureAt).toBe(first); // not overwritten
        app.addParsedTrack('Russian', [sub('b')]);
        expect(eventsNamed('subs_recovered')[0].params.waited_s).toBeGreaterThanOrEqual(59);
    });
});

describe('REPORT_NO_SUBS carries the cause', () => {
    test('the diagnostic message says WHY, not just that subtitles were missing', async () => {
        const app = makeApp();
        app.addParsedTrack('English', [sub('a')]);
        app.noteTrackFailure('Russian', {
            failure: 'rate-limited',
            status: 429,
            attempts: 4,
        });
        (chrome.runtime.sendMessage as jest.Mock).mockClear();

        // reportNoSubsAndReload() ends in location.reload(), which jsdom logs
        // as "not implemented" but does not throw. Letting the real method run
        // means the assertion below is against the actual message, not a
        // hand-built copy of what it is supposed to contain.
        await app.reportNoSubsAndReload();

        const report = (chrome.runtime.sendMessage as jest.Mock).mock.calls
            .map((c) => c[0])
            .find((m) => m && m.action === 'REPORT_NO_SUBS');
        expect(report).toMatchObject({
            failure: 'rate-limited',
            status: 429,
            attempts: 4,
            tracksLoaded: 1,
        });
    });
});

describe('never leaks identifying data', () => {
    test('no event carries a URL, video id, or hostname', () => {
        const app = makeApp();
        app.addParsedTrack('English', [sub('a')]);
        app.addParsedTrack('Russian', [sub('b')]);
        app.noteTrackFailure('German', { failure: 'rate-limited' });
        app.declareNoSubtitles();
        const blob = JSON.stringify(sent());
        expect(blob).not.toContain('watch?v=');
        expect(blob).not.toContain('www.youtube.com');
        expect(blob).not.toContain('abc'); // the video id
    });
});
