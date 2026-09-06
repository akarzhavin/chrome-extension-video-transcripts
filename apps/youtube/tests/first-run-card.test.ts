/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://www.youtube.com/watch?v=abc"}
 */

/**
 * Behaviour map §1 — the setup card, which is the first thing every new user
 * sees and the gate in front of everything else in the product.
 *
 * The card was reachable from the analytics suite only, and only as a funnel:
 * two events had to arrive after BOTH languages were picked. That leaves the
 * card's own rules unasserted — most sharply the "both required" guard, which
 * could be deleted without a single check going red, because the funnel test
 * always picks both.
 *
 * Strings: the unit harness stubs `chrome.i18n.getMessage` to '' the way its
 * siblings do, so `t()` returns the SOURCE FALLBACK. That is what these checks
 * pin. The locale file is a second source and can drift from it — the shipped
 * text is pinned live (e2e/failure-states.spec.ts reads localeMessage) and the
 * keys' existence by locale-coverage.test.ts. Recorded so a later reader does
 * not mistake this for a check on what the user reads.
 */

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
import { SUPPORTED_LANGUAGES } from '@video-transcripts/shared';

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

const flush = () => new Promise((r) => setTimeout(r, 0));

const card = () => document.getElementById('vtt-lang-onboarding');
const selects = () =>
    [...document.querySelectorAll('#vtt-lang-onboarding select')] as HTMLSelectElement[];

/** Pick a value the way a person does — through the element's own event. */
const pick = (select: HTMLSelectElement, code: string): void => {
    select.value = code;
    select.dispatchEvent(new Event('change', { bubbles: true }));
};

/** A mounted panel with the card shown, as a first run produces. */
function showCard(): TestApp {
    document.body.innerHTML = '';
    const sidebar = document.createElement('div');
    sidebar.id = 'vtt-sidebar';
    document.body.appendChild(sidebar);
    const app = new TestApp();
    // The two-copies guard: updateOnboardingState() returns early unless this
    // panel is ours (app-base.ts:478). init() sets it from ui.init(), which has
    // no real panel to claim here.
    app.uiOwned = true;
    app.langPrefs = null;
    app.showLanguageOnboarding();
    return app;
}

beforeEach(() => {
    (chrome.storage.local.set as jest.Mock).mockClear();
    (chrome.runtime.sendMessage as jest.Mock).mockClear();
});

describe('what the setup card says', () => {
    it('is headed "Choose your languages" and says what to do', () => {
        showCard();
        expect(card()?.querySelector('.vtt-lang-onboarding-title')?.textContent).toBe(
            'Choose your languages',
        );
        expect(card()?.querySelector('.vtt-lang-onboarding-text')?.textContent).toBe(
            "Pick the language you're learning and your native language to start.",
        );
    });

    it('labels the two dropdowns for what each one is', () => {
        showCard();
        const labels = [...(card()?.querySelectorAll('.vtt-lang-onboarding-row > span') ?? [])].map(
            (s) => s.textContent,
        );
        expect(labels).toEqual(["I'm learning", 'My native language']);
    });

    /**
     * There is no confirm button by design — each dropdown saves on change.
     * Asserted as the absence of any button in the card, because adding one
     * would mean the save moved and the "saves the moment it is changed" claim
     * silently stopped being true.
     */
    it('offers no confirm or save button', () => {
        showCard();
        expect(card()?.querySelectorAll('button')).toHaveLength(0);
    });
});

