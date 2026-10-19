/**
 * @jest-environment jsdom
 *
 * Signing in fills the word mirror at once.
 *
 * The mirror is what the popup counts and the page highlight paints. Before
 * this, a fresh sign-in left it empty until some page happened to wake a sync:
 * a learner with 67 words signed in from the welcome page and the popup said
 * "0 words saved".
 */

const local: Record<string, unknown> = {};
const session: Record<string, unknown> = {};
let externalListener: ((m: any, s: any, r: (x: unknown) => void) => boolean | void) | null = null;

const area = (store: Record<string, unknown>) => ({
    get: jest.fn(async (keys: any) => {
        const arr = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys ?? {});
        const out: Record<string, unknown> = {};
        for (const k of arr) if (k in store) out[k] = store[k];
        return out;
    }),
    set: jest.fn(async (items: Record<string, unknown>) => {
        Object.assign(store, JSON.parse(JSON.stringify(items)));
    }),
    remove: jest.fn(async (keys: any) => {
        for (const k of typeof keys === 'string' ? [keys] : keys) delete store[k];
    }),
});

(global as any).chrome = {
    storage: { local: area(local), session: area(session), onChanged: { addListener: jest.fn(), removeListener: jest.fn() } },
    runtime: {
        id: 'ext',
        getManifest: () => ({ version: '0.0.0' }),
        sendMessage: jest.fn(),
        lastError: undefined,
        onMessageExternal: { addListener: (l: any) => (externalListener = l) },
    },
    i18n: { getMessage: () => '' },
    action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn() },
};

const listInboxWords = jest.fn();
jest.mock('../src/auth/firestoreRest', () => ({
    ...jest.requireActual('../src/auth/firestoreRest'),
    listInboxWords: (...a: unknown[]) => listInboxWords(...a),
}));
jest.mock('../src/auth/firebaseRest', () => ({
    exchangeCustomToken: jest.fn(async () => ({ idToken: 'id', refreshToken: 'refresh', expiresAt: Date.now() + 3_600_000, uid: 'u1' })),
}));
jest.mock('../src/analytics-bg', () => ({ track: jest.fn(async () => {}), handleTrackMessage: jest.fn() }));

import { __resetSyncStateForTests, installExternalAuthHandoff } from '../src/auth/background';
import { setPendingAuthNonce } from '../src/auth/storage';
import { config } from '../src/auth/config';
import { refreshFeatures } from '../src/features/worker';
import { loadMirror } from '../src/word-mirror';

const until = async (cond: () => Promise<boolean>) => {
    for (let i = 0; i < 50; i++) {
        if (await cond()) return;
        await new Promise((r) => setTimeout(r, 10));
    }
};

beforeEach(() => {
    __resetSyncStateForTests();
    for (const k of Object.keys(local)) delete local[k];
    for (const k of Object.keys(session)) delete session[k];
    listInboxWords.mockReset();
});

test('a successful sign-in pulls the dictionary into the mirror', async () => {
    listInboxWords.mockResolvedValue([
        { key: 'k1', term: 'dawn', state: 'active', updatedAt: 1 },
        { key: 'k2', term: 'courage', state: 'active', updatedAt: 2 },
        { key: 'k3', term: 'afraid', state: 'removed', updatedAt: 3 },
    ]);
    installExternalAuthHandoff();
    await setPendingAuthNonce('n1');

    const reply = await new Promise((resolve) =>
        externalListener!(
            { type: 'lingogram-extension-auth', payload: { customToken: 't', uid: 'u1', email: 'a@b.c', nonce: 'n1' } },
            { origin: 'http://localhost:5173' },
            resolve,
        ),
    );
    expect(reply).toEqual({ ok: true });

    await until(async () => Object.keys((await loadMirror()).words).length === 3);
    expect((await loadMirror()).words).toEqual({ dawn: 'active', courage: 'active', afraid: 'removed' });
});

test('a refused sign-in does not ask the server for anything', async () => {
    installExternalAuthHandoff();
    await setPendingAuthNonce('n1');

    const reply = await new Promise((resolve) =>
        externalListener!(
            { type: 'lingogram-extension-auth', payload: { customToken: 't', uid: 'u1', email: 'a@b.c', nonce: 'wrong' } },
            { origin: 'http://localhost:5173' },
            resolve,
        ),
    );
    expect(reply).toMatchObject({ ok: false });
    await new Promise((r) => setTimeout(r, 50));
    expect(listInboxWords).not.toHaveBeenCalled();
});

test("a successful sign-in asks the new account's features (spec 032)", async () => {
    listInboxWords.mockResolvedValue([]);
    const fetchMock = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ features: { 'subtitles.second_track': true } }) }));
    (global as any).fetch = fetchMock;
    try {
        installExternalAuthHandoff();
        await setPendingAuthNonce('n1');
        await new Promise((resolve) =>
            externalListener!(
                { type: 'lingogram-extension-auth', payload: { customToken: 't', uid: 'u1', email: 'a@b.c', nonce: 'n1' } },
                { origin: 'http://localhost:5173' },
                resolve,
            ),
        );
        await until(async () => 'features' in local);
        expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/dictionary\/features$/), expect.objectContaining({ method: 'GET' }));
        expect((local.features as { features: unknown }).features).toEqual({ 'subtitles.second_track': true });
    } finally {
        delete (global as any).fetch;
    }
});

test("signing in as another account keeps nothing of the previous one's features or AI balance", async () => {
    listInboxWords.mockResolvedValue([]);
    // A is signed in, with a balance kept and a features ask still in flight.
    Object.assign(local, {
        'auth.idToken': 'idA',
        'auth.refreshToken': 'refreshA',
        'auth.expiresAt': Date.now() + 3_600_000,
        'auth.email': 'a@a.a',
        'auth.uid': 'uA',
        'ai.balance': { day: { used: 1, limit: 2, resetsAt: 3 }, month: { used: 1, limit: 2, resetsAt: 3 } },
    });
    let answerA!: (r: unknown) => void;
    const forA = new Promise((r) => (answerA = r));
    const fetchMock = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ features: { 'subtitles.second_track': false } }) }));
    (global as any).fetch = fetchMock;
    try {
        const askedForA = refreshFeatures(config.apiBaseUrl, {
            fetch: () => forA as Promise<Response>,
            token: async () => ({ idToken: 'idA' }),
        });

        installExternalAuthHandoff();
        await setPendingAuthNonce('n1');
        const reply = await new Promise((resolve) =>
            externalListener!(
                { type: 'lingogram-extension-auth', payload: { customToken: 't', uid: 'u1', email: 'b@b.b', nonce: 'n1' } },
                { origin: 'http://localhost:5173' },
                resolve,
            ),
        );
        expect(reply).toEqual({ ok: true });
        answerA({ ok: true, status: 200, json: async () => ({ features: { 'subtitles.second_track': true } }) });
        await askedForA;

        await until(async () => fetchMock.mock.calls.length > 0 && 'features' in local);
        expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/dictionary\/features$/), expect.anything());
        expect((local.features as { features: unknown }).features).toEqual({ 'subtitles.second_track': false });
        expect(local['ai.balance']).toBeUndefined();
    } finally {
        delete (global as any).fetch;
    }
});
