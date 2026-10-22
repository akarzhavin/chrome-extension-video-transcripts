/**
 * @jest-environment jsdom
 */

/**
 * The AI translation in the sidebar: only its status line. The switch lives on
 * the site's settings page (settings-bridge.ts).
 */

const prefsStore: Record<string, unknown> = {};
(global as any).chrome = {
    runtime: { id: 'test-extension-id', onMessage: { addListener: jest.fn() }, sendMessage: jest.fn() },
    storage: {
        local: {
            get: jest.fn((key: string) =>
                Promise.resolve(key in prefsStore ? { [key]: prefsStore[key] } : {})),
            set: jest.fn((items: Record<string, unknown>) => {
                Object.assign(prefsStore, items);
                return Promise.resolve();
            }),
        },
        onChanged: { addListener: jest.fn(), removeListener: jest.fn() },
    },
};
(window as any).HTMLElement.prototype.scrollIntoView = jest.fn();
(window as any).Element.prototype.scrollTo = jest.fn();
(window as any).isTopWindow = true;

import { SidebarUI } from '../src/SidebarUI';
import { AppState } from '../src/AppState';
import { loadPrefs, savePrefs } from '../src/prefs';
import type { AppInterface } from '../src/types';

const flush = () => new Promise((r) => setTimeout(r, 0));

function build(): SidebarUI {
    document.body.innerHTML = '';
    const app: AppInterface = { seekVideo: jest.fn(), updateHighlight: jest.fn() };
    const ui = new SidebarUI(new AppState(), app);
    ui.init();
    return ui;
}

beforeEach(() => {
    for (const k of Object.keys(prefsStore)) delete prefsStore[k];
});

test('the sidebar has no switch, only the status line in the Languages group', async () => {
    build();
    await flush();
    expect(document.getElementById('vtt-ai-toggle')).toBeNull();
    const status = document.getElementById('vtt-ai-status')!;
    expect(document.getElementById('vtt-track-selectors')!.parentElement!.contains(status)).toBe(true);
    expect(status.textContent).toBe('');
});

test('the status line says what the translation is doing, and nothing when it is off', () => {
    const ui = build();
    const status = () => document.getElementById('vtt-ai-status')!.textContent;
    ui.setAiStatus('quota');
    expect(status()).toMatch(/limit/i);
    ui.setAiStatus('auth');
    expect(status()).toMatch(/sign in/i);
    ui.setAiStatus(null);
    expect(status()).toBe('');
});

// The Languages group is in Settings, out of sight while subtitles play; a
// stopped translation must say so where the empty lines are.
test('the subtitles view shows the status too, and hides the line when there is none', () => {
    const ui = build();
    const banner = () => document.getElementById('vtt-ai-banner')!;
    expect(document.getElementById('vtt-subheader')!.contains(banner())).toBe(true);
    expect(banner().hidden).toBe(true);
    ui.setAiStatus('unavailable');
    expect(banner().hidden).toBe(false);
    expect(banner().textContent).toMatch(/unavailable/i);
    ui.setAiStatus(null);
    expect(banner().hidden).toBe(true);
    expect(banner().textContent).toBe('');
});

// AI translation spends credits, so it is offered, in the same quiet row, and
// runs only when the offer is taken.
// The cost is the button's tooltip, kept out of the line (the owner's call:
// the line stays short); the button still names it to hover and screen readers.
test('the offer sits in the status row and names the cost on hover', () => {
    const ui = build();
    const banner = () => document.getElementById('vtt-ai-banner')!;
    ui.setAiOffer(jest.fn());
    expect(banner().hidden).toBe(false);
    expect(banner().textContent).toBe('No subtitles in your language · Translate with AI');
    const button = banner().querySelector('button')!;
    expect(button.title).toBe('Uses AI credits');
    expect(button.getAttribute('aria-description')).toBe('Uses AI credits');

    ui.setAiOffer(null);
    expect(banner().hidden).toBe(true);
    expect(banner().querySelector('button')).toBeNull();
});

describe('the first turn-on asks once', () => {
    const bubble = () => document.querySelector<HTMLElement>('.vtt-ai-confirm');
    const offerButton = () => document.querySelector<HTMLButtonElement>('.vtt-ai-offer')!;
    const buttonNamed = (name: string) =>
        [...bubble()!.querySelectorAll('button')].find((b) => b.textContent === name)!;

    test('taking the offer opens the question, and Translate starts it', async () => {
        const ui = build();
        const start = jest.fn();
        ui.setAiOffer(start);
        offerButton().click();
        await flush();
        expect(start).not.toHaveBeenCalled();
        expect(bubble()!.getAttribute('role')).toBe('dialog');
        expect(bubble()!.textContent).toMatch(/uses credits/);
        expect(offerButton().getAttribute('aria-expanded')).toBe('true');
        buttonNamed('Translate').click();
        expect(start).toHaveBeenCalledTimes(1);
        expect(bubble()).toBeNull();
    });

    test('Not now closes it without translating', async () => {
        const ui = build();
        const start = jest.fn();
        ui.setAiOffer(start);
        offerButton().click();
        await flush();
        buttonNamed('Not now').click();
        expect(start).not.toHaveBeenCalled();
        expect(bubble()).toBeNull();
    });

    test('ticked, it is not asked again', async () => {
        const ui = build();
        const start = jest.fn();
        ui.setAiOffer(start);
        offerButton().click();
        await flush();
        bubble()!.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked = true;
        buttonNamed('Translate').click();
        expect(prefsStore.aiConfirmSkip).toBe(true);

        ui.setAiOffer(start);
        offerButton().click();
        await flush();
        expect(bubble()).toBeNull();
        expect(start).toHaveBeenCalledTimes(2);
    });

    test('a withdrawn offer takes its question with it', async () => {
        const ui = build();
        ui.setAiOffer(jest.fn());
        offerButton().click();
        await flush();
        ui.setAiOffer(null);
        expect(bubble()).toBeNull();
    });
});

