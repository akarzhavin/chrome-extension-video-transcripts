/**
 * @jest-environment jsdom
 *
 * Saving without an account, end to end through the worker's handler
 * (auth/background.ts): words are kept in the browser, the mirror says so, and
 * they move into the account after sign-in, one at a time, within its limits.
 * Only the network (firestoreRest) and analytics are fake.
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
        for (const [k, v] of Object.entries(items)) store[k] = JSON.parse(JSON.stringify(v));
    }),
    remove: jest.fn(async (keys: any) => {
        for (const k of typeof keys === 'string' ? [keys] : keys) delete store[k];
    }),
});

const setBadgeText = jest.fn();
const messageListeners: Array<(...a: any[]) => any> = [];

(global as any).chrome = {
    storage: { local: area(local), session: area(session), onChanged: { addListener: jest.fn(), removeListener: jest.fn() } },
    runtime: {
        id: 'ext',
        getManifest: () => ({ version: '0.0.0' }),
        sendMessage: jest.fn(),
        lastError: undefined,
        onMessage: { addListener: (l: any) => messageListeners.push(l) },
        onMessageExternal: { addListener: (l: any) => (externalListener = l) },
    },
    i18n: { getMessage: () => '' },
    action: { setBadgeText, setBadgeBackgroundColor: jest.fn() },
    tabs: { create: jest.fn() },
};

const addInboxWord = jest.fn();
const removeInboxWord = jest.fn();
const listInboxWords = jest.fn();
jest.mock('../src/auth/firestoreRest', () => ({
    addInboxWord: (...a: unknown[]) => addInboxWord(...a),
    removeInboxWord: (...a: unknown[]) => removeInboxWord(...a),
    listInboxWords: (...a: unknown[]) => listInboxWords(...a),
    addFeedback: jest.fn(),
    addNoSubsReport: jest.fn(),
}));
jest.mock('../src/auth/firebaseRest', () => ({
    exchangeCustomToken: jest.fn(async () => ({ idToken: 'id', refreshToken: 'refresh', expiresAt: Date.now() + 3_600_000, uid: 'u1' })),
}));
const track = jest.fn(async (..._a: unknown[]) => {});
jest.mock('../src/analytics-bg', () => ({
    track: (...a: unknown[]) => track(...a),
    handleTrackMessage: jest.fn(async () => ({ ok: true })),
}));

import {
    __resetSyncStateForTests,
    __resetUploadStateForTests,
    handleAuthMessage,
    installAuthBackground,
    installExternalAuthHandoff,
    isAuthAction,
    syncWords,
    uploadLocalWords,
} from '../src/auth/background';
import { setAuthState, setPendingAuthNonce } from '../src/auth/storage';
import { loadMirror } from '../src/word-mirror';

const KEY = 'localWords.v1';
const localWords = () => ((local[KEY] as { words: Record<string, any> } | undefined)?.words ?? {});
const seed = (...rows: Array<[string, number, string?]>) => {
    const words: Record<string, unknown> = {};
    for (const [term, addedAt, context] of rows) words[term] = { term, context: context ?? '', site: 'web', addedAt };
    local[KEY] = { words };
};
const signIn = () =>
    setAuthState({ idToken: 'id', refreshToken: 'refresh', expiresAt: Date.now() + 3_600_000, email: 'a@b.c', uid: 'u1' });
const add = (term: string, extra: Record<string, unknown> = {}) =>
    handleAuthMessage({ action: 'ADD_WORD', term, context: 'ctx', site: 'youtube', ...extra });
const rules403 = () => new Error('Firestore rules 403: {"error":{"status":"PERMISSION_DENIED"}}');

const until = async (cond: () => boolean | Promise<boolean>) => {
    for (let i = 0; i < 100; i++) {
        if (await cond()) return;
        await new Promise((r) => setTimeout(r, 5));
    }
};

beforeEach(() => {
    jest.useRealTimers();
    __resetSyncStateForTests();
    __resetUploadStateForTests();
    for (const k of Object.keys(local)) delete local[k];
    for (const k of Object.keys(session)) delete session[k];
    addInboxWord.mockReset();
    addInboxWord.mockResolvedValue({ wordId: 'w' });
    removeInboxWord.mockReset();
    removeInboxWord.mockResolvedValue({ state: 'removed' });
    listInboxWords.mockReset();
    listInboxWords.mockResolvedValue([]);
    track.mockClear();
    setBadgeText.mockClear();
});

describe('saving signed out', () => {
    test('the word is kept in the browser, the mirror marks it, and the reply says so', async () => {
        const r = await add('Dawn');
        expect(r).toEqual({ ok: true, local: true, inboxCount: 1, promptRate: false });
        expect(localWords().dawn).toMatchObject({ term: 'Dawn', context: 'ctx', site: 'youtube' });
        expect((await loadMirror()).words).toEqual({ dawn: 'active' });
        expect(addInboxWord).not.toHaveBeenCalled();
    });

    test('a term over the account\'s byte limit is refused like the account refuses it, and stored nowhere', async () => {
        // 130 two-byte characters: well inside the UI's 256-character cap, over 256 bytes.
        const wide = 'é'.repeat(130);
        await expect(add(wide)).rejects.toThrow('term must be 1..256 bytes (UTF-8)');
        expect(localWords()).toEqual({});
        expect((await loadMirror()).words).toEqual({});
        expect(track.mock.calls.find((c) => c[0] === 'word_saved')).toBeUndefined();
    });

    test('analytics: the attempt and the success are both reported, flagged signed out, never with the word', async () => {
        await add('Dawn');
        const calls = track.mock.calls;
        expect(calls.find((c) => c[0] === 'word_save_attempt')?.[1]).toMatchObject({ site: 'youtube', signed_in: false });
        expect(calls.find((c) => c[0] === 'word_saved')?.[1]).toEqual({
            site: 'youtube',
            saved_count: 1,
            signed_in: false,
            learning: '',
            native: '',
        });
        expect(JSON.stringify(calls)).not.toContain('Dawn');
    });

    test('a silent save (context menu) does not spend the rating prompt, a normal one past the threshold does', async () => {
        for (const t of ['a', 'b', 'c', 'd']) await add(t, { silent: true });
        const silent = (await add('e', { silent: true })) as { promptRate: boolean };
        expect(silent.promptRate).toBe(false);
        const loud = (await add('f')) as { promptRate: boolean };
        expect(loud.promptRate).toBe(true);
    });

    test('removing a word drops it from the browser and marks the mirror removed; nothing is sent to an account', async () => {
        await add('Dawn');
        const r = await handleAuthMessage({ action: 'REMOVE_WORD', term: 'dawn', site: 'youtube' });
        expect(r).toEqual({ ok: true, local: true, state: 'removed', inboxCount: 0 });
        expect(localWords()).toEqual({});
        expect((await loadMirror()).words).toEqual({ dawn: 'removed' });
        expect(removeInboxWord).not.toHaveBeenCalled();
    });
});

describe('saving when the session is dead', () => {
    test('an auth failure clears the session, raises the badge, and keeps the word locally', async () => {
        await signIn();
        local['words.v1'] = { v: 1, words: { account: 'active' }, cursor: 5 };
        addInboxWord.mockRejectedValue(new Error('Firebase REST 401: TOKEN_EXPIRED'));

        const r = await add('Dawn');

        expect(r).toMatchObject({ ok: true, local: true, inboxCount: 1 });
        expect(local['auth.uid']).toBeUndefined();
        expect(setBadgeText).toHaveBeenCalledWith({ text: '!' });
        expect(local['auth.needsReauth']).toBe(true);
        expect(localWords().dawn).toMatchObject({ term: 'Dawn' });
        // Exactly the local words: the account's word is gone, the new one is there.
        expect((await loadMirror()).words).toEqual({ dawn: 'active' });
    });

    test('a refusal by the rules is not a dead session: it still throws, keeps the session, stores nothing', async () => {
        await signIn();
        addInboxWord.mockRejectedValue(rules403());
        await expect(add('Dawn')).rejects.toThrow('Firestore rules 403');
        expect(local['auth.uid']).toBe('u1');
        expect(setBadgeText).not.toHaveBeenCalled();
        expect(localWords()).toEqual({});
    });

    test('the daily cap is not a dead session either', async () => {
        await signIn();
        addInboxWord.mockRejectedValue(new Error('Daily limit of 500 words reached. Try again tomorrow.'));
        await expect(add('Dawn')).rejects.toThrow('Daily limit');
        expect(local['auth.uid']).toBe('u1');
        expect(localWords()).toEqual({});
    });

    test('a failed removal still ends the session on an auth failure and keeps local words in the mirror', async () => {
        seed(['pending', 1]);
        await signIn();
        removeInboxWord.mockRejectedValue(new Error('Firebase REST 401: TOKEN_EXPIRED'));
        await expect(handleAuthMessage({ action: 'REMOVE_WORD', term: 'x' })).rejects.toThrow('TOKEN_EXPIRED');
        expect(local['auth.uid']).toBeUndefined();
        expect((await loadMirror()).words).toEqual({ pending: 'active' });
    });
});

describe('removing while signed in', () => {
    test('also drops a copy still waiting in the browser, so it cannot upload later', async () => {
        await signIn();
        seed(['dawn', 1], ['other', 2]);
        await handleAuthMessage({ action: 'REMOVE_WORD', term: 'Dawn', site: 'youtube' });
        expect(removeInboxWord).toHaveBeenCalledTimes(1);
        expect(Object.keys(localWords())).toEqual(['other']);
    });

    test('a failed account removal leaves the local copy alone', async () => {
        await signIn();
        seed(['dawn', 1]);
        removeInboxWord.mockRejectedValue(new Error('Firestore commit 500: down'));
        await expect(handleAuthMessage({ action: 'REMOVE_WORD', term: 'dawn' })).rejects.toThrow('500');
        expect(Object.keys(localWords())).toEqual(['dawn']);
    });
});

describe('AUTH_STATUS', () => {
    test('signed out: carries the local count and the reauth flag', async () => {
        await add('a');
        await add('b');
        expect(await handleAuthMessage({ action: 'AUTH_STATUS' })).toEqual({
            signedIn: false,
            inboxCount: 2,
            localCount: 2,
            needsReauth: false,
        });
    });

    test('signed in: same two fields beside the account ones', async () => {
        await signIn();
        seed(['a', 1]);
        local['auth.needsReauth'] = true;
        expect(await handleAuthMessage({ action: 'AUTH_STATUS' })).toEqual({
            signedIn: true,
            email: 'a@b.c',
            uid: 'u1',
            inboxCount: 0,
            localCount: 1,
            needsReauth: true,
        });
    });

    test('a dead session leaves needsReauth set, and an explicit sign-out clears it', async () => {
        await signIn();
        addInboxWord.mockRejectedValue(new Error('Firebase REST 401: TOKEN_EXPIRED'));
        await add('Dawn');
        expect(await handleAuthMessage({ action: 'AUTH_STATUS' })).toMatchObject({ needsReauth: true, localCount: 1 });
        await handleAuthMessage({ action: 'AUTH_SIGN_OUT' });
        expect(await handleAuthMessage({ action: 'AUTH_STATUS' })).toMatchObject({ needsReauth: false, localCount: 1 });
    });
});

describe('the mirror around sign-out and sync', () => {
    test('sign-out leaves exactly the local words, active, and removes the account ones', async () => {
        await signIn();
        local['words.v1'] = { v: 1, words: { account: 'active', gone: 'removed' }, cursor: 7 };
        seed(['pending', 1]);
        await handleAuthMessage({ action: 'AUTH_SIGN_OUT' });
        expect(local['auth.uid']).toBeUndefined();
        expect(await loadMirror()).toEqual({ v: 1, words: { pending: 'active' }, cursor: 0 });
        expect(Object.keys(localWords())).toEqual(['pending']);
    });

    test('a sync that does not know a waiting word, or knows it as removed, leaves it active', async () => {
        await signIn();
        seed(['waiting', 1], ['unknown-to-account', 2]);
        listInboxWords.mockResolvedValue([
            { key: 'k', term: 'waiting', state: 'removed', updatedAt: 10 },
            { key: 'k2', term: 'account', state: 'active', updatedAt: 11 },
        ]);
        await syncWords({ force: true });
        expect((await loadMirror()).words).toEqual({
            waiting: 'active',
            'unknown-to-account': 'active',
            account: 'active',
        });
    });

    test('worker start signed out rebuilds the mirror from the local words', async () => {
        seed(['kept', 1]);
        local['words.v1'] = { v: 1, words: { stale: 'active' }, cursor: 3 };
        // As the real call does with no session.
        listInboxWords.mockRejectedValue(new Error('Not signed in'));
        installAuthBackground();
        await until(async () => !('stale' in (await loadMirror()).words));
        expect((await loadMirror()).words).toEqual({ kept: 'active' });
    });
});

describe('the two worker messages', () => {
    test('LOCAL_WORDS_LIST answers newest first', async () => {
        seed(['old', 1000], ['new', 3000], ['mid', 2000]);
        const r = (await handleAuthMessage({ action: 'LOCAL_WORDS_LIST' })) as { ok: boolean; words: Array<{ term: string }> };
        expect(r.ok).toBe(true);
        expect(r.words.map((w) => w.term)).toEqual(['new', 'mid', 'old']);
    });

    test('LOCAL_WORD_SET_TRANSLATION stores it on the word', async () => {
        seed(['dawn', 1]);
        expect(await handleAuthMessage({ action: 'LOCAL_WORD_SET_TRANSLATION', term: 'Dawn', translation: 'рассвет' })).toEqual({ ok: true });
        expect(localWords().dawn.translation).toBe('рассвет');
        const r = (await handleAuthMessage({ action: 'LOCAL_WORDS_LIST' })) as { words: Array<{ translation?: string }> };
        expect(r.words[0].translation).toBe('рассвет');
    });

    test('both are recognised actions, and the listener answers them', async () => {
        expect(isAuthAction('LOCAL_WORDS_LIST')).toBe(true);
        expect(isAuthAction('LOCAL_WORD_SET_TRANSLATION')).toBe(true);
        seed(['dawn', 1]);
        installAuthBackground();
        const listener = messageListeners[messageListeners.length - 1];
        const answer = await new Promise<any>((resolve) => listener({ action: 'LOCAL_WORDS_LIST' }, {}, resolve));
        expect(answer.words).toHaveLength(1);
    });
});

describe('moving local words into the account', () => {
    const handoff = async () => {
        installExternalAuthHandoff();
        await setPendingAuthNonce('n1');
        return new Promise((resolve) =>
            externalListener!(
                { type: 'lingogram-extension-auth', payload: { customToken: 't', uid: 'u1', email: 'a@b.c', nonce: 'n1' } },
                { origin: 'http://localhost:5173' },
                resolve,
            ),
        );
    };

    test('sign-in uploads the words oldest first, each through the ordinary save, and empties the local store', async () => {
        seed(['newest', 3000, 'c3'], ['oldest', 1000, 'c1'], ['middle', 2000, 'c2']);
        local['auth.needsReauth'] = true;
        expect(await handoff()).toEqual({ ok: true });
        await until(() => Object.keys(localWords()).length === 0);
        expect(addInboxWord.mock.calls.map((c) => c[1])).toEqual([
            { term: 'oldest', context: 'c1' },
            { term: 'middle', context: 'c2' },
            { term: 'newest', context: 'c3' },
        ]);
        expect(local['auth.needsReauth']).toBeUndefined();
        expect((await loadMirror()).words).toMatchObject({ oldest: 'active', middle: 'active', newest: 'active' });
    });

    test('words stay active in the mirror while still waiting', async () => {
        seed(['a', 1]);
        let release!: () => void;
        addInboxWord.mockImplementation(() => new Promise((r) => (release = () => r({ wordId: 'w' }))));
        await signIn();
        const run = uploadLocalWords();
        await until(() => addInboxWord.mock.calls.length === 1);
        await syncWords({ force: true });
        expect((await loadMirror()).words.a).toBe('active');
        expect(Object.keys(localWords())).toEqual(['a']);
        release();
        await run;
        expect(localWords()).toEqual({});
    });

    test('a refused write stops the run and leaves that word and the rest local', async () => {
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
        seed(['one', 1], ['two', 2], ['three', 3]);
        await signIn();
        addInboxWord.mockImplementation(async (_c: unknown, input: { term: string }) => {
            if (input.term === 'one') return { wordId: 'w' };
            throw rules403();
        });
        const run = uploadLocalWords();
        await jest.advanceTimersByTimeAsync(5000);
        const res = await run;
        expect(res).toEqual({ ok: false, uploaded: 1, left: 2, error: expect.stringContaining('Firestore rules 403') });
        expect(Object.keys(localWords()).sort()).toEqual(['three', 'two']);
        // one: ok; two: refused, retried once, refused; three never tried.
        expect(addInboxWord.mock.calls.map((c) => c[1].term)).toEqual(['one', 'two', 'two']);
        expect(local['auth.uid']).toBe('u1');
        expect(setBadgeText).not.toHaveBeenCalled();
    });

    test('pacing: no pause at first; after a refusal the retry waits a second and later words keep that gap', async () => {
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
        seed(['one', 1], ['two', 2], ['three', 3]);
        await signIn();
        let oneAttempts = 0;
        addInboxWord.mockImplementation(async (_c: unknown, input: { term: string }) => {
            if (input.term === 'one' && ++oneAttempts === 1) throw rules403();
            return { wordId: 'w' };
        });
        const run = uploadLocalWords();
        await jest.advanceTimersByTimeAsync(0);
        // First attempt made at once, refused; the retry has not been made yet.
        expect(addInboxWord.mock.calls.map((c) => c[1].term)).toEqual(['one']);
        await jest.advanceTimersByTimeAsync(1000);
        expect(addInboxWord).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(100);
        expect(addInboxWord.mock.calls.map((c) => c[1].term)).toEqual(['one', 'one']);
        // 'two' waits another second before it is written.
        await jest.advanceTimersByTimeAsync(1000);
        expect(addInboxWord).toHaveBeenCalledTimes(2);
        await jest.advanceTimersByTimeAsync(200);
        expect(addInboxWord.mock.calls.map((c) => c[1].term)).toEqual(['one', 'one', 'two']);
        await jest.advanceTimersByTimeAsync(1200);
        expect((await run).ok).toBe(true);
        expect(localWords()).toEqual({});
    });

    test('the daily cap ends the run and keeps the rest', async () => {
        seed(['one', 1], ['two', 2]);
        await signIn();
        addInboxWord.mockRejectedValue(new Error('Daily limit of 500 words reached. Try again tomorrow.'));
        const res = await uploadLocalWords();
        expect(res).toMatchObject({ ok: false, uploaded: 0, left: 2 });
        expect(Object.keys(localWords()).sort()).toEqual(['one', 'two']);
        expect(addInboxWord).toHaveBeenCalledTimes(1);
    });

    test('an auth failure during upload clears the session, raises the badge, keeps the words, mirror shows them', async () => {
        seed(['one', 1], ['two', 2]);
        await signIn();
        addInboxWord.mockRejectedValue(new Error('Firestore commit 401: expired'));
        await uploadLocalWords();
        expect(local['auth.uid']).toBeUndefined();
        expect(setBadgeText).toHaveBeenCalledWith({ text: '!' });
        expect(local['auth.needsReauth']).toBe(true);
        expect(Object.keys(localWords()).sort()).toEqual(['one', 'two']);
        expect((await loadMirror()).words).toEqual({ one: 'active', two: 'active' });
    });

    test('a sign-out in the middle ends the run quietly: no badge, no write for the rest', async () => {
        seed(['one', 1], ['two', 2]);
        await signIn();
        addInboxWord.mockImplementation(async () => {
            await handleAuthMessage({ action: 'AUTH_SIGN_OUT' });
            return { wordId: 'w' };
        });
        const res = await uploadLocalWords();
        expect(addInboxWord).toHaveBeenCalledTimes(1);
        expect(res).toMatchObject({ ok: true, uploaded: 1, left: 1 });
        expect(Object.keys(localWords())).toEqual(['two']);
        expect(setBadgeText).not.toHaveBeenCalledWith({ text: '!' });
    });

    test('a word removed while the run was under way is not uploaded', async () => {
        seed(['one', 1], ['two', 2]);
        await signIn();
        addInboxWord.mockImplementation(async (_c: unknown, input: { term: string }) => {
            // Removed from the My words page while the first write is out.
            if (input.term === 'one') await handleAuthMessage({ action: 'REMOVE_WORD', term: 'two' });
            return { wordId: 'w' };
        });
        const res = await uploadLocalWords();
        expect(addInboxWord.mock.calls.map((c) => c[1].term)).toEqual(['one']);
        expect(res).toMatchObject({ ok: true, uploaded: 1, left: 0 });
        expect(localWords()).toEqual({});
        expect((await loadMirror()).words.two).toBe('removed');
    });

    test('a sign-out during the pacing wait ends the run quietly, with no badge and no reauth flag', async () => {
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
        seed(['one', 1], ['two', 2]);
        await signIn();
        addInboxWord.mockImplementation(async (_c: unknown, input: { term: string }) => {
            if (input.term === 'one') throw rules403();
            if (!local['auth.uid']) throw new Error('Not signed in');
            return { wordId: 'w' };
        });
        const run = uploadLocalWords();
        await jest.advanceTimersByTimeAsync(0);
        // 'one' was refused and is waiting out the gap; the learner signs out now.
        await handleAuthMessage({ action: 'AUTH_SIGN_OUT' });
        await jest.advanceTimersByTimeAsync(5000);
        const res = await run;
        expect(res.ok).toBe(true);
        expect(setBadgeText).not.toHaveBeenCalledWith({ text: '!' });
        expect(local['auth.needsReauth']).toBeUndefined();
        expect(addInboxWord).toHaveBeenCalledTimes(1);
        expect(Object.keys(localWords()).sort()).toEqual(['one', 'two']);
    });

    test('"Not signed in" from a write after the session is gone is a quiet stop, not an expired session', async () => {
        seed(['one', 1]);
        await signIn();
        addInboxWord.mockImplementation(async () => {
            await handleAuthMessage({ action: 'AUTH_SIGN_OUT' });
            throw new Error('Not signed in');
        });
        const res = await uploadLocalWords();
        expect(res).toEqual({ ok: true, uploaded: 0, left: 1 });
        expect(setBadgeText).not.toHaveBeenCalledWith({ text: '!' });
        expect(local['auth.needsReauth']).toBeUndefined();
    });

    test('two triggers at once are one run: every word is written once', async () => {
        seed(['one', 1], ['two', 2]);
        await signIn();
        const a = uploadLocalWords();
        const b = uploadLocalWords();
        expect(b).toBe(a);
        await Promise.all([a, b]);
        expect(addInboxWord.mock.calls.map((c) => c[1].term)).toEqual(['one', 'two']);
    });

    test('a term the account can never hold is dropped instead of blocking the queue', async () => {
        seed(['huge', 1], ['fine', 2]);
        await signIn();
        addInboxWord.mockImplementation(async (_c: unknown, input: { term: string }) => {
            if (input.term === 'huge') throw new Error('term must be 1..256 bytes (UTF-8)');
            return { wordId: 'w' };
        });
        const res = await uploadLocalWords();
        expect(res).toEqual({ ok: true, uploaded: 1, left: 0 });
        expect(localWords()).toEqual({});
    });

    test('nothing to upload, or no session, writes nothing', async () => {
        await signIn();
        expect(await uploadLocalWords()).toEqual({ ok: true, uploaded: 0, left: 0 });
        seed(['one', 1]);
        await handleAuthMessage({ action: 'AUTH_SIGN_OUT' });
        await uploadLocalWords();
        expect(addInboxWord).not.toHaveBeenCalled();
        expect(Object.keys(localWords())).toEqual(['one']);
    });

    test('a successful signed-in save carries on with words that are still waiting', async () => {
        await signIn();
        seed(['waiting', 1]);
        await add('fresh');
        await until(() => Object.keys(localWords()).length === 0);
        expect(addInboxWord.mock.calls.map((c) => c[1].term)).toEqual(['fresh', 'waiting']);
    });

    test('worker start signed in carries on with words that are still waiting', async () => {
        await signIn();
        seed(['waiting', 1]);
        installAuthBackground();
        await until(() => Object.keys(localWords()).length === 0);
        expect(addInboxWord.mock.calls.map((c) => c[1].term)).toEqual(['waiting']);
    });
});

describe('the sign-in handoff and the settings page', () => {
    test('the handoff listener leaves lingogram-settings to its own listener', () => {
        installExternalAuthHandoff();
        const respond = jest.fn();
        expect(externalListener!({ type: 'lingogram-settings', op: 'state' }, { origin: 'https://evil.example' }, respond)).toBe(false);
        expect(respond).not.toHaveBeenCalled();
    });
});
