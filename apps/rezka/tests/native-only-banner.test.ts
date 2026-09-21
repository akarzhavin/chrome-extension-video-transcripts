/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://example.com/neutral.html"}
 */

// The blank-sidebar regression, pinned against the REAL VttApp.
//
// HDrezka serves its default dub with exactly one subtitle track: the viewer's
// own language. AppState refuses to seat the native translation in the learning
// slot (see AppState.test.ts, "a native-only load leaves the main pane empty"),
// so the transcript stays empty while `tracks.length` is 1.
//
// The bug: rezka's status logic asked `tracks.length`, read 1 as "we have
// something to show", cleared the "Searching…" banner and never ran the
// no-subtitles path. Measured live on 5141-odnazhdy-v-meksike (2026-09-21):
// 105 cues parsed, main pane empty, sidebar blank, no event reported — and the
// manual how-to that exists for exactly this moment was unreachable.
//
// These tests import the module on a NON-rezka URL so bootstrap() bails out,
// then drive a real VttApp. A hand-written copy of the class is what let this
// regression hide behind a green suite in content-analytics.test.ts.

const sendMessageMock = jest.fn();

(global as any).chrome = {
    runtime: {
        id: 'test-extension-id',
        getURL: (p: string) => `chrome-extension://test/${p}`,
        getManifest: () => ({ version: '1.0.0' }),
        sendMessage: sendMessageMock,
        onMessage: { addListener: jest.fn() },
        onMessageExternal: { addListener: jest.fn() },
        onInstalled: { addListener: jest.fn() },
        setUninstallURL: jest.fn(),
        lastError: undefined,
    },
    tabs: { create: jest.fn(), sendMessage: jest.fn() },
    action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn() },
    i18n: { getMessage: () => '', getUILanguage: () => 'en' },
    storage: {
        local: {
            get: jest.fn().mockResolvedValue({}),
            set: jest.fn().mockResolvedValue(undefined),
        },
        sync: {
            get: jest.fn().mockResolvedValue({}),
            set: jest.fn().mockResolvedValue(undefined),
        },
        onChanged: { addListener: jest.fn() },
    },
};

import { VttApp } from '../src/content/index';
import type { Subtitle } from '@video-transcripts/shared';

const cue = (text: string): Subtitle =>
    ({ startTime: 0, endTime: 1, text }) as Subtitle;

/**
 * A VttApp with the sidebar DOM the status banners mount into, the language
 * pair already chosen, and the timers under jest's control.
 */
function makeApp(): any {
    // Empty page on purpose: SidebarUI.init() builds #vtt-sidebar itself and
    // only claims ownership when it does. A pre-seeded, unstamped sidebar reads
    // as ANOTHER installed copy's panel, so init() yields and uiOwned comes back
    // false — a state production never reaches on a fresh page, and one that
    // would have let these tests pass while the real gate was shut.
    document.body.innerHTML = '';

    const app: any = new VttApp();
    expect(app.uiOwned).toBe(true); // the harness must mirror production here
    app.langPrefs = { learning: 'en', native: 'ru' };
    app.state.setLanguagePreferences('English', 'Russian');
    return app;
}

// Comfortably past the grace window, which is derived from the inline-scan
// schedule in index.ts rather than written as a literal. Spelled as its own
// constant so a change to that schedule surfaces here as one edit, not as a
// scatter of stale magic numbers.
const PAST_GRACE_MS = 10_000;

const banner = () => document.getElementById('vtt-status');
const bannerText = () => banner()?.textContent ?? '';

beforeEach(() => {
    jest.useFakeTimers();
    sendMessageMock.mockClear();
});

afterEach(() => {
    jest.useRealTimers();
    document.body.innerHTML = '';
});

