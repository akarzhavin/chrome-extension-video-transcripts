/**
 * The worker's side of the AI wallet (spec 024): AI_BALANCE_REFRESH, the
 * signed-in token on LOOKUP_WORD and the balance an AI answer carries.
 */

const store: Record<string, unknown> = {};
const area = () => ({
    get: jest.fn(async (keys: string | string[] | null) => {
        if (keys === null) return { ...store };
        const list = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, store[k]]));
    }),
    set: jest.fn(async (o: Record<string, unknown>) => {
        Object.assign(store, o);
    }),
    remove: jest.fn(async (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
    }),
});

(global as any).chrome = {
    runtime: { id: 'test-extension-id', lastError: undefined, getManifest: () => ({ version: '1.0.0' }) },
    storage: { local: area(), session: area() },
    action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn() },
    i18n: { getMessage: () => '' },
    tabs: { create: jest.fn() },
};

const freshIdToken = jest.fn();
jest.mock('../src/auth/firestoreRest', () => ({
    ...jest.requireActual('../src/auth/firestoreRest'),
    freshIdToken: (...a: unknown[]) => freshIdToken(...a),
}));
jest.mock('../src/analytics-bg', () => ({
    track: jest.fn(async () => {}),
    handleTrackMessage: jest.fn(async () => ({ ok: true })),
}));

import { handleAuthMessage } from '../src/auth/background';
import { setAuthState } from '../src/auth/storage';

import { clearLookupCache } from '../src/lookup';

const FP = 'a'.repeat(64);
const wallet = (used: number) => ({
    day: { used, limit: 500_000, resets_at: Date.UTC(2026, 9, 12) },
    month: { used, limit: 10_000_000, resets_at: Date.UTC(2026, 10, 1) },
    exhausted: null,
    warn_ratio: 0.8,
});
const answer = (extra: Record<string, unknown> = {}) => ({
    term: 'anchor',
    lemma: 'anchor',
    translations: ['якорь'],
    parts_of_speech: [],
    source: 'llm',
    ...extra,
});
const json = (body: unknown, status = 200) =>
    ({ ok: status >= 200 && status < 300, status, json: async () => body, headers: new Headers() }) as unknown as Response;
const fetchMock = () => (global as any).fetch as jest.Mock;
const headersOf = (call: number) => (fetchMock().mock.calls[call][1] as RequestInit).headers as Record<string, string>;
const BALANCE_KEY = 'ai.balance';
const storedUsed = () => (store[BALANCE_KEY] as { day: { used: number } } | undefined)?.day.used;

const signIn = () =>
    setAuthState({ idToken: 'id', refreshToken: 'r', expiresAt: Date.now() + 3_600_000, email: 'a@b.c', uid: 'u1' });

beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    (global as any).fetch = jest.fn();
    freshIdToken.mockReset();
    freshIdToken.mockImplementation(async (_cfg: unknown, refresh: boolean) => ({ idToken: refresh ? 'fresh' : 'tok', uid: 'u1' }));
    clearLookupCache();
});

describe('AI_BALANCE_REFRESH', () => {
    test('signed out: GETs the default windows, with no token, and stores them', async () => {
        fetchMock().mockResolvedValue(json({ day: { limit: 123_000 }, month: { limit: 4_000_000 } }));
        const res = (await handleAuthMessage({ action: 'AI_BALANCE_REFRESH' })) as { ok: boolean; defaults: any };
        expect(res.ok).toBe(true);
        expect(res.defaults).toMatchObject({ day: 123_000, month: 4_000_000 });
        const [url, init] = fetchMock().mock.calls[0];
        expect(url).toBe('https://api.test/dictionary/ai/limits');
        expect((init as RequestInit).headers).toBeUndefined();
        expect(freshIdToken).not.toHaveBeenCalled();
        expect(store['ai.limits']).toMatchObject({ day: 123_000, month: 4_000_000 });
        expect(store[BALANCE_KEY]).toBeUndefined();
    });

    test('signed out and the limits are unreachable or malformed: ok:false, nothing stored', async () => {
        fetchMock().mockResolvedValueOnce(json({}, 503));
        expect(await handleAuthMessage({ action: 'AI_BALANCE_REFRESH' })).toEqual({ ok: false });
        fetchMock().mockResolvedValueOnce(json({ day: { limit: 0 }, month: { limit: 1 } }));
        expect(await handleAuthMessage({ action: 'AI_BALANCE_REFRESH' })).toEqual({ ok: false });
        fetchMock().mockRejectedValueOnce(new Error('offline'));
        expect(await handleAuthMessage({ action: 'AI_BALANCE_REFRESH' })).toEqual({ ok: false });
        expect(store['ai.limits']).toBeUndefined();
    });

    test('signed in: GETs the balance with the bearer token and stores it', async () => {
        await signIn();
        fetchMock().mockResolvedValue(json(wallet(42)));
        const res = (await handleAuthMessage({ action: 'AI_BALANCE_REFRESH' })) as { ok: boolean; balance: any };
        expect(res.ok).toBe(true);
        expect(res.balance.day.used).toBe(42);
        const [url, init] = fetchMock().mock.calls[0];
        expect(url).toBe('https://api.test/dictionary/ai/balance');
        expect(init).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer tok' } });
        expect(storedUsed()).toBe(42);
    });

    test('signed in but the server fails: ok:false, nothing stored', async () => {
        await signIn();
        fetchMock().mockResolvedValue(json({}, 500));
        expect(await handleAuthMessage({ action: 'AI_BALANCE_REFRESH' })).toEqual({ ok: false });
        expect(store[BALANCE_KEY]).toBeUndefined();
    });

    test('a 401 is retried with a forced fresh token', async () => {
        await signIn();
        fetchMock().mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json(wallet(7)));
        await handleAuthMessage({ action: 'AI_BALANCE_REFRESH' });
        expect(freshIdToken).toHaveBeenLastCalledWith(expect.anything(), true);
        expect(headersOf(1).Authorization).toBe('Bearer fresh');
    });
});

