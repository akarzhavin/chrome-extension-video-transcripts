/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://hdrezka.ag/films/drama/1-title.html"}
 */

// No site switch any more: a site switched off by an older version is built
// anyway, since nothing is left to switch it back on. Driven through the REAL
// entry module, with the stored flag off and on.

// A module, not a script: the three site-switch files share names.
export {};

let stored: Record<string, unknown> = {};

(global as any).chrome = {
    runtime: {
        id: 'test-extension-id',
        getURL: (p: string) => `chrome-extension://test/${p}`,
        getManifest: () => ({ version: '1.0.0' }),
        sendMessage: jest.fn(),
        onMessage: { addListener: jest.fn() },
        onMessageExternal: { addListener: jest.fn() },
        onInstalled: { addListener: jest.fn() },
        setUninstallURL: jest.fn(),
        lastError: undefined,
    },
    tabs: { create: jest.fn(), sendMessage: jest.fn() },
    action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn() },
    i18n: { getMessage: () => '', getUILanguage: () => 'en' },
    storage: {
        local: {
            get: jest.fn(async (k: any) => {
                const keys = typeof k === 'string' ? [k] : Array.isArray(k) ? k : Object.keys(k ?? {});
                const out: Record<string, unknown> = {};
                for (const key of keys) if (key in stored) out[key] = stored[key];
                return out;
            }),
            set: jest.fn().mockResolvedValue(undefined),
        },
        sync: { get: jest.fn().mockResolvedValue({}), set: jest.fn().mockResolvedValue(undefined) },
        onChanged: { addListener: jest.fn() },
    },
};

const flush = async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

async function loadEntry(siteRezka: boolean): Promise<void> {
    document.body.innerHTML = '';
    stored = { 'prefs.v1': { siteRezka } };
    jest.isolateModules(() => {
        require('../src/content/index');
    });
    await flush();
}

test('a site switched off by an older version is built anyway: there is no switch to turn it back on', async () => {
    await loadEntry(false);
    expect(document.getElementById('vtt-sidebar')).not.toBeNull();
});

test('switched on: the sidebar is built', async () => {
    await loadEntry(true);
    expect(document.getElementById('vtt-sidebar')).not.toBeNull();
});
