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
    runtime: {
        id: 'test-extension-id',
        lastError: undefined,
        getManifest: () => ({ version: '1.0.0' }),
        onInstalled: { addListener: jest.fn() },
        OnInstalledReason: { INSTALL: 'install', UPDATE: 'update' },
    },
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
import { clearAuthState, setAuthState } from '../src/auth/storage';
import { installInstallation } from '../src/installation';

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

async function until(ok: () => boolean): Promise<void> {
    for (let i = 0; i < 50 && !ok(); i++) await new Promise((r) => setTimeout(r, 0));
    expect(ok()).toBe(true);
}

const signIn = () =>
    setAuthState({ idToken: 'id', refreshToken: 'r', expiresAt: Date.now() + 3_600_000, email: 'a@b.c', uid: 'u1' });

beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    (global as any).fetch = jest.fn();
    freshIdToken.mockReset();
    freshIdToken.mockImplementation(async (_cfg: unknown, refresh: boolean) => ({ idToken: refresh ? 'fresh' : 'tok', uid: 'u1' }));
    clearLookupCache();
});


// Recorded on this backend today (spec 039): no daily record goes out besides what a test asks.
const utcToday = new Date();
const recordedToday = {
    'installation.recorded': 'https://api.test',
    'installation.recordedDay': utcToday.getUTCFullYear() * 10000 + (utcToday.getUTCMonth() + 1) * 100 + utcToday.getUTCDate(),
};

describe('AI_BALANCE_REFRESH', () => {
    test('signed out: GETs the default limits, with no token, and stores them', async () => {
        fetchMock().mockResolvedValue(json({ day: { limit: 123_000 }, month: { limit: 4_000_000 } }));
        const res = (await handleAuthMessage({ action: 'AI_BALANCE_REFRESH' })) as { ok: boolean; defaultAILimits: any };
        expect(res.ok).toBe(true);
        expect(res.defaultAILimits).toMatchObject({ day: 123_000, month: 4_000_000 });
        const [url, init] = fetchMock().mock.calls[0];
        expect(url).toBe('https://api.test/dictionary/ai/limits');
        expect((init as RequestInit).headers).toBeUndefined();
        expect(freshIdToken).not.toHaveBeenCalled();
        expect(store['ai.defaultLimits']).toMatchObject({ day: 123_000, month: 4_000_000 });
        expect(store[BALANCE_KEY]).toBeUndefined();
    });

    test('signed out, every view open reads the default limits again: an admin change shows at once, not hours later', async () => {
        fetchMock().mockResolvedValue(json({ day: { limit: 300_000 }, month: { limit: 2_100_000 } }));
        store['ai.defaultLimits'] = { day: 500_000, month: 10_000_000, at: Date.now() - 60_000 };
        const res = (await handleAuthMessage({ action: 'AI_BALANCE_REFRESH' })) as { ok: boolean; defaultAILimits: any };
        expect(res).toMatchObject({ ok: true, defaultAILimits: { day: 300_000, month: 2_100_000 } });
        expect(fetchMock()).toHaveBeenCalledTimes(1);
        expect(store['ai.defaultLimits']).toMatchObject({ day: 300_000, month: 2_100_000 });
    });

    test('signed out and the limits are unreachable: the stored ones stay for the badge', async () => {
        store['ai.defaultLimits'] = { day: 123_000, month: 4_000_000, at: Date.now() - 60_000 };
        fetchMock().mockRejectedValueOnce(new Error('offline'));
        expect(await handleAuthMessage({ action: 'AI_BALANCE_REFRESH' })).toEqual({ ok: false });
        expect(store['ai.defaultLimits']).toMatchObject({ day: 123_000 });
    });

    test('signed out and the limits are unreachable or malformed: ok:false, nothing stored', async () => {
        fetchMock().mockResolvedValueOnce(json({}, 503));
        expect(await handleAuthMessage({ action: 'AI_BALANCE_REFRESH' })).toEqual({ ok: false });
        fetchMock().mockResolvedValueOnce(json({ day: { limit: 0 }, month: { limit: 1 } }));
        expect(await handleAuthMessage({ action: 'AI_BALANCE_REFRESH' })).toEqual({ ok: false });
        fetchMock().mockRejectedValueOnce(new Error('offline'));
        expect(await handleAuthMessage({ action: 'AI_BALANCE_REFRESH' })).toEqual({ ok: false });
        expect(store['ai.defaultLimits']).toBeUndefined();
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
        expect(freshIdToken).toHaveBeenNthCalledWith(2, expect.anything(), true);
        expect(headersOf(1).Authorization).toBe('Bearer fresh');
    });

    test('asks the balance only: the features have their own message (spec 032)', async () => {
        await signIn();
        fetchMock().mockResolvedValue(json(wallet(1)));
        await handleAuthMessage({ action: 'AI_BALANCE_REFRESH' });
        await new Promise((r) => setTimeout(r, 0));
        expect(fetchMock().mock.calls.map((c) => c[0])).toEqual(['https://api.test/dictionary/ai/balance']);
    });
});

