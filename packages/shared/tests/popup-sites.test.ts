/**
 * @jest-environment jsdom
 *
 * The popup's block that comes with the welcome page: "Finish setup" until the
 * welcome page was finished. The video-site switches are on the settings page
 * (settings-page.test.ts).
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
    tabs: { create: jest.fn(), query: jest.fn(async () => []) },
};

import { initPopup } from '../src/popup/popup';

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

test('the video-site switches are not in the popup, in either edition', async () => {
    for (const edition of ['youtube', 'rezka'] as const) {
        const root = await mount(edition);
        expect(root.querySelector('input[data-pref^="site"]')).toBeNull();
        expect(root.textContent).not.toContain('Subtitles on');
    }
});

test('"Finish setup" is a menu row directly under the account rows, above the highlight row', async () => {
    const root = await mount('youtube');
    const b = Array.from(root.querySelectorAll('button')).find((x) => x.textContent === 'Finish setup')!;
    expect(b.className).toBe('mi');
    expect(b.querySelector('svg')).not.toBeNull();
    expect(b.parentElement!.nextElementSibling!.className).toBe('highlight');
    expect(b.parentElement!.previousElementSibling!.textContent).toBe('Sign in on Lingogram');
});

test('the "Finish setup" slot stays out of the layout until storage has answered', async () => {
    store['welcome.v1'] = { step: 2, languageDone: true, skippedAccount: false, finished: true };
    const root = await mount('youtube');
    const slot = root.querySelector('.highlight')!.previousElementSibling as HTMLElement;
    expect(slot.hidden).toBe(true);
    expect(slot.children).toHaveLength(0);
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

test('no edition given (older callers): no "Finish setup"', async () => {
    const root = await mount();
    expect(root.querySelector('input[data-pref^="site"]')).toBeNull();
    expect(Array.from(root.querySelectorAll('button')).some((x) => x.textContent === 'Finish setup')).toBe(false);
});
