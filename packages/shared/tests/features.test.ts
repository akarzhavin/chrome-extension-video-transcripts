/**
 * Which gated features this account has (english repo spec
 * 032-feature-rollout-admin): asked from the server, kept for every view,
 * and a feature unknown here counts as off — except AI subtitle translation,
 * which is on for everyone and must survive a failed read.
 */

import { FEATURE_AI, FEATURE_AI_TRANSLATE, FEATURE_SECOND_TRACK, isOn, type FeatureKey } from '../src/features/rules';
import { forgetFeatures, gateOpen, loadFeatures, watchGate } from '../src/features/store';
import { featureClient, refusalKeeper, type FeatureClient } from '../src/features/worker';
import { followFeatures } from '../src/features/follow';
import { browserAiDeps } from '../src/subtitle-ai/browser';

const store: Record<string, unknown> = {};
const has = async (key: FeatureKey) => isOn(await loadFeatures(), key);
// Each test its own client, so no request in flight outlives a test.
let refreshFeatures: FeatureClient['refreshFeatures'];
let ensureFresh: FeatureClient['ensureFresh'];
type Listener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;
let listeners: Listener[] = [];
// Like chrome.storage: every write tells the listeners which keys changed, and to what.
const changed = (keys: string[]) =>
    listeners.forEach((l) => l(Object.fromEntries(keys.map((k) => [k, { newValue: store[k] }])), 'local'));
beforeEach(() => {
    ({ refreshFeatures, ensureFresh } = featureClient());
    listeners = [];
    for (const k of Object.keys(store)) delete store[k];
    // The 032 cases are an account's; signed out only a guest answer opens a gate (spec 034).
    Object.assign(store, { 'auth.idToken': 'tok', 'auth.uid': 'u1' });
    (globalThis as unknown as { chrome: unknown }).chrome = {
        storage: {
            local: {
                get: async (k: string | string[]) =>
                    Object.fromEntries((Array.isArray(k) ? k : [k]).filter((key) => key in store).map((key) => [key, store[key]])),
                set: async (o: Record<string, unknown>) => {
                    Object.assign(store, o);
                    changed(Object.keys(o));
                },
                remove: async (k: string | string[]) => {
                    const keys = Array.isArray(k) ? k : [k];
                    for (const key of keys) delete store[key];
                    changed(keys);
                },
            },
            onChanged: { addListener: (l: Listener) => listeners.push(l), removeListener: () => undefined },
        },
    };
});

function reply(status: number, body: unknown): Response {
    return { status, ok: status >= 200 && status < 300, json: async () => body } as unknown as Response;
}

const NOW = Date.UTC(2026, 9, 18, 12, 0, 0);

/** The server answers body: kept as a refresh would keep it. */
const answerBody = (body: unknown) =>
    refreshFeatures('https://api.test', {
        fetch: async () => reply(200, body),
        token: async () => ({ idToken: 't' }),
        now: () => NOW,
    });
const answer = (features: Record<string, boolean>) => answerBody({ features });

/** Whether a translation part at t asks the server first; the ask itself fails (503). */
const partAsks = async (t: number) => {
    let asked = false;
    await ensureFresh('https://api.test', {
        fetch: async () => {
            asked = true;
            return reply(503, {});
        },
        token: async () => ({ idToken: 't' }),
        now: () => t,
    });
    return asked;
};

