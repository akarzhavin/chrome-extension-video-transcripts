/**
 * @jest-environment jsdom
 */

/**
 * The "AI translation" switch in the settings panel's Languages group: it
 * stores aiTranslate and shows what the translation is doing.
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

test('the switch sits in the Languages group, off by default, and stores the choice', async () => {
    build();
    await flush();
    const box = document.getElementById('vtt-ai-toggle') as HTMLInputElement;
    expect(box).not.toBeNull();
    expect(document.getElementById('vtt-track-selectors')!.parentElement!.contains(box)).toBe(true);
    expect(box.checked).toBe(false);

    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await flush();
    expect((await loadPrefs()).aiTranslate).toBe(true);
});

test('it shows the stored choice', async () => {
    await savePrefs({ aiTranslate: true });
    build();
    await flush();
    expect((document.getElementById('vtt-ai-toggle') as HTMLInputElement).checked).toBe(true);
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
