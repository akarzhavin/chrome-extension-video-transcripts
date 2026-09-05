/**
 * @jest-environment jsdom
 *
 * What signing out clears, and — the half that matters — what it keeps.
 *
 * Behaviour map §2.8. Signing out removes the credentials. It deliberately
 * leaves the lifetime saved-word count and the one-shot rating flag behind,
 * because the person is the same person: they signed out, they did not become
 * someone new.
 *
 * Nothing checked that. Adding those two keys to the clear list looks like
 * tidy-up — the same function, the same shape, two more lines — and would
 * re-ask every signed-out reader for a store rating, the one thing the rating
 * section says must never happen twice.
 */

const store: Record<string, unknown> = {};
const removed: string[][] = [];
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
            remove: jest.fn((keys: string[]) => {
                removed.push(keys);
                keys.forEach((k) => delete store[k]);
                return Promise.resolve();
            }),
        },
        onChanged: { addListener: jest.fn(), removeListener: jest.fn() },
    },
    runtime: { id: 'test-extension-id' },
};

import {
    RATE_PROMPT_WORD_THRESHOLD,
    bumpSavedWordCount,
    clearAuthState,
    getAuthState,
    getRatePromptShown,
    getSavedWordCount,
    markRatePromptShown,
    setAuthState,
} from '../src/auth/storage';

beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
    removed.length = 0;
});

const signedIn = () =>
    setAuthState({
        idToken: 'id',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 3_600_000,
        email: 'someone@example.com',
        uid: 'uid-1',
    } as any);

describe('signing out', () => {
    test('removes the five credential keys and nothing else', async () => {
        await signedIn();
        await clearAuthState();
        expect(removed).toHaveLength(1);
        expect([...removed[0]].sort()).toEqual(
            ['auth.email', 'auth.expiresAt', 'auth.idToken', 'auth.refreshToken', 'auth.uid'],
        );
    });

    test('leaves no session behind', async () => {
        await signedIn();
        await clearAuthState();
        expect(await getAuthState()).toBeNull();
    });

    test('keeps the lifetime saved-word count', async () => {
        await signedIn();
        for (let i = 0; i < 7; i++) await bumpSavedWordCount();
        await clearAuthState();
        expect(await getSavedWordCount()).toBe(7);
    });

    test('keeps the one-shot rating flag, so nobody is asked twice', async () => {
        await signedIn();
        await markRatePromptShown();
        await clearAuthState();
        expect(await getRatePromptShown()).toBe(true);
    });

    test('a signed-out reader past the threshold is still not re-asked', async () => {
        // The whole point, stated end to end: count past the trigger, flag
        // spent, sign out — and the conditions to ask again must not be met.
        await signedIn();
        for (let i = 0; i < RATE_PROMPT_WORD_THRESHOLD; i++) await bumpSavedWordCount();
        await markRatePromptShown();
        await clearAuthState();

        expect(await getSavedWordCount()).toBeGreaterThanOrEqual(RATE_PROMPT_WORD_THRESHOLD);
        expect(await getRatePromptShown()).toBe(true);
    });
});
