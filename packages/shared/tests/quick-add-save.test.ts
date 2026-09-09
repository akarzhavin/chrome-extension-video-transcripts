/**
 * @jest-environment jsdom
 */

/**
 * Behaviour map §14.5, §14.9, §48 — what saving a word says, and how loudly.
 *
 * Saving is the product's one write, and the toast is its only confirmation:
 * it appears for 2.5 seconds and is gone. Two things had no check. The first
 * is the message *chosen* — a signed-out save reaches the same catch block as
 * a network error, and without the mapping the reader is shown a raw
 * "Not signed in" from the worker instead of where to sign in. The second is
 * whether a screen reader hears it in time: an error that waits its turn is an
 * error the user never learns about before the toast is gone.
 */

(global as any).chrome = {
    runtime: { id: 'test-extension-id', sendMessage: jest.fn(), lastError: undefined },
    storage: {
        local: {
            get: jest.fn(() => Promise.resolve({})),
            set: jest.fn(() => Promise.resolve()),
        },
    },
    i18n: { getMessage: jest.fn(() => '') }, // force the English fallbacks
};

import { removeTerm, saveTerm } from '../src/content/quick-add-overlay';

const TOAST_ID = 'lingogram-quick-add-toast';
const toast = () => document.getElementById(TOAST_ID);

/** Answer the worker's ADD_WORD with `res`, whatever the message. */
function workerReplies(res: object): void {
    (chrome.runtime.sendMessage as jest.Mock).mockImplementation(
        (_m: object, cb: (r: unknown) => void) => cb(res),
    );
}

beforeEach(() => {
    document.body.innerHTML = '';
    jest.clearAllMocks();
    (chrome.runtime as any).lastError = undefined;
});

describe('a signed-out save says how to sign in', () => {
    test('the not-signed-in error becomes the sign-in instruction, not the raw error', async () => {
        workerReplies({ ok: false, error: 'Not signed in' });

        const saved = await saveTerm('serendipity', 'a context');

        expect(saved).toBe(false);
        expect(toast()?.textContent).toBe(
            'Sign in via the Lingogram row above the subtitle list to save words.',
        );
        // The worker's own words name a state, not an action; they must not
        // be what the reader is left with.
        expect(toast()?.textContent).not.toContain('Not signed in');
    });

    test('an unrelated failure keeps its own reason instead of blaming sign-in', () => {
        // The counter-half: the mapping must be a mapping, not a catch-all.
        // Without this, "route every error to the sign-in text" passes above.
        workerReplies({ ok: false, error: 'network unreachable' });

        return saveTerm('serendipity', 'a context').then(() => {
            expect(toast()?.textContent).toContain('network unreachable');
            expect(toast()?.textContent).not.toContain('Sign in via');
        });
    });
});

describe('a success says what was saved', () => {
    test('the toast names the term', async () => {
        workerReplies({ ok: true, wordId: 'w1' });

        const saved = await saveTerm('serendipity', 'a context');

        expect(saved).toBe(true);
        expect(toast()?.textContent).toBe('Saved: serendipity');
        // The placeholder is substituted, not shipped.
        expect(toast()?.textContent).not.toContain('{term}');
    });

    test('a different term produces a different message', () => {
        // Pins the term as the variable part: a message that dropped it would
        // still contain "Saved:" and still pass the check above on its own.
        workerReplies({ ok: true });
        return saveTerm('ephemeral', 'ctx').then(() => {
            expect(toast()?.textContent).toBe('Saved: ephemeral');
        });
    });
});

describe('a failed save interrupts; a success waits its turn', () => {
    test('a failure is announced assertively, as an alert', async () => {
        workerReplies({ ok: false, error: 'network unreachable' });

        await saveTerm('serendipity', 'ctx');

        expect(toast()?.getAttribute('role')).toBe('alert');
        expect(toast()?.getAttribute('aria-live')).toBe('assertive');
    });

    test('a success is announced politely, as a status', async () => {
        workerReplies({ ok: true });

        await saveTerm('serendipity', 'ctx');

        expect(toast()?.getAttribute('role')).toBe('status');
        expect(toast()?.getAttribute('aria-live')).toBe('polite');
    });

    test('the two are never announced the same way', async () => {
        // The assertion neither half can make alone: one urgency for both
        // outcomes satisfies either check above, depending which one it is.
        workerReplies({ ok: true });
        await saveTerm('a', 'ctx');
        const success = [toast()?.getAttribute('role'), toast()?.getAttribute('aria-live')];

        workerReplies({ ok: false, error: 'network unreachable' });
        await saveTerm('a', 'ctx');
        const failure = [toast()?.getAttribute('role'), toast()?.getAttribute('aria-live')];

        expect(failure).not.toEqual(success);
    });
});

/**
 * The same three cases, for the OTHER direction.
 *
 * `removeTerm` is the mirror image of `saveTerm` and had none of the mapping
 * above: every failure reached one line, and that line said "Couldn't save".
 * A learner pressing the filled heart to take a word OFF the list, on a
 * failure, was told the save had failed — for a word that is still saved,
 * because the rollback has just put it back. The message states the opposite
 * of what happened, and the action it suggests is one the learner did not ask
 * for.
 */
describe('a failed removal says removal, not saving', () => {
    test('the last-resort wording is about removing', async () => {
        workerReplies({ ok: false, error: 'network unreachable' });

        const removed = await removeTerm('serendipity');

        expect(removed).toBe(false);
        expect(toast()?.textContent).toContain('network unreachable');
        // The heart is filled again by the rollback, so the word IS still
        // saved. Telling the learner it could not be saved is the one thing
        // this message must not do.
        expect(toast()?.textContent).not.toContain("Couldn't save");
        expect(toast()?.textContent).toContain("Couldn't remove");
    });

    test('a signed-out removal says how to sign in, like a save does', async () => {
        // The friendly branches were reachable from `saveTerm` only. A learner
        // whose session expired between the save and the removal got the raw
        // worker string with no route back.
        workerReplies({ ok: false, error: 'Not signed in' });

        await removeTerm('serendipity');

        expect(toast()?.textContent).toBe(
            'Sign in via the Lingogram row above the subtitle list to save words.',
        );
        expect(toast()?.textContent).not.toContain('Not signed in');
    });

    test('an orphaned content script keeps the worker’s own wording', async () => {
        // The extension reloaded under the page. The worker's message is
        // already written for a human and says what to do; wrapping it in
        // "Couldn't remove: …" would bury the instruction.
        workerReplies({ ok: false, error: 'Lingogram was reloaded — refresh the page to save words.' });

        await removeTerm('serendipity');

        expect(toast()?.textContent).toBe('Lingogram was reloaded — refresh the page to save words.');
        expect(toast()?.textContent).not.toContain("Couldn't");
    });
});
