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
    document.body.innerHTML = `
        <div id="vtt-sidebar">
            <div id="vtt-header"></div>
            <div id="vtt-list"></div>
        </div>`;

    const app: any = new VttApp();
    app.langPrefs = { learning: 'en', native: 'ru' };
    app.state.setLanguagePreferences('English', 'Russian');
    return app;
}

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

        jest.advanceTimersByTime(5000);

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

        jest.advanceTimersByTime(5000);
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
});