describe('features', () => {
    test('keeps only booleans by key, and nothing from a malformed answer', async () => {
        expect(await answerBody({ features: { a: true, b: false, c: 'yes' } })).toEqual({ a: true, b: false });
        expect(await answerBody({ nope: 1 })).toBeNull();
        expect(await answerBody(null)).toBeNull();
        expect((store.features as { features: unknown }).features).toEqual({ a: true, b: false });
    });

    test('before any answer: subtitles on, everything else off', async () => {
        expect(await has(FEATURE_AI_TRANSLATE)).toBe(true);
        expect(await has(FEATURE_SECOND_TRACK)).toBe(false);
    });

    test('asks with the bearer token, retries a 401 with a fresh one, and keeps the answer', async () => {
        const calls: string[] = [];
        const got = await refreshFeatures('https://api.test/', {
            fetch: async (url, init) => {
                calls.push(`${url} ${(init.headers as Record<string, string>).Authorization}`);
                return calls.length === 1 ? reply(401, {}) : reply(200, { features: { [FEATURE_SECOND_TRACK]: true, [FEATURE_AI_TRANSLATE]: false } });
            },
            token: async (refresh) => ({ idToken: refresh ? 'tok2' : 'tok1' }),
            now: () => NOW,
        });
        expect(calls).toEqual(['https://api.test/dictionary/features Bearer tok1', 'https://api.test/dictionary/features Bearer tok2']);
        expect(got).toEqual({ [FEATURE_SECOND_TRACK]: true, [FEATURE_AI_TRANSLATE]: false });
        expect(await has(FEATURE_SECOND_TRACK)).toBe(true);
        expect(await has(FEATURE_AI_TRANSLATE)).toBe(false);
        expect(await partAsks(NOW + 60_000)).toBe(false);
        expect(await partAsks(NOW + 11 * 60_000)).toBe(true);
    });

    test('an unreachable server keeps what was known', async () => {
        await refreshFeatures('https://api.test', {
            fetch: async () => reply(200, { features: { [FEATURE_SECOND_TRACK]: true } }),
            token: async () => ({ idToken: 't' }),
            now: () => NOW,
        });
        const got = await refreshFeatures('https://api.test', {
            fetch: async () => {
                throw new Error('offline');
            },
            token: async () => ({ idToken: 't' }),
            now: () => NOW,
        });
        expect(got).toBeNull();
        expect(await has(FEATURE_SECOND_TRACK)).toBe(true);
    });

    test('a refusal switches the feature off until the next answer; sign-out forgets', async () => {
        await refreshFeatures('https://api.test', {
            fetch: async () => reply(200, { features: { [FEATURE_SECOND_TRACK]: true } }),
            token: async () => ({ idToken: 't' }),
            now: () => NOW,
        });
        await refusalKeeper()(FEATURE_SECOND_TRACK);
        expect(await has(FEATURE_SECOND_TRACK)).toBe(false);
        await forgetFeatures();
        expect(await has(FEATURE_AI_TRANSLATE)).toBe(true);
        expect(await partAsks(NOW)).toBe(true);
    });
});

describe('a kept refusal', () => {
    test('only a key the extension reads is kept', async () => {
        await refusalKeeper()('');
        await refusalKeeper()('lookup.phrase_cloud');
        expect(store.features).toBeUndefined();
        expect(await has(FEATURE_AI)).toBe(true);
    });

    test("a refusal for a request begun before a sign-out is not kept for the next account", async () => {
        const keep = refusalKeeper();
        await forgetFeatures();
        await answer({ [FEATURE_AI]: true });
        await keep(FEATURE_AI);
        expect(await has(FEATURE_AI)).toBe(true);
        await refusalKeeper()(FEATURE_AI); // one begun after it is
        expect(await has(FEATURE_AI)).toBe(false);
    });

    test('a refusal whose read is slow does not write the older answer over a newer one', async () => {
        await answer({ [FEATURE_AI]: true, [FEATURE_SECOND_TRACK]: true });
        const local = (chrome as unknown as { storage: { local: { get: (k: string) => Promise<unknown> } } }).storage.local;
        const get = local.get;
        let release = () => undefined as void;
        local.get = (k) => {
            const was = get(k);
            local.get = get;
            return new Promise((r) => (release = () => r(was)));
        };
        const off = refusalKeeper()(FEATURE_SECOND_TRACK);
        const newer = refreshFeatures('https://api.test', {
            fetch: async () => reply(200, { features: { [FEATURE_AI]: false } }),
            token: async () => ({ idToken: 't' }),
            now: () => NOW + 1_000,
        });
        await new Promise((r) => setTimeout(r, 0));
        release();
        await Promise.all([off, newer]);
        expect(store.features).toEqual({ features: { [FEATURE_AI]: false }, at: NOW + 1_000 });
    });

    test('with storage gone it throws nothing', async () => {
        (globalThis as unknown as { chrome: unknown }).chrome = {};
        await expect(refusalKeeper()(FEATURE_AI)).resolves.toBeUndefined();
    });
});