describe('the two dropdowns', () => {
    it('open on a placeholder that cannot be chosen', () => {
        showCard();
        for (const select of selects()) {
            const first = select.options[0];
            expect(first.textContent).toBe('Select…');
            expect(first.value).toBe('');
            // Disabled AND selected: it shows, and it cannot be picked back.
            expect(first.disabled).toBe(true);
            expect(select.selectedIndex).toBe(0);
        }
    });

    it('offer every supported language, and nothing else', () => {
        showCard();
        for (const select of selects()) {
            expect(select.options).toHaveLength(SUPPORTED_LANGUAGES.length + 1);
        }
    });

    /**
     * Each language reads in its own script ("Español", "Русский", "中文") so a
     * learner can find their target by sight before understanding anything else
     * on the screen. The negative half matters: the toolbar popup renders
     * "English — Español" for the same list, and that form leaking into this
     * card would undo the point.
     */
    it('name each language in its own script, not in English', () => {
        showCard();
        const options = [...selects()[0].options].slice(1);
        const spanish = options.find((o) => o.value === 'es');
        expect(spanish?.textContent).toBe('Español');
        expect(spanish?.textContent).not.toContain('Spanish');

        const byCode = new Map(SUPPORTED_LANGUAGES.map((l) => [l.code, l.native]));
        for (const o of options) expect(o.textContent).toBe(byCode.get(o.value));
    });
});

describe('choosing the pair', () => {
    /**
     * The highest-value check in this file. `if (!l || !n) return` is the whole
     * of the rule, and deleting it was invisible: the only test that drove the
     * card picked BOTH languages, so a card saving after the first pick still
     * produced exactly the expected events.
     *
     * A half-written pair is not a lesser version of a pair — it is a pair that
     * would teach the wrong language, which §1 says the product must never
     * guess at.
     */
    it('picking one language alone saves nothing', async () => {
        showCard();
        pick(selects()[0], 'en');
        await flush();

        expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    it('picking the second one saves the pair', async () => {
        showCard();
        pick(selects()[0], 'en');
        pick(selects()[1], 'ru');
        await flush();

        const written = (chrome.storage.local.set as jest.Mock).mock.calls.map(([o]) => o);
        const pair = written.find((o) => 'lang.v1' in o)?.['lang.v1'];
        expect(pair).toEqual({ learning: 'en', native: 'ru' });
    });

    /** Either order — the rule is "both", not "learning first". */
    it('saves just the same when the native language is picked first', async () => {
        showCard();
        pick(selects()[1], 'ru');
        await flush();
        expect(chrome.storage.local.set).not.toHaveBeenCalled();

        pick(selects()[0], 'en');
        await flush();
        const written = (chrome.storage.local.set as jest.Mock).mock.calls.map(([o]) => o);
        expect(written.find((o) => 'lang.v1' in o)?.['lang.v1']).toEqual({
            learning: 'en',
            native: 'ru',
        });
    });
});

describe('once the pair exists', () => {
    /**
     * §1: "Once both exist, the card disappears" and "on a later visit the card
     * never reappears". Both run through updateOnboardingState(), which had no
     * test at all — it could have been emptied without anything going red.
     */
    it('the card is taken away', () => {
        const app = showCard();
        expect(card()).not.toBeNull();

        app.langPrefs = { learning: 'en', native: 'ru' };
        app.updateOnboardingState();

        expect(card()).toBeNull();
    });

    it('a returning user with a stored pair never sees it', () => {
        document.body.innerHTML = '';
        const sidebar = document.createElement('div');
        sidebar.id = 'vtt-sidebar';
        document.body.appendChild(sidebar);
        const app = new TestApp();
        app.uiOwned = true;
        app.langPrefs = { learning: 'en', native: 'ru' };

        app.updateOnboardingState();

        expect(card()).toBeNull();
    });

    /**
     * The half that stops "always remove it" passing: with no pair stored the
     * same call must PUT the card up, not leave the panel empty.
     */
    it('a user with no pair is shown it', () => {
        document.body.innerHTML = '';
        const sidebar = document.createElement('div');
        sidebar.id = 'vtt-sidebar';
        document.body.appendChild(sidebar);
        const app = new TestApp();
        app.uiOwned = true;
        app.langPrefs = null;

        app.updateOnboardingState();

        expect(card()).not.toBeNull();
    });
});
