/**
 * @jest-environment jsdom
 *
 * The popup's two blocks that come with the welcome page: this edition's video
 * site switches, and "Finish setup" until the welcome page was finished.
 */

const store: Record<string, unknown> = {};
(global as any).chrome = {
    storage: {
        local: {
            get: jest.fn(async (k: any) => {
                const keys = typeof k === 'string' ? [k] : Array.isArray(k) ? k : Object.keys(k ?? {});
                const out: Record<string, unknown> = {};
                for (const key of keys) if (key in store) out[key] = store[key];
                return out;
            }),
            set: jest.fn(async (items: Record<string, unknown>) => {
                for (const [k, v] of Object.entries(items)) store[k] = JSON.parse(JSON.stringify(v));
            }),
        },
        onChanged: { addListener: jest.fn(), removeListener: jest.fn() },
    },
    runtime: {
        id: 'ext',
        lastError: undefined,
        getURL: (p: string) => `chrome-extension://ext/${p}`,
        sendMessage: jest.fn((msg: any, cb?: (r: unknown) => void) => cb?.({ signedIn: false })),
    },
    i18n: { getMessage: () => '' },
    tabs: { create: jest.fn() },
};

import { initPopup } from '../src/popup/popup';
import { loadPrefs } from '../src/prefs';

const flush = async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};

async function mount(edition?: 'youtube' | 'rezka'): Promise<HTMLElement> {
    document.body.innerHTML = '<div id="root"></div>';
    initPopup(edition ? { edition } : undefined);
    await flush();
    return document.getElementById('root')!;
}

beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    (chrome.tabs.create as jest.Mock).mockClear();
    window.close = jest.fn();
});

test('YouTube edition: YouTube and Netflix switches, writing the site prefs', async () => {
    store['prefs.v1'] = { siteNetflix: false };
    const root = await mount('youtube');
    const yt = root.querySelector<HTMLInputElement>('input[data-pref="siteYoutube"]')!;
    const nf = root.querySelector<HTMLInputElement>('input[data-pref="siteNetflix"]')!;
    expect(yt.checked).toBe(true);
    expect(nf.checked).toBe(false);
    expect(root.querySelector('input[data-pref="siteRezka"]')).toBeNull();
    yt.checked = false;
    yt.dispatchEvent(new Event('change'));
    await flush();
    expect((await loadPrefs()).siteYoutube).toBe(false);
});

test('HDrezka edition: only the HDrezka switch', async () => {
    const root = await mount('rezka');
    expect(Array.from(root.querySelectorAll('input[data-pref^="site"]')).map((b) => (b as HTMLElement).dataset.pref)).toEqual([
        'siteRezka',
    ]);
});

test('"Finish setup" until the welcome page is finished, and it opens that page', async () => {
    const root = await mount('youtube');
    const b = Array.from(root.querySelectorAll('button')).find((x) => x.textContent === 'Finish setup')!;
    b.click();
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: expect.stringMatching(/\/welcome\/\?ext=youtube&id=ext$/) });

    store['welcome.v1'] = { step: 2, languageDone: true, skippedAccount: false, finished: true };
    const again = await mount('youtube');
    expect(Array.from(again.querySelectorAll('button')).some((x) => x.textContent === 'Finish setup')).toBe(false);
});

test('no edition given (older callers): neither block appears', async () => {
    const root = await mount();
    expect(root.querySelector('input[data-pref^="site"]')).toBeNull();
    expect(Array.from(root.querySelectorAll('button')).some((x) => x.textContent === 'Finish setup')).toBe(false);
});
