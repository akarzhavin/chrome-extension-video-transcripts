/**
 * @jest-environment jsdom
 *
 * "N words saved" in the popup and the YouTube badge: the account's words, not
 * a tally of what this install happened to save.
 *
 * The number comes from the word mirror, which the sync fills with the whole
 * dictionary. A counter bumped on each local save started at zero on every new
 * install, so a learner with 67 words signed in on a fresh browser and read
 * "0 words saved" while the page highlight already marked all 67.
 */

const store: Record<string, unknown> = {};

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
                Object.assign(store, items);
                return Promise.resolve();
            }),
            remove: jest.fn((keys: any) => {
                const arr = typeof keys === 'string' ? [keys] : keys;
                for (const k of arr) delete store[k];
                return Promise.resolve();
            }),
        },
        session: { get: jest.fn(async () => ({})), set: jest.fn(async () => {}) },
        onChanged: { addListener: jest.fn(), removeListener: jest.fn() },
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
import { setMirrorEntry } from '../src/word-mirror';

type Status = { signedIn: boolean; inboxCount?: number };
type SaveReply = { ok: boolean; inboxCount?: number };

beforeEach(() => {
    __resetSyncStateForTests();
    Object.keys(store).forEach((k) => delete store[k]);
    store['auth.idToken'] = 'token';
    store['auth.refreshToken'] = 'refresh';
    store['auth.expiresAt'] = Date.now() + 3_600_000;
    store['auth.email'] = 'someone@example.com';
    store['auth.uid'] = 'uid-1';
    // Every Firestore call succeeds with an empty body: a commit is accepted,
    // a query returns no rows.
    (global as any).fetch = jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => '',
    }));
});

describe('the saved-word count', () => {
    test('is the number of active words in the mirror', async () => {
        await setMirrorEntry('dawn', 'active');
        await setMirrorEntry('courage', 'active');
        await setMirrorEntry('whilst', 'active');
        await setMirrorEntry('afraid', 'removed');

        const status = (await handleAuthMessage({ action: 'AUTH_STATUS' })) as Status;

        expect(status).toMatchObject({ signedIn: true, inboxCount: 3 });
    });

    test('counts words synced from another device on a fresh install', async () => {
        // A new browser: nothing saved here yet, the dictionary arrived by sync.
        for (const w of ['one', 'two', 'three', 'four', 'five']) await setMirrorEntry(w, 'active');

        const status = (await handleAuthMessage({ action: 'AUTH_STATUS' })) as Status;

        expect(status.inboxCount).toBe(5);
    });

    test('a save reports the whole dictionary, not one more than this install saw', async () => {
        await setMirrorEntry('dawn', 'active');
        await setMirrorEntry('courage', 'active');
        // The content script marks the word in the mirror before it asks the
        // worker to save it.
        await setMirrorEntry('whilst', 'active');

        const reply = (await handleAuthMessage({
            action: 'ADD_WORD',
            term: 'whilst',
            context: 'whilst we wait',
            site: 'youtube',
        })) as SaveReply;

        expect(reply).toMatchObject({ ok: true, inboxCount: 3 });
    });

    test('a save the caller did not mark first is counted too', async () => {
        // The context-menu save marks the mirror only after the reply.
        await setMirrorEntry('dawn', 'active');

        const reply = (await handleAuthMessage({
            action: 'ADD_WORD',
            term: 'Courage',
            context: 'courage under fire',
            site: 'web',
        })) as SaveReply;

        expect(reply).toMatchObject({ ok: true, inboxCount: 2 });
    });

    test('a removal the caller did not mark first is taken off too', async () => {
        await setMirrorEntry('dawn', 'active');
        await setMirrorEntry('courage', 'active');

        const reply = (await handleAuthMessage({
            action: 'REMOVE_WORD',
            term: 'courage',
            site: 'youtube',
        })) as SaveReply;

        expect(reply).toMatchObject({ ok: true, inboxCount: 1 });
    });

    test('a removal reports what is left', async () => {
        await setMirrorEntry('dawn', 'active');
        await setMirrorEntry('courage', 'active');
        await setMirrorEntry('whilst', 'removed');

        const reply = (await handleAuthMessage({
            action: 'REMOVE_WORD',
            term: 'whilst',
            site: 'youtube',
        })) as SaveReply;

        expect(reply).toMatchObject({ ok: true, inboxCount: 2 });
    });
});
