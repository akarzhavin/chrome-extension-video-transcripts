/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://rezka.ag/films/drama/12345-example.html"}
 */

// Rezka-side analytics. Two things differ from the YouTube edition and both
// are worth pinning:
//
//  - there is no per-video reset here (one page is one title), so the one-shot
//    scope is the page load;
//  - rezka names tracks by sniffing their content rather than requesting a
//    planned pair, so it cannot say WHICH half is missing — only that one is.
//
// KNOWN LIMITATION of the Harness below: it re-implements index.ts rather than
// importing it, because that module calls bootstrap() at load and VttApp is not
// exported. So these tests pin the intended CONTRACT, not the shipped code —
// a divergence between the two passes here. That is not theoretical: on
// 2026-08-11 subtitles_loaded was reporting track_count=1 for every dual load
// on a live rezka page while this suite stayed green. Live verification
// (docs/analytics-manual-check.md) is what actually covers this file.

const sendMessageMock = jest.fn();
let messageListener: ((req: any) => void) | null = null;

(global as any).chrome = {
    runtime: {
        id: 'test-extension-id',
        getURL: (p: string) => `chrome-extension://test/${p}`,
        getManifest: () => ({ version: '1.0.0' }),
        sendMessage: sendMessageMock,
        onMessage: {
            addListener: jest.fn((l: any) => {
                messageListener = l;
            }),
        },
        // Importing the background module runs installAuthBackground() and
        // installOnboarding() at module scope, so their APIs must exist even
        // though this suite only exercises classifyStatus().
        onMessageExternal: { addListener: jest.fn() },
        onInstalled: { addListener: jest.fn() },
        OnInstalledReason: { INSTALL: 'install', UPDATE: 'update' },
        setUninstallURL: jest.fn(),
        lastError: undefined,
    },
    tabs: { create: jest.fn(), sendMessage: jest.fn() },
    action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn() },
    i18n: { getMessage: () => '', getUILanguage: () => 'en' },
    storage: {
        local: { get: jest.fn().mockResolvedValue({}), set: jest.fn().mockResolvedValue(undefined) },
        onChanged: { addListener: jest.fn() },
    },
};

import { platformOf } from '@video-transcripts/shared';

function tracked(): Array<{ event: string; params: Record<string, unknown> }> {
    return sendMessageMock.mock.calls
        .map((c) => c[0])
        .filter((m) => m && m.action === 'TRACK_EVENT');
}

const named = (n: string) => tracked().filter((m) => m.event === n);

beforeEach(() => {
    sendMessageMock.mockReset();
    messageListener = null;
});

describe('platform label on a rezka mirror', () => {
    test('every mirror TLD collapses to one value', () => {
        // ~250 mirrors are listed in the manifest; if each reported its own
        // hostname the parameter would be useless and would burn GA4's
        // cardinality budget for nothing.
        for (const host of [
            'rezka.ag',
            'rezka.ai',
            'rezka-ua.tv',
            'hdrezka.website',
            'www.rezka.ag',
            'voidboost.net',
        ]) {
            expect(platformOf(host)).toBe('rezka');
        }
    });

    test('the current test page reports as rezka, not as a hostname', () => {
        expect(platformOf(location.hostname)).toBe('rezka');
    });
});

describe('VTT_LOAD_FAILED plumbing', () => {
    // The background worker used to swallow the HTTP status in a console.error,
    // so the content script had only a timeout to go on and told the user the
    // video had no subtitles — for what was often a 429. These assert the
    // message contract that replaced that.
    test('the failure message carries a status and a classified reason', async () => {
        const { classifyStatus } = await import('../src/background/background');
        const msg = {
            action: 'VTT_LOAD_FAILED',
            url: 'https://cdn/subs.vtt',
            status: 429,
            failure: classifyStatus(429),
        };
        expect(msg.failure).toBe('rate-limited');
        expect(msg.status).toBe(429);
    });

    test('a missing status still classifies as something actionable', async () => {
        const { classifyStatus } = await import('../src/background/background');
        // fetch() threw before any response — a network problem, not a limit.
        expect(classifyStatus(undefined)).toBe('network');
    });
});

