/**
 * @jest-environment jsdom
 */

/**
 * Netflix's audio & subtitles panel gets our block on top of its Subtitles
 * column: only what the viewer needs, from their two languages.
 */

const store: Record<string, unknown> = {};
(global as any).chrome = {
    runtime: { id: 'test-extension-id' },
    storage: {
        local: {
            get: jest.fn((key: string) => Promise.resolve(key in store ? { [key]: store[key] } : {})),
            set: jest.fn((items: Record<string, unknown>) => {
                Object.assign(store, items);
                return Promise.resolve();
            }),
        },
        onChanged: { addListener: jest.fn(), removeListener: jest.fn() },
    },
};

import { AppState } from '../../../packages/shared/src/AppState';
import type { DisplayMode, Subtitle } from '../../../packages/shared/src/types';
import { installNetflixMenu, subtitleList } from '../src/content/netflix/subtitle-menu';

const flush = () => new Promise((r) => setTimeout(r, 0));
const frames = () => new Promise((r) => setTimeout(r, 50));
const cues = (n: number): Subtitle[] =>
    Array.from({ length: n }, (_, i) => ({ startTime: i, endTime: i + 1, text: `line ${i}` }) as Subtitle);

/** The panel as Netflix renders it: two columns, each a heading and a list. */
function netflix(subs: string[]): void {
    const li = (kind: string, label: string, selected: boolean) =>
        `<li class="nf-item" data-uia="${kind}-item${selected ? '-selected' : ''}-${label}">${selected ? '<svg class="nf-check"></svg>' : ''}<div>${label}</div></li>`;
    document.body.innerHTML = `
        <button data-uia="control-audio-subtitle">CC</button>
        <div data-uia="selector-audio-subtitle">
            <div><h3>Audio</h3><ul class="nf-list">${li('audio', 'English', true)}</ul></div>
            <div><h3>Subtitles</h3><ul class="nf-list">${['Off', ...subs].map((l, i) => li('subtitle', l, i === 0)).join('')}</ul></div>
        </div>`;
}

const installed: { destroy(): void }[] = [];
afterEach(() => {
    for (const c of installed.splice(0)) c.destroy();
    for (const k of Object.keys(store)) delete store[k];
});

function setup(opts: { native: string; shipped: string[] }) {
    const state = new AppState();
    state.setLanguagePreferences('English', opts.native === 'pl' ? 'Polish' : 'Ukrainian');
    const ui = {
        setMode: jest.fn((m: DisplayMode) => {
            state.setDisplayMode(m);
        }),
        toggleOverlay: jest.fn(() => {
            state.overlayEnabled = !state.overlayEnabled;
        }),
        openSettings: jest.fn(),
        refresh: jest.fn(),
    };
    const showPair = jest.fn();
    const controls = installNetflixMenu({
        state,
        ui,
        langPrefs: () => ({ learning: 'en', native: opts.native }),
        titleLanguages: () => opts.shipped,
        showPair,
    });
    installed.push(controls);
    const block = () => document.querySelector<HTMLElement>('.vtt-nf-block');
    const labels = () => [...(block()?.querySelectorAll('.vtt-nf-item') ?? [])].map((li) => li.textContent);
    const item = (text: string) => [...block()!.querySelectorAll<HTMLElement>('.vtt-nf-item')].find((li) => li.textContent === text)!;
    const open = async () => {
        document.querySelector('[data-uia="control-audio-subtitle"]')!.dispatchEvent(new Event('pointerover', { bubbles: true }));
        await frames();
    };
    return { state, ui, controls, showPair, block, labels, item, open };
}

test('finds the Subtitles list by its items', () => {
    netflix(['English (CC)', 'Polish']);
    const list = subtitleList(document.querySelector('[data-uia="selector-audio-subtitle"]')!);
    expect(list!.querySelectorAll('li')).toHaveLength(3);
});

test('the site has the viewer\'s language: one pair, no AI, on top of the Subtitles list', async () => {
    netflix(['English (CC)', 'Arabic', 'Polish', 'Spanish']);
    const s = setup({ native: 'pl', shipped: ['en', 'ar', 'pl', 'es'] });
    s.state.addTrack('English', cues(5));
    s.state.addTrack('Polish', cues(5));
    s.state.setDisplayMode('dual');
    await s.open();
    expect(s.labels()).toEqual(['English + Polski']);
    const list = subtitleList(document.querySelector('[data-uia="selector-audio-subtitle"]')!)!;
    expect(s.block()!.nextElementSibling).toBe(list);
    expect(s.block()!.querySelector('.vtt-nf-item')!.className).toContain('nf-item');
    expect(s.block()!.querySelector('[aria-checked="true"]')).not.toBeNull();
});

