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

const NAMES: Record<string, string> = { en: 'English', pl: 'Polish', ar: 'Arabic', es: 'Spanish' };
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
    // As the Netflix app does: the learning slot points at that language.
    const showTrack = jest.fn((b: string) => state.setLanguagePreferences(NAMES[b] ?? b, state.secondaryLangLabel));
    const controls = installNetflixMenu({
        state,
        ui,
        langPrefs: () => ({ learning: 'en', native: opts.native }),
        titleTracks: () => opts.shipped.map((b) => ({ base: b, label: NAMES[b] ?? b })),
        showPair,
        showTrack,
    });
    installed.push(controls);
    const block = () => document.querySelector<HTMLElement>('.vtt-nf-block');
    const labels = () => [...(block()?.querySelectorAll('.vtt-nf-item') ?? [])].map((li) => li.textContent);
    const item = (text: string) => [...block()!.querySelectorAll<HTMLElement>('.vtt-nf-item')].find((li) => li.textContent === text)!;
    const open = async () => {
        document.querySelector('[data-uia="control-audio-subtitle"]')!.dispatchEvent(new Event('pointerover', { bubbles: true }));
        await frames();
    };
    return { state, ui, controls, showPair, showTrack, block, labels, item, open };
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
    expect(s.labels()).toEqual(['English + Polish']);
    // Our items first, right under Subtitles; the link to other pairs under them.
    expect(s.block()!.firstElementChild!.classList.contains('vtt-nf-list')).toBe(true);
    expect(s.block()!.querySelector('.vtt-nf-list + .vtt-nf-head')!.textContent).toBe('Choose another pair ›');
    const list = subtitleList(document.querySelector('[data-uia="selector-audio-subtitle"]')!)!;
    expect(s.block()!.nextElementSibling).toBe(list);
    expect(s.block()!.querySelector('.vtt-nf-item')!.className).toContain('nf-item');
    // A copy of Netflix's selected item: its check mark, no test hooks of its own.
    expect(s.block()!.querySelector('.vtt-nf-item svg.nf-check')).not.toBeNull();
    expect(s.block()!.querySelector('[data-uia]')).toBeNull();
    expect(s.block()!.querySelector('[aria-checked="true"]')).not.toBeNull();
});