describe('a 429 from the CDN reaches analytics as throttling', () => {
    // Checklist 2b.23 end to end, minus the browser. Rezka is geo-blocked (403)
    // from this environment, so the DevTools response-override route is not
    // available; the seam that matters is the same either way — the classified
    // status arriving at the content script and turning into an event rather
    // than into "Subtitles didn't load", which blamed the video for a limit.

    class Harness {
        hadFailures = false;
        firstFailureAt = 0;
        lastFailure = '';
        lastFailureStatus: number | undefined;
        state = { tracks: [] as unknown[] };
        langPrefs: { learning: string; native: string } | null = { learning: 'en', native: 'ru' };
        // Each frame runs its own content script with its own one-shots, so the
        // set is per-instance exactly as OncePerScope is in production.
        private fired = new Set<string>();

        constructor(readonly isTopWindow: boolean = true) {}

        /** Mirrors index.ts handleVttLoadFailed — same order, same one-shots. */
        handleVttLoadFailed(info: { status?: number; failure?: string }): void {
            const failure = info.failure ?? 'unknown';
            if (!this.hadFailures) {
                this.hadFailures = true;
                this.firstFailureAt = Date.now();
            }
            this.lastFailure = failure;
            this.lastFailureStatus = info.status;
            if (!this.isTopWindow) return;
            if (failure === 'rate-limited' && !this.fired.has('subs_rate_limited')) {
                this.fired.add('subs_rate_limited');
                sendMessageMock({
                    action: 'TRACK_EVENT',
                    event: 'subs_rate_limited',
                    params: { site: platformOf(location.hostname), translation: false },
                });
            }
            if (this.state.tracks.length > 0 && !this.fired.has('subs_partial')) {
                this.fired.add('subs_partial');
                sendMessageMock({
                    action: 'TRACK_EVENT',
                    event: 'subs_partial',
                    params: {
                        site: platformOf(location.hostname),
                        failure,
                        throttled: failure === 'rate-limited',
                    },
                });
            }
        }

        /**
         * Mirrors index.ts declareNoSubtitles — the failure param is never the
         * empty string: on rezka the player only fetches a track once it's
         * picked in the CC menu, so "nothing reported a failure" means no
         * track was selected, an expected absence rather than an error.
         */
        declareNoSubtitles(): void {
            if (!this.langPrefs) return;
            if (this.state.tracks.length > 0) return;
            if (this.fired.has('no_subtitles')) return;
            this.fired.add('no_subtitles');
            sendMessageMock({
                action: 'TRACK_EVENT',
                event: 'no_subtitles',
                params: {
                    site: platformOf(location.hostname),
                    retried: false,
                    failure: this.lastFailure || 'not-selected',
                    status: this.lastFailureStatus ?? 0,
                    attempts: 0,
                    learning: this.langPrefs?.learning ?? '',
                    native: this.langPrefs?.native ?? '',
                },
            });
        }
    }

    test('429 becomes subs_rate_limited, not silence', async () => {
        const { classifyStatus } = await import('../src/background/background');
        const app = new Harness();
        app.handleVttLoadFailed({ status: 429, failure: classifyStatus(429) });

        expect(named('subs_rate_limited')).toHaveLength(1);
        expect(named('subs_rate_limited')[0].params.site).toBe('rezka');
        expect(app.lastFailure).toBe('rate-limited');
        expect(app.lastFailureStatus).toBe(429);
    });

    test('one event per page however many tracks fail', () => {
        const app = new Harness();
        app.handleVttLoadFailed({ status: 429, failure: 'rate-limited' });
        app.handleVttLoadFailed({ status: 429, failure: 'rate-limited' });
        app.handleVttLoadFailed({ status: 429, failure: 'rate-limited' });
        // Rezka loads several tracks per title; without the one-shot a single
        // throttling episode would bill as three.
        expect(named('subs_rate_limited')).toHaveLength(1);
    });

    test('one event per tab however many frames receive the broadcast', () => {
        // The worker answers with chrome.tabs.sendMessage(tabId, …), which
        // reaches every frame, and this content script runs in all of them
        // (all_frames: true) with a private one-shot each. HDrezka's player is
        // an iframe, so a real page has at least two — one 429 was arriving as
        // one event per frame.
        const frames = [new Harness(true), new Harness(false), new Harness(false)];
        for (const frame of frames) {
            frame.handleVttLoadFailed({ status: 429, failure: 'rate-limited' });
        }
        expect(named('subs_rate_limited')).toHaveLength(1);
        // The failure state itself is still recorded in every frame — only the
        // reporting is scoped, because each frame still renders its own UI.
        expect(frames.every((f) => f.lastFailure === 'rate-limited')).toBe(true);
    });

    test('a 404 is not reported as throttling', async () => {
        const { classifyStatus } = await import('../src/background/background');
        const app = new Harness();
        app.handleVttLoadFailed({ status: 404, failure: classifyStatus(404) });
        // The whole point of carrying the status: a missing file and a refused
        // request are different problems and must not share a metric.
        expect(named('subs_rate_limited')).toHaveLength(0);
        expect(app.lastFailure).not.toBe('rate-limited');
    });

    test('a track already playing turns the same failure into subs_partial', () => {
        const app = new Harness();
        app.state.tracks = [{ name: 'English' }];
        app.handleVttLoadFailed({ status: 429, failure: 'rate-limited' });

        expect(named('subs_partial')).toHaveLength(1);
        expect(named('subs_partial')[0].params.throttled).toBe(true);
        expect(named('subs_partial')[0].params.failure).toBe('rate-limited');
    });

    test('no_subtitles without any reported failure means no track selected', () => {
        // The '' regression: an unpicked CC menu and a broken CDN used to land
        // in the same undiagnosable GA4 bucket.
        const app = new Harness();
        app.declareNoSubtitles();
        expect(named('no_subtitles')).toHaveLength(1);
        expect(named('no_subtitles')[0].params.failure).toBe('not-selected');
    });

    test('no_subtitles after a real failure carries that failure', () => {
        const app = new Harness();
        app.handleVttLoadFailed({ status: 429, failure: 'rate-limited' });
        app.declareNoSubtitles();
        expect(named('no_subtitles')[0].params).toMatchObject({
            failure: 'rate-limited',
            status: 429,
        });
    });

    test('no_subtitles carries the language pair', () => {
        const app = new Harness();
        app.declareNoSubtitles();
        expect(named('no_subtitles')[0].params).toMatchObject({
            learning: 'en',
            native: 'ru',
        });
    });
});
