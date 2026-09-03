// The promisified sendMessage, and the asymmetry at the heart of it.
//
// This module was born by collapsing four copies. Three were unguarded and one
// checked for an orphaned extension context first, and that difference is
// BEHAVIOUR: without the check a stale content script — the thing every reload
// of the unpacked extension leaves behind on every open tab — throws from deep
// inside the messaging API instead of saying anything a person could act on.
//
// The deduplication deliberately preserved both forms rather than unifying on
// the better one, so the asymmetry is now a decision rather than an accident.
// A decision deserves a test: these assertions exist to make an unnoticed
// "cleanup" of one form into the other fail loudly.

import { sendMessage, sendMessageGuarded } from '../src/messaging';

/** A live extension context: what a healthy content script sees. */
function setLiveContext(): void {
    (global as any).chrome = {
        runtime: {
            id: 'abcdefghijklmnopabcdefghijklmnop',
            lastError: undefined,
            sendMessage: jest.fn((_msg: object, cb: (r: unknown) => void) => cb({ ok: true })),
        },
    };
}

/**
 * An orphaned context: `chrome` survives an extension reload but runtime.id
 * flips to undefined. Copied from the shape orphan-notice.test.ts measured off
 * a real reloaded tab.
 */
function setOrphanedContext(): void {
    (global as any).chrome = { runtime: { sendMessage: jest.fn() } };
}

afterEach(() => {
    delete (global as any).chrome;
    jest.clearAllMocks();
});

describe('both forms, on a live context', () => {
    it.each([
        ['sendMessage', sendMessage],
        ['sendMessageGuarded', sendMessageGuarded],
    ])('%s resolves with the worker reply', async (_name, send) => {
        setLiveContext();
        await expect(send<{ ok: boolean }>({ action: 'PING' })).resolves.toEqual({ ok: true });
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'PING' }, expect.any(Function));
    });

    it.each([
        ['sendMessage', sendMessage],
        ['sendMessageGuarded', sendMessageGuarded],
    ])('%s rejects with chrome.runtime.lastError when the worker reports one', async (_name, send) => {
        setLiveContext();
        (chrome.runtime.sendMessage as jest.Mock).mockImplementation((_m: object, cb: (r: unknown) => void) => {
            (chrome.runtime as { lastError?: { message: string } }).lastError = { message: 'no receiver' };
            cb(undefined);
        });
        await expect(send({ action: 'PING' })).rejects.toThrow('no receiver');
    });

    it.each([
        ['sendMessage', sendMessage],
        ['sendMessageGuarded', sendMessageGuarded],
    ])('%s rejects rather than throwing when the API throws synchronously', async (_name, send) => {
        setLiveContext();
        (chrome.runtime.sendMessage as jest.Mock).mockImplementation(() => {
            throw new Error('context invalidated');
        });
        // The point is the shape, not the message: a synchronous throw has to
        // come back as a rejected promise, or every `await send(...)` in a
        // content script becomes an uncaught error instead of a caught one.
        await expect(send({ action: 'PING' })).rejects.toThrow('context invalidated');
    });
});

describe('the guard, which is the whole reason there are two functions', () => {
    it('sendMessageGuarded rejects with a human-readable message on an orphaned context', async () => {
        setOrphanedContext();
        await expect(sendMessageGuarded({ action: 'PING' })).rejects.toThrow(
            'Extension was reloaded — refresh this page to use Lingogram again.',
        );
    });

    it('sendMessageGuarded does not reach the messaging API at all when orphaned', async () => {
        setOrphanedContext();
        await expect(sendMessageGuarded({ action: 'PING' })).rejects.toThrow();
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it("the guard's wording is what quick-add matches on: /reloaded/i", async () => {
        // quick-add-overlay decides between a friendly toast and a generic
        // failure by testing the message with /reloaded/i. Reword the guard
        // without knowing that and the toast silently turns generic.
        setOrphanedContext();
        await expect(sendMessageGuarded({ action: 'PING' })).rejects.toThrow(/reloaded/i);
    });

    it('plain sendMessage does NOT guard — it calls straight through', async () => {
        // The deliberate asymmetry. feedback, the auth badge and the YouTube
        // player menu were all unguarded before the deduplication and stay
        // unguarded after it; unifying them would be an improvement, but it
        // would be a behaviour change and is not what that commit did.
        setOrphanedContext();
        (chrome.runtime.sendMessage as jest.Mock).mockImplementation((_m: object, cb: (r: unknown) => void) =>
            cb({ ok: true }),
        );
        await expect(sendMessage({ action: 'PING' })).resolves.toEqual({ ok: true });
        expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    });
});
