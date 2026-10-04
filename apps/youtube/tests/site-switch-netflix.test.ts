/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://www.netflix.com/watch/123"}
 */

// The site switch (welcome page, popup): Netflix switched off means the content
// script builds nothing on a Netflix page. Driven through the REAL entry
// module on a Netflix URL, once off and once on, so the "on" run proves the
// "off" run's empty page is the switch and not a bootstrap that never ran.

// A module, not a script: the three site-switch files share names.
export {};

let stored: Record<string, unknown> = {};

// jsdom has no ResizeObserver; the YouTube bootstrap watches the control bar with one.
(global as any).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
};

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

async function loadEntry(siteNetflix: boolean): Promise<void> {
    document.body.innerHTML = '';
    stored = { 'prefs.v1': { siteNetflix } };
    jest.isolateModules(() => {
        require('../src/content/index');
    });
    await flush();
}

test('switched off: nothing is built on an netflix page', async () => {
    await loadEntry(false);
    expect(document.getElementById('vtt-sidebar')).toBeNull();
});

test('switched on: the sidebar is built (control for the test above)', async () => {
    await loadEntry(true);
    expect(document.getElementById('vtt-sidebar')).not.toBeNull();
});