test('a pick of the pair puts the viewer\'s pair back on two lines', async () => {
    netflix(['English (CC)', 'Polish']);
    const s = setup({ native: 'pl', shipped: ['en', 'pl'] });
    s.state.addTrack('English', cues(5));
    s.state.addTrack('Polish', cues(5));
    s.state.overlayEnabled = false;
    await s.open();
    s.item('English + Polish').click();
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

    test('the credits spent for now: both greyed, «after 02:00», a press does nothing', async () => {
        const hour = 3600_000;
        store['ai.balance'] = {
            day: { used: 100, limit: 100, resetsAt: Date.now() + hour },
            month: { used: 100, limit: 1000, resetsAt: Date.now() + 30 * 24 * hour },
            exhausted: 'day',
        };
        const s = ukrainian();
        const start = jest.fn();
        s.controls.offer(start, true);
        await flush();
        await s.open();
        const items = [...s.block()!.querySelectorAll<HTMLElement>('.vtt-nf-item')];
        expect(items.map((li) => li.getAttribute('aria-disabled'))).toEqual(['true', 'true']);
        expect(items[0].textContent).toMatch(/^УкраїнськаAIafter \d{1,2}:\d{2}/);
        expect(items[1].title).toMatch(/AI limit for today reached/);
        items[1].dispatchEvent(new Event('pointerdown', { bubbles: true }));
        items[1].dispatchEvent(new Event('pointerup', { bubbles: true }));
        items[1].click();
        expect(start).not.toHaveBeenCalled();
        expect(s.ui.setMode).not.toHaveBeenCalled();
    });

    test('the language alone and the pair, both by AI', async () => {
        const s = ukrainian();
        await s.open();
        expect(s.labels()).toEqual(['УкраїнськаAI', 'English + УкраїнськаAI']);
    });

    test('nothing of AI while the account has no AI translation', async () => {
        const s = ukrainian();
        s.state.secondLineOnDemand = false;
        await s.open();
        expect(s.block()!.querySelectorAll('.vtt-nf-item')).toHaveLength(0);
        // The way to any other pair stays.
        expect(s.block()!.querySelector('.vtt-nf-choose')).not.toBeNull();
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
        // Under the item that asked, the items still in view.
        expect(s.labels()).toEqual(['УкраїнськаAI', 'English + УкраїнськаAI']);
        expect(box.closest('li')!.previousElementSibling!.textContent).toBe('English + УкраїнськаAI');
        [...box.querySelectorAll('button')].find((b) => b.textContent === 'Translate')!.click();
        expect(start).toHaveBeenCalledTimes(1);
        expect(s.state.displayMode).toBe('dual');
    });

    test('after a Netflix pick, the AI pair puts the learning track back on the first line', async () => {
        const s = ukrainian();
        s.state.addTrack('Polish', cues(5));
        s.controls.stop(() => {});
        await s.open();
        s.state.addTrack('Ukrainian · AI', cues(5));
        const list = subtitleList(document.querySelector('[data-uia="selector-audio-subtitle"]')!)!;
        (list.querySelectorAll('li')[2] as HTMLElement).click();
        expect(s.state.tracks[s.state.activeTrackIndex].name).toBe('Polish');
        s.item('English + УкраїнськаAI').click();
        expect(s.showTrack).toHaveBeenLastCalledWith('en');
        expect(s.state.displayMode).toBe('dual');
        expect(s.state.tracks[s.state.activeTrackIndex].name).toBe('English');
    });

    test('the language alone shows the translation as the one line', async () => {
        const s = ukrainian();
        // As attach and AiTranslator.start do: the translator offered for
        // stopping, its track preferred for the second line.
        const start = jest.fn(() => {
            s.controls.stop(() => {});
            s.state.preferredSecondaryName = 'Ukrainian · AI';
            s.state.addTrack('Ukrainian · AI', cues(5));
        });
        s.controls.offer(start, true);
        await s.open();
        s.item('УкраїнськаAI').click();
        expect(start).toHaveBeenCalledTimes(1);
        expect(s.state.displayMode).toBe('single');
        expect(s.state.singleTrackName).toBe('Ukrainian · AI');
        expect(s.state.tracks[s.state.activeTrackIndex].name).toBe('Ukrainian · AI');
        // Dual from the sidebar puts English back on the first line.
        s.state.displayMode = 'dual';
        expect(s.state.tracks[s.state.activeTrackIndex].name).toBe('English');
    });

    test('the offer gone while the question was up: Yes starts nothing and shows nothing as started', async () => {
        const s = ukrainian();
        const start = jest.fn();
        s.controls.offer(start, false);
        await s.open();
        s.item('УкраїнськаAI').click();
        await flush();
        [...s.block()!.querySelectorAll('button')].find((b) => b.textContent === 'Translate')!.click();
        expect(start).toHaveBeenCalledTimes(1);
        expect(s.state.singleTrackName).toBeUndefined();
        expect(s.block()!.querySelector('.vtt-nf-confirm')).toBeNull();
    });

    test('a question up when Netflix drops the block comes back with it', async () => {
        const s = ukrainian();
        s.controls.offer(jest.fn(), false);
        await s.open();
        s.item('English + УкраїнськаAI').click();
        await flush();
        expect(s.block()!.querySelector('.vtt-nf-confirm')).not.toBeNull();
        s.block()!.remove();
        await frames();
        expect(s.block()!.querySelector('.vtt-nf-confirm')).not.toBeNull();
    });
});

