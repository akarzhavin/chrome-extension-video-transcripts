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

describe('in a production build', () => {
    // Dev-only until it ships: absent, not hidden.
    afterEach(() => {
        (global as any).__EXT_ENV__ = 'dev';
    });

    test('the status line is never built', async () => {
        (global as any).__EXT_ENV__ = 'prod';
        const ui = build();
        await flush();
        expect(document.getElementById('vtt-ai-status')).toBeNull();
        expect(() => ui.setAiStatus('ready')).not.toThrow();
    });

    test('a stored choice reads as off', async () => {
        await savePrefs({ aiTranslateForce: true });
        (global as any).__EXT_ENV__ = 'prod';
        expect((await loadPrefs()).aiTranslateForce).toBe(false);
    });
});
