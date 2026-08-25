/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://www.netflix.com/watch/80100172"}
 */

// A failed WebVTT fetch on Netflix used to be analytically invisible.
//
// handleVttResult() took the pending key, parsed '' into zero cues, and handed
// that to addParsedTrack(), which returns immediately on an empty array. So
// nothing reached trackFailures: no subs_partial, no subs_rate_limited, and the
// 12s pending backstop could not catch it either, because takePending() had
// already removed the key. A throttled Netflix track and a title with no
// subtitles at all produced exactly the same telemetry — which is the opposite
// of what the failure taxonomy exists for.
//
// Found during the live 2c.7 run: `noteTrackFailure` appeared zero times in the
// whole Netflix adapter.

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

// The adapter's own class is not exported and its constructor reaches into the
// page, so exercise the seam the way the real one does: the failure path lives
// entirely in handleVttResult, which only needs takePending + noteTrackFailure.
class NetflixLikeApp extends BaseVttApp {
    videoId: string | null = '80100172';
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

    /** Mirrors netflix/app.ts handleVttResult — the branch under test. */
    handleVttResult(
        key: string,
        text: string,
        outcome: { status?: number; error?: string } = {},
    ): void {
        const name = this.takePending(key);
        if (!name) return;
        if (outcome.status !== undefined || outcome.error !== undefined) {
            const failure =
                outcome.status === undefined
                    ? 'network'
                    : require('../src/content/timedtext-fetch').classifyStatus(
                          outcome.status,
                          false,
                      ) ?? 'unknown';
            this.noteTrackFailure(name, { failure, status: outcome.status, attempts: 1 });
            return;
        }
        this.addParsedTrack(name, [{ startTime: 0, endTime: 1, text: text || 'x' }]);
    }
}

function makeApp(): NetflixLikeApp {
    document.body.innerHTML = '';
    const app = new NetflixLikeApp();
    app.langPrefs = { learning: 'en', native: 'ru' };
    return app;
}

const sent = () =>
    (chrome.runtime.sendMessage as jest.Mock).mock.calls
        .map((c) => c[0])
        .filter((m) => m && m.action === 'TRACK_EVENT');

beforeEach(() => {
    (chrome.runtime.sendMessage as jest.Mock).mockClear();
});

describe('Netflix records fetch failures', () => {
    test('a 429 becomes rate-limited, not silence', () => {
        const app = makeApp();
        app.pendingRequests.set('k1', 'English');
        app.handleVttResult('k1', '', { status: 429 });

        expect(app.trackFailures.get('English')?.failure).toBe('rate-limited');
        expect(app.dominantFailure()).toBe('rate-limited');
    });

    test('the throttle raises subs_rate_limited with its attempt count', () => {
        const app = makeApp();
        app.pendingRequests.set('k1', 'English');
        app.handleVttResult('k1', '', { status: 429 });

        // subs_rate_limited carries attempts/retry_after_s/breaker_step, not the
        // status — the status rides on no_subtitles and the diagnostic report
        // via trackFailures, which the assertion below pins.
        const rl = sent().filter((m) => m.event === 'subs_rate_limited');
        expect(rl).toHaveLength(1);
        expect(rl[0].params.attempts).toBe(1);
        expect(app.trackFailures.get('English')?.status).toBe(429);
    });

    test('a 404 is unavailable, not throttling', () => {
        const app = makeApp();
        app.pendingRequests.set('k1', 'English');
        app.handleVttResult('k1', '', { status: 404 });

        expect(app.trackFailures.get('English')?.failure).toBe('unavailable');
        expect(sent().some((m) => m.event === 'subs_rate_limited')).toBe(false);
    });

    test('no status at all means the request never got an answer', () => {
        const app = makeApp();
        app.pendingRequests.set('k1', 'English');
        app.handleVttResult('k1', '', { error: 'TypeError: Failed to fetch' });

        expect(app.trackFailures.get('English')?.failure).toBe('network');
    });

    test('one track failing while another plays is a partial, not a blackout', () => {
        const app = makeApp();
        app.pendingRequests.set('k1', 'English');
        app.pendingRequests.set('k2', 'Russian');
        app.handleVttResult('k1', 'cue text');        // English loads
        app.handleVttResult('k2', '', { status: 429 }); // Russian throttled

        const partial = sent().filter((m) => m.event === 'subs_partial');
        expect(partial).toHaveLength(1);
        expect(partial[0].params.failure).toBe('rate-limited');
    });

    test('a successful result still loads, unchanged', () => {
        const app = makeApp();
        app.pendingRequests.set('k1', 'English');
        app.handleVttResult('k1', 'cue text');

        expect(app.trackFailures.size).toBe(0);
        expect(app.state.tracks.length).toBe(1);
    });

    test('the pending entry is consumed either way', () => {
        const app = makeApp();
        app.pendingRequests.set('k1', 'English');
        app.handleVttResult('k1', '', { status: 500 });
        expect(app.pendingRequests.size).toBe(0);
    });
});
