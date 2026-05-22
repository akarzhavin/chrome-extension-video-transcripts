function makeChromeStorage(): { local: chrome.storage.LocalStorageArea } {
    const store: Record<string, unknown> = {};
    const local: any = {
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
    return { local };
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
    beforeEach(() => {
        const store = ((global as any).chrome.storage.local as any)._store;
        Object.keys(store).forEach((k) => delete store[k]);
        (global as any).fetch = jest.fn();
        ((global as any).chrome.action.setBadgeText as jest.Mock).mockClear();
    });

    test('accepts a well-formed customToken from localhost:5173, exchanges, stores tokens', async () => {
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
                },
            },
            { origin: 'http://localhost:5173', url: 'http://localhost:5173/extension-auth?ext=foo' },
        );
        expect(res).toEqual({ ok: true });
        const state = await getAuthState();
        expect(state?.uid).toBe('uid-1');
        expect(state?.idToken).toBe('fresh-id-token');
        expect(state?.refreshToken).toBe('fresh-refresh-token');
        expect(state?.email).toBe('a@b.com');
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
                payload: { customToken: 'ct-bad', email: 'a@b.com', uid: 'uid-1' },
            },
            { origin: 'http://localhost:5173' },
        );
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/Firebase REST 400/);
        expect(await getAuthState()).toBeNull();
    });
});
