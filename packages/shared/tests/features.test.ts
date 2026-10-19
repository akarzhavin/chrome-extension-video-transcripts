/**
 * Which gated features this account has (english repo spec
 * 032-feature-rollout-admin): asked from the server, kept for every view,
 * and a feature unknown here counts as off — except AI subtitle translation,
 * which is on for everyone and must survive a failed read.
 */

import {
    FEATURE_SECOND_TRACK,
    FEATURE_AI_TRANSLATE,
    forgetFeatures,
    hasFeature,
    featureRefused,
    ensureFresh,
    followFeatures,
    refreshFeatures,
    watchGate,
    gateOpen,
    FEATURE_AI,
} from '../src/features';
import { browserAiDeps } from '../src/subtitle-ai/browser';

const store: Record<string, unknown> = {};
let listeners: unknown[] = [];
beforeEach(() => {
    listeners = [];
    for (const k of Object.keys(store)) delete store[k];
    (globalThis as unknown as { chrome: unknown }).chrome = {
        storage: {
            local: {
                get: async (k: string) => (k in store ? { [k]: store[k] } : {}),
                set: async (o: Record<string, unknown>) => Object.assign(store, o),
                remove: async (k: string | string[]) => {
                    for (const key of Array.isArray(k) ? k : [k]) delete store[key];
                },
            },
            onChanged: { addListener: (l: unknown) => listeners.push(l), removeListener: () => undefined },
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
        expect(await hasFeature(FEATURE_AI_TRANSLATE)).toBe(true);
        expect(await hasFeature(FEATURE_SECOND_TRACK)).toBe(false);
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
        expect(await hasFeature(FEATURE_SECOND_TRACK)).toBe(true);
        expect(await hasFeature(FEATURE_AI_TRANSLATE)).toBe(false);
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
        expect(await hasFeature(FEATURE_SECOND_TRACK)).toBe(true);
    });

    test('a refusal switches the feature off until the next answer; sign-out forgets', async () => {
        await refreshFeatures('https://api.test', {
            fetch: async () => reply(200, { features: { [FEATURE_SECOND_TRACK]: true } }),
            token: async () => ({ idToken: 't' }),
            now: () => NOW,
        });
        expect(await featureRefused(404, { code: 'feature_off', feature: FEATURE_SECOND_TRACK })).toBe(FEATURE_SECOND_TRACK);
        expect(await hasFeature(FEATURE_SECOND_TRACK)).toBe(false);
        await forgetFeatures();
        expect(await hasFeature(FEATURE_AI_TRANSLATE)).toBe(true);
        expect(await partAsks(NOW)).toBe(true);
    });
});

describe('featureRefused', () => {
    test('only a 404 feature_off is a refusal; its key comes back, "" when unnamed', async () => {
        expect(await featureRefused(404, { code: 'track_unknown' })).toBeNull();
        expect(await featureRefused(403, { code: 'feature_off', feature: FEATURE_AI })).toBeNull();
        expect(await featureRefused(404, { code: 'feature_off' })).toBe('');
        expect(await featureRefused(404, { code: 'feature_off', feature: 'lookup.phrase_cloud' })).toBe('lookup.phrase_cloud');
        expect(store.features).toBeUndefined(); // nothing the extension reads was refused
        expect(await hasFeature(FEATURE_AI)).toBe(true);
    });

    test('a refusal with storage gone still answers, and throws nothing', async () => {
        (globalThis as unknown as { chrome: unknown }).chrome = {};
        expect(await featureRefused(404, { code: 'feature_off', feature: FEATURE_AI })).toBe(FEATURE_AI);
    });
});

describe('gates', () => {
    const all = async () => [await gateOpen('badge'), await gateOpen('translation'), await gateOpen('hint')];
    test('AI closes every gate; each opens only with every key it needs', async () => {
        await answer({ [FEATURE_AI]: false, [FEATURE_AI_TRANSLATE]: true, [FEATURE_SECOND_TRACK]: true });
        expect(await all()).toEqual([false, false, false]);
        await answer({ [FEATURE_AI]: true, [FEATURE_AI_TRANSLATE]: false, [FEATURE_SECOND_TRACK]: true });
        expect(await all()).toEqual([true, false, false]);
        await answer({ [FEATURE_AI]: true, [FEATURE_AI_TRANSLATE]: true });
        expect(await all()).toEqual([true, true, false]);
        await answer({ [FEATURE_AI]: true, [FEATURE_AI_TRANSLATE]: true, [FEATURE_SECOND_TRACK]: true });
        expect(await all()).toEqual([true, true, true]);
    });

    test('before any answer: the badge and translation open, the hint closed', async () => {
        expect(await all()).toEqual([true, true, false]);
    });
});

describe('the AI feature', () => {
    const flush = () => new Promise((r) => setTimeout(r, 0));
    test('counts as on without an answer, and a watcher hears it go off and on', async () => {
        expect(await hasFeature(FEATURE_AI)).toBe(true);
        const seen: boolean[] = [];
        watchGate('badge', (on) => seen.push(on));
        await flush();
        store.features = { features: { [FEATURE_AI]: false }, at: NOW };
        for (const l of listeners) (l as (c: unknown, a: string) => void)({ features: {} }, 'local');
        await flush();
        store.features = { features: { [FEATURE_AI]: true }, at: NOW };
        for (const l of listeners) (l as (c: unknown, a: string) => void)({ features: {} }, 'local');
        await flush();
        expect(seen).toEqual([true, false, true]);
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
    const tell = () => {
        for (const l of listeners) (l as (c: unknown, a: string) => void)({ features: {} }, 'local');
    };
    test('stops when its own switch goes off, not only the AI one', async () => {
        const seen: boolean[] = [];
        browserAiDeps().onTranslationAllowed?.((on) => seen.push(on));
        await flush();
        store.features = { features: { [FEATURE_AI]: true, [FEATURE_AI_TRANSLATE]: false }, at: NOW };
        tell();
        await flush();
        store.features = { features: { [FEATURE_AI]: true, [FEATURE_AI_TRANSLATE]: true }, at: NOW };
        tell();
        await flush();
        store.features = { features: { [FEATURE_AI]: false, [FEATURE_AI_TRANSLATE]: true }, at: NOW };
        tell();
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
