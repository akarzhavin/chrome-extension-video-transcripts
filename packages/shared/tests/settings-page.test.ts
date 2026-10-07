/**
 * settings.html (the options page) is a doorway to the site's settings page:
 * every way into "Settings" — the popup, "Manage sites", Chrome's own
 * "Extension options" — ends on one interface, signed in or not.
 */

const store: Record<string, unknown> = {};
(global as any).chrome = {
    runtime: { id: 'ajjfnojdnahbmialmfdeafejbieacnik' },
    storage: {
        local: { get: jest.fn(async () => ({ ...store })) },
        onChanged: { addListener: jest.fn() },
    },
};

const replace = jest.fn();
let tab = { hash: '', replace };
function at(hash: string): void {
    tab = { hash, replace };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
    jest.resetModules();
    replace.mockReset();
    for (const k of Object.keys(store)) delete store[k];
});

test("replaces itself with the site's page for this extension and edition", async () => {
    at('');
    const { initSettings } = await import('../src/settings/settings');
    await initSettings({ edition: 'youtube' }, tab);
    expect(replace.mock.calls).toEqual([
        ['http://localhost:5173/app/vocab/extension?ext=ajjfnojdnahbmialmfdeafejbieacnik&edition=youtube'],
    ]);
});

test('keeps the anchor "Manage sites" opens it with', async () => {
    at('#highlight');
    const { initSettings } = await import('../src/settings/settings');
    await initSettings({ edition: 'rezka' }, tab);
    expect(replace.mock.calls).toEqual([
        ['http://localhost:5173/app/vocab/extension?ext=ajjfnojdnahbmialmfdeafejbieacnik&edition=rezka#highlight'],
    ]);
});

test("a dev build goes to the site of the backend it is switched to", async () => {
    (global as any).__EXT_DEV_TARGETS__ = JSON.stringify([
        { name: 'preprod', projectId: 'p-pre', apiKey: 'k', frontendBaseUrl: 'https://preprod.example.com' },
    ]);
    store['dev.targetEnv'] = 'preprod';
    at('');
    try {
        const { initSettings } = await import('../src/settings/settings');
        await initSettings({ edition: 'youtube' }, tab);
        await settle();
        expect(replace.mock.calls[0][0]).toMatch(/^https:\/\/preprod\.example\.com\/app\/vocab\/extension\?/);
    } finally {
        (global as any).__EXT_DEV_TARGETS__ = '';
    }
});
