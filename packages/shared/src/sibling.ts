// The two editions, and the one message they exchange with each other.
//
// Both put "Save to Lingogram" in the right-click menu, and with both installed
// Chrome would list it twice. They agree on one owner instead: the edition the
// learner is signed in to keeps the item. Signed in to both, or to neither, the
// YouTube edition keeps it. See ownsSharedFeatures.
//
// Addressed by extension id. A store build's id comes from its signing key and
// is fixed here; a dev build's comes from the fixed dev key its manifest
// carries, the same from any folder (vite-sibling-ids.mjs). A RELEASE build
// loaded unpacked has neither: its id comes from its folder and nobody knows it.

import { SIBLING_KEYS } from './auth/storage';

export type Edition = 'youtube' | 'rezka';

const STORE_IDS: Record<Edition, string> = {
    youtube: 'pkoibjilnaeadmcnmfkgcjhalljbmfan',
    rezka: 'hmdkmkimdbomemfcjmgeclchbcdbhabj',
};

// Replaced by the build (see apps/*/vite.config.ts); absent under jest.
declare const __SIBLING_DEV_IDS__: Partial<Record<Edition, string>>;
const DEV_IDS: Partial<Record<Edition, string>> =
    typeof __SIBLING_DEV_IDS__ === 'object' && __SIBLING_DEV_IDS__ !== null ? __SIBLING_DEV_IDS__ : {};

/** Store ids, for code and tests that need to name one edition. */
export const EDITION_IDS = STORE_IDS;

/** The edition that shows the shared features when it is not this one. */
export interface SharedOwner {
    edition: Edition;
    id: string;
}

/**
 * The other edition when it owns the page highlight and the menu item, else
 * null. Written by the worker each time it decides (context-menu-save.ts);
 * read by the popup and the settings bridge, which must not offer highlight
 * settings that the painting edition does not read.
 */
export async function loadSharedOwner(): Promise<SharedOwner | null> {
    try {
        const got = await chrome.storage.local.get(SIBLING_KEYS.owner);
        const o = got[SIBLING_KEYS.owner] as Partial<SharedOwner> | undefined;
        if (o && (o.edition === 'youtube' || o.edition === 'rezka') && typeof o.id === 'string') {
            return { edition: o.edition, id: o.id };
        }
    } catch {
        // no storage: this edition owns, as far as anyone can tell
    }
    return null;
}

/** Which edition an extension id belongs to, or null for any other build. */
export function editionOf(id: string): Edition | null {
    for (const e of ['youtube', 'rezka'] as const) {
        if (id === STORE_IDS[e] || (DEV_IDS[e] !== undefined && id === DEV_IDS[e])) return e;
    }
    return null;
}

/** Every id the other edition may have: its store id, and its dev id in a dev build. */
export function siblingIdsOf(selfId: string): string[] {
    const self = editionOf(selfId);
    if (!self) return [];
    const other: Edition = self === 'youtube' ? 'rezka' : 'youtube';
    return [STORE_IDS[other], DEV_IDS[other]].filter((id): id is string => !!id && id !== selfId);
}

/**
 * The only message one edition sends the other. `status` asks whether it is
 * there and signed in; `sync` tells it the asker's sign-in changed (or it was
 * just installed), so it should decide again now rather than at its next wake.
 */
export const SIBLING_MESSAGE_TYPE = 'lingogram-sibling';

export type SiblingMessage = {
    type: typeof SIBLING_MESSAGE_TYPE;
    // highlightGet / highlightSet: the highlight settings, kept by the edition that paints (highlight-prefs.ts).
    // analyticsGet / analyticsSet: the stats choice, one for both editions (analytics-consent.ts).
    // aiTranslateForceGet / aiTranslateForceSet: the switch forcing AI translation, likewise; dev builds only (subtitle-ai/ai-switch.ts).
    op: 'status' | 'sync' | 'highlightGet' | 'highlightSet' | 'analyticsGet' | 'analyticsSet' | 'aiTranslateForceGet' | 'aiTranslateForceSet';
};
export type SiblingStatus = { ok: true; signedIn: boolean };

export function isSiblingMessage(message: unknown): message is SiblingMessage {
    return (
        typeof message === 'object' &&
        message !== null &&
        (message as { type?: unknown }).type === SIBLING_MESSAGE_TYPE
    );
}

/**
 * Whether this edition shows the shared features (the menu item, page marks).
 * Both editions evaluate the same rule on the same two facts, so they always
 * agree on exactly one owner.
 */
export function ownsSharedFeatures(
    self: Edition | null,
    selfSignedIn: boolean,
    sibling: { signedIn: boolean } | null,
): boolean {
    if (!self || !sibling) return true;
    if (selfSignedIn !== sibling.signedIn) return selfSignedIn;
    return self === 'youtube';
}

/**
 * The other edition's answer, or null when it is not installed, disabled, or an
 * old version that does not accept this message. Null makes this edition show
 * its item: a duplicate is a nuisance, a missing item is a broken feature.
 */
export async function askSiblingStatus(): Promise<{ signedIn: boolean; id: string } | null> {
    for (const id of siblingIdsOf(chrome.runtime.id)) {
        try {
            const res = (await chrome.runtime.sendMessage(id, {
                type: SIBLING_MESSAGE_TYPE,
                op: 'status',
            })) as Partial<SiblingStatus> | undefined;
            if (res?.ok === true && typeof res.signedIn === 'boolean') return { signedIn: res.signedIn, id };
        } catch {
            // that id is not installed — try the next one.
        }
    }
    return null;
}
