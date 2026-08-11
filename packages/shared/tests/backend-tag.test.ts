/**
 * @jest-environment jsdom
 */

// The `backend` analytics parameter — the thing that tells a preprod test
// session apart from one against real production data, both of which land in
// the same dev property.
//
// Covered here rather than in the browser because the browser cannot settle it:
// devEnvSwitch reads its stored side in restoreEnv() at service-worker STARTUP,
// so proving the switch flips the tag needs a worker restart, and Playwright
// loses its handle on the worker across chrome.runtime.reload(). The rule
// itself is pure, so a unit test pins it more durably than the acrobatics would.

const store: Record<string, unknown> = {};

(global as any).chrome = {
    runtime: {
        id: 'test-extension-id',
        getManifest: () => ({ version: '1.0.0' }),
        lastError: undefined,
    },
    storage: {
        local: {
            get: jest.fn(async (k: string) => (k in store ? { [k]: store[k] } : {})),
            set: jest.fn(async (o: Record<string, unknown>) => {
                Object.assign(store, o);
            }),
        },
        session: {
            get: jest.fn(async () => ({})),
            set: jest.fn(async () => undefined),
        },
        onChanged: { addListener: jest.fn(), removeListener: jest.fn() },
    },
};

(global as any).__EXT_ENV__ = 'dev';
(global as any).__EXT_SOURCE__ = 'youtube-extension';
(global as any).__GA4_MEASUREMENT_ID__ = 'G-TEST';
(global as any).__GA4_API_SECRET__ = 'secret';
(global as any).__GA4_ENDPOINT__ = 'https://ga4.test';

import { buildPayload } from '../src/analytics';
import { setBackendResolver, track } from '../src/analytics-bg';

const ctx = {
    clientId: 'cid',
    sessionId: 'sid',
    extSource: 'youtube-extension',
    extVersion: '1.0.0',
    extEnv: 'dev',
};

function paramsOf(): Record<string, unknown> {
    const body = JSON.parse((global as any).fetch.mock.calls[0][1].body);
    return body.events[0].params;
}

beforeEach(() => {
    (global as any).fetch = jest.fn(async () => ({ json: async () => ({}) }));
    setBackendResolver(null);
    for (const k of Object.keys(store)) delete store[k];
});

afterEach(() => setBackendResolver(null));

describe('the backend tag distinguishes prod from preprod', () => {
    test('the resolver decides the value, verbatim', async () => {
        // Mirrors what the background scripts wire up:
        //   setBackendResolver(() => isLiveProd() ? 'prod' : 'preprod')
        let liveIsProd = false;
        setBackendResolver(() => (liveIsProd ? 'prod' : 'preprod'));

        await track('word_saved');
        expect(paramsOf().backend).toBe('preprod');

        // Flipping the underlying condition — what switching sides does — must
        // change the tag on the very next event, with no restart in between.
        liveIsProd = true;
        (global as any).fetch = jest.fn(async () => ({ json: async () => ({}) }));
        await track('word_saved');
        expect(paramsOf().backend).toBe('prod');
    });

    test('an edition with no switch sends no tag at all', async () => {
        // apps/web defines no __EXT_ALT_*__ and wires no resolver: there is one
        // backend, so the question has no meaning and ext_env already answers it.
        await track('word_saved');
        expect(paramsOf().backend).toBeUndefined();
    });

    test('the tag never displaces the build-type dimension', async () => {
        // ext_env says how the build was COMPILED; backend says what it is
        // pointed at. A dev build against production is a real combination and
        // both halves have to survive.
        setBackendResolver(() => 'prod');
        await track('word_saved');
        const p = paramsOf();
        expect(p.ext_env).toBe('dev');
        expect(p.backend).toBe('prod');
    });

    test('buildPayload treats an empty tag as absent, not as a value', () => {
        // A resolver that returns '' (misconfigured build) must not create a
        // bogus dimension value that would fragment every report.
        const p = buildPayload('word_saved', {}, { ...ctx, backend: '' });
        expect(p.events[0].params.backend).toBeUndefined();
    });
});
