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

(global as any).chrome = {
    storage: {
        local: {
            get: (keys: string | string[]) => {
                const list = Array.isArray(keys) ? keys : [keys];
                return Promise.resolve(Object.fromEntries(list.map((k) => [k, store[k]])));
            },
            set: (o: Record<string, unknown>) => {
                Object.assign(store, o);
                return Promise.resolve();
            },
            remove: (keys: string[]) => {
                for (const k of keys) delete store[k];
                return Promise.resolve();
            },
        },
    },
};

import {
    RATE_PROMPT_WORD_THRESHOLD,
    bumpSavedWordCount,
    getRatePromptShown,
    markRatePromptShown,
} from '@video-transcripts/shared/src/auth/storage';

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

    test('the decision is count AND one-shot together, so it fires exactly once', async () => {
        // The rule as the product applies it, in one place.
        const wouldAsk = async () =>
            (await bumpSavedWordCount()) >= RATE_PROMPT_WORD_THRESHOLD && !(await getRatePromptShown());

        const asked: number[] = [];
        for (let word = 1; word <= 10; word++) {
            if (await wouldAsk()) {
                await markRatePromptShown();
                asked.push(word);
            }
        }

        // Once, on the fifth word, and never again however many follow.
        expect(asked).toEqual([5]);
    });
});
