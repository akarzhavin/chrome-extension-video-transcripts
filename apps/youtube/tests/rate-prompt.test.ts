/**
 * Behaviour map §15 — being asked for a review, and the counter behind it.
 *
 * The product gets ONE chance per installation to ask, after five saved words.
 * Asking twice is worse than never asking, and the counter deliberately
 * survives signing out, because it is the same person either way.
 *
 * None of this was covered anywhere. The live check drives the card with the
 * diagnostic switch, which by design does not touch the counter — so the
 * counter's own rules could only ever be checked here.
 */

const store: Record<string, unknown> = {};

const area = () => ({
    get: (keys: string | string[] | null) => {
        if (keys === null) return Promise.resolve({ ...store });
        const list = Array.isArray(keys) ? keys : [keys];
        return Promise.resolve(Object.fromEntries(list.filter((k) => k in store).map((k) => [k, store[k]])));
    },
    set: (o: Record<string, unknown>) => {
        Object.assign(store, o);
        return Promise.resolve();
    },
    remove: (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
        return Promise.resolve();
    },
});

(global as any).chrome = {
    runtime: { id: 'test-extension-id', lastError: undefined, getManifest: () => ({ version: '1.0.0' }) },
    storage: { local: area(), session: area() },
    action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn() },
    tabs: { create: jest.fn().mockResolvedValue({ id: 1 }) },
};

// The worker's collaborators the decision does not depend on. The Firestore
// write is what a save IS, but the prompt is decided on the counter, not on
// the document; analytics is fire-and-forget.
jest.mock('@video-transcripts/shared/src/auth/firestoreRest', () => ({
    addInboxWord: jest.fn().mockResolvedValue({ wordId: 'w1' }),
    addFeedback: jest.fn(),
    addNoSubsReport: jest.fn(),
}));
jest.mock('@video-transcripts/shared/src/analytics-bg', () => ({
    track: jest.fn().mockResolvedValue(undefined),
    handleTrackMessage: jest.fn().mockResolvedValue({ ok: true }),
}));

import {
    RATE_PROMPT_WORD_THRESHOLD,
    bumpSavedWordCount,
    getRatePromptShown,
    markRatePromptShown,
} from '@video-transcripts/shared/src/auth/storage';
import { handleAuthMessage } from '@video-transcripts/shared/src/auth/background';

beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
});

describe('the review prompt', () => {
    test('the threshold is five', () => {
        // A deliberate product decision, lowered from thirty. Pinned so it
        // cannot drift back by accident.
        expect(RATE_PROMPT_WORD_THRESHOLD).toBe(5);
    });

    test('the count rises one word at a time', async () => {
        const seen: number[] = [];
        for (let i = 0; i < 5; i++) seen.push(await bumpSavedWordCount());
        expect(seen).toEqual([1, 2, 3, 4, 5]);
    });

    test('the fifth word is the first that qualifies — not the fourth, not the sixth', async () => {
        const qualifiesAt: number[] = [];
        for (let i = 0; i < 7; i++) {
            const n = await bumpSavedWordCount();
            if (n >= RATE_PROMPT_WORD_THRESHOLD) qualifiesAt.push(n);
        }
        expect(qualifiesAt[0]).toBe(5);
    });

    test('the one-shot starts unspent and stays spent once used', async () => {
        expect(await getRatePromptShown()).toBe(false);
        await markRatePromptShown();
        expect(await getRatePromptShown()).toBe(true);
        // Marking again is harmless — but it can never go back to unspent, or
        // the product would ask a second time.
        await markRatePromptShown();
        expect(await getRatePromptShown()).toBe(true);
    });

});

/**
 * The gate itself, in the worker's ADD_WORD handler
 * (packages/shared/src/auth/background.ts) — not a restatement of it.
 *
 * The earlier form of these checks wrote the rule inside the test body
 * (`count >= threshold && !shown`, then mark) and asserted its own
 * arithmetic: dropping the one-shot term from the product, or moving the burn
 * to the answer handler, left it green. Here the product decides.
 */
describe('the review prompt, as the worker decides it', () => {
    const signIn = () =>
        Object.assign(store, {
            'auth.idToken': 'tok',
            'auth.refreshToken': 'refresh',
            'auth.expiresAt': Date.now() + 3_600_000,
            'auth.email': 'a@b.com',
            'auth.uid': 'uid-1',
        });
    const save = async () =>
        (await handleAuthMessage({ action: 'ADD_WORD', term: 'hola', site: 'youtube' } as any)) as {
            ok: boolean;
            promptRate: boolean;
        };

    test('the worker asks on the fifth save and never again', async () => {
        signIn();
        const asked: number[] = [];
        for (let word = 1; word <= 10; word++) {
            const r = await save();
            expect(r.ok).toBe(true);
            if (r.promptRate) asked.push(word);
        }
        // Once, on the fifth word, and never again however many follow.
        expect(asked).toEqual([5]);
    });

    test('the one-shot burns when the prompt is decided, before anything answers it', async () => {
        signIn();
        for (let i = 0; i < 4; i++) await save();
        expect(store['rate.promptShown']).toBeUndefined();
        const fifth = await save();
        expect(fifth.promptRate).toBe(true);
        // Spent by being shown, not by being answered (§15): nothing has
        // pressed "Yes" or "Not really" and the flag is already set.
        expect(store['rate.promptShown']).toBe(true);
        expect(await getRatePromptShown()).toBe(true);
    });
});
