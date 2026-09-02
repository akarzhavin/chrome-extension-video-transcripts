function makeStorageArea(): any {
    const store: Record<string, unknown> = {};
    return {
        get: jest.fn((keys: string | string[] | Record<string, unknown> | null) => {
            if (keys === null || keys === undefined) return Promise.resolve({ ...store });
            const keyArr = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
            const out: Record<string, unknown> = {};
            for (const k of keyArr) if (k in store) out[k] = store[k];
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

function makeChromeStorage(): { local: any; session: any } {
    return { local: makeStorageArea(), session: makeStorageArea() };
}

// Capture the onMessageExternal listener so we can invoke it directly in tests.
let capturedExternalListener: ((message: any, sender: any, sendResponse: any) => boolean | void) | null = null;

(global as any).chrome = {
    webRequest: { onCompleted: { addListener: jest.fn() } },
    runtime: {
        id: 'test-extension-id',
        onMessage: { addListener: jest.fn() },
        onMessageExternal: {
            addListener: jest.fn((listener: any) => {
                capturedExternalListener = listener;
            }),
        },
        sendMessage: jest.fn(),
        lastError: undefined,
        // background.ts calls installOnboarding at import time; without these
        // the whole suite failed to load on `onInstalled.addListener`.
        onInstalled: { addListener: jest.fn() },
        OnInstalledReason: { INSTALL: 'install', UPDATE: 'update' },
        setUninstallURL: jest.fn(),
    },
    tabs: {
        get: jest.fn(),
        sendMessage: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 1 }),
        remove: jest.fn().mockResolvedValue(undefined),
    },
    action: {
        setBadgeText: jest.fn(),
        setBadgeBackgroundColor: jest.fn(),
    },
    storage: makeChromeStorage(),
    identity: {
        getAuthToken: jest.fn(),
        clearAllCachedAuthTokens: jest.fn((cb: () => void) => cb()),
    },
};

import { HttpError, classifyStatus, fetchWithRetry } from '../src/background/background';

describe('fetch failure classification', () => {
    // Before this, the status was formatted into an Error message and lost, so
    // the content script had only a timeout to go on and told the user the
    // video had no subtitles — for what was often a rate limit.
    test('HttpError carries the status, not just a message', async () => {
        (global as any).fetch = jest
            .fn()
            .mockResolvedValue({ ok: false, status: 429, text: () => Promise.resolve('') });
        await expect(fetchWithRetry('http://x/subs.vtt', 1, 1)).rejects.toBeInstanceOf(HttpError);
        try {
            await fetchWithRetry('http://x/subs.vtt', 1, 1);
        } catch (err) {
            expect((err as HttpError).status).toBe(429);
        }
    });

    test.each([
        [429, 'rate-limited'],
        [503, 'rate-limited'],
        [403, 'stale-url'],
        [404, 'unavailable'],
        [410, 'unavailable'],
        [500, 'unknown'],
        [undefined, 'network'],
    ])('status %s → %s', (status, expected) => {
        expect(classifyStatus(status as number | undefined)).toBe(expected);
    });
});
import {
    AUTH_ACTIONS,
    buildAllowedExternalOrigins,
    getAuthState,
    handleAuthMessage,
    isAuthAction,
} from '@video-transcripts/shared';

describe('message action registry', () => {
    // isAuthAction() filters on AUTH_ACTIONS before the handler ever runs, so
    // an action present in the type union but missing from the Set is dropped
    // silently — no error, no log, just events that never arrive. These two
    // assertions are the only thing standing between that bug and production.
    test('TRACK_EVENT is registered', () => {
        expect(isAuthAction('TRACK_EVENT')).toBe(true);
        expect(AUTH_ACTIONS.has('TRACK_EVENT')).toBe(true);
    });

    test('the notification actions are registered', () => {
        expect(isAuthAction('GET_NOTIFICATION')).toBe(true);
        expect(AUTH_ACTIONS.has('GET_NOTIFICATION')).toBe(true);
        expect(isAuthAction('DISMISS_NOTIFICATION')).toBe(true);
        expect(AUTH_ACTIONS.has('DISMISS_NOTIFICATION')).toBe(true);
    });

    test('the registry holds exactly the eleven non-dev actions', () => {
        // Fails loudly when an action is added to the union but not the Set.
        expect(AUTH_ACTIONS.size).toBe(11);
    });

    test('an unknown analytics event is rejected at the boundary', async () => {
        (global as any).fetch = jest.fn();
        await expect(
            handleAuthMessage({ action: 'TRACK_EVENT', event: 'not_a_real_event' }),
        ).resolves.toEqual({ ok: false });
        expect((global as any).fetch).not.toHaveBeenCalled();
    });
});

describe('background script', () => {
    beforeEach(() => {
        (global as any).fetch = jest.fn();
    });

    test('fetchWithRetry should retry on failure', async () => {
        ((global as any).fetch as jest.Mock)
            .mockRejectedValueOnce(new Error('Network error'))
            .mockRejectedValueOnce(new Error('Network error'))
            .mockResolvedValueOnce({
                ok: true,
                text: () => Promise.resolve('WEBVTT content')
            });

        const result = await fetchWithRetry('http://example.com/subs.vtt', 3, 10);
        expect(result).toBe('WEBVTT content');
        expect((global as any).fetch).toHaveBeenCalledTimes(3);
    });

    test('fetchWithRetry should throw after max retries', async () => {
        ((global as any).fetch as jest.Mock).mockRejectedValue(new Error('Persistent error'));

        await expect(fetchWithRetry('http://example.com/subs.vtt', 3, 10))
            .rejects.toThrow('Persistent error');
        expect((global as any).fetch).toHaveBeenCalledTimes(3);
    });

    test('fetchWithRetry should throw on non-ok response', async () => {
        ((global as any).fetch as jest.Mock).mockResolvedValue({
            ok: false,
            status: 404
        });

        await expect(fetchWithRetry('http://example.com/subs.vtt', 2, 10))
            .rejects.toThrow('HTTP error! status: 404');
    });
});

function invokeExternal(message: any, sender: any): Promise<any> {
    return new Promise((resolve) => {
        const ret = capturedExternalListener!(message, sender, resolve);
        if (ret !== true) {
            // No async, resolve already happened or there was a sync return — but
            // we always either resolved already or returned true with async work.
        }
    });
}

// Mock the Firebase identityToolkit signInWithCustomToken response — that's
// the call the handoff handler makes to exchange the scoped custom token
// for the extension's own id+refresh pair.
function mockSignInWithCustomToken(payload: {
    idToken: string;
    refreshToken: string;
    expiresIn: string;
    localId: string;
}) {
    ((global as any).fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(payload),
        text: () => Promise.resolve(JSON.stringify(payload)),
    });
}

describe('onMessageExternal handoff (custom-token exchange)', () => {
    // Tests below open the handoff path directly; pre-seed the matching
    // pending nonce in storage.session so the listener accepts the payload.
    // The nonce-mismatch / missing branches live in their own tests.
    const PENDING_NONCE = 'test-nonce-aaa';

    beforeEach(async () => {
        const localStore = (global as any).chrome.storage.local._store;
        const sessionStore = (global as any).chrome.storage.session._store;
        Object.keys(localStore).forEach((k) => delete localStore[k]);
        Object.keys(sessionStore).forEach((k) => delete sessionStore[k]);
        (global as any).fetch = jest.fn();
        ((global as any).chrome.action.setBadgeText as jest.Mock).mockClear();
        await (global as any).chrome.storage.session.set({
            'auth.pendingNonce': PENDING_NONCE,
            'auth.pendingNonceAt': Date.now(),
        });
    });

    test('accepts a well-formed customToken with matching nonce, exchanges, stores tokens', async () => {
        mockSignInWithCustomToken({
            idToken: 'fresh-id-token',
            refreshToken: 'fresh-refresh-token',
            expiresIn: '3600',
            localId: 'uid-1',
        });
        const res = await invokeExternal(
            {
                type: 'lingogram-extension-auth',
                payload: {
                    customToken: 'ct-1',
                    email: 'a@b.com',
                    uid: 'uid-1',
                    nonce: PENDING_NONCE,
                },
            },
            { origin: 'http://localhost:5173', url: `http://localhost:5173/extension-auth?ext=foo&nonce=${PENDING_NONCE}` },
        );
        expect(res).toEqual({ ok: true });
        const state = await getAuthState();
        expect(state?.uid).toBe('uid-1');
        expect(state?.idToken).toBe('fresh-id-token');
        expect(state?.refreshToken).toBe('fresh-refresh-token');
        expect(state?.email).toBe('a@b.com');
        // Successful handoff consumes the nonce — same URL cannot be replayed.
        const sessionStore = (global as any).chrome.storage.session._store;
        expect(sessionStore['auth.pendingNonce']).toBeUndefined();
    });

    test('rejects handoff with no nonce — an XSS in a trusted-origin tab cannot push tokens', async () => {
        const res = await invokeExternal(
            {
                type: 'lingogram-extension-auth',
                payload: { customToken: 'ct', email: 'a@b.com', uid: 'uid-1' },
            },
            { origin: 'http://localhost:5173' },
        );
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/invalid or expired auth challenge/);
        expect(await getAuthState()).toBeNull();
        // Failed validation does NOT clear the legitimate value — a real
        // tab that retries with the right nonce later still works.
        const sessionStore = (global as any).chrome.storage.session._store;
        expect(sessionStore['auth.pendingNonce']).toBe(PENDING_NONCE);
    });

    test('rejects handoff with mismatched nonce', async () => {
        const res = await invokeExternal(
            {
                type: 'lingogram-extension-auth',
                payload: {
                    customToken: 'ct',
                    email: 'a@b.com',
                    uid: 'uid-1',
                    nonce: 'wrong-nonce',
                },
            },
            { origin: 'http://localhost:5173' },
        );
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/invalid or expired auth challenge/);
        expect(await getAuthState()).toBeNull();
    });

    test('rejects handoff when the stored nonce is expired (>10 minutes old)', async () => {
        // Re-seed with a stale timestamp so consumePendingAuthNonce treats
        // the pending value as expired even though the string matches.
        const elevenMinutesAgo = Date.now() - 11 * 60 * 1000;
        await (global as any).chrome.storage.session.set({
            'auth.pendingNonce': PENDING_NONCE,
            'auth.pendingNonceAt': elevenMinutesAgo,
        });
        const res = await invokeExternal(
            {
                type: 'lingogram-extension-auth',
                payload: {
                    customToken: 'ct',
                    email: 'a@b.com',
                    uid: 'uid-1',
                    nonce: PENDING_NONCE,
                },
            },
            { origin: 'http://localhost:5173' },
        );
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/invalid or expired auth challenge/);
        expect(await getAuthState()).toBeNull();
    });

    test('derives prod allowlist from frontend base URL, including .firebaseapp.com mirror', () => {
        const web = buildAllowedExternalOrigins('https://lingogram-app.web.app');
        expect(web.has('https://lingogram-app.web.app')).toBe(true);
        expect(web.has('https://lingogram-app.firebaseapp.com')).toBe(true);

        const mirror = buildAllowedExternalOrigins('https://lingogram-app.firebaseapp.com');
        expect(mirror.has('https://lingogram-app.firebaseapp.com')).toBe(true);
        expect(mirror.has('https://lingogram-app.web.app')).toBe(true);

        const staging = buildAllowedExternalOrigins('https://staging.lingogram.example.com');
        expect([...staging]).toEqual(['https://staging.lingogram.example.com']);

        const bad = buildAllowedExternalOrigins('not-a-url');
        expect([...bad]).toEqual([]);
    });

    test('rejects unauthorized origin', async () => {
        const res = await invokeExternal(
            { type: 'lingogram-extension-auth', payload: { customToken: 'ct', uid: 'u' } },
            { origin: 'https://evil.example.com' },
        );
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/unauthorized/);
        const state = await getAuthState();
        expect(state).toBeNull();
    });

    test('rejects unknown message type', async () => {
        const res = await invokeExternal(
            { type: 'something-else' },
            { origin: 'http://localhost:5173' },
        );
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/unknown/);
    });

    test('rejects payload missing customToken', async () => {
        const res = await invokeExternal(
            { type: 'lingogram-extension-auth', payload: { uid: 'u' } },
            { origin: 'http://localhost:5173' },
        );
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/customToken/);
    });

    test('exchange failure (e.g. expired custom token) is surfaced and no state is stored', async () => {
        ((global as any).fetch as jest.Mock).mockResolvedValueOnce({
            ok: false,
            status: 400,
            statusText: 'Bad Request',
            text: () => Promise.resolve('INVALID_CUSTOM_TOKEN'),
        });
        const res = await invokeExternal(
            {
                type: 'lingogram-extension-auth',
                payload: { customToken: 'ct-bad', email: 'a@b.com', uid: 'uid-1', nonce: PENDING_NONCE },
            },
            { origin: 'http://localhost:5173' },
        );
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/Firebase REST 400/);
        expect(await getAuthState()).toBeNull();
    });

    test('nonce survives a transient exchange failure so the user can retry without re-opening the popup', async () => {
        // First attempt: exchange fails (e.g. backend rollout mid-flight,
        // CREDENTIAL_MISMATCH while infra catches up, network blip).
        ((global as any).fetch as jest.Mock).mockResolvedValueOnce({
            ok: false,
            status: 400,
            statusText: 'Bad Request',
            text: () => Promise.resolve('CREDENTIAL_MISMATCH'),
        });
        const res1 = await invokeExternal(
            {
                type: 'lingogram-extension-auth',
                payload: { customToken: 'ct-1', email: 'a@b.com', uid: 'uid-1', nonce: PENDING_NONCE },
            },
            { origin: 'http://localhost:5173' },
        );
        expect(res1.ok).toBe(false);
        // Nonce stays in storage — the legitimate URL can still be retried.
        expect((global as any).chrome.storage.session._store['auth.pendingNonce']).toBe(PENDING_NONCE);

        // Second attempt with the same nonce + customToken: exchange succeeds.
        mockSignInWithCustomToken({
            idToken: 'fresh-id', refreshToken: 'fresh-r', expiresIn: '3600', localId: 'uid-1',
        });
        const res2 = await invokeExternal(
            {
                type: 'lingogram-extension-auth',
                payload: { customToken: 'ct-1', email: 'a@b.com', uid: 'uid-1', nonce: PENDING_NONCE },
            },
            { origin: 'http://localhost:5173' },
        );
        expect(res2).toEqual({ ok: true });
        expect((await getAuthState())?.idToken).toBe('fresh-id');
        // Now (post-success) the nonce is finally cleared.
        expect((global as any).chrome.storage.session._store['auth.pendingNonce']).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// ADD_WORD analytics params
// ---------------------------------------------------------------------------

describe('ADD_WORD analytics params', () => {
    // word_save_attempt / word_saved ride the language pair and sign-in state
    // so attempt/saved rows are sliceable by the same GA4 dimensions. The pair
    // is read from storage in the handler — the web edition's context menu has
    // no langPrefs of its own to pass along.

    if (!(global as any).crypto?.randomUUID) {
        let n = 0;
        (global as any).crypto = {
            ...((global as any).crypto ?? {}),
            randomUUID: () => `uuid-${++n}`,
        };
    }

    const localStore = (global as any).chrome.storage.local._store as Record<string, unknown>;

    /** GA4 hits posted by track(), parsed down to {name, params}. */
    function ga4Events(): Array<{ name: string; params: Record<string, unknown> }> {
        return ((global as any).fetch as jest.Mock).mock.calls
            .filter((c) => String(c[0]).startsWith('https://ga4.test'))
            .map((c) => JSON.parse(c[1].body).events[0]);
    }

    const flush = () => new Promise((r) => setTimeout(r, 0));

    beforeEach(() => {
        for (const k of Object.keys(localStore)) delete localStore[k];
        const sessionStore = (global as any).chrome.storage.session._store as Record<string, unknown>;
        for (const k of Object.keys(sessionStore)) delete sessionStore[k];
        // The file-wide stub omits getManifest, which makes isEmbed() treat
        // the environment as the marketing-site shim and silence track().
        (global as any).chrome.runtime.getManifest = () => ({ version: '1.0.0' });
        // Routed mock: GA4 posts succeed; the Firestore sentinel read 404s
        // (first word ever) and the commit accepts.
        (global as any).fetch = jest.fn((url: string, init?: RequestInit) => {
            if (String(url).startsWith('https://ga4.test')) {
                return Promise.resolve({ json: () => Promise.resolve({}) });
            }
            if (init?.method === 'POST') {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve({}),
                    text: () => Promise.resolve(''),
                });
            }
            return Promise.resolve({
                ok: false,
                status: 404,
                json: () => Promise.resolve({}),
                text: () => Promise.resolve(''),
            });
        });
    });

    test('a signed-out attempt carries signed_in:false and the stored pair', async () => {
        localStore['lang.v1'] = { learning: 'en', native: 'ru' };
        await expect(
            handleAuthMessage({ action: 'ADD_WORD', term: 'hola', site: 'rezka' } as any),
        ).rejects.toThrow();
        await flush();
        const attempts = ga4Events().filter((e) => e.name === 'word_save_attempt');
        expect(attempts).toHaveLength(1);
        expect(attempts[0].params).toMatchObject({
            site: 'rezka',
            signed_in: false,
            learning: 'en',
            native: 'ru',
        });
        expect(ga4Events().filter((e) => e.name === 'word_saved')).toHaveLength(0);
    });

    test('an unconfigured pair reports empty strings, not absence', async () => {
        // sanitizeParams keeps '' — an explicit "unconfigured" bucket beats a
        // (not set) row that is indistinguishable from old-version traffic.
        await expect(
            handleAuthMessage({ action: 'ADD_WORD', term: 'hola', site: 'rezka' } as any),
        ).rejects.toThrow();
        await flush();
        const attempts = ga4Events().filter((e) => e.name === 'word_save_attempt');
        expect(attempts[0].params).toMatchObject({ learning: '', native: '' });
    });

    test('a signed-in save sends word_saved with signed_in, pair and count', async () => {
        localStore['lang.v1'] = { learning: 'en', native: 'ru' };
        localStore['auth.idToken'] = 'tok';
        localStore['auth.refreshToken'] = 'refresh';
        localStore['auth.expiresAt'] = Date.now() + 3_600_000;
        localStore['auth.email'] = 'a@b.com';
        localStore['auth.uid'] = 'uid-1';
        const res = (await handleAuthMessage({
            action: 'ADD_WORD',
            term: 'hola',
            site: 'rezka',
        } as any)) as { ok: boolean };
        expect(res.ok).toBe(true);
        await flush();
        const saved = ga4Events().filter((e) => e.name === 'word_saved');
        expect(saved).toHaveLength(1);
        expect(saved[0].params).toMatchObject({
            site: 'rezka',
            signed_in: true,
            learning: 'en',
            native: 'ru',
            saved_count: 1,
        });
    });
});