describe('LOOKUP_WORD with the AI wallet', () => {
    const lookup = () => handleAuthMessage({ action: 'LOOKUP_WORD', term: 'anchor', targetLang: 'ru' }) as Promise<any>;

    test('signed out: no Authorization, no token asked', async () => {
        fetchMock().mockResolvedValue(json(answer()));
        expect((await lookup()).ok).toBe(true);
        expect(headersOf(0)).not.toHaveProperty('Authorization');
        expect(freshIdToken).not.toHaveBeenCalled();
    });

    test('signed in: Authorization carries the fresh token, and the wallet is kept', async () => {
        await signIn();
        fetchMock().mockResolvedValue(json(answer({ wallet: wallet(99) })));
        const res = await lookup();
        expect(res.ok).toBe(true);
        expect(headersOf(0).Authorization).toBe('Bearer tok');
        expect(freshIdToken).toHaveBeenCalledWith(expect.anything(), false);
        expect(storedUsed()).toBe(99);
    });

    test('signed in but the token will not refresh: the lookup goes anonymous', async () => {
        await signIn();
        freshIdToken.mockRejectedValue(new Error('refresh failed'));
        fetchMock().mockResolvedValue(json(answer()));
        expect((await lookup()).ok).toBe(true);
        expect(headersOf(0)).not.toHaveProperty('Authorization');
    });

    test('an answer from the cache does not rewrite the stored balance', async () => {
        await signIn();
        fetchMock().mockResolvedValue(json(answer({ wallet: wallet(10) })));
        await lookup();
        expect(storedUsed()).toBe(10);
        delete store[BALANCE_KEY];
        const second = await lookup();
        expect(fetchMock()).toHaveBeenCalledTimes(1);
        expect(second.result).not.toHaveProperty('wallet');
        expect(store[BALANCE_KEY]).toBeUndefined();
    });

    test('an answer without a wallet stores nothing', async () => {
        await signIn();
        fetchMock().mockResolvedValue(json(answer()));
        await lookup();
        expect(store[BALANCE_KEY]).toBeUndefined();
    });
});

describe('SUBTITLE_AI_PART keeps the wallet (dev build)', () => {
    const part = () =>
        handleAuthMessage({ action: 'SUBTITLE_AI_PART', part: { fingerprint: FP, lang: 'ru', from: 0, to: 1 } }) as Promise<any>;

    test('a translated part carries the balance into storage', async () => {
        await signIn();
        fetchMock().mockResolvedValue(json({ from: 0, to: 1, lines: ['x'], wallet: wallet(5) }));
        const reply = await part();
        expect(reply.ok).toBe(true);
        expect(reply.wallet).toEqual(wallet(5));
        expect(storedUsed()).toBe(5);
    });

    test('a spent wallet (429) still carries the balance', async () => {
        await signIn();
        fetchMock().mockResolvedValue(json({ code: 'quota_exceeded', resets_at: 123, window: 'month', wallet: wallet(10_000_000) }, 429));
        const reply = await part();
        expect(reply).toMatchObject({ ok: false, code: 'quota', resetsAt: 123 });
        expect(storedUsed()).toBe(10_000_000);
    });

    test('a part without a wallet stores nothing', async () => {
        fetchMock().mockResolvedValue(json({ from: 0, to: 1, lines: ['x'] }));
        expect((await part()).ok).toBe(true);
        expect(store[BALANCE_KEY]).toBeUndefined();
    });
});
