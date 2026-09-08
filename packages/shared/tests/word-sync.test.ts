/**
 * @jest-environment jsdom
 *
 * The delta sync: changes made elsewhere arriving here.
 *
 * Without it the heart answers "did I save this from this browser" rather than
 * "is this in my dictionary" — a smaller lie than the one the mirror already
 * fixed, and one that self-corrects, which is why US3 ranks below the first
 * two stories.
 *
 * Assertions come from the mirror's contents and from the query the test
 * captures off the wire — never from prose about either. The message shape is
 * contracts/messages.md's, the scenarios are spec.md's US3 1-6.
 */

const store: Record<string, unknown> = {};
const listeners: Array<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void> = [];

(global as any).chrome = {
    storage: {
        local: {
            get: jest.fn((keys: any) => {
                const arr = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
                const out: Record<string, unknown> = {};
                for (const k of arr) if (k in store) out[k] = store[k];
                return Promise.resolve(out);
            }),
            set: jest.fn((items: Record<string, unknown>) => {
                const changes: Record<string, chrome.storage.StorageChange> = {};
                for (const [k, v] of Object.entries(items)) {
                    changes[k] = { oldValue: store[k], newValue: v };
                    store[k] = v;
                }
                listeners.forEach((l) => l(changes, 'local'));
                return Promise.resolve();
            }),
            remove: jest.fn((keys: any) => {
                const arr = typeof keys === 'string' ? [keys] : keys;
                for (const k of arr) delete store[k];
                return Promise.resolve();
            }),
        },
        session: { get: jest.fn(async () => ({})), set: jest.fn(async () => {}) },
        onChanged: {
            addListener: jest.fn((l: any) => { listeners.push(l); }),
            removeListener: jest.fn(),
        },
    },
    runtime: {
        id: 'test-extension-id',
        getManifest: () => ({ version: '0.0.0' }),
        sendMessage: jest.fn(),
        lastError: undefined,
    },
    i18n: { getMessage: () => '' },
    action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn() },
};

import { __resetSyncStateForTests, handleAuthMessage } from '../src/auth/background';
import { MIRROR_KEY, loadMirror, setMirrorEntry } from '../src/word-mirror';
import { wordKey } from '../src/word-key';
import type { AuthConfig } from '../src/auth/config';

const cfg = {
    projectId: 'demo-lingogram',
    firestoreUrl: 'https://firestore.test',
    apiKey: 'k',
    frontendBaseUrl: 'http://localhost:5173',
    apiBaseUrl: 'https://api.test',
    source: 'youtube-extension',
} as AuthConfig;

/** Every runQuery body the sync sent, parsed back off the wire. */
let queries: Array<Record<string, any>>;
/** Documents the fake store answers with. */
let documents: Array<{ term: string; state: string; updatedAt: number }>;
let queryStatus: number;

function signedIn(): void {
    store['auth.idToken'] = 'token';
    store['auth.refreshToken'] = 'refresh';
    store['auth.expiresAt'] = Date.now() + 3_600_000;
    store['auth.email'] = 'someone@example.com';
    store['auth.uid'] = 'uid-1';
}

/** A Firestore runQuery answer: one row per document, in wire shape. */
const asRows = (docs: typeof documents): unknown[] =>
    docs.map((d) => ({
        document: {
            name: `projects/${cfg.projectId}/databases/(default)/documents/inbox/uid-1/words/${wordKey(d.term)}`,
            fields: {
                term: { stringValue: d.term },
                state: { stringValue: d.state },
                updatedAt: { timestampValue: new Date(d.updatedAt).toISOString() },
            },
        },
    }));

beforeEach(() => {
    // The coalescing state lives in module scope, as it must — it is what makes
    // three triggers cost one read. Left alone between tests it would make the
    // second test in this file skip its own sync and read as a failure of the
    // behaviour rather than of the fixture.
    __resetSyncStateForTests();
    Object.keys(store).forEach((k) => delete store[k]);
    listeners.length = 0;
    signedIn();
    queries = [];
    documents = [];
    queryStatus = 200;
    (global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes(':runQuery')) {
            queries.push(JSON.parse(String(init?.body ?? '{}')));
            return {
                ok: queryStatus === 200,
                status: queryStatus,
                json: async () => asRows(documents),
                text: async () => '',
            } as any;
        }
        return { ok: true, status: 200, json: async () => ({}), text: async () => '' } as any;
    });
});

const sync = (reason = 'wake') => handleAuthMessage({ action: 'SYNC_WORDS', reason }, cfg);

describe('a sync that finds nothing', () => {
    test('writes nothing to storage and advances no cursor', async () => {
        // Scenario 3: one read, no local write. The mirror object must not be
        // rewritten with an identical copy either — a write wakes every
        // subscriber in every open tab.
        await setMirrorEntry('going', 'active');
        const before = JSON.stringify(store[MIRROR_KEY]);
        (chrome.storage.local.set as jest.Mock).mockClear();

        const res = await sync();

        expect(res).toMatchObject({ ok: true, applied: 0 });
        expect(JSON.stringify(store[MIRROR_KEY])).toBe(before);
        expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });
});

