/**
 * @jest-environment jsdom
 *
 * The worker side of the settings page on the site (settings-bridge.ts). Every
 * value the page sends is checked here before anything is written, and a
 * message with one bad part writes nothing at all.
 */

const store: Record<string, unknown> = {};
const session: Record<string, unknown> = {};
let externalListener: ((m: any, s: any, r: any) => boolean | void) | null = null;

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
        onChanged: { addListener: jest.fn() },
        session: {
            set: jest.fn(async (items: Record<string, unknown>) => Object.assign(session, items)),
        },
    },
    runtime: {
        id: 'pkoibjilnaeadmcnmfkgcjhalljbmfan',
        getManifest: () => ({ version: '1.2.3' }),
        sendMessage: jest.fn(),
        onMessageExternal: { addListener: (l: any) => (externalListener = l) },
    },
};

const handleAuthMessage = jest.fn();
jest.mock('../src/auth/background', () => ({
    handleAuthMessage: (...a: unknown[]) => handleAuthMessage(...a),
    isAllowedExternalSender: (s: { origin?: string }) => s.origin === 'https://lingogram.ai',
}));
// What the stored analytics preference said at the moment each event went out.
const optOutSeen: unknown[] = [];
jest.mock('../src/analytics-bg', () => ({
    track: jest.fn(async (event: string) => {
        const p = (store['prefs.v1'] as { analyticsEnabled?: boolean } | undefined)?.analyticsEnabled;
        optOutSeen.push([event, p]);
    }),
}));
jest.mock('../src/analytics', () => ({ ...jest.requireActual('../src/analytics'), trackVia: jest.fn() }));

import { handleSettingsMessage, installSettingsBridge } from '../src/settings-bridge';

const msg = (op: string, extra: Record<string, unknown> = {}) => ({ type: 'lingogram-settings' as const, op: op as any, ...extra });
const yt = { edition: 'youtube' as const };
const rezka = { edition: 'rezka' as const, languages: ['en', 'ru', 'uk'] };

beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    optOutSeen.length = 0;
    (chrome.runtime.sendMessage as jest.Mock).mockReset();
    handleAuthMessage.mockReset();
    handleAuthMessage.mockResolvedValue({ signedIn: true, email: 'a@b.c' });
});

describe('state', () => {
    test('the YouTube edition: its two sites, version, languages, and the switches', async () => {
        store['lang.v1'] = { learning: 'en', native: 'ru' };
        // A site switched off by an older version: the state no longer reports it.
        store['prefs.v1'] = { pageHighlight: false, analyticsEnabled: false, siteNetflix: false };
        const s: any = await handleSettingsMessage(msg('state'), yt);
        expect(s).toMatchObject({
            ok: true,
            edition: 'youtube',
            version: '1.2.3',
            signedIn: true,
            learning: 'en',
            native: 'ru',
            pageHighlight: false,
            analyticsEnabled: false,
        });
        expect(s.sites).toEqual([
            { id: 'youtube', name: 'YouTube' },
            { id: 'netflix', name: 'Netflix' },
        ]);
        expect(s.languages.length).toBeGreaterThan(10);
        expect(s.languages[0]).toEqual({ code: expect.any(String), label: expect.any(String), native: expect.any(String) });
    });

    test('the HDrezka edition: its one site and its own language list', async () => {
        const s: any = await handleSettingsMessage(msg('state'), rezka);
        expect(s.edition).toBe('rezka');
        expect(s.sites).toEqual([{ id: 'rezka', name: 'HDrezka' }]);
        expect(s.languages.map((l: any) => l.code)).toEqual(['en', 'ru', 'uk']);
    });

    test('unset languages are empty strings, signed out is false, defaults are on', async () => {
        handleAuthMessage.mockResolvedValue({ signedIn: false });
        const s: any = await handleSettingsMessage(msg('state'), yt);
        expect(s).toMatchObject({ signedIn: false, learning: '', native: '', pageHighlight: true, analyticsEnabled: true });
    });
});

