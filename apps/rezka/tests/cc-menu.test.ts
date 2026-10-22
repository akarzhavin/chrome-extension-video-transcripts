/**
 * @jest-environment jsdom
 */

/**
 * HDrezka's CC button opens our menu: one line or two from the loaded tracks,
 * the AI pair when the site has no track in the viewer's language, and Off.
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
import { installCcMenu, trackLabel } from '../src/content/cc-menu';

const flush = () => new Promise((r) => setTimeout(r, 0));
const cues = (n: number): Subtitle[] =>
    Array.from({ length: n }, (_, i) => ({ startTime: i, endTime: i + 1, text: `line ${i}` }) as Subtitle);

/** The player's markup around the CC button, as Playerjs builds it. */
function player(): { root: HTMLElement; cc: HTMLElement } {
    document.body.innerHTML = `
        <div id="cdnplayer"><div id="oframecdnplayer">
            <pjsdiv id="holder"><pjsdiv><pjsdiv id="cdnplayer_control_cc_bg"></pjsdiv></pjsdiv>
                <pjsdiv id="hit"></pjsdiv></pjsdiv>
        </div></div>`;
    return { root: document.getElementById('oframecdnplayer')!, cc: document.getElementById('hit')! };
}

function setup(opts: { native?: string } = {}) {
    const { root, cc } = player();
    const state = new AppState();
    state.setLanguagePreferences('English', 'Ukrainian');
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
    const controls = installCcMenu({
        state,
        ui,
        langPrefs: () => ({ learning: 'en', native: opts.native ?? 'uk' }),
    });
    const menu = () => root.querySelector<HTMLElement>('.vtt-cc-menu');
    const items = () => [...(menu()?.querySelectorAll<HTMLButtonElement>('.vtt-cc-item') ?? [])];
    const labels = () => items().map((b) => b.textContent);
    const item = (label: string) => items().find((b) => b.textContent === label)!;
    const checked = () => items().filter((b) => b.getAttribute('aria-checked') === 'true').map((b) => b.textContent);
    const click = () => {
        const e = new MouseEvent('click', { bubbles: true, cancelable: true });
        cc.dispatchEvent(e);
        return e;
    };
    return { state, ui, controls, root, menu, labels, item, checked, click };
}

test('the player names a track by its own label', () => {
    expect(trackLabel('Russian — Русский')).toBe('Русский');
    expect(trackLabel('English — Оригинал (+субтитры) (реж.)')).toBe('Оригинал (+субтитры) (реж.)');
    expect(trackLabel('English 2')).toBe('English 2');
});

test('before any track loads, the player opens its own menu', () => {
    const s = setup();
    const e = s.click();
    expect(e.defaultPrevented).toBe(false);
    expect(s.menu()).toBeNull();
});

test('with tracks, CC opens ours inside the player: lines alone, then pairs, then Off', () => {
    const s = setup();
    s.state.addTrack('English — English', cues(5));
    s.state.addTrack('Russian — Русский', cues(5));
    s.state.setDisplayMode('dual');
    const e = s.click();
    expect(e.defaultPrevented).toBe(true);
    expect(s.menu()!.parentElement).toBe(s.root);
    expect(s.labels()).toEqual(['English', 'Русский', 'English + Русский', 'Off']);
    expect(s.checked()).toEqual(['English + Русский']);
    expect(s.menu()!.querySelectorAll('[role=separator]')).toHaveLength(2);

    s.click();
    expect(s.menu()).toBeNull();
});

test('a track alone is Single on that track; a pair is Dual on both', () => {
    const s = setup();
    s.state.addTrack('English — English', cues(5));
    s.state.addTrack('Russian — Русский', cues(5));
    s.click();
    s.item('Русский').click();
    expect(s.menu()).toBeNull();
    expect(s.state.activeTrackIndex).toBe(1);
    expect(s.state.displayMode).toBe('single');

    s.click();
    expect(s.checked()).toEqual(['Русский']);
    s.item('Русский + English').click();
    expect(s.state.displayMode).toBe('dual');
    expect(s.state.activeTrackIndex).toBe(1);
    expect(s.state.secondaryTrackIndex).toBe(0);
});

