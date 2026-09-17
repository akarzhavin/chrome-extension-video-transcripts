/**
 * @jest-environment jsdom
 *
 * Parked sessions: one per backend, so the dev backend switch does not cost a
 * sign-in on every click.
 *
 * A session cannot travel across the switch — an ID token is signed by one
 * project and no other will verify it, and a `uid` names a different person in
 * each. What it CAN do is be set aside under the project it belongs to and
 * handed back on return. These tests pin that the two halves stay matched:
 * nothing is restored under the wrong project, and nothing survives a sign-out.
 */

const store: Record<string, unknown> = {};

(global as any).chrome = {
    storage: {
        local: {
            // Deliberately does NOT implement get(null). Real stubs across
            // this repo do not either, and the first version of parking used
            // it to scan for parked keys — which threw inside AUTH_SIGN_OUT,
            // leaving the user signed in. Keeping the gap here means that
            // implementation cannot come back unnoticed.
            get: jest.fn(async (keys: unknown) => {
                if (keys === null || keys === undefined) {
                    throw new TypeError('get(null) is not supported by this stub');
                }
                const arr = typeof keys === 'string' ? [keys] : (keys as string[]);
                const out: Record<string, unknown> = {};
                for (const k of arr) if (k in store) out[k] = store[k];
                return out;
            }),
            set: jest.fn(async (items: Record<string, unknown>) => {
                Object.assign(store, items);
            }),
            remove: jest.fn(async (keys: unknown) => {
                const arr = typeof keys === 'string' ? [keys] : (keys as string[]);
                for (const k of arr) delete store[k];
            }),
        },
    },
};

(global as any).__EXT_ENV__ = 'dev';

import {
    clearParkedAuthStates,
    getAuthState,
    parkAuthState,
    setAuthState,
    unparkAuthState,
    WORD_KEYS,
} from '../src/auth/storage';

const SESSION_A = {
    idToken: 'token-a',
    refreshToken: 'refresh-a',
    expiresAt: 2_000_000,
    email: 'a@example.com',
    uid: 'uid-in-project-a',
};
const SESSION_B = {
    idToken: 'token-b',
    refreshToken: 'refresh-b',
    expiresAt: 3_000_000,
    email: 'b@example.com',
    uid: 'uid-in-project-b',
};

beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
});

/** The parked SESSION keys. The index deliberately sits outside this prefix. */
function parkedSessionKeys(): string[] {
    return Object.keys(store).filter((k) => k.startsWith('dev.parkedAuth.'));
}

describe('a lap of the ring costs no sign-ins', () => {
    test('parking clears the live session and unparking brings it back whole', async () => {
        await setAuthState(SESSION_A);

        await parkAuthState('project-a');
        // The point of parking is that the worker really is signed out of the
        // environment it left — a session that lingered would be presented to
        // the next project, whose uid means someone else.
        expect(await getAuthState()).toBeNull();

        expect(await unparkAuthState('project-a')).toBe(true);
        expect(await getAuthState()).toEqual(SESSION_A);
    });

    test('two projects keep separate sessions, and neither leaks into the other', async () => {
        await setAuthState(SESSION_A);
        await parkAuthState('project-a');

        await setAuthState(SESSION_B);
        await parkAuthState('project-b');

        expect(await unparkAuthState('project-a')).toBe(true);
        expect((await getAuthState())?.uid).toBe(SESSION_A.uid);

        await parkAuthState('project-a');
        expect(await unparkAuthState('project-b')).toBe(true);
        expect((await getAuthState())?.uid).toBe(SESSION_B.uid);
    });

    test('a project never signed into restores nothing, and says so', async () => {
        await setAuthState(SESSION_A);
        await parkAuthState('project-a');

        // The caller needs "you must sign in here" to be distinguishable from
        // "you are back where you were"; a silent false-but-signed-in would
        // paint a signed-in badge over no session at all.
        expect(await unparkAuthState('project-never-used')).toBe(false);
        expect(await getAuthState()).toBeNull();
    });

    test('the saved-word mirror travels with its own account', async () => {
        // The mirror lists the terms THIS account saved. Left behind it would
        // paint hearts from one environment while signed into another.
        await setAuthState(SESSION_A);
        await chrome.storage.local.set({ [WORD_KEYS.mirror]: { hello: 1 } });
        await parkAuthState('project-a');

        expect((await chrome.storage.local.get(WORD_KEYS.mirror)) as Record<string, unknown>)
            .toEqual({});

        await unparkAuthState('project-a');
        const back = (await chrome.storage.local.get(WORD_KEYS.mirror)) as Record<string, unknown>;
        expect(back[WORD_KEYS.mirror]).toEqual({ hello: 1 });
    });

    test('unparking consumes the parked copy rather than leaving a stale twin', async () => {
        await setAuthState(SESSION_A);
        await parkAuthState('project-a');
        await unparkAuthState('project-a');

        // A copy left behind would be restored again after a later sign-out,
        // resurrecting credentials the user believed were gone.
        expect(await unparkAuthState('project-a')).toBe(false);
        expect(parkedSessionKeys()).toEqual([]);
    });
});