// The row ends in the state's own word, in the link colour: clicking "on"
// turns it off, clicking "off" turns it back on.
test('a running translation ends its row in "on", which turns it off', () => {
    const ui = build();
    const banner = () => document.getElementById('vtt-ai-banner')!;
    const stop = jest.fn();
    ui.setAiStatus('working');
    ui.setAiStop(stop);
    expect(banner().textContent).toBe('Translating… · on');
    ui.setAiStatus('ready');
    expect(banner().textContent).toBe('AI translation · on');
    const word = banner().querySelector('button')!;
    expect(word.getAttribute('aria-label')).toBe('AI translation is on. Turn off');
    word.click();
    expect(stop).toHaveBeenCalledTimes(1);

    ui.setAiStop(null);
    expect(banner().querySelector('button')).toBeNull();
});

test('turned off on this video, the row reads "off", which turns it on without asking', async () => {
    const ui = build();
    const banner = () => document.getElementById('vtt-ai-banner')!;
    const start = jest.fn();
    ui.setAiOffer(start, true);
    expect(banner().textContent).toBe('AI translation · off');
    const word = banner().querySelector('button')!;
    expect(word.getAttribute('aria-label')).toBe('AI translation is off. Turn on');
    expect(word.title).toBe('Turn on · uses AI credits');
    word.click();
    await flush();
    expect(start).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.vtt-ai-confirm')).toBeNull();
});

describe('the native-language picker', () => {
    const sub = () => document.getElementById('vtt-sub-select') as HTMLSelectElement;
    const pick = (value: string) => {
        sub().value = value;
        sub().dispatchEvent(new Event('change'));
    };

    function withTracks() {
        const ui = build();
        const state = (ui as any).state as AppState;
        state.addTrack('English — English', [{ startTime: 0, endTime: 1, text: 'a' } as any]);
        state.addTrack('Russian — Русский', [{ startTime: 0, endTime: 1, text: 'б' } as any]);
        // What attachAiTranslation sets while the site has no Ukrainian.
        state.secondLineOnDemand = true;
        state.secondLineLanguage = 'uk';
        ui.refresh();
        return { ui, state };
    }

    test('names tracks as the site does, and offers the AI translation as one more item, in any mode', () => {
        const { ui, state } = withTracks();
        state.displayMode = 'single';
        ui.refresh();
        expect([...sub().options].map((o) => o.text)).toEqual(['English', 'Русский', 'Українська']);
        state.secondLineOnDemand = false;
        ui.refresh();
        expect([...sub().options].map((o) => o.text)).toEqual(['English', 'Русский']);
    });

    test('picked in Single, it turns Dual on and takes the offer that makes', async () => {
        const { ui, state } = withTracks();
        state.displayMode = 'single';
        const start = jest.fn();
        // attachAiTranslation offers only in Dual.
        state.subscribe((e) => {
            if (e.type === 'mode' && e.mode === 'dual') ui.setAiOffer(start, true);
        });
        pick('ai');
        await flush();
        expect(state.displayMode).toBe('dual');
        expect(start).toHaveBeenCalledTimes(1);
    });

    test('lists the other languages of the edition, and picking one makes it the native language', async () => {
        const { ui, state } = withTracks();
        state.languagePair = { learning: 'en', native: 'uk' };
        state.pickerLanguages = ['en', 'ru', 'uk', 'de'];
        ui.refresh();
        const group = sub().querySelector('optgroup')!;
        expect(group.label).toBe('Other languages');
        // English and Russian load as tracks, Ukrainian is the AI item: only German is left.
        expect([...group.querySelectorAll('option')].map((o) => o.text)).toEqual(['Deutsch']);
        pick('lang:de');
        await flush();
        expect(prefsStore['lang.v1']).toEqual({ learning: 'en', native: 'de' });
    });

    test('without a pair or a language list it lists the tracks alone', () => {
        withTracks();
        expect(sub().querySelector('optgroup')).toBeNull();
    });

    test('picking it asks once, then starts', async () => {
        const { ui } = withTracks();
        const start = jest.fn();
        ui.setAiOffer(start, false);
        pick('ai');
        await flush();
        expect(start).not.toHaveBeenCalled();
        const bubble = document.querySelector('.vtt-ai-confirm')!;
        expect(bubble.parentElement!.id).toBe('vtt-settings-panel');
        [...bubble.querySelectorAll('button')].find((b) => b.textContent === 'Translate')!.click();
        expect(start).toHaveBeenCalledTimes(1);
    });

    test('turned off on this video, picking it starts at once', async () => {
        const { ui } = withTracks();
        const start = jest.fn();
        ui.setAiOffer(start, true);
        pick('ai');
        await flush();
        expect(start).toHaveBeenCalledTimes(1);
    });

    test('a site track in its place turns a running translation off', () => {
        const { ui, state } = withTracks();
        const stop = jest.fn();
        ui.setAiStop(stop);
        pick('1');
        expect(stop).toHaveBeenCalledTimes(1);
        expect(state.secondaryTrackIndex).toBe(1);
    });
});