describe('gates', () => {
    const all = async () => [await gateOpen('badge'), await gateOpen('translation'), await gateOpen('hint')];
    test('before any answer: the badge and translation open, the hint closed', async () => {
        expect(await all()).toEqual([true, true, false]);
    });

    test('signed out every gate is closed until a guest answer opens it, and a watcher hears the sign-out (spec 034)', async () => {
        const flush = () => new Promise((r) => setTimeout(r, 0));
        const seen: boolean[] = [];
        watchGate('badge', (on) => seen.push(on));
        await flush();
        await chrome.storage.local.remove(['auth.idToken', 'auth.uid']);
        await flush();
        expect(await all()).toEqual([false, false, false]);
        await chrome.storage.local.set({ features: { features: { [FEATURE_AI]: true }, at: NOW, as: 'guest' } });
        await flush();
        expect(await gateOpen('badge')).toBe(true);
        expect(seen).toEqual([true, false, true]);
    });

    test('a running translation hears the sign-out and stays off, even when a guest answer says every key', async () => {
        const flush = () => new Promise((r) => setTimeout(r, 0));
        const seen: boolean[] = [];
        watchGate('translation', (on) => seen.push(on));
        await flush();
        await chrome.storage.local.remove(['auth.idToken', 'auth.uid']);
        await flush();
        await chrome.storage.local.set({
            features: { features: { [FEATURE_AI]: true, [FEATURE_AI_TRANSLATE]: true, [FEATURE_SECOND_TRACK]: true }, at: NOW, as: 'guest' },
        });
        await flush();
        expect(seen).toEqual([true, false]);
        expect([await gateOpen('translation'), await gateOpen('hint')]).toEqual([false, false]);
    });
});

describe('the AI feature', () => {
    const flush = () => new Promise((r) => setTimeout(r, 0));
    test('counts as on without an answer, and a watcher hears it go off and on', async () => {
        expect(await has(FEATURE_AI)).toBe(true);
        const seen: boolean[] = [];
        watchGate('badge', (on) => seen.push(on));
        await flush();
        await answer({ [FEATURE_AI]: false });
        await flush();
        await answerBody(null); // a failed read: the last answer stands
        await flush();
        await answer({ [FEATURE_AI]: true });
        await flush();
        expect(seen).toEqual([true, false, true]);
    });

    test("a change heard before the watcher's first read settles is not undone by that read", async () => {
        const local = (chrome as unknown as { storage: { local: { get: (k: string) => Promise<unknown> } } }).storage.local;
        const get = local.get;
        let release = () => undefined as void;
        // The first read sees the store as it was, and answers late.
        local.get = (k) => {
            const was = get(k);
            return new Promise((r) => (release = () => r(was)));
        };
        const seen: boolean[] = [];
        watchGate('badge', (on) => seen.push(on));
        local.get = get;
        await answer({ [FEATURE_AI]: false });
        release();
        await flush();
        expect(seen).toEqual([false]);
    });
});

describe('a failed read', () => {
    test('waits a minute before a translation part asks again', async () => {
        const failing = {
            fetch: async () => reply(503, {}),
            token: async () => ({ idToken: 't' }),
            now: () => NOW,
        };
        expect(await refreshFeatures('https://api.test', failing)).toBeNull();
        expect(await partAsks(NOW + 1_000)).toBe(false);
        expect(await partAsks(NOW + 61_000)).toBe(true);
    });
});