test('a pick in Netflix\'s own list is shown by us, one line; Netflix itself does not switch', async () => {
    netflix(['English (CC)', 'Polish']);
    const s = setup({ native: 'pl', shipped: ['en', 'pl'] });
    s.state.addTrack('English', cues(5));
    s.state.addTrack('Polish', cues(5));
    s.state.setDisplayMode('dual');
    await s.open();
    const panel = document.querySelector('[data-uia="selector-audio-subtitle"]')!;
    const netflixSaw = jest.fn();
    panel.parentElement!.addEventListener('click', netflixSaw);
    const list = subtitleList(panel)!;
    const polish = list.querySelectorAll('li')[2] as HTMLElement;
    polish.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    polish.dispatchEvent(new Event('pointerup', { bubbles: true }));
    polish.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(netflixSaw).not.toHaveBeenCalled();
    expect(s.showTrack).toHaveBeenCalledWith('pl');
    expect(s.state.displayMode).toBe('single');
    expect(s.state.overlayEnabled).toBe(true);
    // Netflix's mark follows what we show.
    expect(list.querySelectorAll('li')[2].classList.contains('vtt-nf-shown')).toBe(true);
    expect(list.querySelectorAll('li')[2].querySelector('.vtt-nf-check')).not.toBeNull();
    expect(list.querySelectorAll('li')[0].classList.contains('vtt-nf-shown')).toBe(false);
});

test('a Netflix item we cannot show stays Netflix\'s: its press goes through', async () => {
    netflix(['English (CC)', 'Polish', 'Japanese']);
    const s = setup({ native: 'pl', shipped: ['en', 'pl'] });
    s.state.addTrack('English', cues(5));
    await s.open();
    const panel = document.querySelector('[data-uia="selector-audio-subtitle"]')!;
    const netflixSaw = jest.fn();
    panel.parentElement!.addEventListener('click', netflixSaw);
    const japanese = subtitleList(panel)!.querySelectorAll('li')[3] as HTMLElement;
    japanese.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    expect(netflixSaw).toHaveBeenCalled();
    expect(s.showTrack).not.toHaveBeenCalled();
});

test('keys in Netflix\'s list: Enter picks by us, Tab and Escape go on to Netflix', async () => {
    netflix(['English (CC)', 'Polish']);
    const s = setup({ native: 'pl', shipped: ['en', 'pl'] });
    s.state.addTrack('English', cues(5));
    s.state.addTrack('Polish', cues(5));
    await s.open();
    const panel = document.querySelector('[data-uia="selector-audio-subtitle"]')!;
    const netflixKeys: string[] = [];
    panel.parentElement!.addEventListener('keydown', (e) => netflixKeys.push(e.key));
    const polish = subtitleList(panel)!.querySelectorAll('li')[2] as HTMLElement;
    for (const key of ['Tab', 'Escape']) {
        const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        polish.dispatchEvent(e);
        expect(e.defaultPrevented).toBe(false);
    }
    expect(netflixKeys).toEqual(['Tab', 'Escape']);
    polish.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(netflixKeys).toEqual(['Tab', 'Escape']);
    expect(s.showTrack).toHaveBeenCalledWith('pl');
});