describe('in a production build', () => {
    afterEach(() => {
        (global as any).__EXT_ENV__ = 'dev';
    });

    test('the status line is built and says what the translation is doing', async () => {
        (global as any).__EXT_ENV__ = 'prod';
        const ui = build();
        await flush();
        ui.setAiStatus('quota');
        expect(document.getElementById('vtt-ai-status')!.textContent).toMatch(/limit/i);
    });

    // The switch forcing AI over a native track stays dev-only.
    test('a stored force choice reads as off', async () => {
        await savePrefs({ aiTranslateForce: true });
        (global as any).__EXT_ENV__ = 'prod';
        expect((await loadPrefs()).aiTranslateForce).toBe(false);
    });
});

describe('the AI translation alone on the line, stopped', () => {
    const cue = (text: string, original?: string) => ({ startTime: 0, endTime: 1, text, ...(original ? { original } : {}) });
    function alone() {
        const ui = build();
        const state = ui.state;
        state.setLanguagePreferences('English', 'Russian');
        state.addTrack('English', [cue('It is not safe.')]);
        state.preferredSecondaryName = 'Russian · AI';
        state.addTrack('Russian · AI', [cue('', 'It is not safe.')]);
        state.setDisplayMode('single');
        state.setSingleTrack('Russian · AI');
        ui.refresh();
        const banner = document.getElementById('vtt-ai-banner')!;
        const button = (text: RegExp) => [...banner.querySelectorAll('button')].find((b) => text.test(b.textContent ?? '') || text.test(b.getAttribute('aria-label') ?? ''))!;
        return { ui, state, banner, button };
    }

    test('its limit spent: the line offers the learning track and any other, framed, with a ×', () => {
        const { ui, banner, button } = alone();
        ui.setAiStop(() => {});
        ui.setAiStatus('quota');
        expect(banner.hidden).toBe(false);
        expect(banner.classList.contains('vtt-ai-banner-out')).toBe(true);
        // The "on" word is not shown beside a stopped translation.
        const seen = [...banner.children].filter((c) => !(c as HTMLElement).hidden).map((c) => c.textContent).join('');
        expect(seen).toBe('The AI limit is reached · Show English · Other track ›');
        expect(button(/^Hide$/)).toBeDefined();
    });

    test('Show English puts the learning track on the line; the row goes back to its usual self', () => {
        const { ui, state, banner, button } = alone();
        ui.setAiStatus('quota');
        button(/Show English/).click();
        expect(state.singleTrackName).toBeUndefined();
        expect(state.tracks[state.activeTrackIndex].name).toBe('English');
        expect(banner.classList.contains('vtt-ai-banner-out')).toBe(false);
        expect(banner.querySelector('.vtt-ai-banner-close')).toBeNull();
    });

    test('Other track opens Languages, lit', () => {
        const { ui, button } = alone();
        const open = jest.spyOn(ui, 'openSettings');
        ui.setAiStatus('quota');
        button(/Other track/).click();
        expect(open).toHaveBeenCalledWith('languages');
    });

    test('× hides the line until the status changes', () => {
        const { ui, banner, button } = alone();
        ui.setAiStatus('quota');
        button(/^Hide$/).click();
        expect(banner.hidden).toBe(true);
        ui.refresh();
        expect(banner.hidden).toBe(true);
        ui.setAiStatus('unavailable');
        expect(banner.hidden).toBe(false);
    });

    test('still translating, or the translation on the second line: no way-out line', () => {
        const { ui, state, banner } = alone();
        ui.setAiStatus('working');
        expect(banner.classList.contains('vtt-ai-banner-out')).toBe(false);
        ui.setAiStatus('quota');
        state.setDisplayMode('dual');
        ui.refresh();
        expect(banner.classList.contains('vtt-ai-banner-out')).toBe(false);
    });

    test('a line it has not translated shows the original, muted', () => {
        alone();
        const main = document.querySelector('.vtt-main-text')!;
        expect(main.textContent).toBe('It is not safe.');
        expect(main.classList.contains('vtt-untranslated')).toBe(true);
    });
});