test('Dual with nothing to pair checks the one line that shows', () => {
    const s = setup();
    s.state.addTrack('Russian — Русский', cues(5));
    s.state.displayMode = 'dual';
    s.click();
    expect(s.labels()).toEqual(['Русский', 'Off']);
    expect(s.checked()).toEqual(['Русский']);
});

test('every version of a language stays on the list', () => {
    const s = setup();
    s.state.addTrack('English — English', cues(5));
    s.state.addTrack('English — English (реж.)', cues(6));
    s.state.addTrack('Russian — Русский', cues(5));
    s.click();
    expect(s.labels()).toEqual(['English', 'English (реж.)', 'Русский', 'English + Русский', 'Off']);
});

test('Off hides the on-screen lines, and any line brings them back', () => {
    const s = setup();
    s.state.addTrack('English — English', cues(5));
    s.click();
    s.item('Off').click();
    expect(s.state.overlayEnabled).toBe(false);
    s.click();
    expect(s.checked()).toEqual(['Off']);
    s.item('English').click();
    expect(s.state.overlayEnabled).toBe(true);
});

test('Settings opens the sidebar settings', () => {
    const s = setup();
    s.state.addTrack('English — English', cues(5));
    s.click();
    s.menu()!.querySelector<HTMLButtonElement>('.vtt-cc-settings')!.click();
    expect(s.ui.openSettings).toHaveBeenCalled();
    expect(s.menu()).toBeNull();
});

test('Escape and a click outside close it', () => {
    const s = setup();
    s.state.addTrack('English — English', cues(5));
    s.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(s.menu()).toBeNull();
    s.click();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(s.menu()).toBeNull();
});

describe('the AI pair', () => {
    beforeEach(() => {
        for (const k of Object.keys(store)) delete store[k];
    });

    function withAi() {
        const s = setup();
        s.state.addTrack('English — English', cues(5));
        s.state.addTrack('Russian — Русский', cues(5));
        s.state.secondLineOnDemand = true;
        return s;
    }

    test('is offered in the viewer\'s language, marked AI', () => {
        const s = withAi();
        s.click();
        expect(s.labels()).toEqual(['English', 'Русский', 'English + Русский', 'English + УкраїнськаAI', 'Off']);
        expect(s.item('English + УкраїнськаAI').querySelector('.vtt-cc-ai')).not.toBeNull();
    });

    test('asks once inside the menu, then Translate starts it', async () => {
        const s = withAi();
        const start = jest.fn();
        s.controls.offer(start, false);
        s.click();
        s.item('English + УкраїнськаAI').click();
        await flush();
        expect(start).not.toHaveBeenCalled();
        expect(s.state.displayMode).toBe('dual');
        const body = s.menu()!.querySelector('.vtt-cc-confirm')!;
        expect(body.textContent).toMatch(/uses credits/);
        const yes = [...body.querySelectorAll('button')].find((b) => b.textContent === 'Translate')!;
        body.querySelector<HTMLInputElement>('input')!.checked = true;
        yes.click();
        expect(start).toHaveBeenCalledTimes(1);
        expect(store.aiConfirmSkip).toBe(true);
        expect(s.menu()).toBeNull();
    });

    test('Not now goes back to the list', async () => {
        const s = withAi();
        const start = jest.fn();
        s.controls.offer(start, false);
        s.click();
        s.item('English + УкраїнськаAI').click();
        await flush();
        const no = [...s.menu()!.querySelectorAll('.vtt-cc-confirm button')].find((b) => b.textContent === 'Not now') as HTMLButtonElement;
        no.click();
        expect(start).not.toHaveBeenCalled();
        expect(s.labels()).toContain('Off');
    });

    test('turned off on this video, it starts again without asking', async () => {
        const s = withAi();
        const start = jest.fn();
        s.controls.offer(start, true);
        s.click();
        s.item('English + УкраїнськаAI').click();
        await flush();
        expect(start).toHaveBeenCalledTimes(1);
        expect(s.menu()).toBeNull();
    });

    test('while it runs it is the checked pair, and any other choice turns it off', () => {
        const s = withAi();
        const stop = jest.fn();
        s.state.setDisplayMode('dual');
        s.controls.stop(stop);
        s.click();
        expect(s.checked()).toEqual(['English + УкраїнськаAI']);
        s.item('English + Русский').click();
        expect(stop).toHaveBeenCalledTimes(1);
    });
});
