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

import { BaseVttApp } from '../src/content/app-base';
import type { Subtitle } from '@video-transcripts/shared';

class TestApp extends BaseVttApp {
    videoId: string | null = 'vid1';
    reprocessed = 0;

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
    reprocessCurrentVideo(): void {
        this.reprocessed++;
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

    test('an expired link asks to search again rather than declaring defeat', () => {
        const app = makeApp();
        app.noteTrackFailure('English', { failure: 'stale-url' });

        expect(bannerText()).toContain('expired');
        actions()[0].click();
        expect(app.reprocessed).toBe(1);
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
