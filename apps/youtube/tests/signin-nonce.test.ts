/**
 * Behaviour map §2 — the challenge that protects signing in.
 *
 * The extension sends someone to the website with a one-shot challenge and
 * accepts a session back only if the reply carries that exact value, unexpired.
 * Without it, any page the browser already trusts could push a session at the
 * extension and be signed in as somebody else.
 *
 * The live checks cover the minting; these cover the refusing, which is the
 * half that cannot be observed from outside.
 */

const store: Record<string, unknown> = {};

(global as any).chrome = {
    storage: {
        session: {
            set: (o: Record<string, unknown>) => {
                Object.assign(store, o);
                return Promise.resolve();
            },
            get: (keys: string[]) =>
                Promise.resolve(Object.fromEntries(keys.map((k) => [k, store[k]]))),
            remove: (keys: string[]) => {
                for (const k of keys) delete store[k];
                return Promise.resolve();
            },
        },
    },
};

import {
    clearPendingAuthNonce,
    setPendingAuthNonce,
    validatePendingAuthNonce,
} from '@video-transcripts/shared/src/auth/storage';

beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    jest.useRealTimers();
});

describe('the sign-in challenge', () => {
    test('the exact challenge is accepted', async () => {
        await setPendingAuthNonce('the-real-one');
        expect(await validatePendingAuthNonce('the-real-one')).toBe(true);
    });

    test('a different challenge is refused', async () => {
        await setPendingAuthNonce('the-real-one');
        // Someone who cannot see the value cannot guess it, which is the whole
        // point of sending it in the address we opened.
        expect(await validatePendingAuthNonce('a-guess')).toBe(false);
    });

    test('an empty reply is refused, and so is an empty store', async () => {
        await setPendingAuthNonce('the-real-one');
        expect(await validatePendingAuthNonce('')).toBe(false);

        await clearPendingAuthNonce();
        expect(await validatePendingAuthNonce('the-real-one')).toBe(false);
    });

    test('a challenge older than ten minutes is refused', async () => {
        await setPendingAuthNonce('the-real-one');
        // Someone who walks away mid-sign-in and comes back an hour later starts
        // again, rather than completing a handoff nobody is watching.
        const elevenMinutes = 11 * 60 * 1000;
        jest.spyOn(Date, 'now').mockReturnValue(Date.now() + elevenMinutes);
        try {
            expect(await validatePendingAuthNonce('the-real-one')).toBe(false);
        } finally {
            jest.restoreAllMocks();
        }
    });

    test('a challenge just inside ten minutes is still accepted', async () => {
        await setPendingAuthNonce('the-real-one');
        const nineMinutes = 9 * 60 * 1000;
        jest.spyOn(Date, 'now').mockReturnValue(Date.now() + nineMinutes);
        try {
            expect(await validatePendingAuthNonce('the-real-one')).toBe(true);
        } finally {
            jest.restoreAllMocks();
        }
    });

    test('the challenge survives being read, so a transient failure can retry', async () => {
        await setPendingAuthNonce('the-real-one');
        expect(await validatePendingAuthNonce('the-real-one')).toBe(true);
        // Still there: the caller clears it only once the whole handoff worked.
        expect(await validatePendingAuthNonce('the-real-one')).toBe(true);
    });
});
