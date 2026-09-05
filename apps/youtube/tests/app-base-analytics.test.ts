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

import {
    BaseVttApp,
    REPORT_NO_SUBS_TIMEOUT_MS,
    type ReprocessOptions,
} from '../src/content/app-base';
import type { Subtitle } from '@video-transcripts/shared';
// The worker's runtime allow-list, for the funnel-set check at the end.
import { ALL_ANALYTICS_EVENTS } from '@video-transcripts/shared';

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

/** Let the queryNativeCc() promise chain settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

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

        test('requests still in flight → nothing is concluded yet', () => {
            // The grace period used to call this "timeout" at 7s. It cannot:
            // a request that is still retrying against a Retry-After has not
            // said anything, and reporting a verdict from silence produced a
            // measured 7-second window in which the reader was told a captioned
            // video had no captions.
            const app = makeApp();
            app.pendingRequests.set('k1', 'English');
            app.scheduleNoSubtitlesCheck(7_000);
            jest.advanceTimersByTime(7_000);
            expect(eventsNamed('no_subtitles')).toHaveLength(0);
        });

        test('a reply that never comes is still reported, just later', () => {
            // The watchdog is kept, not removed: a wedged page-script must not
            // leave the panel searching for ever. It waits long enough for the
            // fetch layer's own retry schedule to finish first.
            const app = makeApp();
            app.pendingRequests.set('k1', 'English');
            app.scheduleNoSubtitlesCheck(7_000);
            jest.advanceTimersByTime(7_000 + 30_000);
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

    // The budget IS the feature. It was 400ms, and a live run showed the report
    // losing that race essentially every time: an MV3 worker has to cold-start,
    // refresh a token and reach Firestore before the unconditional reload fires.
    // The value is asserted rather than assumed because shrinking it back
    // silently disables diagnostics — the failure mode is an empty collection,
    // not an error anyone would notice.
    test('the send is given long enough for a cold service worker', () => {
        // Pinned to the literal the map states (2.5 s), not to a range: the
        // range this used to accept (2000..3000) let a drift to 2.9 s pass,
        // and a drift is exactly what this exists to notice. Still bounded by
        // the same reasoning — the user pressed a button that promises a
        // reload — the bound is just no longer loose.
        expect(REPORT_NO_SUBS_TIMEOUT_MS).toBe(2500);
    });

    test('a worker that never answers still lets the page reload', async () => {
        const app = makeApp();
        app.noteTrackFailure('Russian', { failure: 'network' });
        // A send that never settles: only the timeout can end the race.
        (chrome.runtime.sendMessage as jest.Mock).mockImplementation(
            () => new Promise(() => {}),
        );
        jest.useFakeTimers();
        const done = app.reportNoSubsAndReload();
        jest.advanceTimersByTime(REPORT_NO_SUBS_TIMEOUT_MS + 50);
        await expect(done).resolves.toBeUndefined();
        jest.useRealTimers();
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

// ---------------------------------------------------------------------------
// subs_missed_with_cc
// ---------------------------------------------------------------------------

// The one signal that is unambiguously our own failure: the panel is empty
// while the site's own caption control says captions exist. Deliberately not a
// param on no_subtitles, which also fires for the healthy "this video has no
// captions" case.
describe('subs_missed_with_cc', () => {
    function appWithCc(state: 'yes' | 'no' | 'unknown'): TestApp {
        const app = makeApp();
        app.queryNativeCc = () => Promise.resolve(state);
        return app;
    }

    test('fires when native CC exists but nothing loaded', async () => {
        const app = appWithCc('yes');
        app.noteTrackFailure('English', { failure: 'stale-url', status: 200, attempts: 3 });
        app.declareNoSubtitles();
        await flush();

        const hits = eventsNamed('subs_missed_with_cc');
        expect(hits).toHaveLength(1);
        expect(hits[0].params).toMatchObject({ failure: 'stale-url', status: 200, attempts: 3 });
    });

    // A video that genuinely has no captions is not breakage — this event must
    // stay readable as a pure failure count with no filtering.
    test('stays silent when the native control says there are no captions', async () => {
        const app = appWithCc('no');
        app.declareNoSubtitles('no-tracks');
        await flush();

        expect(eventsNamed('subs_missed_with_cc')).toHaveLength(0);
        expect(eventsNamed('no_subtitles')).toHaveLength(1);
    });

    // The control renders late and is absent on some surfaces; counting an
    // unreadable button as "captions exist" would invent breakage out of timing.
    test('stays silent when the native control could not be read', async () => {
        const app = appWithCc('unknown');
        app.declareNoSubtitles('no-tracks');
        await flush();

        expect(eventsNamed('subs_missed_with_cc')).toHaveLength(0);
    });

    // Same one-shot discipline as no_subtitles: "Search again" runs
    // resetForNewVideo(), which must not re-arm the event for one video.
    test('reports one miss per video, not one per retry', async () => {
        const app = appWithCc('yes');
        app.noteTrackFailure('English', { failure: 'stale-url' });
        app.declareNoSubtitles();
        await flush();

        app.retrySubtitleSearch();
        app.noteTrackFailure('English', { failure: 'stale-url' });
        app.declareNoSubtitles();
        await flush();

        expect(eventsNamed('subs_missed_with_cc')).toHaveLength(1);
    });

    // The CC answer is a postMessage round trip, so a track can land while it
    // is in flight — nothing was missed in that case.
    test('does not report a miss when a track lands during the CC query', async () => {
        const app = makeApp();
        let answer: (s: 'yes') => void = () => {};
        app.queryNativeCc = () => new Promise((r) => { answer = r as (s: 'yes') => void; });

        app.noteTrackFailure('English', { failure: 'stale-url' });
        app.declareNoSubtitles();
        app.addParsedTrack('English', [sub('late but here')]);
        answer('yes');
        await flush();

        expect(eventsNamed('subs_missed_with_cc')).toHaveLength(0);
    });

    // The CC answer is a postMessage round trip with a timeout, so it can
    // outlive a navigation. A video change re-arms analyticsOnce and zeroes
    // noSubsRetries, so without an explicit check the late callback sails
    // through every guard and reports the OLD video's failure against the NEW
    // video's prefs — while consuming the new video's one-shot slot.
    test('does not report the old video when the CC answer outlives a navigation', async () => {
        const app = makeApp();
        let answer: (s: 'yes') => void = () => {};
        app.queryNativeCc = () => new Promise((r) => { answer = r as (s: 'yes') => void; });

        app.noteTrackFailure('English', { failure: 'stale-url' });
        app.declareNoSubtitles();

        // Navigate while the round trip is still in flight.
        app.videoId = 'vid2';
        app.resetNoSubsRetries();
        app.resetForNewVideo();

        answer('yes');
        await flush();

        expect(eventsNamed('subs_missed_with_cc')).toHaveLength(0);
    });

    // A genuine video change re-arms it, or a user hitting a broken run of
    // videos would be counted once.
    test('re-arms on a real video change', async () => {
        const app = appWithCc('yes');
        app.noteTrackFailure('English', { failure: 'stale-url' });
        app.declareNoSubtitles();
        await flush();

        app.resetNoSubsRetries();
        app.resetForNewVideo();
        app.noteTrackFailure('English', { failure: 'stale-url' });
        app.declareNoSubtitles();
        await flush();

        expect(eventsNamed('subs_missed_with_cc')).toHaveLength(2);
    });
});

/**
 * §33.2, T5.30 — the setup funnel is a pinned set.
 *
 * The funnel is read as a ratio: how many of the people shown the picker went
 * on to configure a pair. Both halves of that ratio are event names, and a
 * rename breaks the report silently — GA4 accepts the new name with a 204 and
 * simply starts a second, empty series while the first flatlines. Nobody is
 * told; the funnel just reads as a cliff.
 *
 * So the SET is pinned, not the presence of each name: an event added to the
 * run is as much a change to the ratio as one removed.
 */
