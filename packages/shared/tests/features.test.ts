/**
 * Which gated features this account has (english repo spec
 * 032-feature-rollout-admin): asked from the server, kept for every view,
 * and a feature unknown here counts as off — except AI subtitle translation,
 * which is on for everyone and must survive a failed read.
 */

import {
    FEATURE_SECOND_TRACK,
    FEATURE_SUBTITLES,
    forgetFeatures,
    hasFeature,
    markFeatureOff,
    parseFeatures,
    refreshFeatures,
    staleFeatures,
    watchFeature,
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
                remove: async (k: string) => {
                    delete store[k];
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

describe('features', () => {
    test('parses only booleans by key', () => {
        expect(parseFeatures({ features: { a: true, b: false, c: 'yes' } })).toEqual({ a: true, b: false });
        expect(parseFeatures({ nope: 1 })).toBeNull();
        expect(parseFeatures(null)).toBeNull();
    });

    test('before any answer: subtitles on, everything else off', async () => {
        expect(await hasFeature(FEATURE_SUBTITLES)).toBe(true);
        expect(await hasFeature(FEATURE_SECOND_TRACK)).toBe(false);
    });

    test('asks with the bearer token, retries a 401 with a fresh one, and keeps the answer', async () => {
        const calls: string[] = [];
        const got = await refreshFeatures('https://api.test/', {
            fetch: async (url, init) => {
                calls.push(`${url} ${(init.headers as Record<string, string>).Authorization}`);
                return calls.length === 1 ? reply(401, {}) : reply(200, { features: { [FEATURE_SECOND_TRACK]: true, [FEATURE_SUBTITLES]: false } });
            },
            token: async (refresh) => ({ idToken: refresh ? 'tok2' : 'tok1' }),
            now: () => NOW,
        });
        expect(calls).toEqual(['https://api.test/dictionary/features Bearer tok1', 'https://api.test/dictionary/features Bearer tok2']);
        expect(got).toEqual({ [FEATURE_SECOND_TRACK]: true, [FEATURE_SUBTITLES]: false });
        expect(await hasFeature(FEATURE_SECOND_TRACK)).toBe(true);
        expect(await hasFeature(FEATURE_SUBTITLES)).toBe(false);
        expect(await staleFeatures(NOW + 60_000)).toBe(false);
        expect(await staleFeatures(NOW + 11 * 60_000)).toBe(true);
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
        await markFeatureOff(FEATURE_SECOND_TRACK);
        expect(await hasFeature(FEATURE_SECOND_TRACK)).toBe(false);
        await forgetFeatures();
        expect(await hasFeature(FEATURE_SUBTITLES)).toBe(true);
        expect(await staleFeatures(NOW)).toBe(true);
    });
});

describe('the AI feature', () => {
    const flush = () => new Promise((r) => setTimeout(r, 0));
    test('counts as on without an answer, and a watcher hears it go off and on', async () => {
        expect(await hasFeature(FEATURE_AI)).toBe(true);
        const seen: boolean[] = [];
        watchFeature(FEATURE_AI, (on) => seen.push(on));
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
        expect(await staleFeatures(NOW + 1_000)).toBe(false);
        expect(await staleFeatures(NOW + 61_000)).toBe(true);
    });
});

describe('AI subtitle translation', () => {
    const flush = () => new Promise((r) => setTimeout(r, 0));
    const tell = () => {
        for (const l of listeners) (l as (c: unknown, a: string) => void)({ features: {} }, 'local');
    };
    test('stops when its own switch goes off, not only the AI one', async () => {
        const seen: boolean[] = [];
        browserAiDeps().onAIChange?.((on) => seen.push(on));
        await flush();
        store.features = { features: { [FEATURE_AI]: true, [FEATURE_SUBTITLES]: false }, at: NOW };
        tell();
        await flush();
        store.features = { features: { [FEATURE_AI]: true, [FEATURE_SUBTITLES]: true }, at: NOW };
        tell();
        await flush();
        store.features = { features: { [FEATURE_AI]: false, [FEATURE_SUBTITLES]: true }, at: NOW };
        tell();
        await flush();
        expect(seen).toEqual([true, false, true, false]);
    });
});