test('a pick of the pair puts the viewer\'s pair back on two lines', async () => {
    netflix(['English (CC)', 'Polish']);
    const s = setup({ native: 'pl', shipped: ['en', 'pl'] });
    s.state.addTrack('English', cues(5));
    s.state.addTrack('Polish', cues(5));
    s.state.overlayEnabled = false;
    await s.open();
    s.item('English + Polski').click();
    expect(s.showPair).toHaveBeenCalled();
    expect(s.state.overlayEnabled).toBe(true);
    expect(s.state.displayMode).toBe('dual');
});

describe('the site lacks the viewer\'s language', () => {
    function ukrainian() {
        netflix(['English (CC)', 'Polish']);
        const s = setup({ native: 'uk', shipped: ['en', 'pl'] });
        s.state.addTrack('English', cues(5));
        s.state.secondLineOnDemand = true;
        s.state.secondLineLanguage = 'uk';
        return s;
    }

    test('the language alone and the pair, both by AI', async () => {
        const s = ukrainian();
        await s.open();
        expect(s.labels()).toEqual(['УкраїнськаAI', 'English + УкраїнськаAI']);
    });

    test('nothing of AI while the account has no AI translation', async () => {
        const s = ukrainian();
        s.state.secondLineOnDemand = false;
        await s.open();
        expect(s.block()?.querySelectorAll('.vtt-nf-item').length ?? 0).toBe(0);
    });

    test('the first pick asks in the column, Translate starts it', async () => {
        const s = ukrainian();
        const start = jest.fn(() => {
            s.state.addTrack('Ukrainian · AI', cues(5));
        });
        s.controls.offer(start, false);
        await s.open();
        s.item('English + УкраїнськаAI').click();
        await flush();
        const box = s.block()!.querySelector('.vtt-nf-confirm')!;
        expect(box.textContent).toMatch(/uses credits/);
        [...box.querySelectorAll('button')].find((b) => b.textContent === 'Translate')!.click();
        expect(start).toHaveBeenCalledTimes(1);
        expect(s.state.displayMode).toBe('dual');
    });

    test('the language alone shows the translation as the one line', async () => {
        const s = ukrainian();
        // As AiTranslator.start does: its track, preferred for the second line.
        const start = jest.fn(() => {
            s.state.preferredSecondaryName = 'Ukrainian · AI';
            s.state.addTrack('Ukrainian · AI', cues(5));
        });
        s.controls.offer(start, true);
        await s.open();
        s.item('УкраїнськаAI').click();
        expect(start).toHaveBeenCalledTimes(1);
        expect(s.state.displayMode).toBe('single');
        expect(s.state.aiAlone).toBe(true);
        expect(s.state.tracks[s.state.activeTrackIndex].name).toBe('Ukrainian · AI');
        // Dual from the sidebar puts English back on the first line.
        s.state.displayMode = 'dual';
        expect(s.state.aiAlone).toBe(false);
        expect(s.state.tracks[s.state.activeTrackIndex].name).toBe('English');
    });
});

test('a pick among Netflix\'s own subtitles hands the screen back to Netflix; Off does not', async () => {
    netflix(['English (CC)', 'Polish']);
    const s = setup({ native: 'pl', shipped: ['en', 'pl'] });
    s.state.addTrack('English', cues(5));
    await s.open();
    const list = subtitleList(document.querySelector('[data-uia="selector-audio-subtitle"]')!)!;
    (list.querySelectorAll('li')[0] as HTMLElement).click();
    expect(s.state.overlayEnabled).toBe(true);
    (list.querySelectorAll('li')[2] as HTMLElement).click();
    expect(s.state.overlayEnabled).toBe(false);
});

test('Choose another pair opens the sidebar settings, and clicks in the block stay there', async () => {
    netflix(['English (CC)', 'Polish']);
    const s = setup({ native: 'pl', shipped: ['en', 'pl'] });
    s.state.addTrack('English', cues(5));
    await s.open();
    const panel = document.querySelector('[data-uia="selector-audio-subtitle"]')!;
    const netflixHandler = jest.fn();
    panel.addEventListener('click', netflixHandler);
    s.block()!.querySelector<HTMLButtonElement>('.vtt-nf-choose')!.click();
    expect(s.ui.openSettings).toHaveBeenCalled();
    expect(netflixHandler).not.toHaveBeenCalled();
});

test('a panel Netflix re-renders gets the block back', async () => {
    netflix(['English (CC)', 'Polish']);
    const s = setup({ native: 'pl', shipped: ['en', 'pl'] });
    s.state.addTrack('English', cues(5));
    await s.open();
    s.block()!.remove();
    await frames();
    expect(s.block()).not.toBeNull();
});
