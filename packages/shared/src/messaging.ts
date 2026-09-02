// The one promisified wrapper around chrome.runtime.sendMessage.
//
// It existed in four copies — three private and identical, one exported and
// subtly different — and the difference was behavioural, not cosmetic: only the
// exported copy checked for an orphaned extension context. Both forms are kept
// here, as two names rather than one function with a flag, so that a call site
// cannot change which behaviour it gets by editing an argument.
//
// NOT re-exported from src/index.ts. That barrel is also the surface of
// packages/embed (the marketing site), and widening it is how a feature leaked
// into the landing-page bundle once already.

/**
 * Promisified `chrome.runtime.sendMessage`.
 *
 * Rejects with `chrome.runtime.lastError` when the worker reports one, and with
 * whatever `chrome.runtime.sendMessage` throws synchronously.
 */
export function sendMessage<T>(message: object): Promise<T> {
    return new Promise((resolve, reject) => {
        try {
            chrome.runtime.sendMessage(message, (res) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(res as T);
            });
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * As `sendMessage`, but rejects up front when this content script has been
 * orphaned by an extension reload.
 *
 * Without the check the caller gets a raw exception from deep inside the
 * messaging API, which no user can act on — and an orphaned script is a routine
 * state here, not an exotic one: every reload of the unpacked extension leaves
 * one behind on every open tab.
 */
export function sendMessageGuarded<T>(message: object): Promise<T> {
    return new Promise((resolve, reject) => {
        // Stale content scripts left over from an extension reload still have
        // a `chrome` global, but `chrome.runtime.id` flips to undefined.
        if (!chrome?.runtime?.id) {
            reject(new Error('Extension was reloaded — refresh this page to use Lingogram again.'));
            return;
        }
        try {
            chrome.runtime.sendMessage(message, (res) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(res as T);
            });
        } catch (err) {
            reject(err);
        }
    });
}
