/**
 * @jest-environment jsdom
 *
 * The worker side of lingogram.ai/welcome/ (welcome/bridge.ts). The page is
 * on the site; every value it sends is checked here before it touches prefs.
 */

const store: Record<string, unknown> = {};
const session: Record<string, unknown> = {};
let externalListener: ((m: any, s: any, r: any) => boolean | void) | null = null;
let siblingAnswers = false;

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
        sendMessage: jest.fn((id: string) =>
            siblingAnswers ? Promise.resolve({ ok: true, signedIn: false }) : Promise.reject(new Error('absent')),
        ),
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
    siblingAnswers = false;
});

describe('state', () => {
    test("names this edition's own sites only, and what is signed in", async () => {
        store['prefs.v1'] = { siteNetflix: false, siteRezka: false };
        const s: any = await handleWelcomeMessage(msg('state'), yt);
        expect(s.sites).toEqual({ youtube: true, netflix: false });
        expect(s.signedIn).toBe(true);
        expect(s.email).toBe('a@b.c');
        expect(s.siblingInstalled).toBe(false);
    });

    test('HDrezka edition offers its own language list; the other edition is seen when it answers', async () => {
        siblingAnswers = true;
        const s: any = await handleWelcomeMessage(msg('state'), rezka);
        expect(s.languages.map((l: any) => l.code)).toEqual(['en', 'ru', 'uk']);
        expect(s.sites).toEqual({ rezka: true });
        expect(s.siblingInstalled).toBe(true);
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

    test("prefs: only booleans, only this edition's sites and highlighting", async () => {
        expect(await handleWelcomeMessage(msg('setPrefs', { prefs: { siteRezka: false } }), yt)).toMatchObject({ ok: false });
        expect(await handleWelcomeMessage(msg('setPrefs', { prefs: { siteNetflix: 'no' } }), yt)).toMatchObject({ ok: false });
        expect(await handleWelcomeMessage(msg('setPrefs', { prefs: { analyticsEnabled: false } }), yt)).toMatchObject({ ok: false });
        expect((await loadPrefs()).analyticsEnabled).toBe(true);
        expect(await handleWelcomeMessage(msg('setPrefs', { prefs: { siteNetflix: false, pageHighlight: false } }), yt)).toEqual({ ok: true });
        const p = await loadPrefs();
        expect(p.siteNetflix).toBe(false);
        expect(p.pageHighlight).toBe(false);
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
