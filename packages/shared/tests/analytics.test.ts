/**
 * @jest-environment jsdom
 */

// Analytics is the one subsystem whose failure mode is silent: a payload
// missing session_id is accepted by GA4 with a 204 and then never appears in
// any report. These tests exist so that class of bug fails here instead of
// three weeks later in an empty dashboard.

function makeStorageArea(): any {
    const store: Record<string, unknown> = {};
    return {
        get: jest.fn((keys: string | string[] | null) => {
            if (keys == null) return Promise.resolve({ ...store });
            const arr = typeof keys === 'string' ? [keys] : keys;
            const out: Record<string, unknown> = {};
            for (const k of arr) if (k in store) out[k] = store[k];
            return Promise.resolve(out);
        }),
        set: jest.fn((items: Record<string, unknown>) => {
            Object.assign(store, items);
            return Promise.resolve();
        }),
        remove: jest.fn((keys: string | string[]) => {
            const arr = typeof keys === 'string' ? [keys] : keys;
            for (const k of arr) delete store[k];
            return Promise.resolve();
        }),
        _store: store,
    };
}

const storage = { local: makeStorageArea(), session: makeStorageArea() };

(global as any).chrome = {
    runtime: {
        id: 'test-extension-id',
        getManifest: () => ({ version: '1.2.3' }),
        sendMessage: jest.fn(),
        lastError: undefined,
    },
    storage,
};

if (!(global as any).crypto?.randomUUID) {
    let n = 0;
    (global as any).crypto = {
        ...((global as any).crypto ?? {}),
        randomUUID: () => `uuid-${++n}`,
    };
}

import {
    ALL_ANALYTICS_EVENTS,
    DENIED_PARAM_KEYS,
    OncePerScope,
    buildPayload,
    isEmbed,
    platformOf,
    sanitizeParams,
    trackVia,
    type AnalyticsEvent,
} from '../src/analytics';
import {
    _resetAnalyticsCacheForTests,
    collectUrl,
    daysSinceInstall,
    getClientId,
    getSessionId,
    handleTrackMessage,
    isAnalyticsEnabled,
    markInstalled,
    setBackendResolver,
    track,
} from '../src/analytics-bg';

const DAY = 86_400_000;
const PREFS_KEY = 'prefs.v1';

function clearStorage(): void {
    for (const area of [storage.local, storage.session]) {
        Object.keys(area._store).forEach((k) => delete area._store[k]);
    }
}

beforeEach(() => {
    clearStorage();
    _resetAnalyticsCacheForTests();
    (global as any).chrome.runtime.id = 'test-extension-id';
    (global as any).chrome.runtime.getManifest = () => ({ version: '1.2.3' });
    (global as any).fetch = jest.fn(() =>
        Promise.resolve({ json: () => Promise.resolve({}) } as any),
    );
    // clearAllMocks resets calls but NOT implementations, so a one-off
    // mockRejectedValue would otherwise leak into every later test.
    jest.clearAllMocks();
    storage.local.get.mockImplementation((keys: string | string[] | null) => {
        const store = storage.local._store;
        if (keys == null) return Promise.resolve({ ...store });
        const arr = typeof keys === 'string' ? [keys] : keys;
        const out: Record<string, unknown> = {};
        for (const k of arr) if (k in store) out[k] = store[k];
        return Promise.resolve(out);
    });
});

// ---------------------------------------------------------------------------
// Event vocabulary
// ---------------------------------------------------------------------------

describe('event names', () => {
    test('every name satisfies GA4 rules', () => {
        for (const name of ALL_ANALYTICS_EVENTS) {
            expect(name.length).toBeLessThanOrEqual(40);
            expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
            // GA4 silently drops events using its reserved prefixes.
            expect(name).not.toMatch(/^(ga_|google_|firebase_)/);
        }
    });

    test('the runtime list has no duplicates', () => {
        expect(new Set(ALL_ANALYTICS_EVENTS).size).toBe(ALL_ANALYTICS_EVENTS.length);
    });
});

// ---------------------------------------------------------------------------
// platformOf
// ---------------------------------------------------------------------------