describe('parking never outlives an explicit sign-out', () => {
    test('signing out forgets every parked environment', async () => {
        await setAuthState(SESSION_A);
        await parkAuthState('project-a');
        await setAuthState(SESSION_B);
        await parkAuthState('project-b');

        await clearParkedAuthStates();

        // "Signed out" has to mean it everywhere, or the next badge click
        // silently signs the user back in somewhere they thought they had left.
        expect(await unparkAuthState('project-a')).toBe(false);
        expect(await unparkAuthState('project-b')).toBe(false);
        expect(parkedSessionKeys()).toEqual([]);
        expect(store['dev.parkedIndex']).toBeUndefined();
    });
});

describe('the parked index stays true to what is stored', () => {
    test('the index empties as sessions are taken back out', async () => {
        // The index is a second copy of the truth, so it can drift. A stale
        // entry makes sign-out try to remove a key that is gone (harmless) —
        // but a MISSING entry makes sign-out skip a real parked session, which
        // is credentials surviving an explicit sign-out.
        await setAuthState(SESSION_A);
        await parkAuthState('project-a');
        await setAuthState(SESSION_B);
        await parkAuthState('project-b');
        expect(store['dev.parkedIndex']).toEqual(['project-a', 'project-b']);

        await unparkAuthState('project-a');
        expect(store['dev.parkedIndex']).toEqual(['project-b']);
    });

    test('parking the same project twice does not duplicate its entry', async () => {
        await setAuthState(SESSION_A);
        await parkAuthState('project-a');
        await unparkAuthState('project-a');
        await parkAuthState('project-a');

        expect(store['dev.parkedIndex']).toEqual(['project-a']);
    });

    test('a corrupt index does not throw — sign-out runs through this path', async () => {
        // A worker whose sign-out throws leaves the user signed in, which is
        // the opposite of what they asked for. Stored input gets the same
        // treatment here as everywhere else.
        store['dev.parkedIndex'] = 'not-an-array';
        await expect(clearParkedAuthStates()).resolves.toBeUndefined();

        store['dev.parkedIndex'] = [null, 42, 'project-a'];
        await expect(clearParkedAuthStates()).resolves.toBeUndefined();
    });
});

describe('a parked blob is stored input, not a promise', () => {
    test('half an identity is refused rather than half-restored', async () => {
        // Storage can be edited, truncated, or written by an older build. A
        // blob without both halves is not a session, and restoring it would
        // leave the worker believing it is signed in with no uid to write under.
        store['dev.parkedAuth.project-a'] = { auth: { idToken: 'orphan' } };
        expect(await unparkAuthState('project-a')).toBe(false);
        expect(await getAuthState()).toBeNull();

        store['dev.parkedAuth.project-b'] = { auth: { uid: 'orphan' } };
        expect(await unparkAuthState('project-b')).toBe(false);
        expect(await getAuthState()).toBeNull();
    });

    test('an expired token is still restored, because the refresh token outlives it', async () => {
        // Dropping it here would cost a sign-in in exactly the case parking
        // exists to avoid: the normal refresh path is what turns an expired
        // session into a fresh one.
        await setAuthState({ ...SESSION_A, expiresAt: 1 });
        await parkAuthState('project-a');

        expect(await unparkAuthState('project-a')).toBe(true);
        expect((await getAuthState())?.refreshToken).toBe(SESSION_A.refreshToken);
    });
});