describe('asking', () => {
    test('asks made while one is in flight share it; the next one asks anew', async () => {
        let release: (r: Response) => void = () => undefined;
        let fetches = 0;
        const deps = {
            fetch: () => {
                fetches++;
                return new Promise<Response>((r) => (release = r));
            },
            token: async () => ({ idToken: 't' }),
            now: () => NOW,
        };
        const a = refreshFeatures('https://api.test', deps);
        const b = refreshFeatures('https://api.test', deps);
        const c = ensureFresh('https://api.test', deps);
        await new Promise((r) => setTimeout(r, 0));
        expect(fetches).toBe(1);
        release(reply(200, { features: { [FEATURE_SECOND_TRACK]: true } }));
        expect(await a).toEqual({ [FEATURE_SECOND_TRACK]: true });
        expect(await b).toEqual({ [FEATURE_SECOND_TRACK]: true });
        await c;
        const d = refreshFeatures('https://api.test', deps);
        await new Promise((r) => setTimeout(r, 0));
        expect(fetches).toBe(2);
        release(reply(200, { features: {} }));
        await d;
    });

    test("an ask that was in flight at sign-out keeps nothing, and the next account's ask does not wait on it", async () => {
        const releases: ((r: Response) => void)[] = [];
        const deps = {
            fetch: () => new Promise<Response>((r) => releases.push(r)),
            token: async () => ({ idToken: 't' }),
            now: () => NOW,
        };
        const old = refreshFeatures('https://api.test', deps);
        await new Promise((r) => setTimeout(r, 0));
        await forgetFeatures();
        const next = refreshFeatures('https://api.test', deps);
        await new Promise((r) => setTimeout(r, 0));
        expect(releases).toHaveLength(2);
        releases[0](reply(200, { features: { [FEATURE_SECOND_TRACK]: true } }));
        expect(await old).toBeNull();
        expect(store.features).toBeUndefined();
        expect(await has(FEATURE_SECOND_TRACK)).toBe(false);
        releases[1](reply(200, { features: { [FEATURE_AI]: false } }));
        expect(await next).toEqual({ [FEATURE_AI]: false });
        expect(await has(FEATURE_AI)).toBe(false);
    });

    test('a failed ask in flight at sign-out stamps no failure either', async () => {
        let release: (r: Response) => void = () => undefined;
        const ask = refreshFeatures('https://api.test', {
            fetch: () => new Promise<Response>((r) => (release = r)),
            token: async () => ({ idToken: 't' }),
            now: () => NOW,
        });
        await new Promise((r) => setTimeout(r, 0));
        await forgetFeatures();
        release(reply(503, {}));
        await ask;
        expect(store.featuresTried).toBeUndefined();
    });

    test('a view asks the worker as it opens, and on a return to its tab at most once a minute', async () => {
        jest.useFakeTimers({ now: NOW });
        const sent: unknown[] = [];
        (chrome as unknown as { runtime: unknown }).runtime = { sendMessage: (m: unknown) => sent.push(m), lastError: undefined };
        const show = (state: 'visible' | 'hidden') => {
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
            document.dispatchEvent(new Event('visibilitychange'));
        };
        try {
            const stop = followFeatures(document);
            expect(sent).toEqual([{ action: 'FEATURES_REFRESH' }]);
            jest.setSystemTime(NOW + 59_000);
            show('visible');
            expect(sent).toHaveLength(1);
            jest.setSystemTime(NOW + 61_000);
            show('hidden');
            expect(sent).toHaveLength(1);
            show('visible');
            expect(sent).toHaveLength(2);
            show('visible');
            expect(sent).toHaveLength(2); // the minute counts from the last ask
            stop();
            jest.setSystemTime(NOW + 10 * 60_000);
            show('visible');
            expect(sent).toHaveLength(2);
        } finally {
            jest.useRealTimers();
        }
    });
});

describe('AI subtitle translation', () => {
    const flush = () => new Promise((r) => setTimeout(r, 0));
    test('stops when its own switch goes off, not only the AI one', async () => {
        const seen: boolean[] = [];
        browserAiDeps().onTranslationAllowed?.((on) => seen.push(on));
        await flush();
        await answer({ [FEATURE_AI]: true, [FEATURE_AI_TRANSLATE]: false });
        await flush();
        await answer({ [FEATURE_AI]: true, [FEATURE_AI_TRANSLATE]: true });
        await flush();
        await answer({ [FEATURE_AI]: false, [FEATURE_AI_TRANSLATE]: true });
        await flush();
        expect(seen).toEqual([true, false, true, false]);
    });

    test('the gender hint is allowed only while the hint gate is open', async () => {
        const deps = browserAiDeps();
        expect(await deps.hintAllowed?.()).toBe(false);
        await answer({ [FEATURE_SECOND_TRACK]: true });
        expect(await deps.hintAllowed?.()).toBe(true);
        await answer({ [FEATURE_SECOND_TRACK]: true, [FEATURE_AI_TRANSLATE]: false });
        expect(await deps.hintAllowed?.()).toBe(false);
    });
});