describe('set', () => {
    test('writes languages and the two switches in one message', async () => {
        const r = await handleSettingsMessage(
            msg('set', {
                languages: { learning: 'en', native: 'ru' },
                prefs: { pageHighlight: false, analyticsEnabled: false },
            }),
            yt,
        );
        expect(r).toEqual({ ok: true });
        expect(store['lang.v1']).toEqual({ learning: 'en', native: 'ru' });
        expect(store['prefs.v1']).toMatchObject({ pageHighlight: false, analyticsEnabled: false });
    });

    const refusals: Array<[string, Record<string, unknown>, any, string]> = [
        ['a language this edition does not offer', { languages: { learning: 'es', native: 'ru' } }, rezka, 'unknown language'],
        ['an unknown language code', { languages: { learning: 'en', native: 'xx' } }, yt, 'unknown language'],
        ['a language that is not a string', { languages: { learning: 5, native: 'ru' } }, yt, 'unknown language'],
        ['an unknown key inside languages', { languages: { learning: 'en', native: 'ru', extra: 1 } }, yt, 'unknown key: languages.extra'],
        ['languages that is not an object', { languages: 'en' }, yt, 'languages must be an object'],
        ['a non-boolean pageHighlight', { prefs: { pageHighlight: 'no' } }, yt, 'pageHighlight must be a boolean'],
        ['a non-boolean analyticsEnabled', { prefs: { analyticsEnabled: 0 } }, yt, 'analyticsEnabled must be a boolean'],
        ['an unknown pref', { prefs: { theme: 'dark' } }, yt, 'unknown key: prefs.theme'],
        // The video sites have no switch any more: the old message is refused, not stored.
        ['a site switch', { prefs: { sites: { youtube: false } } }, yt, 'unknown key: prefs.sites'],
        ['prefs that is not an object', { prefs: true }, yt, 'prefs must be an object'],
        ['an unknown top-level key', { colour: 'red' }, yt, 'unknown key: colour'],
    ];
    test.each(refusals)('refuses %s', async (_name, extra, opts, error) => {
        expect(await handleSettingsMessage(msg('set', extra), opts)).toEqual({ ok: false, error });
    });

    test('nothing is written when any part is invalid, even if the other parts are fine', async () => {
        const r = await handleSettingsMessage(
            msg('set', {
                languages: { learning: 'en', native: 'ru' },
                prefs: { pageHighlight: false, sites: { youtube: false } },
            }),
            yt,
        );
        expect(r).toMatchObject({ ok: false });
        expect(store['lang.v1']).toBeUndefined();
        expect(store['prefs.v1']).toBeUndefined();
        expect(optOutSeen).toEqual([]);
    });

    test('an invalid message never reports an opt-out', async () => {
        await handleSettingsMessage(msg('set', { prefs: { analyticsEnabled: false, theme: 'x' } }), yt);
        expect(optOutSeen).toEqual([]);
    });

    test('turning analytics off reports analytics_opt_out BEFORE the preference is written', async () => {
        await handleSettingsMessage(msg('set', { prefs: { analyticsEnabled: false } }), yt);
        // The stored preference still said "on" when the event went out.
        expect(optOutSeen).toEqual([['analytics_opt_out', undefined]]);
        expect((store['prefs.v1'] as any).analyticsEnabled).toBe(false);
    });

    test('turning analytics off also tells the other edition', async () => {
        const send = chrome.runtime.sendMessage as jest.Mock;
        send.mockClear();
        await handleSettingsMessage(msg('set', { prefs: { analyticsEnabled: false } }), yt);
        expect(send).toHaveBeenCalledWith('hmdkmkimdbomemfcjmgeclchbcdbhabj', {
            type: 'lingogram-sibling',
            op: 'analyticsSet',
            on: false,
        });
    });

    test('other prefs stay with this edition', async () => {
        const send = chrome.runtime.sendMessage as jest.Mock;
        send.mockClear();
        await handleSettingsMessage(msg('set', { prefs: { pageHighlight: false } }), yt);
        expect(send.mock.calls.filter(([, m]) => m?.op === 'analyticsSet')).toEqual([]);
    });

    test('with analytics already on and explicitly stored, the event still sees it on', async () => {
        store['prefs.v1'] = { analyticsEnabled: true };
        await handleSettingsMessage(msg('set', { prefs: { analyticsEnabled: false } }), yt);
        expect(optOutSeen).toEqual([['analytics_opt_out', true]]);
    });

    test('turning analytics on, or sending off while it is already off, reports nothing', async () => {
        store['prefs.v1'] = { analyticsEnabled: false };
        await handleSettingsMessage(msg('set', { prefs: { analyticsEnabled: false } }), yt);
        await handleSettingsMessage(msg('set', { prefs: { analyticsEnabled: true } }), yt);
        expect(optOutSeen).toEqual([]);
        expect((store['prefs.v1'] as any).analyticsEnabled).toBe(true);
    });

    test('an empty set is a no-op that succeeds', async () => {
        expect(await handleSettingsMessage(msg('set'), yt)).toEqual({ ok: true });
        expect(store['prefs.v1']).toBeUndefined();
    });

    test('the pair is saved with the site as its source label', async () => {
        const languages = jest.requireActual('../src/languages') as typeof import('../src/languages');
        const spy = jest.spyOn(languages, 'saveLanguagePrefs');
        await handleSettingsMessage(msg('set', { languages: { learning: 'en', native: 'ru' } }), yt);
        expect(spy).toHaveBeenCalledWith({ learning: 'en', native: 'ru' }, 'site');
        spy.mockRestore();
    });
});