describe('platformOf', () => {
    test.each([
        ['www.youtube.com', 'youtube'],
        ['youtube.com', 'youtube'],
        ['m.youtube.com', 'youtube'],
        ['music.youtube.com', 'youtube'],
        ['youtu.be', 'youtube'],
        ['www.netflix.com', 'netflix'],
        ['netflix.com', 'netflix'],
        ['rezka.ag', 'rezka'],
        ['hdrezka.website', 'rezka'],
        ['www.rezka-ua.tv', 'rezka'],
        ['rezka.ai', 'rezka'],
        ['voidboost.net', 'rezka'],
        ['example.com', 'other'],
        ['', 'other'],
    ])('%s → %s', (host, expected) => {
        expect(platformOf(host)).toBe(expected);
    });

    test('never leaks a raw hostname', () => {
        // The value is a fixed enum precisely so GA4 never receives something
        // that edges toward browsing history.
        const allowed = ['youtube', 'netflix', 'rezka', 'web', 'other'];
        for (const host of ['weird.unknown.tld', 'localhost', '10.0.0.1']) {
            expect(allowed).toContain(platformOf(host));
        }
    });
});

// ---------------------------------------------------------------------------
// sanitizeParams
// ---------------------------------------------------------------------------

describe('sanitizeParams', () => {
    test('drops undefined and non-finite numbers', () => {
        const out = sanitizeParams({ a: undefined, b: NaN, c: Infinity, d: 1 });
        expect(out).toEqual({ d: 1 });
    });

    test('truncates long string values', () => {
        const out = sanitizeParams({ s: 'x'.repeat(250) });
        expect((out.s as string).length).toBe(100);
    });

    test('caps the number of params', () => {
        const many: Record<string, number> = {};
        for (let i = 0; i < 40; i++) many[`k${i}`] = i;
        expect(Object.keys(sanitizeParams(many)).length).toBeLessThanOrEqual(18);
    });

    test('strips every denied key, case-insensitively', () => {
        const params: Record<string, string> = { site: 'youtube' };
        for (const k of DENIED_PARAM_KEYS) params[k] = 'leak';
        params.UID = 'leak';
        params.Email = 'leak';
        const out = sanitizeParams(params);
        expect(out).toEqual({ site: 'youtube' });
    });

    test('preserves booleans and numbers unchanged', () => {
        expect(sanitizeParams({ ok: true, n: 0 })).toEqual({ ok: true, n: 0 });
    });

    test('the deny-list survives an entry longer than the name limit', () => {
        // Guards the arithmetic the raw-name match relies on: today every
        // denied name is far shorter than the 40-char cap, so matching before
        // or after truncation agrees on every input. Add a longer entry and
        // matching the truncated name would silently stop denying it.
        expect(DENIED_PARAM_KEYS.every((k) => k.length < 40)).toBe(true);
        const long = 'x'.repeat(60);
        expect(sanitizeParams({ [long]: 'kept' })[long.slice(0, 40)]).toBe('kept');
    });

    test('names colliding after truncation keep the first, not the last', () => {
        // Both spend from the 18-param budget, so letting the second overwrite
        // the first silently dropped a parameter the payload had paid for.
        const prefix = 'a'.repeat(40);
        const out = sanitizeParams({ [`${prefix}_one`]: 'first', [`${prefix}_two`]: 'second' });
        expect(out[prefix]).toBe('first');
        expect(Object.keys(out)).toHaveLength(1);
    });

    test('drops objects and arrays', () => {
        // The declared type says string|number|boolean, but these arrive over
        // sendMessage where the type is a claim. A careless `...request` spread
        // must not put a nested structure into the payload.
        const out = sanitizeParams({
            obj: { uid: 'leak' },
            arr: ['leak'],
            site: 'youtube',
        } as any);
        expect(out).toEqual({ site: 'youtube' });
    });
});

// ---------------------------------------------------------------------------
// buildPayload
// ---------------------------------------------------------------------------

