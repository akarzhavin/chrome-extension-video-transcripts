function makeChromeStorage() {
    const store: Record<string, unknown> = {};
    return {
        local: {
            get: jest.fn((keys: any) => {
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
        } as any,
    };
}

const chromeStorage = makeChromeStorage();
const getAuthTokenMock = jest.fn();
const clearAllCachedAuthTokensMock = jest.fn((cb: () => void) => cb());

(global as any).chrome = {
    webRequest: { onCompleted: { addListener: jest.fn() } },
    runtime: {
        onMessage: { addListener: jest.fn() },
        sendMessage: jest.fn(),
        lastError: undefined,
    },
    tabs: { get: jest.fn(), sendMessage: jest.fn() },
    storage: chromeStorage,
    identity: {
        getAuthToken: getAuthTokenMock,
        clearAllCachedAuthTokens: clearAllCachedAuthTokensMock,
    },
};

import { config } from '../src/auth/config';
import {
    exchangeGoogleAccessToken,
    signInWithPassword,
    refreshIdToken,
} from '../src/auth/firebaseRest';
import { addInboxWord } from '../src/auth/firestoreRest';
import { getAuthState, setAuthState, clearAuthState } from '../src/auth/storage';

function mockJsonResponse(body: unknown, status = 200): any {
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: String(status),
        json: async () => body,
        text: async () => JSON.stringify(body),
    };
}

function mockEmptyResponse(status: number): any {
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: String(status),
        json: async () => ({}),
        text: async () => '',
    };
}

beforeEach(() => {
    Object.keys((chromeStorage.local as any)._store).forEach(
        (k) => delete (chromeStorage.local as any)._store[k]
    );
    getAuthTokenMock.mockReset();
    (global as any).fetch = jest.fn();
});

describe('firebaseRest', () => {
    test('signInWithPassword stores token shape', async () => {
        ((global as any).fetch as jest.Mock).mockResolvedValueOnce(mockJsonResponse({
            idToken: 'id-1', refreshToken: 'r-1', expiresIn: '3600',
            localId: 'uid-1', email: 'a@b.com',
        }));

        const state = await signInWithPassword(config, 'a@b.com', 'pwd');
        expect(state.uid).toBe('uid-1');
        expect(state.email).toBe('a@b.com');
        expect(state.idToken).toBe('id-1');
        expect(state.expiresAt).toBeGreaterThan(Date.now());

        const [url, init] = ((global as any).fetch as jest.Mock).mock.calls[0];
        expect(url).toContain('/v1/accounts:signInWithPassword');
        expect(JSON.parse(init.body)).toEqual({
            email: 'a@b.com', password: 'pwd', returnSecureToken: true,
        });
    });

    test('exchangeGoogleAccessToken posts access_token via signInWithIdp', async () => {
        ((global as any).fetch as jest.Mock).mockResolvedValueOnce(mockJsonResponse({
            idToken: 'fid', refreshToken: 'fr', expiresIn: '3600',
            localId: 'guid', email: 'g@example.com',
        }));

        const state = await exchangeGoogleAccessToken(config, 'google-tok');
        expect(state.uid).toBe('guid');

        const [url, init] = ((global as any).fetch as jest.Mock).mock.calls[0];
        expect(url).toContain('/v1/accounts:signInWithIdp');
        const body = JSON.parse(init.body);
        expect(body.postBody).toContain('access_token=google-tok');
        expect(body.postBody).toContain('providerId=google.com');
        expect(body.returnSecureToken).toBe(true);
    });

    test('refreshIdToken hits secure token endpoint', async () => {
        ((global as any).fetch as jest.Mock).mockResolvedValueOnce(mockJsonResponse({
            id_token: 'new-id', refresh_token: 'new-r', expires_in: '3600',
            user_id: 'uid-2',
        }));

        const r = await refreshIdToken(config, 'r-1');
        expect(r.idToken).toBe('new-id');
        expect(r.refreshToken).toBe('new-r');
        expect(r.uid).toBe('uid-2');

        const [url, init] = ((global as any).fetch as jest.Mock).mock.calls[0];
        expect(url).toContain('/v1/token');
        expect(init.body).toContain('grant_type=refresh_token');
        expect(init.body).toContain('refresh_token=r-1');
    });
});