describe('a native-only page still explains itself', () => {
    test('the no-subtitles banner appears when only the native track loaded', () => {
        const app = makeApp();
        app.state.addTrack('Russian', [cue('привет')]);

        // The precondition the old code got wrong: a track IS loaded.
        expect(app.state.tracks.length).toBe(1);
        expect(app.state.getMainTrack()).toBeNull();

        app.scheduleNoSubtitlesCheck();
        expect(bannerText()).toContain('Searching');

        jest.advanceTimersByTime(PAST_GRACE_MS);

        // Before the fix this was an empty sidebar: tracks.length > 0 returned
        // early from both scheduleNoSubtitlesCheck and declareNoSubtitles.
        expect(banner()).not.toBeNull();
        expect(bannerText()).toContain('Only your own language');
        expect(banner()!.querySelector('.vtt-empty-state-figure svg')).not.toBeNull();
    });

    test('its steps point at the voice-over row, not the CC menu', () => {
        const app = makeApp();
        app.state.addTrack('Russian', [cue('привет')]);
        app.declareNoSubtitles();

        const steps = [...document.querySelectorAll('.vtt-empty-state-steps li')]
            .map((li) => li.textContent ?? '');
        expect(steps.length).toBe(3);
        // The recovery for this state is switching the audio track; telling the
        // user to re-click the CC menu sends them somewhere that cannot help.
        expect(steps[0]).toContain('Оригинал');
    });

    test('it reports native-only rather than blaming the title', () => {
        const app = makeApp();
        app.state.addTrack('Russian', [cue('привет')]);
        app.declareNoSubtitles();

        const events = sendMessageMock.mock.calls
            .map((c) => c[0])
            .filter((m) => m && m.action === 'TRACK_EVENT' && m.event === 'no_subtitles');

        expect(events.length).toBe(1);
        expect(events[0].params.failure).toBe('native-only');
    });

    test('a loaded LEARNING track still clears the banner', () => {
        const app = makeApp();
        app.scheduleNoSubtitlesCheck();
        expect(bannerText()).toContain('Searching');

        app.state.addTrack('English', [cue('hello')]);
        app.scheduleNoSubtitlesCheck();

        jest.advanceTimersByTime(PAST_GRACE_MS);
        expect(banner()).toBeNull();
    });

    test('an empty page keeps the original "didn\'t load" copy', () => {
        const app = makeApp();
        app.declareNoSubtitles();

        expect(bannerText()).toContain("didn't load");
        expect(bannerText()).not.toContain('Only your own language');

        const events = sendMessageMock.mock.calls
            .map((c) => c[0])
            .filter((m) => m && m.action === 'TRACK_EVENT' && m.event === 'no_subtitles');
        expect(events[0].params.failure).toBe('not-selected');
    });

    // "Search again" cannot change this state: the dub still ships one track.
    // Falling back to the CC-menu copy after a retry replaced correct advice
    // with advice that cannot work — pointing the user at a control that has
    // nothing to do with the cause.
    test('a retry keeps the voice-over advice instead of reverting to the CC menu', () => {
        const app = makeApp();
        app.state.addTrack('Russian', [cue('привет')]);
        app.noSubsRetries = 1;
        app.declareNoSubtitles();

        expect(bannerText()).toContain('Only your own language');
        expect(bannerText()).not.toContain("didn't load");

        const steps = [...document.querySelectorAll('.vtt-empty-state-steps li')]
            .map((li) => li.textContent ?? '');
        expect(steps[0]).toContain('Оригинал');

        // The retry escalation still happens: the reload button rides along in
        // `actions`, which this branch passes through unchanged.
        const labels = [...document.querySelectorAll('.vtt-empty-state-action')]
            .map((b) => b.textContent ?? '');
        expect(labels.some((l) => l.includes('Reload page'))).toBe(true);
    });

    // tracks.length > 0 is not "native only". A throttled learning track with
    // the native one already loaded satisfies it too, and "switch to the
    // original" then points at a control that cannot fix a 429.
    test('a reported failure is not dressed up as a dubbed-audio problem', () => {
        const app = makeApp();
        app.state.addTrack('Russian', [cue('привет')]);
        app.handleVttLoadFailed({ status: 429, failure: 'rate-limited' });
        app.declareNoSubtitles();

        expect(bannerText()).not.toContain('Only your own language');
        expect(bannerText()).toContain("didn't load");

        const events = sendMessageMock.mock.calls
            .map((c) => c[0])
            .filter((m) => m && m.action === 'TRACK_EVENT' && m.event === 'no_subtitles');
        expect(events[0].params.failure).toBe('rate-limited');
    });

    // The ids are shared across installed copies, so a non-owning frame's
    // banner lands in the sidebar the owning copy built. handleNewSubtitles
    // reaches this path from every frame, which is how the write became
    // possible at all.
    test('a frame that does not own the sidebar writes no banner', () => {
        const app = makeApp();
        app.uiOwned = false;

        app.scheduleNoSubtitlesCheck();
        expect(banner()).toBeNull();

        app.declareNoSubtitles();
        expect(banner()).toBeNull();
    });

    test('a non-watch page stays quiet', () => {
        const app = makeApp();
        app.isWatchPage = () => false;

        app.scheduleNoSubtitlesCheck();
        expect(banner()).toBeNull();

        app.declareNoSubtitles();
        expect(banner()).toBeNull();
    });

    // The verdict must not be reached before the last inline scan (4000ms) has
    // had its chance. At a flat 3000ms grace a title whose track list appeared
    // late was declared native-only and, the one-shot having fired, never
    // corrected: subs_recovered needs hadFailures, which this path never sets.
    test('the grace window outlasts the last inline scan', () => {
        const app = makeApp();
        app.state.addTrack('Russian', [cue('привет')]);
        app.scheduleNoSubtitlesCheck();

        jest.advanceTimersByTime(4000);
        expect(bannerText()).toContain('Searching');

        jest.advanceTimersByTime(2000);
        expect(bannerText()).toContain('Only your own language');
    });

    // Arming the window per arriving track restarts it, because
    // scheduleNoSubtitlesCheck clears the pending timer first. "Search again"
    // re-fetches every known URL at once, so on a native-only title each answer
    // pushed the verdict out by another full grace period and the banner never
    // returned — measured live: 25s after the click, still nothing on screen.
    test('repeated native-only arrivals do not postpone the banner forever', () => {
        const app = makeApp();
        // Enough Russian for guessLanguage to name the track "Russian"; a bare
        // word is not, and an unrecognised name becomes the main-pane filler
        // instead of the native track this test is about. The label rides along
        // exactly as production sends it (the CDN listing gives one), which is
        // also what lets isDuplicate recognise the repeat.
        const vtt = 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n'
            + 'Я не понимаю, о ком вы говорите\n\n'
            + '00:00:01.000 --> 00:00:02.000\nМы тут только гитары делаем\n';

        app.scheduleNoSubtitlesCheck();

        // The same native track answering over and over — what "Search again"
        // produces, since it re-fetches every URL it knows. Deduped, so the
        // state never changes; what used to change was the deadline.
        for (let i = 0; i < 6; i++) {
            jest.advanceTimersByTime(1000);
            app.handleNewSubtitles(vtt, 'Русский');
        }

        expect(app.state.tracks).toHaveLength(1);     // the repeat is deduped
        expect(app.state.getMainTrack()).toBeNull();  // still nothing to show

        // 6s of arrivals have passed and the window is 6s, so the verdict is due
        // now. If every arrival restarted it, it would sit 6s past the LAST one
        // and this advance would find the sidebar still empty — which is exactly
        // what happened live: 25s after the retry click, nothing had returned.
        jest.advanceTimersByTime(1000);
        expect(bannerText()).toContain('Only your own language');
    });

    // The other half of the dedup rule, and the reason the check is by name at
    // all: a director's cut and the theatrical version share their opening and
    // middle cue — all the content check compares — so content alone would drop
    // the second one and leave the user with whichever loaded first.
    test('two labels over identical content stay two tracks', () => {
        const app = makeApp();
        const vtt = 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n'
            + 'Я не понимаю, о ком вы говорите\n\n'
            + '00:00:01.000 --> 00:00:02.000\nМы тут только гитары делаем\n';

        app.handleNewSubtitles(vtt, 'Оригинал (+субтитры)');
        app.handleNewSubtitles(vtt, 'Оригинал (+субтитры) (реж.)');

        expect(app.state.tracks).toHaveLength(2);
    });

    test('a track arriving after the old 3s window still counts', () => {
        const app = makeApp();
        app.state.addTrack('Russian', [cue('привет')]);
        app.scheduleNoSubtitlesCheck();

        jest.advanceTimersByTime(3500); // past the old grace, before the new one
        app.state.addTrack('English', [cue('hello')]);
        app.handleNewSubtitles('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nhello\n');

        jest.advanceTimersByTime(10000);
        expect(banner()).toBeNull();

        const events = sendMessageMock.mock.calls
            .map((c) => c[0])
            .filter((m) => m && m.action === 'TRACK_EVENT' && m.event === 'no_subtitles');
        expect(events).toHaveLength(0);
    });
});