describe('buildPayload', () => {
    const ctx = {
        clientId: 'cid-1',
        sessionId: 'sid-1',
        extSource: 'youtube-extension',
        extVersion: '1.2.3',
        extEnv: 'dev',
    };

    test('includes session_id and engagement_time_msec', () => {
        // Without these GA4 returns 204 and the event never surfaces in a
        // report — the single most undebuggable failure in this subsystem.
        const p = buildPayload('word_saved', { site: 'youtube' }, ctx);
        expect(p.events[0].params.session_id).toBe('sid-1');
        expect(p.events[0].params.engagement_time_msec).toBe(1);
    });

    test('client_id sits at the top level, not in params', () => {
        const p = buildPayload('word_saved', {}, ctx);
        expect(p.client_id).toBe('cid-1');
        expect(p.events[0].params.client_id).toBeUndefined();
    });

    test('sets non_personalized_ads', () => {
        expect(buildPayload('word_saved', {}, ctx).non_personalized_ads).toBe(true);
    });

    test('never emits user_id anywhere', () => {
        // The product's core privacy claim: analytics cannot be joined to an
        // account. Passing one in must not smuggle it through either.
        const p = buildPayload('word_saved', { user_id: 'u1', uid: 'u1', email: 'a@b.c' } as any, ctx);
        expect((p as any).user_id).toBeUndefined();
        expect(p.events[0].params.user_id).toBeUndefined();
        expect(p.events[0].params.uid).toBeUndefined();
        expect(p.events[0].params.email).toBeUndefined();
        expect(JSON.stringify(p)).not.toContain('a@b.c');
    });

    test('omits days_since_install when unknown', () => {
        const p = buildPayload('word_saved', {}, ctx);
        expect(p.events[0].params.days_since_install).toBeUndefined();
    });

    test('includes days_since_install when known', () => {
        const p = buildPayload('word_saved', {}, { ...ctx, daysSinceInstall: 6 });
        expect(p.events[0].params.days_since_install).toBe(6);
    });

    test('carries the source/version/env dimensions', () => {
        const p = buildPayload('word_saved', {}, ctx);
        expect(p.events[0].params.ext_source).toBe('youtube-extension');
        expect(p.events[0].params.ext_version).toBe('1.2.3');
        expect(p.events[0].params.ext_env).toBe('dev');
    });

    test('omits backend when the build cannot switch', () => {
        // Prod builds contain no environment table, so the question "which
        // backend?" has no meaning there — ext_env already answers it. An
        // empty string must not become a bogus dimension value either.
        expect(buildPayload('word_saved', {}, ctx).events[0].params.backend).toBeUndefined();
        expect(
            buildPayload('word_saved', {}, { ...ctx, backend: '' }).events[0].params.backend,
        ).toBeUndefined();
    });

    test('carries backend when the build can switch', () => {
        // A dev build pointed at preprod must be distinguishable from one
        // pointed at real production data — both land in the same dev property.
        const pre = buildPayload('word_saved', {}, { ...ctx, backend: 'preprod' });
        expect(pre.events[0].params.backend).toBe('preprod');
        const prod = buildPayload('word_saved', {}, { ...ctx, backend: 'prod' });
        expect(prod.events[0].params.backend).toBe('prod');
    });
});

// ---------------------------------------------------------------------------
// OncePerScope
// ---------------------------------------------------------------------------

