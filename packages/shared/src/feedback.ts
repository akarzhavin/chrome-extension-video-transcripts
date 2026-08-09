// Shared feedback plumbing: the byte budget, the clamp, and the send call.
//
// Extracted from the rating card (content/quick-add-overlay.ts) once the
// sidebar grew its own feedback screen. The clamp is the reason this is shared
// rather than copied: getting it subtly wrong silently halves non-Latin
// messages, and that failure is invisible until someone reads the Firestore
// docs and finds Russian feedback cut in half.

import { msg as i18nMsg } from './i18n';

// Firestore counts UTF-8 BYTES, while a textarea's maxLength counts UTF-16
// code units — so a 2000-char Russian message is 4000 bytes and would be
// silently halved on send. Clamp on the real budget instead.
export const MAX_FEEDBACK_BYTES = __LIMIT_MAX_FEEDBACK_TEXT_BYTES__;

export function utf8Len(s: string): number {
    return new TextEncoder().encode(s).length;
}

/** Longest prefix of `s` that fits in `maxBytes`, never splitting a surrogate pair. */
export function clampToBytes(s: string, maxBytes: number): string {
    if (utf8Len(s) <= maxBytes) return s;
    let lo = 0;
    let hi = s.length;
    while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if (utf8Len(s.slice(0, mid)) <= maxBytes) lo = mid;
        else hi = mid - 1;
    }
    // Step back off a lone high surrogate — TextEncoder turns it into U+FFFD
    // (3 bytes), which the search above would otherwise accept as valid.
    while (lo > 0) {
        const code = s.charCodeAt(lo - 1);
        if (code >= 0xd800 && code <= 0xdbff) lo--;
        else break;
    }
    return s.slice(0, lo);
}

function sendMessage<T>(message: object): Promise<T> {
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

// A reply address typed by a signed-out user. Firestore's rules pin the
// feedback doc to a fixed key set (no `email` field), so the address rides
// along inside `text` rather than as its own column — a schema change would
// need a rules deploy, and this costs one line and works today.
//
// Prepended, not appended: a message clamped at the byte ceiling would lose a
// trailing address, which is exactly the case where a reply matters most.
export function composeFeedbackText(text: string, email: string): string {
    const addr = email.trim();
    const body = text.trim();
    if (!addr) return body;
    return `[${addr}] ${body}`;
}

/**
 * Send feedback through the background worker.
 *
 * Signed-in users are identified by the uid the background stamps from their
 * own token (see addFeedback) — nothing to pass here. `email` is the optional
 * reply address a signed-out user typed, and is folded into the text.
 *
 * Resolves true on success. Never throws: every failure path is a false, and
 * callers turn that into a retry offer.
 */
export async function sendFeedback(text: string, email = ''): Promise<boolean> {
    const composed = clampToBytes(composeFeedbackText(text, email), MAX_FEEDBACK_BYTES);
    if (!composed) return false;
    try {
        const res = await sendMessage<{ ok: boolean }>({
            action: 'SEND_FEEDBACK',
            text: composed,
            site: location.hostname,
            version: chrome.runtime.getManifest().version,
            locale: chrome.i18n?.getUILanguage?.() ?? '',
        });
        return res?.ok === true;
    } catch {
        return false;
    }
}

/** Shared copy, so the card and the sidebar screen never drift apart. */
export const feedbackCopy = {
    hint: () => i18nMsg('ytRateFeedbackHint', 'What went wrong? What would you change?'),
    send: () => i18nMsg('ytRateSend', 'Send'),
    sending: () => i18nMsg('ytRateSending', 'Sending…'),
    sent: () => i18nMsg('ytRateFeedbackSent', 'Thank you, this really helps.'),
    failed: () => i18nMsg('ytRateFeedbackFailed', "Couldn't send. Try again?"),
    /**
     * How much room is left, as words rather than a lone number. The counter is
     * aria-live, so a bare "12" announced on every keystroke tells a screen
     * reader nothing about what is running out.
     */
    charsLeft: (n: number) =>
        i18nMsg('ytFeedbackCharsLeft', '{n} characters left').replace('{n}', String(n)),
};