describe('changes arriving from the store', () => {
    test('a removal made elsewhere empties the heart here', async () => {
        // Scenario 1, and the half that is easy to skip: a sync that only
        // applied additions would leave a removed word looking saved forever.
        await setMirrorEntry('going', 'active');
        documents = [{ term: 'going', state: 'removed', updatedAt: 1_700_000_000_500 }];

        await sync();

        expect((await loadMirror()).words.going).toBe('removed');
    });

    test('the cursor advances to the largest updatedAt applied', async () => {
        documents = [
            { term: 'alpha', state: 'active', updatedAt: 1_700_000_000_100 },
            { term: 'beta', state: 'active', updatedAt: 1_700_000_000_900 },
        ];
        await sync();
        expect((await loadMirror()).cursor).toBe(1_700_000_000_900);
    });
});

describe('the query the sync sends', () => {
    test('a first sync lists everything and says so', async () => {
        // Scenario 4: cursor 0 means "never synced", which is also the recovery
        // path after the mirror is lost.
        const res = await sync();
        expect(res).toMatchObject({ full: true });
        expect(queries).toHaveLength(1);
        // No FILTER — `updatedAt` still appears in the ordering, which is not
        // the same thing and must not be confused with it: the first sync asks
        // for everything, in order, rather than for a window.
        expect(queries[0].structuredQuery.where).toBeUndefined();
    });

    test('a later sync asks only for what changed, less a 60-second overlap', async () => {
        // The overlap is what stops a document committed while a query was in
        // flight from being missed: re-applying one is idempotent, missing one
        // is permanent.
        documents = [{ term: 'alpha', state: 'active', updatedAt: 1_700_000_000_000 }];
        await sync();

        queries.length = 0;
        documents = [];
        // The cooldown is real behaviour, not a fixture detail: a second sync
        // within two seconds is deliberately skipped. Clearing it here isolates
        // the assertion about the QUERY from the one about coalescing, which
        // has its own tests below.
        __resetSyncStateForTests();
        await sync();

        expect(queries).toHaveLength(1);
        const body = JSON.stringify(queries[0]);
        expect(body).toContain('updatedAt');
        // 1_700_000_000_000 - 60_000, as a timestamp — never Date.now().
        expect(body).toContain(new Date(1_700_000_000_000 - 60_000).toISOString());
    });
});

describe('a sync that fails', () => {
    test('leaves the mirror untouched and surfaces nothing', async () => {
        // Scenario 5. The caller is a background trigger with nobody to tell,
        // and the mirror still answers from what it has.
        await setMirrorEntry('going', 'active');
        queryStatus = 500;

        const res = await sync();

        expect(res).toMatchObject({ ok: false });
        expect((await loadMirror()).words.going).toBe('active');
    });
});

describe('a sync refused by the rules', () => {
    // The refusal a preprod run is most likely to meet, and the one 500 does
    // NOT stand in for: `read`+`list` on inbox/{uid}/words is a right the rules
    // grant explicitly, so a rules regression answers 403, not 500.
    //
    // The distinction that matters is what the worker does NEXT. "Firestore
    // commit 403" is one of the strings isAuthFailure matches — a sync that let
    // its refusal reach that classifier would sign the learner out because a
    // background trigger they never invoked was denied a read. The sync is not
    // an act the learner performed and has no standing to end their session.
    //
    // Asserted on the session and the mirror rather than on the message: the
    // wording of an error is not a contract, staying signed in is.
    test('a 403 leaves the session alone — a background read cannot sign anyone out', async () => {
        await setMirrorEntry('going', 'active');
        queryStatus = 403;

        const res = await sync();

        expect(res).toMatchObject({ ok: false });
        // Still signed in: the tokens are exactly where they were.
        expect(store['auth.idToken']).toBe('token');
        expect(store['auth.uid']).toBe('uid-1');
        expect((await loadMirror()).words.going).toBe('active');
    });

    test('and the cursor does not advance past a refusal', async () => {
        // A cursor moved on a failed read would skip whatever changed in that
        // window permanently — the one sync error that does not self-correct.
        documents = [{ term: 'alpha', state: 'active', updatedAt: 1_700_000_000_100 }];
        await sync();
        const cursorBefore = (await loadMirror()).cursor;

        __resetSyncStateForTests();
        queryStatus = 403;
        await sync();

        expect((await loadMirror()).cursor).toBe(cursorBefore);
    });
});

describe('a local change the sync must not undo', () => {
    // Scenario 6, and T039's own red. The mirror holds no per-word timestamp,
    // so it cannot tell whether an arriving document is newer than a change the
    // learner just made. The worker keeps that ordering: a save stamps its term
    // with a counter, a sync records the counter when it ISSUES its query, and
    // it skips any term stamped later.
    test('a save made after the query was issued is not reverted by it', async () => {
        await setMirrorEntry('going', 'removed');
        // The store still holds the pre-removal state and will answer with it.
        documents = [{ term: 'going', state: 'active', updatedAt: 1_700_000_000_000 }];

        // The local write lands while the query is in flight, and it goes
        // through the WORKER — `setMirrorEntry` alone would bypass the stamp
        // and test nothing but the mirror module.
        const inFlight = sync();
        await handleAuthMessage({ action: 'REMOVE_WORD', term: 'going', site: 'youtube' }, cfg);
        await inFlight;

        expect((await loadMirror()).words.going).toBe('removed');
    });
});

describe('coalescing', () => {
    test('a sync already running is joined, not queued', async () => {
        documents = [{ term: 'alpha', state: 'active', updatedAt: 1_700_000_000_000 }];
        await Promise.all([sync('wake'), sync('page'), sync('focus')]);
        expect(queries).toHaveLength(1);
    });

    test('a sync that just finished is skipped', async () => {
        await sync('wake');
        queries.length = 0;
        await sync('page');
        expect(queries).toHaveLength(0);
    });
});
