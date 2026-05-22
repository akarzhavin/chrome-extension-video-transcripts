function makeStorageArea(): any {
    const store: Record<string, unknown> = {};
    return {
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
    };
}

function makeChromeStorage() {
    return { local: makeStorageArea(), session: makeStorageArea() };
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

import {
    config,
    signInWithPassword,
    refreshIdToken,
    exchangeCustomToken,
    addInboxWord,
    truncateBytes,
    getAuthState,
    setAuthState,
    clearAuthState,
    setPendingAuthNonce,
    consumePendingAuthNonce,
} from '@video-transcripts/shared';

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
    Object.keys((chromeStorage.session as any)._store).forEach(
        (k) => delete (chromeStorage.session as any)._store[k]
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

    test('exchangeCustomToken posts to signInWithCustomToken and maps response', async () => {
        ((global as any).fetch as jest.Mock).mockResolvedValueOnce(mockJsonResponse({
            idToken: 'id-ext', refreshToken: 'r-ext', expiresIn: '3600', localId: 'uid-ext',
        }));

        const r = await exchangeCustomToken(config, 'custom-token-xyz', 'fallback-uid');
        expect(r.idToken).toBe('id-ext');
        expect(r.refreshToken).toBe('r-ext');
        expect(r.uid).toBe('uid-ext');
        expect(r.expiresAt).toBeGreaterThan(Date.now());

        const [url, init] = ((global as any).fetch as jest.Mock).mock.calls[0];
        expect(url).toContain('/v1/accounts:signInWithCustomToken');
        expect(JSON.parse(init.body)).toEqual({
            token: 'custom-token-xyz', returnSecureToken: true,
        });
    });

    test('exchangeCustomToken falls back to provided uid when localId is missing', async () => {
        // Some emulator builds omit localId on signInWithCustomToken — the
        // caller already knows the uid from the handoff payload, so we use
        // that rather than failing the exchange.
        ((global as any).fetch as jest.Mock).mockResolvedValueOnce(mockJsonResponse({
            idToken: 'id-ext', refreshToken: 'r-ext', expiresIn: '3600',
        }));
        const r = await exchangeCustomToken(config, 'ct', 'fallback-uid');
        expect(r.uid).toBe('fallback-uid');
    });

    test('exchangeCustomToken surfaces non-OK responses as Firebase REST errors', async () => {
        ((global as any).fetch as jest.Mock).mockResolvedValueOnce({
            ok: false, status: 400, statusText: 'Bad Request',
            text: () => Promise.resolve('INVALID_CUSTOM_TOKEN'),
        });
        await expect(exchangeCustomToken(config, 'expired-ct', 'uid-1'))
            .rejects.toThrow(/Firebase REST 400/);
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

    test('consumePendingAuthNonce: matching value within TTL → true, and clears', async () => {
        await setPendingAuthNonce('abc-123');
        expect(await consumePendingAuthNonce('abc-123')).toBe(true);
        // One-shot: second consume on the same value fails because storage is empty.
        expect(await consumePendingAuthNonce('abc-123')).toBe(false);
    });

    test('consumePendingAuthNonce: mismatch → false, still clears (no replay)', async () => {
        await setPendingAuthNonce('abc-123');
        expect(await consumePendingAuthNonce('different')).toBe(false);
        // The legitimate value can no longer be redeemed — a leaked nonce
        // buys at most one mismatch attempt, never a later valid replay.
        expect(await consumePendingAuthNonce('abc-123')).toBe(false);
    });

    test('consumePendingAuthNonce: empty provided value → false even with a stored nonce', async () => {
        await setPendingAuthNonce('abc-123');
        expect(await consumePendingAuthNonce('')).toBe(false);
    });

    test('consumePendingAuthNonce: no pending nonce → false', async () => {
        expect(await consumePendingAuthNonce('anything')).toBe(false);
    });

    test('consumePendingAuthNonce: past TTL (>10 minutes) → false', async () => {
        // Seed storage directly so we can backdate the issuedAt timestamp.
        const sessionStore = (chromeStorage.session as any)._store;
        sessionStore['auth.pendingNonce'] = 'abc-123';
        sessionStore['auth.pendingNonceAt'] = Date.now() - 11 * 60 * 1000;
        expect(await consumePendingAuthNonce('abc-123')).toBe(false);
    });
});

describe('addInboxWord', () => {
    const SENTINEL_URL = 'http://localhost:8080/v1/projects/demo-lingogram/databases/(default)/documents/inbox/uid-X';
    const COMMIT_URL = 'http://localhost:8080/v1/projects/demo-lingogram/databases/(default)/documents:commit';

    function mockSentinel(dailyCount: number, dayBucket: number): any {
        return mockJsonResponse({
            name: 'projects/demo-lingogram/databases/(default)/documents/inbox/uid-X',
            fields: {
                lastAddedAt: { timestampValue: new Date(Date.now() - 60_000).toISOString() },
                dailyCount: { integerValue: String(dailyCount) },
                dayBucket: { integerValue: String(dayBucket) },
            },
            createTime: '', updateTime: '',
        }, 200);
    }

    function mockCommitOk(): any {
        return mockJsonResponse({
            writeResults: [{ updateTime: '2026-05-20T17:00:00Z' }, { updateTime: '2026-05-20T17:00:00Z', transformResults: [] }],
            commitTime: '2026-05-20T17:00:00Z',
        }, 200);
    }

    function today(): number {
        const d = new Date();
        return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
    }

    beforeEach(async () => {
        await setAuthState({
            idToken: 'tok', refreshToken: 'ref', expiresAt: Date.now() + 600_000,
            email: 'a@b.com', uid: 'uid-X',
        });
    });

    test('first ever add: 404 sentinel → :commit with dailyCount=1 and word', async () => {
        ((global as any).fetch as jest.Mock)
            .mockResolvedValueOnce(mockEmptyResponse(404)) // GET sentinel
            .mockResolvedValueOnce(mockCommitOk());        // POST :commit

        const r = await addInboxWord(config, { term: 'ephemeral', sourceUrl: 'https://rezka.ag/x' });
        expect(r.wordId).toMatch(/^[A-Za-z0-9]{20}$/);
        expect(r.documentPath).toContain(`/documents/inbox/uid-X/words/${r.wordId}`);

        const [getUrl, getInit] = ((global as any).fetch as jest.Mock).mock.calls[0];
        expect(getUrl).toBe(SENTINEL_URL);
        expect(getInit.headers['Authorization']).toBe('Bearer tok');

        const [commitUrl, commitInit] = ((global as any).fetch as jest.Mock).mock.calls[1];
        expect(commitUrl).toBe(COMMIT_URL);
        expect(commitInit.method).toBe('POST');
        expect(commitInit.headers['Authorization']).toBe('Bearer tok');

        const body = JSON.parse(commitInit.body);
        expect(body.writes).toHaveLength(2);

        const wordWrite = body.writes[0];
        expect(wordWrite.update.name).toContain('/documents/inbox/uid-X/words/');
        expect(wordWrite.currentDocument).toEqual({ exists: false });
        expect(wordWrite.update.fields.term.stringValue).toBe('ephemeral');
        expect(wordWrite.update.fields.source.stringValue).toBe('rezka-extension');
        expect(wordWrite.update.fields.sourceUrl.stringValue).toBe('https://rezka.ag/x');
        expect(wordWrite.update.fields.processed.booleanValue).toBe(false);
        // addedAt comes from a server transform — Firestore rule pins it to
        // request.time, which a client-supplied timestamp can't match.
        expect(wordWrite.update.fields.addedAt).toBeUndefined();
        expect(wordWrite.updateTransforms).toEqual([
            { fieldPath: 'addedAt', setToServerValue: 'REQUEST_TIME' },
        ]);

        const sentinelWrite = body.writes[1];
        expect(sentinelWrite.update.name).toBe('projects/demo-lingogram/databases/(default)/documents/inbox/uid-X');
        expect(sentinelWrite.update.fields.dailyCount.integerValue).toBe('1');
        expect(sentinelWrite.update.fields.dayBucket.integerValue).toBe(String(today()));
        expect(sentinelWrite.updateTransforms).toEqual([
            { fieldPath: 'lastAddedAt', setToServerValue: 'REQUEST_TIME' },
        ]);
    });

    test('same-day sentinel: dailyCount increments', async () => {
        ((global as any).fetch as jest.Mock)
            .mockResolvedValueOnce(mockSentinel(7, today()))
            .mockResolvedValueOnce(mockCommitOk());

        await addInboxWord(config, { term: 'next', sourceUrl: '' });
        const [, commitInit] = ((global as any).fetch as jest.Mock).mock.calls[1];
        const body = JSON.parse(commitInit.body);
        expect(body.writes[1].update.fields.dailyCount.integerValue).toBe('8');
        expect(body.writes[1].update.fields.dayBucket.integerValue).toBe(String(today()));
    });

    test('different-day sentinel: dailyCount resets to 1', async () => {
        ((global as any).fetch as jest.Mock)
            .mockResolvedValueOnce(mockSentinel(420, today() - 1))
            .mockResolvedValueOnce(mockCommitOk());

        await addInboxWord(config, { term: 'fresh', sourceUrl: '' });
        const [, commitInit] = ((global as any).fetch as jest.Mock).mock.calls[1];
        const body = JSON.parse(commitInit.body);
        expect(body.writes[1].update.fields.dailyCount.integerValue).toBe('1');
        expect(body.writes[1].update.fields.dayBucket.integerValue).toBe(String(today()));
    });

    test('refuses when daily cap reached', async () => {
        ((global as any).fetch as jest.Mock)
            .mockResolvedValueOnce(mockSentinel(500, today()));

        await expect(addInboxWord(config, { term: 'over', sourceUrl: '' }))
            .rejects.toThrow(/Daily limit/);
        // No :commit call — we refused client-side.
        expect(((global as any).fetch as jest.Mock).mock.calls.length).toBe(1);
    });

    test('on 401 from :commit refreshes token and retries once', async () => {
        ((global as any).fetch as jest.Mock)
            .mockResolvedValueOnce(mockEmptyResponse(404)) // GET sentinel: not found
            .mockResolvedValueOnce(mockEmptyResponse(401)) // POST :commit fails
            .mockResolvedValueOnce(mockJsonResponse({     // refresh
                id_token: 'tok-2', refresh_token: 'ref-2', expires_in: '3600', user_id: 'uid-X',
            }))
            .mockResolvedValueOnce(mockCommitOk());        // retried :commit succeeds

        await addInboxWord(config, { term: 'word', sourceUrl: '' });
        expect(((global as any).fetch as jest.Mock).mock.calls.length).toBe(4);
        const [, refreshInit] = ((global as any).fetch as jest.Mock).mock.calls[2];
        expect(refreshInit.body).toContain('grant_type=refresh_token');
        const [, retryInit] = ((global as any).fetch as jest.Mock).mock.calls[3];
        expect(retryInit.headers['Authorization']).toBe('Bearer tok-2');
        expect((await getAuthState())?.idToken).toBe('tok-2');
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
            .mockResolvedValueOnce(mockEmptyResponse(404)) // GET sentinel
            .mockResolvedValueOnce(mockCommitOk());        // POST :commit

        await addInboxWord(config, { term: 'soon', sourceUrl: '' });
        const [refreshUrl] = ((global as any).fetch as jest.Mock).mock.calls[0];
        expect(refreshUrl).toContain('/v1/token');
        const [, getSentinelInit] = ((global as any).fetch as jest.Mock).mock.calls[1];
        expect(getSentinelInit.headers['Authorization']).toBe('Bearer new');
        const [, commitInit] = ((global as any).fetch as jest.Mock).mock.calls[2];
        expect(commitInit.headers['Authorization']).toBe('Bearer new');
    });
});

describe('truncateBytes', () => {
    const utf8 = (s: string) => new TextEncoder().encode(s).length;

    test('returns input unchanged when already within limit', () => {
        expect(truncateBytes('hello', 100)).toBe('hello');
        expect(truncateBytes('hello', 5)).toBe('hello'); // exactly at boundary
    });

    test('truncates ASCII to the requested byte budget', () => {
        const out = truncateBytes('abcdefghij', 4);
        expect(out).toBe('abcd');
        expect(utf8(out)).toBe(4);
    });

    test('never splits a multi-byte UTF-8 sequence', () => {
        // Each Cyrillic char is 2 bytes; "Привет" = 12 bytes.
        // Requesting 5 bytes must yield "Пр" (4 bytes) — not "Пр\x?" garbage.
        const out = truncateBytes('Привет', 5);
        expect(out).toBe('Пр');
        expect(utf8(out)).toBeLessThanOrEqual(5);
    });

    test('preserves astral codepoints (surrogate pairs)', () => {
        // 😀 is 4 UTF-8 bytes. Budget 3 must drop it entirely, not half it.
        expect(truncateBytes('😀a', 3)).toBe('');
        expect(truncateBytes('😀a', 4)).toBe('😀');
        expect(truncateBytes('😀a', 5)).toBe('😀a');
    });

    test('returns empty string for zero budget', () => {
        expect(truncateBytes('hello', 0)).toBe('');
    });
});