describe('FEATURES_REFRESH (spec 032)', () => {
    test('a view opening asks the features again, however fresh the last answer', async () => {
        await signIn();
        store.features = { features: { ai: true }, at: Date.now() };
        fetchMock().mockResolvedValueOnce(json({ features: { ai: false } }));
        expect(await handleAuthMessage({ action: 'FEATURES_REFRESH' })).toEqual({ ok: true });
        const [url, init] = fetchMock().mock.calls[0];
        expect(url).toBe('https://api.test/dictionary/features');
        expect(init).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer tok' } });
        expect((store.features as { features: Record<string, boolean> }).features.ai).toBe(false);
    });

    test('signed out in a build that named no edition: nothing is asked and nothing kept', async () => {
        expect(await handleAuthMessage({ action: 'FEATURES_REFRESH' })).toEqual({ ok: false });
        expect(fetchMock()).not.toHaveBeenCalled();
        expect(store.featuresTried).toBeUndefined();
    });

    describe('signed out (spec 034)', () => {
        const ID = '0b7c2f7e-3d1a-4c55-9a8e-1f2d3c4b5a69';
        // The worker named its edition at start; the record and the guest check answer by URL.
        beforeEach(() => {
            installInstallation('youtube', { ready: async () => undefined, signedIn: async () => null });
            fetchMock().mockImplementation(async (url: string) =>
                url.includes('/guest/features') ? json({ features: { ai: true } }) : json(null, 204),
            );
        });

        test('asks the guest route for this installation, without a token, and keeps the answer as a guest one', async () => {
            store['installation.id'] = ID;
            Object.assign(store, recordedToday);
            expect(await handleAuthMessage({ action: 'FEATURES_REFRESH' })).toEqual({ ok: true });
            expect(fetchMock().mock.calls.map(([url]) => url)).toEqual([`https://api.test/dictionary/guest/features?installation=${ID}`]);
            expect(headersOf(0) ?? {}).not.toHaveProperty('Authorization');
            expect(freshIdToken).not.toHaveBeenCalled();
            expect(store.features).toMatchObject({ features: { ai: true }, as: 'guest' });
        });

        test('an installation not yet minted or recorded is, first', async () => {
            expect(await handleAuthMessage({ action: 'FEATURES_REFRESH' })).toEqual({ ok: true });
            const id = store['installation.id'];
            expect(fetchMock().mock.calls.map(([url]) => url)).toEqual([
                'https://api.test/dictionary/installations',
                `https://api.test/dictionary/guest/features?installation=${id}`,
            ]);
            expect(store['installation.recorded']).toBe('https://api.test');
        });

        test('signed in it still asks /dictionary/features, and a guest answer is dropped at sign-in', async () => {
            store.features = { features: { ai: false }, at: Date.now(), as: 'guest' };
            await signIn();
            expect(store.features).toBeUndefined();
            fetchMock().mockImplementation(async () => json({ features: { ai: true } }));
            expect(await handleAuthMessage({ action: 'FEATURES_REFRESH' })).toEqual({ ok: true });
            expect(fetchMock().mock.calls.map(([url]) => url)).toEqual(['https://api.test/dictionary/features']);
            expect(store.features).not.toHaveProperty('as');
        });

        test('signed in, a link that failed at sign-in is retried first, so a join from guests is in the answer', async () => {
            Object.assign(store, { 'installation.id': ID, ...recordedToday, 'installation.linkPending': 'https://api.test' });
            await signIn();
            fetchMock().mockImplementation(async (url: string) =>
                url.endsWith('/installations/link') ? json({ joined: true }) : json({ features: { ai: true } }),
            );
            expect(await handleAuthMessage({ action: 'FEATURES_REFRESH' })).toEqual({ ok: true });
            expect(fetchMock().mock.calls.map(([url]) => url)).toEqual([
                'https://api.test/dictionary/installations/link',
                'https://api.test/dictionary/features',
            ]);
            expect(headersOf(0).Authorization).toBe('Bearer tok');
            expect(store).not.toHaveProperty(['installation.linkPending']);
            await handleAuthMessage({ action: 'FEATURES_REFRESH' });
            expect(fetchMock().mock.calls.map(([url]) => url)).toHaveLength(3); // linked: only the features again
        });

        test('a guest check in flight at sign-in keeps nothing for the account', async () => {
            store['installation.id'] = ID;
            Object.assign(store, recordedToday);
            let release: (r: Response) => void = () => undefined;
            fetchMock().mockImplementation(() => new Promise<Response>((r) => (release = r)));
            const ask = handleAuthMessage({ action: 'FEATURES_REFRESH' });
            await until(() => fetchMock().mock.calls.length === 1);
            await signIn();
            release(json({ features: { ai: true } }));
            expect(await ask).toEqual({ ok: false });
            expect(store.features).toBeUndefined();
        });
    });

    test('a failed read: ok:false, the last answer stands', async () => {
        await signIn();
        store.features = { features: { ai: false }, at: 1 };
        fetchMock().mockResolvedValueOnce(json({}, 503));
        expect(await handleAuthMessage({ action: 'FEATURES_REFRESH' })).toEqual({ ok: false });
        expect((store.features as { features: Record<string, boolean> }).features.ai).toBe(false);
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

    test('a part asks the features first only when the answer is ten minutes old (spec 032)', async () => {
        await signIn();
        const urls = () => fetchMock().mock.calls.map((c) => String(c[0]).replace('https://api.test', ''));
        store.features = { features: { ai: true }, at: Date.now() - 9 * 60_000 };
        fetchMock().mockResolvedValueOnce(json({ from: 0, to: 1, lines: ['x'] }));
        await part();
        expect(urls()).toEqual([`/dictionary/subtitles/${FP}/part`]);
        store.features = { features: { ai: true }, at: Date.now() - 11 * 60_000 };
        fetchMock().mockResolvedValueOnce(json({ features: { ai: true } })).mockResolvedValueOnce(json({ from: 0, to: 1, lines: ['x'] }));
        await part();
        expect(urls().slice(1)).toEqual(['/dictionary/features', `/dictionary/subtitles/${FP}/part`]);
    });

    test('a refused part keeps the feature off (spec 032)', async () => {
        await signIn();
        store.features = { features: { ai: true }, at: Date.now() };
        fetchMock().mockResolvedValueOnce(json({ code: 'feature_off', feature: 'subtitles.ai_translate' }, 404));
        expect(await part()).toEqual({ ok: false, code: 'feature_off' });
        expect((store.features as { features: Record<string, boolean> }).features).toEqual({ ai: true, 'subtitles.ai_translate': false });
    });

    test("a refusal for a part in flight at sign-out does not land on the next account's answer (spec 032)", async () => {
        await signIn();
        store.features = { features: { ai: true }, at: Date.now() };
        let release: (r: Response) => void = () => undefined;
        fetchMock().mockReturnValueOnce(new Promise<Response>((r) => (release = r)));
        const reply = part();
        await until(() => fetchMock().mock.calls.length === 1);
        await clearAuthState();
        await signIn();
        fetchMock().mockResolvedValueOnce(json({ features: { ai: true } }));
        await handleAuthMessage({ action: 'FEATURES_REFRESH' });
        release(json({ code: 'feature_off', feature: 'ai' }, 404));
        expect(await reply).toEqual({ ok: false, code: 'feature_off' });
        expect((store.features as { features: Record<string, boolean> }).features).toEqual({ ai: true });
    });

    test('a refusal recorded while a newer answer lands does not write the older one back (spec 032)', async () => {
        await signIn();
        const older = Date.now() - 60_000;
        store.features = { features: { ai: true, 'subtitles.second_track': true }, at: older };
        // The refusal's read of the answer is held, as a slow storage read would be.
        let hold = false;
        let releaseRead = () => undefined as void;
        const local = (global as any).chrome.storage.local;
        const get = local.get.getMockImplementation();
        local.get.mockImplementation(async (keys: string | string[]) => {
            const seen = await get(keys);
            if (!hold || !(Array.isArray(keys) ? keys : [keys]).includes('features')) return seen;
            hold = false;
            return new Promise((r) => (releaseRead = () => r(seen)));
        });
        try {
            fetchMock().mockImplementationOnce(async () => {
                hold = true;
                return json({ code: 'feature_off', feature: 'subtitles.ai_translate' }, 404);
            });
            const reply = part();
            await until(() => !hold && fetchMock().mock.calls.length === 1);
            fetchMock().mockResolvedValueOnce(json({ features: { ai: false } }));
            const refresh = handleAuthMessage({ action: 'FEATURES_REFRESH' });
            for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
            releaseRead();
            await Promise.all([reply, refresh]);
            const kept = store.features as { features: Record<string, boolean>; at: number };
            expect(kept.features.ai).toBe(false); // the newer answer stands
            expect(kept.at).toBeGreaterThan(older);
        } finally {
            local.get.mockImplementation(get);
        }
    });

    test('a part without a wallet stores nothing', async () => {
        fetchMock().mockResolvedValue(json({ from: 0, to: 1, lines: ['x'] }));
        expect((await part()).ok).toBe(true);
        expect(store[BALANCE_KEY]).toBeUndefined();
    });
});