describe('storage', () => {
    test('round-trips and clears auth state', async () => {
        expect(await getAuthState()).toBeNull();
        await setAuthState({
            idToken: 'i', refreshToken: 'r', expiresAt: 100, email: 'a@b', uid: 'u',
        });
        const got = await getAuthState();
        expect(got?.uid).toBe('u');
        await clearAuthState();
        expect(await getAuthState()).toBeNull();
    });
});

describe('addInboxWord', () => {
    beforeEach(async () => {
        await setAuthState({
            idToken: 'tok', refreshToken: 'ref', expiresAt: Date.now() + 600_000,
            email: 'a@b.com', uid: 'uid-X',
        });
    });

    test('POSTs Firestore REST shape with Bearer auth', async () => {
        ((global as any).fetch as jest.Mock).mockResolvedValueOnce(mockJsonResponse({
            name: 'projects/demo-lingogram/databases/(default)/documents/inbox/uid-X/words/wid-1',
            fields: {}, createTime: '', updateTime: '',
        }, 200));

        const r = await addInboxWord(config, { term: 'ephemeral', sourceUrl: 'https://rezka.ag/x' });
        expect(r.wordId).toBe('wid-1');

        const [url, init] = ((global as any).fetch as jest.Mock).mock.calls[0];
        expect(url).toBe('http://localhost:8080/v1/projects/demo-lingogram/databases/(default)/documents/inbox/uid-X/words');
        expect(init.method).toBe('POST');
        expect(init.headers['Authorization']).toBe('Bearer tok');
        const body = JSON.parse(init.body);
        expect(body.fields.term.stringValue).toBe('ephemeral');
        expect(body.fields.source.stringValue).toBe('rezka-extension');
        expect(body.fields.sourceUrl.stringValue).toBe('https://rezka.ag/x');
        expect(body.fields.processed.booleanValue).toBe(false);
        expect(typeof body.fields.addedAt.timestampValue).toBe('string');
    });

    test('on 401 refreshes token and retries once', async () => {
        ((global as any).fetch as jest.Mock)
            .mockResolvedValueOnce(mockEmptyResponse(401))
            .mockResolvedValueOnce(mockJsonResponse({
                id_token: 'tok-2', refresh_token: 'ref-2', expires_in: '3600', user_id: 'uid-X',
            }))
            .mockResolvedValueOnce(mockJsonResponse({
                name: 'projects/demo-lingogram/databases/(default)/documents/inbox/uid-X/words/wid-2',
                fields: {}, createTime: '', updateTime: '',
            }));

        const r = await addInboxWord(config, { term: 'word', sourceUrl: '' });
        expect(r.wordId).toBe('wid-2');
        expect(((global as any).fetch as jest.Mock).mock.calls.length).toBe(3);
        const [, secondInit] = ((global as any).fetch as jest.Mock).mock.calls[1];
        expect(secondInit.body).toContain('grant_type=refresh_token');
        const [, retryInit] = ((global as any).fetch as jest.Mock).mock.calls[2];
        expect(retryInit.headers['Authorization']).toBe('Bearer tok-2');
        const got = await getAuthState();
        expect(got?.idToken).toBe('tok-2');
    });

    test('throws when not signed in', async () => {
        await clearAuthState();
        await expect(addInboxWord(config, { term: 'x', sourceUrl: '' }))
            .rejects.toThrow(/Not signed in/);
    });

    test('refreshes proactively when token near expiry', async () => {
        await setAuthState({
            idToken: 'old', refreshToken: 'r-old', expiresAt: Date.now() + 1000,
            email: 'a@b', uid: 'uid-X',
        });
        ((global as any).fetch as jest.Mock)
            .mockResolvedValueOnce(mockJsonResponse({
                id_token: 'new', refresh_token: 'r-new', expires_in: '3600', user_id: 'uid-X',
            }))
            .mockResolvedValueOnce(mockJsonResponse({
                name: 'projects/demo-lingogram/databases/(default)/documents/inbox/uid-X/words/wid-3',
                fields: {}, createTime: '', updateTime: '',
            }));

        await addInboxWord(config, { term: 'soon', sourceUrl: '' });
        const [firstUrl] = ((global as any).fetch as jest.Mock).mock.calls[0];
        expect(firstUrl).toContain('/v1/token');
        const [, secondInit] = ((global as any).fetch as jest.Mock).mock.calls[1];
        expect(secondInit.headers['Authorization']).toBe('Bearer new');
    });
});