describe('the setup funnel is a pinned set', () => {
    /** Every analytics event name emitted, in order, with no de-duplication. */
    const namesSent = (): string[] => sent().map((m) => m.event);

    test('a full first run emits exactly the two funnel events', async () => {
        (chrome.runtime.sendMessage as jest.Mock).mockClear();
        document.body.innerHTML = '';
        const app = new TestApp();
        app.langPrefs = null;

        // The picker is shown: step one.
        const sidebar = document.getElementById('vtt-sidebar') ?? document.createElement('div');
        sidebar.id = 'vtt-sidebar';
        if (!sidebar.parentElement) document.body.appendChild(sidebar);
        app.showLanguageOnboarding();

        // The user picks both languages: step two. Driven through the real
        // selects, so a picker that stops persisting fails here too.
        const selects = document.querySelectorAll('#vtt-lang-onboarding select');
        expect(selects).toHaveLength(2);
        const pick = (select: Element, code: string): void => {
            (select as HTMLSelectElement).value = code;
            select.dispatchEvent(new Event('change', { bubbles: true }));
        };
        pick(selects[0], 'en');
        pick(selects[1], 'ru');
        await flush();

        expect(namesSent()).toEqual(['onboarding_shown', 'languages_configured']);
    });

    // Order is part of the claim: shown before configured. A funnel whose steps
    // arrive out of order is a funnel with a negative conversion rate.
    test('the picker is reported before the pair is', async () => {
        (chrome.runtime.sendMessage as jest.Mock).mockClear();
        document.body.innerHTML = '';
        const app = new TestApp();
        app.langPrefs = null;
        const sidebar = document.createElement('div');
        sidebar.id = 'vtt-sidebar';
        document.body.appendChild(sidebar);
        app.showLanguageOnboarding();
        await flush();

        const names = namesSent();
        expect(names.indexOf('onboarding_shown')).toBeGreaterThanOrEqual(0);
        expect(names.indexOf('languages_configured')).toBe(-1);
    });

    // Both names are in the runtime allow-list the worker checks at the message
    // boundary. A name the product sends but the list does not carry is dropped
    // there — the same silent hole, one hop later.
    test('both names are ones the worker will accept', () => {
        expect(ALL_ANALYTICS_EVENTS).toContain('onboarding_shown');
        expect(ALL_ANALYTICS_EVENTS).toContain('languages_configured');
    });
});