test('destroyed, Netflix\'s items are its own again', async () => {
    netflix(['English (CC)', 'Polish']);
    const s = setup({ native: 'pl', shipped: ['en', 'pl'] });
    s.state.addTrack('English', cues(5));
    await s.open();
    s.controls.destroy();
    const panel = document.querySelector('[data-uia="selector-audio-subtitle"]')!;
    const netflixSaw = jest.fn();
    panel.parentElement!.addEventListener('click', netflixSaw);
    (subtitleList(panel)!.querySelectorAll('li')[2] as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    expect(netflixSaw).toHaveBeenCalled();
    expect(s.showTrack).not.toHaveBeenCalled();
});

test('a Netflix pick left behind by a sidebar change is not marked', async () => {
    netflix(['English (CC)', 'Polish']);
    const s = setup({ native: 'pl', shipped: ['en', 'pl'] });
    s.state.addTrack('English', cues(5));
    s.state.addTrack('Polish', cues(5));
    await s.open();
    const list = subtitleList(document.querySelector('[data-uia="selector-audio-subtitle"]')!)!;
    (list.querySelectorAll('li')[2] as HTMLElement).click();
    expect([...list.querySelectorAll('.vtt-nf-shown')].map((li) => li.textContent)).toEqual(['Polish']);
    // The sidebar puts English on the line, still in Single.
    s.state.setLanguagePreferences('English', 'Polish');
    s.ui.refresh();
    s.state.addTrack('English 2', cues(1));
    expect([...list.querySelectorAll('.vtt-nf-shown')].map((li) => li.textContent)).toEqual(['English (CC)']);
});

test('Netflix\'s Off turns our lines off and carries the mark', async () => {
    netflix(['English (CC)', 'Polish']);
    const s = setup({ native: 'pl', shipped: ['en', 'pl'] });
    s.state.addTrack('English', cues(5));
    await s.open();
    const list = subtitleList(document.querySelector('[data-uia="selector-audio-subtitle"]')!)!;
    (list.querySelector('li') as HTMLElement).click();
    expect(s.state.overlayEnabled).toBe(false);
    expect(list.querySelector('li')!.classList.contains('vtt-nf-shown')).toBe(true);
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
    expect(s.ui.openSettings).toHaveBeenCalledWith('languages');
    expect(netflixHandler).not.toHaveBeenCalled();
});

test('Options on the Subtitles heading line opens the settings as they are, Netflix\'s heading untouched', async () => {
    netflix(['English (CC)', 'Polish']);
    const s = setup({ native: 'pl', shipped: ['en', 'pl'] });
    s.state.addTrack('English', cues(5));
    await s.open();
    const heading = s.block()!.previousElementSibling!;
    expect(heading.textContent).toBe('Subtitles');
    const options = s.block()!.querySelector<HTMLButtonElement>('.vtt-nf-options')!;
    expect(options.textContent).toBe('Options');
    options.click();
    expect(s.ui.openSettings).toHaveBeenCalledTimes(1);
    expect(s.ui.openSettings).toHaveBeenCalledWith();
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

test('every opening of the panel gets the block, not only the first', async () => {
    netflix(['English (CC)', 'Polish']);
    const s = setup({ native: 'pl', shipped: ['en', 'pl'] });
    s.state.addTrack('English', cues(5));
    await s.open();
    expect(s.block()).not.toBeNull();
    // Netflix closes the panel and builds a new one on the next hover.
    netflix(['English (CC)', 'Polish']);
    await s.open();
    expect(s.block()).not.toBeNull();
});

test('the sidebar tab steps aside while the panel is open', async () => {
    netflix(['English (CC)', 'Polish']);
    document.body.firstElementChild!.setAttribute('data-uia', 'control-audio-subtitle');
    const s = setup({ native: 'pl', shipped: ['en', 'pl'] });
    s.state.addTrack('English', cues(5));
    await s.open();
    expect(document.documentElement.classList.contains('vtt-nf-panel-open')).toBe(true);
    document.querySelector('[data-uia="selector-audio-subtitle"]')!.remove();
    await frames();
    expect(document.documentElement.classList.contains('vtt-nf-panel-open')).toBe(false);
});

test('a panel reaching past the narrowed player: the box around it moves left, not the panel it clips', async () => {
    netflix(['English (CC)', 'Polish']);
    const panel = document.querySelector<HTMLElement>('[data-uia="selector-audio-subtitle"]')!;
    const player = document.createElement('div');
    player.setAttribute('data-uia', 'watch-video');
    const box = document.createElement('div');
    panel.replaceWith(player);
    player.append(box);
    box.append(panel);
    // As measured live: the player 0–1408 beside the sidebar; Netflix first
    // puts the box at 931, then, once our block widened it, at 885–1503.
    let at = 931;
    jest.spyOn(player, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 1408 } as DOMRect);
    jest.spyOn(box, 'getBoundingClientRect').mockImplementation(() => {
        const shift = parseFloat(box.style.translate) || 0;
        return { left: at + shift, right: at + 618 + shift } as DOMRect;
    });
    const resized: (() => void)[] = [];
    (global as any).ResizeObserver = class {
        constructor(fn: () => void) {
            resized.push(fn);
        }
        observe() {}
        disconnect() {}
    };
    try {
        const s = setup({ native: 'pl', shipped: ['en', 'pl'] });
        s.state.addTrack('English', cues(5));
        await s.open();
        expect(box.style.translate).toBe('-149px 0');
        // Netflix places it again, by a style on the box around ours.
        at = 885;
        player.setAttribute('style', 'left: 885px');
        await flush();
        expect(box.style.translate).toBe('-103px 0');
        expect(panel.style.translate).toBe('');
        // The sidebar closed: the player is wide again, the box goes back.
        jest.spyOn(player, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 1728 } as DOMRect);
        for (const fn of resized) fn();
        expect(box.style.translate).toBe('');
    } finally {
        delete (global as any).ResizeObserver;
    }
});

test('a press survives Netflix re-rendering the item between pointerdown and pointerup', async () => {
    netflix(['English (CC)', 'Polish']);
    const s = setup({ native: 'pl', shipped: ['en', 'pl'] });
    s.state.addTrack('English', cues(5));
    s.state.addTrack('Polish', cues(5));
    s.state.overlayEnabled = false;
    await s.open();
    s.item('English + Polish').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    // Netflix rebuilds the column: our block goes and comes back as new nodes.
    s.block()!.remove();
    await frames();
    s.item('English + Polish').dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(s.state.overlayEnabled).toBe(true);
    expect(s.showPair).toHaveBeenCalled();
});


test('one check mark at most: unchecked items carry none, only the Subtitles list is managed', async () => {
    netflix(['English (CC)', 'Polish']);
    const s = setup({ native: 'uk', shipped: ['en', 'pl'] });
    s.state.addTrack('English', cues(5));
    s.state.secondLineOnDemand = true;
    s.state.secondLineLanguage = 'uk';
    await s.open();
    const panel = document.querySelector('[data-uia="selector-audio-subtitle"]')!;
    const list = subtitleList(panel)!;
    // Netflix's English (CC) picked through its list: our mark goes there.
    const cc = list.querySelectorAll('li')[1] as HTMLElement;
    cc.click();
    expect(s.block()!.querySelectorAll('svg')).toHaveLength(0);
    expect([...s.block()!.querySelectorAll('.vtt-nf-item')].every((li) => li.getAttribute('aria-checked') === 'false')).toBe(true);
    expect(list.classList.contains('vtt-nf-sublist')).toBe(true);
    const audio = [...panel.querySelectorAll('ul')].find((u) => u !== list)!;
    expect(audio.classList.contains('vtt-nf-sublist')).toBe(false);
});

test('Choose another pair works with a real press across a Netflix re-render', async () => {
    netflix(['English (CC)', 'Polish']);
    const s = setup({ native: 'pl', shipped: ['en', 'pl'] });
    s.state.addTrack('English', cues(5));
    await s.open();
    const first = s.block()!.querySelector('.vtt-nf-choose')!;
    first.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    s.block()!.remove();
    await frames();
    const again = s.block()!.querySelector('.vtt-nf-choose')!;
    expect(again).not.toBe(first);
    again.dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(s.ui.openSettings).toHaveBeenCalledTimes(1);
});

test('Single picked elsewhere marks Netflix\'s item of the language shown', async () => {
    netflix(['English (CC)', 'Polish']);
    const s = setup({ native: 'pl', shipped: ['en', 'pl'] });
    s.state.addTrack('English', cues(5));
    s.state.addTrack('Polish', cues(5));
    s.state.setDisplayMode('single');
    await s.open();
    const list = subtitleList(document.querySelector('[data-uia="selector-audio-subtitle"]')!)!;
    expect([...list.querySelectorAll('.vtt-nf-shown')].map((li) => li.textContent)).toEqual(['English (CC)']);
});

test('a video translated before: Dual starts it again, and the pick still shows it', async () => {
    const s = (() => {
        netflix(['English (CC)', 'Polish']);
        return setup({ native: 'uk', shipped: ['en', 'pl'] });
    })();
    s.state.addTrack('English', cues(5));
    s.state.secondLineOnDemand = true;
    s.state.secondLineLanguage = 'uk';
    s.state.setDisplayMode('single');
    s.state.overlayEnabled = false;
    // As attachAiTranslation does for a remembered video: Dual starts it, no offer.
    s.state.subscribe((e) => {
        if (e.type === 'mode' && e.mode === 'dual') s.controls.stop(jest.fn());
    });
    await s.open();
    s.item('English + УкраїнськаAI').click();
    expect(s.state.displayMode).toBe('dual');
    expect(s.state.overlayEnabled).toBe(true);
});