// Moved from content-analytics.test.ts, where they ran against a hand-written
// copy of declareNoSubtitles that had silently diverged from production.
describe('no_subtitles reporting', () => {
    test('without any reported failure it means no track was selected', () => {
        // The '' regression: an unpicked CC menu and a broken CDN used to land
        // in the same undiagnosable GA4 bucket.
        const app = makeApp();
        app.declareNoSubtitles();

        const events = sendMessageMock.mock.calls
            .map((c) => c[0])
            .filter((m) => m && m.action === 'TRACK_EVENT' && m.event === 'no_subtitles');
        expect(events).toHaveLength(1);
        expect(events[0].params.failure).toBe('not-selected');
    });

    test('after a real failure it carries that failure', () => {
        const app = makeApp();
        app.handleVttLoadFailed({ status: 429, failure: 'rate-limited' });
        app.declareNoSubtitles();

        const events = sendMessageMock.mock.calls
            .map((c) => c[0])
            .filter((m) => m && m.action === 'TRACK_EVENT' && m.event === 'no_subtitles');
        expect(events[0].params).toMatchObject({ failure: 'rate-limited', status: 429 });
    });

    test('it carries the language pair', () => {
        const app = makeApp();
        app.declareNoSubtitles();

        const events = sendMessageMock.mock.calls
            .map((c) => c[0])
            .filter((m) => m && m.action === 'TRACK_EVENT' && m.event === 'no_subtitles');
        expect(events[0].params).toMatchObject({ learning: 'en', native: 'ru' });
    });

    test('one event per page however many times it is declared', () => {
        const app = makeApp();
        app.declareNoSubtitles();
        app.declareNoSubtitles();

        const events = sendMessageMock.mock.calls
            .map((c) => c[0])
            .filter((m) => m && m.action === 'TRACK_EVENT' && m.event === 'no_subtitles');
        expect(events).toHaveLength(1);
    });
});