describe('the listener', () => {
    beforeAll(() => installSettingsBridge(yt));

    test('leaves other message types to their own listeners', () => {
        const respond = jest.fn();
        for (const type of ['lingogram-welcome', 'lingogram-extension-auth']) {
            expect(externalListener!({ type }, { origin: 'https://lingogram.ai' }, respond)).toBe(false);
        }
        expect(respond).not.toHaveBeenCalled();
    });

    test('refuses a page that is not the site, and writes nothing', () => {
        const respond = jest.fn();
        externalListener!(msg('set', { prefs: { pageHighlight: false } }), { origin: 'https://evil.example' }, respond);
        expect(respond).toHaveBeenCalledWith({ ok: false, error: 'unauthorized origin' });
        expect(store['prefs.v1']).toBeUndefined();
    });

    test('answers the site asynchronously, and an unknown op is an error', async () => {
        const state: any = await new Promise((resolve) => {
            expect(externalListener!(msg('state'), { origin: 'https://lingogram.ai' }, resolve)).toBe(true);
        });
        expect(state.ok).toBe(true);
        const unknown = await new Promise((resolve) => externalListener!(msg('nope'), { origin: 'https://lingogram.ai' }, resolve));
        expect(unknown).toEqual({ ok: false, error: 'unknown op' });
    });

    test('a worker error becomes an error reply, not silence', async () => {
        handleAuthMessage.mockRejectedValue(new Error('boom'));
        const r = await new Promise((resolve) => externalListener!(msg('state'), { origin: 'https://lingogram.ai' }, resolve));
        expect(r).toEqual({ ok: false, error: 'boom' });
    });
});

// The site's page is the one settings interface now, so it carries what the
// extension's own page used to: the sites the highlight is off on, and the
// connect button for a signed-out extension.
describe('sites without highlight', () => {
    test('state lists them', async () => {
        store['prefs.v1'] = { highlightOffHosts: ['news.ycombinator.com', 'bbc.co.uk'] };
        const s: any = await handleSettingsMessage(msg('state'), yt);
        expect(s.highlightOffHosts).toEqual(['news.ycombinator.com', 'bbc.co.uk']);
    });

    test('switching one back on removes only that one', async () => {
        store['prefs.v1'] = { highlightOffHosts: ['news.ycombinator.com', 'bbc.co.uk'] };
        const r = await handleSettingsMessage(msg('set', { prefs: { highlightHost: { host: 'www.BBC.co.uk', on: true } } }), yt);
        expect(r).toEqual({ ok: true });
        expect((store['prefs.v1'] as any).highlightOffHosts).toEqual(['news.ycombinator.com']);
    });

    test('a change made since the page read the list is kept', async () => {
        store['prefs.v1'] = { highlightOffHosts: ['a.com'] };
        await handleSettingsMessage(msg('state'), yt);
        // The popup switches b.com off meanwhile.
        store['prefs.v1'] = { highlightOffHosts: ['a.com', 'b.com'] };
        await handleSettingsMessage(msg('set', { prefs: { highlightHost: { host: 'a.com', on: true } } }), yt);
        expect((store['prefs.v1'] as any).highlightOffHosts).toEqual(['b.com']);
    });

    test.each([
        [{ host: 'a.com' }, 'highlightHost.on must be a boolean'],
        [{ host: 'a b.com', on: true }, 'highlightHost.host must be a hostname'],
        [{ host: 7, on: true }, 'highlightHost.host must be a hostname'],
        [{ host: 'a.com', on: true, x: 1 }, 'unknown key: prefs.highlightHost.x'],
        ['a.com', 'highlightHost must be an object'],
    ])('refuses %p, writing nothing', async (highlightHost, error) => {
        store['prefs.v1'] = { highlightOffHosts: ['a.com'], pageHighlight: true };
        const r = await handleSettingsMessage(msg('set', { prefs: { pageHighlight: false, highlightHost } }), yt);
        expect(r).toEqual({ ok: false, error });
        expect(store['prefs.v1']).toEqual({ highlightOffHosts: ['a.com'], pageHighlight: true });
    });
});

