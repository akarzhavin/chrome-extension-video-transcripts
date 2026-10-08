/**
 * @jest-environment jsdom
 *
 * The worker side of lingogram.ai/welcome/ (welcome/bridge.ts). The page is
 * on the site; every value it sends is checked here before it touches prefs.
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
        session: {
            get: jest.fn(async () => ({ ...session })),
            set: jest.fn(async (items: Record<string, unknown>) => Object.assign(session, items)),
        },
        onChanged: { addListener: jest.fn() },
    },
    runtime: {
        id: 'pkoibjilnaeadmcnmfkgcjhalljbmfan',
        getManifest: () => ({ version: '1.0.0' }),
        sendMessage: jest.fn(),
        onMessageExternal: { addListener: (l: any) => (externalListener = l) },
    },
    i18n: { getMessage: () => '' },
};

const handleAuthMessage = jest.fn();
jest.mock('../src/auth/background', () => ({
    handleAuthMessage: (...a: unknown[]) => handleAuthMessage(...a),
    isAllowedExternalSender: (s: { origin?: string }) => s.origin === 'https://lingogram.ai',
}));
jest.mock('../src/analytics', () => ({ ...jest.requireActual('../src/analytics'), trackVia: jest.fn() }));

import { handleWelcomeMessage, installWelcomeBridge } from '../src/welcome/bridge';
import { loadPrefs } from '../src/prefs';
import { welcomeUrl } from '../src/welcome/welcome';

const msg = (op: string, extra: Record<string, unknown> = {}) => ({ type: 'lingogram-welcome' as const, op: op as any, ...extra });
const yt = { edition: 'youtube' as const };
const rezka = { edition: 'rezka' as const, languages: ['en', 'ru', 'uk'] };

beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    handleAuthMessage.mockReset();
    handleAuthMessage.mockImplementation(async (m: { action: string }) =>
        m.action === 'AUTH_STATUS' ? { signedIn: true, email: 'a@b.c' } : { ok: true },
    );
    (global as any).chrome.runtime.sendMessage.mockClear();
});

describe('state', () => {
    test('says what is saved and who is signed in, and nothing about sites or the other edition', async () => {
        store['prefs.v1'] = { pageHighlight: false };
        store['lang.v1'] = { learning: 'en', native: 'ru' };
        const s: any = await handleWelcomeMessage(msg('state'), yt);
        expect(s).toMatchObject({ ok: true, edition: 'youtube', signedIn: true, email: 'a@b.c', learning: 'en', native: 'ru', pageHighlight: false });
        expect(s.languages.length).toBeGreaterThan(10);
        // The page does not use these; they must not be asked or answered.
        expect(s).not.toHaveProperty('sites');
        expect(s).not.toHaveProperty('siblingInstalled');
        expect((global as any).chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    test('HDrezka edition offers its own language list', async () => {
        const s: any = await handleWelcomeMessage(msg('state'), rezka);
        expect(s.edition).toBe('rezka');
        expect(s.languages.map((l: any) => l.code)).toEqual(['en', 'ru', 'uk']);
    });
});

describe('writes are validated', () => {
    test('languages must be ones this edition offers', async () => {
        expect(await handleWelcomeMessage(msg('setLanguages', { learning: 'en', native: 'xx' }), yt)).toEqual({
            ok: false,
            error: 'unknown language',
        });
        expect(await handleWelcomeMessage(msg('setLanguages', { learning: 'es', native: 'ru' }), rezka)).toMatchObject({ ok: false });
        expect(await handleWelcomeMessage(msg('setLanguages', { learning: 'en', native: 'ru' }), rezka)).toEqual({ ok: true });
        expect(store['lang.v1']).toEqual({ learning: 'en', native: 'ru' });
    });

    test('prefs: word highlighting only, and only as a boolean', async () => {
        // There is no video-site switch; a page sending the old ones is refused.
        expect(await handleWelcomeMessage(msg('setPrefs', { prefs: { siteNetflix: false } }), yt)).toMatchObject({ ok: false });
        expect(await handleWelcomeMessage(msg('setPrefs', { prefs: { siteRezka: false } }), yt)).toMatchObject({ ok: false });
        expect(await handleWelcomeMessage(msg('setPrefs', { prefs: { pageHighlight: 'no' } }), yt)).toMatchObject({ ok: false });
        expect(await handleWelcomeMessage(msg('setPrefs', { prefs: { analyticsEnabled: false } }), yt)).toMatchObject({ ok: false });
        expect((await loadPrefs()).analyticsEnabled).toBe(true);
        expect(JSON.stringify(await chrome.storage.local.get('prefs.v1'))).not.toContain('siteNetflix');
        expect(await handleWelcomeMessage(msg('setPrefs', { prefs: { pageHighlight: false } }), yt)).toEqual({ ok: true });
        expect((await loadPrefs()).pageHighlight).toBe(false);
    });

    test('beginSignIn issues a fresh one-shot challenge and stores it for the handoff check', async () => {
        const a: any = await handleWelcomeMessage(msg('beginSignIn'), yt);
        const b: any = await handleWelcomeMessage(msg('beginSignIn'), yt);
        expect(a.ok).toBe(true);
        expect(a.nonce).toMatch(/^[0-9a-f-]{36}$/);
        expect(b.nonce).not.toBe(a.nonce);
        // The handoff validates against the LAST one issued.
        expect(session['auth.pendingNonce']).toBe(b.nonce);
    });

    test('progress only ever sets the two flags', async () => {
        await handleWelcomeMessage(msg('progress', { skippedAccount: true }), yt);
        await handleWelcomeMessage(msg('progress', { finished: 'yes' }), yt);
        expect(store['welcome.v1']).toEqual({ skippedAccount: true, finished: false });
        await handleWelcomeMessage(msg('progress', { finished: true }), yt);
        expect(store['welcome.v1']).toEqual({ skippedAccount: true, finished: true });
    });
});

describe('the listener', () => {
    beforeAll(() => installWelcomeBridge(yt));

    test('leaves other message types to their own listeners', () => {
        const respond = jest.fn();
        expect(externalListener!({ type: 'lingogram-extension-auth' }, { origin: 'https://lingogram.ai' }, respond)).toBe(false);
        expect(respond).not.toHaveBeenCalled();
    });

    test('refuses a page that is not lingogram.ai', () => {
        const respond = jest.fn();
        externalListener!(msg('setPrefs', { prefs: { siteNetflix: false } }), { origin: 'https://evil.example' }, respond);
        expect(respond).toHaveBeenCalledWith({ ok: false, error: 'unauthorized origin' });
    });

    test('answers lingogram.ai asynchronously', async () => {
        const answer = await new Promise((resolve) => {
            expect(externalListener!(msg('progress', { finished: true }), { origin: 'https://lingogram.ai' }, resolve)).toBe(true);
        });
        expect(answer).toEqual({ ok: true });
    });
});

test('the welcome address names the edition and this extension, and the install when known', () => {
    expect(welcomeUrl('youtube', 'abc')).toMatch(/\/welcome\/\?ext=youtube&id=abc$/);
    expect(welcomeUrl('rezka', 'abc', 'cid-1')).toMatch(/\/welcome\/\?ext=rezka&id=abc&cid=cid-1$/);
});
