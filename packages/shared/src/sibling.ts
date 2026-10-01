// The two published editions, and the one message they exchange with each other.
//
// Both put "Save to Lingogram" in the right-click menu, and with both installed
// Chrome would list it twice. The YouTube edition keeps the item; the HDrezka
// edition asks whether its sibling is there and stands down if it answers.
//
// Store ids, not names: they are what chrome.runtime.sendMessage addresses and
// what sender.id carries. An unpacked dev build has a different id, matches
// neither, and keeps its own item — a dev session never hides anything.

export const EDITION_IDS = {
    youtube: 'pkoibjilnaeadmcnmfkgcjhalljbmfan',
    rezka: 'hmdkmkimdbomemfcjmgeclchbcdbhabj',
} as const;

/**
 * The only message one edition sends the other. `ping` asks "are you there?";
 * `sync` tells the yielding edition to look again (sent when the keeper is
 * installed or updated, so the duplicate disappears without a browser restart).
 */
export const SIBLING_MESSAGE_TYPE = 'lingogram-sibling';

export type SiblingMessage = { type: typeof SIBLING_MESSAGE_TYPE; op: 'ping' | 'sync' };

export function isSiblingMessage(message: unknown): message is SiblingMessage {
    return (
        typeof message === 'object' &&
        message !== null &&
        (message as { type?: unknown }).type === SIBLING_MESSAGE_TYPE
    );
}

/** The other published edition's id, or null for a build that is neither (dev). */
export function siblingOf(selfId: string): string | null {
    if (selfId === EDITION_IDS.youtube) return EDITION_IDS.rezka;
    if (selfId === EDITION_IDS.rezka) return EDITION_IDS.youtube;
    return null;
}