describe('beginSignIn', () => {
    test('issues a one-shot challenge and keeps it for the handoff', async () => {
        const r: any = await handleSettingsMessage(msg('beginSignIn'), yt);
        expect(r.ok).toBe(true);
        expect(r.nonce).toMatch(/^[0-9a-f-]{36}$/);
        expect(Object.values(session)).toContain(r.nonce);
    });

    test('two calls, two different challenges', async () => {
        const a: any = await handleSettingsMessage(msg('beginSignIn'), yt);
        const b: any = await handleSettingsMessage(msg('beginSignIn'), yt);
        expect(a.nonce).not.toBe(b.nonce);
    });
});

describe('highlight settings live with the edition that paints', () => {
    const OWNER = 'hmdkmkimdbomemfcjmgeclchbcdbhabj';
    const sendMessage = (global as any).chrome.runtime.sendMessage as jest.Mock;
    afterEach(() => sendMessage.mockReset());

    test('this edition paints: its own settings', async () => {
        store['prefs.v1'] = { pageHighlight: false, highlightOffHosts: ['a.com'] };
        const s: any = await handleSettingsMessage(msg('state'), yt);
        expect([s.pageHighlight, s.highlightOffHosts]).toEqual([false, ['a.com']]);
        expect(sendMessage).not.toHaveBeenCalled();
    });

    test("the other edition paints: state shows its settings", async () => {
        store['sibling.owner'] = { edition: 'rezka', id: OWNER };
        store['prefs.v1'] = { pageHighlight: false, highlightOffHosts: ['mine.com'] };
        sendMessage.mockResolvedValue({ ok: true, prefs: { pageHighlight: true, highlightOffHosts: ['theirs.com'] } });
        const s: any = await handleSettingsMessage(msg('state'), yt);
        expect([s.pageHighlight, s.highlightOffHosts]).toEqual([true, ['theirs.com']]);
        expect(sendMessage).toHaveBeenCalledWith(OWNER, { type: 'lingogram-sibling', op: 'highlightGet' });
    });

    test('a change is sent there and this copy is left alone', async () => {
        store['sibling.owner'] = { edition: 'rezka', id: OWNER };
        store['prefs.v1'] = { pageHighlight: true, highlightOffHosts: [] };
        sendMessage.mockResolvedValue({ ok: true });
        const r = await handleSettingsMessage(msg('set', { prefs: { pageHighlight: false, highlightHost: { host: 'a.com', on: false } } }), yt);
        expect(r).toEqual({ ok: true });
        expect(sendMessage).toHaveBeenCalledWith(OWNER, {
            type: 'lingogram-sibling',
            op: 'highlightSet',
            change: { pageHighlight: false, highlightHost: { host: 'a.com', on: false } },
        });
        expect(store['prefs.v1']).toEqual({ pageHighlight: true, highlightOffHosts: [] });
    });

    test('the painting edition not answering is a refusal, not a silent local write', async () => {
        store['sibling.owner'] = { edition: 'rezka', id: OWNER };
        store['prefs.v1'] = { pageHighlight: true };
        sendMessage.mockRejectedValue(new Error('Receiving end does not exist.'));
        const r: any = await handleSettingsMessage(msg('set', { prefs: { pageHighlight: false } }), yt);
        expect(r.ok).toBe(false);
        expect(store['prefs.v1']).toEqual({ pageHighlight: true });
    });

    test('reading falls back to this copy when the other edition is gone', async () => {
        store['sibling.owner'] = { edition: 'rezka', id: OWNER };
        store['prefs.v1'] = { pageHighlight: false, highlightOffHosts: ['mine.com'] };
        sendMessage.mockRejectedValue(new Error('gone'));
        const s: any = await handleSettingsMessage(msg('state'), yt);
        expect([s.pageHighlight, s.highlightOffHosts]).toEqual([false, ['mine.com']]);
    });
});
