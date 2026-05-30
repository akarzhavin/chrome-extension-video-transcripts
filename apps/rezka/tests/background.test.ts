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

import { fetchWithRetry } from '../src/background/background';
import { buildAllowedExternalOrigins, getAuthState } from '@video-transcripts/shared';

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