describe('OncePerScope', () => {
    test('fires a key only once until reset', () => {
        const once = new OncePerScope();
        const send = jest.fn();
        once.fire('dual', send);
        once.fire('dual', send);
        once.fire('dual', send);
        expect(send).toHaveBeenCalledTimes(1);
        once.reset();
        once.fire('dual', send);
        expect(send).toHaveBeenCalledTimes(2);
    });

    test('keys are independent', () => {
        const once = new OncePerScope();
        const a = jest.fn();
        const b = jest.fn();
        once.fire('a', a);
        once.fire('b', b);
        expect(a).toHaveBeenCalledTimes(1);
        expect(b).toHaveBeenCalledTimes(1);
    });

    test('a throwing callback neither propagates nor re-arms the key', () => {
        const once = new OncePerScope();
        const boom = jest.fn(() => {
            throw new Error('nope');
        });
        expect(() => once.fire('k', boom)).not.toThrow();
        once.fire('k', boom);
        expect(boom).toHaveBeenCalledTimes(1);
    });

    test('hasFired reflects state', () => {
        const once = new OncePerScope();
        expect(once.hasFired('k')).toBe(false);
        once.fire('k', () => {});
        expect(once.hasFired('k')).toBe(true);
        once.reset();
        expect(once.hasFired('k')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Environment guards
// ---------------------------------------------------------------------------

describe('isEmbed', () => {
    test('false inside a real extension', () => {
        expect(isEmbed()).toBe(false);
    });

    test('true for the embed shim runtime id', () => {
        (global as any).chrome.runtime.id = 'lingogram-embed';
        expect(isEmbed()).toBe(true);
    });

    test('true when getManifest is missing (shim without an id change)', () => {
        (global as any).chrome.runtime.getManifest = undefined;
        expect(isEmbed()).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

describe('client id', () => {
    test('mints once and reuses it', () => {
        return getClientId().then(async (first) => {
            expect(first).toBeTruthy();
            expect(storage.local.set).toHaveBeenCalledTimes(1);
            const second = await getClientId();
            expect(second).toBe(first);
            expect(storage.local.set).toHaveBeenCalledTimes(1);
        });
    });

    test('returns a previously stored value untouched', async () => {
        storage.local._store['analytics.clientId'] = 'existing-id';
        expect(await getClientId()).toBe('existing-id');
        expect(storage.local.set).not.toHaveBeenCalled();
    });

    test('is never derived from the auth uid', async () => {
        storage.local._store['auth.uid'] = 'firebase-uid-42';
        const id = await getClientId();
        expect(id).not.toContain('firebase-uid-42');
    });

    test('an unreadable store yields null rather than a fresh id', async () => {
        // Fails closed on the READ. A throwing get cannot distinguish "no id
        // yet" from "the id is there but unreachable", and the worker recycles
        // after ~30s idle — minting on that guess would report one machine as
        // a new user every wake and inflate every retention cohort.
        storage.local.get.mockRejectedValueOnce(new Error('storage unavailable'));
        expect(await getClientId()).toBeNull();
        expect(storage.local.set).not.toHaveBeenCalled();
    });

    test('an unwritable store still reports under the fresh id', async () => {
        // Fails OPEN on the WRITE, and safely: storage answered the read, so
        // there genuinely is no id yet and this is a first mint, not a possible
        // duplicate of one already on disk.
        storage.local.set.mockRejectedValueOnce(new Error('quota'));
        expect(await getClientId()).toBeTruthy();
    });

    test('track() sends nothing when there is no readable identity', async () => {
        storage.local.get.mockRejectedValue(new Error('storage unavailable'));
        await track('extension_installed');
        expect((global as any).fetch).not.toHaveBeenCalled();
    });
});

describe('session id', () => {
    test('reuses an id inside the 30-minute window', async () => {
        const t0 = 1_000_000;
        const first = await getSessionId(t0);
        const second = await getSessionId(t0 + 60_000);
        expect(second).toBe(first);
    });

    test('rolls over after the window', async () => {
        const t0 = 1_000_000;
        const first = await getSessionId(t0);
        const later = await getSessionId(t0 + 31 * 60_000);
        expect(later).not.toBe(first);
    });
});

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

describe('daysSinceInstall', () => {
    test('undefined when the install predates analytics', async () => {
        expect(await daysSinceInstall()).toBeUndefined();
    });

    test('counts whole days', async () => {
        const now = 10 * DAY;
        storage.local._store['analytics.installedAt'] = now - DAY;
        expect(await daysSinceInstall(now)).toBe(1);
        storage.local._store['analytics.installedAt'] = now - 13 * DAY;
        expect(await daysSinceInstall(now)).toBe(13);
    });

    test('markInstalled does not overwrite an existing date', async () => {
        storage.local._store['analytics.installedAt'] = 42;
        await markInstalled(99 * DAY);
        expect(storage.local._store['analytics.installedAt']).toBe(42);
    });

    test('markInstalled stamps UTC midnight', async () => {
        await markInstalled(5 * DAY + 12 * 3600_000);
        expect(storage.local._store['analytics.installedAt']).toBe(5 * DAY);
    });

    test('undefined rather than a negative day when the clock moved backwards', async () => {
        // A user who rolls their system clock back would otherwise produce
        // negative days_since_install and poison the retention cohorts.
        storage.local._store['analytics.installedAt'] = 10 * DAY;
        expect(await daysSinceInstall(5 * DAY)).toBeUndefined();
    });

    test('undefined when storage throws', async () => {
        storage.local.get.mockRejectedValueOnce(new Error('boom'));
        expect(await daysSinceInstall()).toBeUndefined();
    });

    test('markInstalled swallows a storage failure', async () => {
        storage.local.get.mockRejectedValueOnce(new Error('boom'));
        await expect(markInstalled()).resolves.toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Consent gate
// ---------------------------------------------------------------------------

describe('consent gate', () => {
    test('enabled when prefs are absent (on by default, no migration)', async () => {
        expect(await isAnalyticsEnabled()).toBe(true);
    });

    test('enabled when the blob predates the field', async () => {
        storage.local._store[PREFS_KEY] = { displayMode: 'dual' };
        expect(await isAnalyticsEnabled()).toBe(true);
    });

    test('disabled when opted out', async () => {
        storage.local._store[PREFS_KEY] = { analyticsEnabled: false };
        expect(await isAnalyticsEnabled()).toBe(false);
    });

    test('fails closed when storage throws', async () => {
        // A storage error is not permission to collect.
        storage.local.get.mockRejectedValueOnce(new Error('boom'));
        expect(await isAnalyticsEnabled()).toBe(false);
    });

    test('a per-site scope cannot re-consent an opted-out user', async () => {
        // Overlay appearance is stored per streaming site under byPlatform, but
        // consent is global and lives at the top level, which is the only thing
        // this gate reads — the service worker has no tab and so could not pick
        // a scope even if it wanted to. A stray analyticsEnabled inside a scope
        // object must therefore be inert, never an override.
        storage.local._store[PREFS_KEY] = {
            analyticsEnabled: false,
            byPlatform: { youtube: { overlayEnabled: true, analyticsEnabled: true } },
        };
        expect(await isAnalyticsEnabled()).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// track()
// ---------------------------------------------------------------------------

describe('track', () => {
    test('sends when enabled', async () => {
        await track('word_saved', { site: 'youtube' });
        expect((global as any).fetch).toHaveBeenCalledTimes(1);
        const [url, init] = (global as any).fetch.mock.calls[0];
        expect(url).toContain('measurement_id=');
        expect(url).toContain('api_secret=');
        expect(init.keepalive).toBe(true);
        // No Content-Type: gtag omits it too, and adding it triggers a CORS
        // preflight on some Chrome builds.
        expect(init.headers).toBeUndefined();
    });

    test('does not send when opted out', async () => {
        storage.local._store[PREFS_KEY] = { analyticsEnabled: false };
        await track('word_saved');
        expect((global as any).fetch).not.toHaveBeenCalled();
    });

    test('analytics_opt_out still sends once the preference is already false', async () => {
        // The event that reports the gate closing cannot be stopped by the gate
        // it is reporting on. From a content script the write wins the race:
        // sendMessage cold-starts the worker (tens of ms) while savePrefs lands
        // ~0.1ms later, so the worker reads a preference that already says no.
        // Without this exemption the sidebar toggle produced no hit at all.
        storage.local._store[PREFS_KEY] = { analyticsEnabled: false };
        await track('analytics_opt_out');
        expect((global as any).fetch).toHaveBeenCalledTimes(1);
        const body = JSON.parse((global as any).fetch.mock.calls[0][1].body);
        expect(body.events[0].name).toBe('analytics_opt_out');
    });

    test('the exemption is one event, not a hole in the gate', async () => {
        storage.local._store[PREFS_KEY] = { analyticsEnabled: false };
        for (const e of ['word_saved', 'subtitles_loaded', 'extension_installed'] as const) {
            await track(e);
        }
        expect((global as any).fetch).not.toHaveBeenCalled();
    });

    test('does not send from the embed shim', async () => {
        (global as any).chrome.runtime.id = 'lingogram-embed';
        await track('word_saved');
        expect((global as any).fetch).not.toHaveBeenCalled();
    });

    test('does not send when prefs are unreadable', async () => {
        // mockRejectedValueOnce, not mockRejectedValue: a persistent rejection
        // would leak into every later test in the file.
        storage.local.get.mockRejectedValueOnce(new Error('boom'));
        await track('word_saved');
        expect((global as any).fetch).not.toHaveBeenCalled();
    });

    test('never throws when the network fails', async () => {
        (global as any).fetch = jest.fn(() => Promise.reject(new Error('offline')));
        await expect(track('word_saved')).resolves.toBeUndefined();
    });

    describe('backend resolver', () => {
        // Module-level state, so every test here puts it back.
        afterEach(() => setBackendResolver(null));

        function sentParams(): Record<string, unknown> {
            const body = JSON.parse((global as any).fetch.mock.calls[0][1].body);
            return body.events[0].params;
        }

        test('omits backend when no resolver is wired', async () => {
            await track('word_saved');
            expect(sentParams().backend).toBeUndefined();
        });

        test('tags the event with the resolved backend', async () => {
            setBackendResolver(() => 'preprod');
            await track('word_saved');
            expect(sentParams().backend).toBe('preprod');
        });

        test('a throwing resolver costs the tag, not the event', async () => {
            // devEnvSwitch reads `config` and storage; if that ever throws, the
            // event itself must still arrive rather than vanishing silently.
            setBackendResolver(() => {
                throw new Error('config not ready');
            });
            await track('word_saved');
            expect((global as any).fetch).toHaveBeenCalledTimes(1);
            expect(sentParams().backend).toBeUndefined();
        });
    });

    test('surfaces GA4 validation errors in dev', async () => {
        // The dev endpoint is the only place a malformed payload is visible at
        // all — prod answers 204 and the event just never appears in a report.
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        (global as any).fetch = jest.fn(() =>
            Promise.resolve({
                json: () => Promise.resolve({ validationMessages: [{ description: 'bad' }] }),
            } as any),
        );
        await track('word_saved');
        expect(warn).toHaveBeenCalledWith(
            '[Lingogram GA4] payload rejected:',
            expect.any(Array),
        );
        warn.mockRestore();
    });

    test('tolerates a non-JSON response body', async () => {
        (global as any).fetch = jest.fn(() =>
            Promise.resolve({ json: () => Promise.reject(new Error('not json')) } as any),
        );
        await expect(track('word_saved')).resolves.toBeUndefined();
    });

    test('sends an empty version when getManifest throws', async () => {
        (global as any).chrome.runtime.getManifest = () => {
            throw new Error('no manifest');
        };
        await track('word_saved');
        const body = JSON.parse((global as any).fetch.mock.calls[0][1].body);
        expect(body.events[0].params.ext_version).toBe('');
    });

    test('the outgoing body carries no account identifier', async () => {
        storage.local._store['auth.uid'] = 'firebase-uid-42';
        storage.local._store['auth.email'] = 'someone@example.com';
        await track('word_saved', { site: 'youtube', saved_count: 3 });
        const body = (global as any).fetch.mock.calls[0][1].body as string;
        expect(body).not.toContain('firebase-uid-42');
        expect(body).not.toContain('someone@example.com');
        expect(body).not.toContain('user_id');
    });
});

// ---------------------------------------------------------------------------
// Retention milestones
// ---------------------------------------------------------------------------

describe('retention milestones', () => {
    test('fires retained_d2 once on day 1', async () => {
        const now = Date.now();
        storage.local._store['analytics.installedAt'] = now - DAY;
        await track('subtitles_loaded');
        const names = (global as any).fetch.mock.calls.map(
            (c: any[]) => JSON.parse(c[1].body).events[0].name,
        );
        expect(names).toContain('retained_d2');

        (global as any).fetch.mockClear();
        await track('subtitles_loaded');
        const again = (global as any).fetch.mock.calls.map(
            (c: any[]) => JSON.parse(c[1].body).events[0].name,
        );
        expect(again).not.toContain('retained_d2');
    });

    test('does not backfill a missed milestone', async () => {
        // A user first seen on day 7 sends retained_d7 only: back-filling D2
        // would populate that cohort with people never observed on D2.
        const now = Date.now();
        storage.local._store['analytics.installedAt'] = now - 6 * DAY;
        await track('subtitles_loaded');
        const names = (global as any).fetch.mock.calls.map(
            (c: any[]) => JSON.parse(c[1].body).events[0].name,
        );
        expect(names).toContain('retained_d7');
        expect(names).not.toContain('retained_d2');
    });

    test('sends nothing on a non-milestone day', async () => {
        const now = Date.now();
        storage.local._store['analytics.installedAt'] = now - 3 * DAY;
        await track('subtitles_loaded');
        expect((global as any).fetch).toHaveBeenCalledTimes(1);
    });

    test('sends nothing when the install date is unknown', async () => {
        await track('subtitles_loaded');
        expect((global as any).fetch).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// Message boundary
// ---------------------------------------------------------------------------

describe('handleTrackMessage', () => {
    test('accepts a known event', async () => {
        expect(await handleTrackMessage({ event: 'word_saved', params: {} })).toEqual({ ok: true });
        expect((global as any).fetch).toHaveBeenCalledTimes(1);
    });

    test('rejects an unknown event without sending', async () => {
        // Allow-list, not passthrough: a compromised content script must not be
        // able to write arbitrary names into the property.
        expect(await handleTrackMessage({ event: 'evil_event' })).toEqual({ ok: false });
        expect((global as any).fetch).not.toHaveBeenCalled();
    });

    test('rejects a missing or non-string event', async () => {
        expect(await handleTrackMessage({})).toEqual({ ok: false });
        expect(await handleTrackMessage({ event: 42 })).toEqual({ ok: false });
    });

    test('tolerates a non-object params', async () => {
        expect(await handleTrackMessage({ event: 'word_saved', params: 'nope' })).toEqual({
            ok: true,
        });
    });

    test('accepts every declared event name', async () => {
        for (const name of ALL_ANALYTICS_EVENTS) {
            expect(await handleTrackMessage({ event: name })).toEqual({ ok: true });
        }
    });
});

// ---------------------------------------------------------------------------
// trackVia (content side)
// ---------------------------------------------------------------------------

describe('trackVia', () => {
    test('posts a well-formed message to the worker', () => {
        trackVia('dual_subs_shown', { site: 'youtube' });
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        const [msg] = (chrome.runtime.sendMessage as jest.Mock).mock.calls[0];
        expect(msg).toEqual({
            action: 'TRACK_EVENT',
            event: 'dual_subs_shown',
            params: { site: 'youtube' },
        });
    });

    test('reads lastError so Chrome does not log unchecked-error noise', () => {
        trackVia('dual_subs_shown');
        const [, cb] = (chrome.runtime.sendMessage as jest.Mock).mock.calls[0];
        expect(() => cb()).not.toThrow();
    });

    test('stays silent in the embed', () => {
        (global as any).chrome.runtime.id = 'lingogram-embed';
        trackVia('dual_subs_shown');
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    test('stays silent in an orphaned content script', () => {
        (global as any).chrome.runtime.id = '';
        trackVia('dual_subs_shown');
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    test('swallows a throwing sendMessage', () => {
        (chrome.runtime.sendMessage as jest.Mock).mockImplementationOnce(() => {
            throw new Error('context invalidated');
        });
        expect(() => trackVia('dual_subs_shown')).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// URL
// ---------------------------------------------------------------------------

describe('collectUrl', () => {
    test('uses the validating endpoint in dev', () => {
        // Prod 204s on a malformed payload; /debug returns validationMessages,
        // which is the only way to catch a bad event before it is invisible.
        expect(collectUrl()).toContain('/debug/mp/collect');
    });

    test('carries both credentials', () => {
        const url = collectUrl();
        expect(url).toContain('measurement_id=G-TEST');
        expect(url).toContain('api_secret=test-secret');
    });
});
