// A pref kept in step between the two editions: written here and passed to the
// other one over the sibling channel, which answers with its own value.

import { SIBLING_MESSAGE_TYPE, siblingIdsOf, type SiblingMessage } from './sibling';

export interface SiblingPref {
    getOp: SiblingMessage['op'];
    setOp: SiblingMessage['op'];
    read(): Promise<boolean>;
    /** Stores a value set on the settings page or by the other edition. */
    apply(on: boolean): Promise<void>;
}

export type SiblingPrefAnswer = { ok: boolean; on?: boolean; error?: string };

/** Stores the value here and in the other edition, if it is installed. */
export async function setPrefEverywhere(pref: SiblingPref, on: boolean): Promise<void> {
    await pref.apply(on);
    await Promise.all(
        siblingIdsOf(chrome.runtime.id).map(async (id) => {
            try {
                await chrome.runtime.sendMessage(id, { type: SIBLING_MESSAGE_TYPE, op: pref.setOp, on });
            } catch {
                // not installed, or too old to know the op
            }
        }),
    );
}

/** The other edition's get and set; null for any other message, so the caller can pass it on. */
export async function answerPrefRequest(pref: SiblingPref, message: unknown): Promise<SiblingPrefAnswer | null> {
    const m = message as { type?: unknown; op?: unknown; on?: unknown } | null;
    if (m?.type !== SIBLING_MESSAGE_TYPE) return null;
    if (m.op === pref.getOp) return { ok: true, on: await pref.read() };
    if (m.op !== pref.setOp) return null;
    if (typeof m.on !== 'boolean') return { ok: false, error: 'on must be a boolean' };
    await pref.apply(m.on);
    return { ok: true };
}

/** Whether an installed other edition answers with `value`; for a fresh install to adopt it. */
export async function siblingHas(pref: SiblingPref, value: boolean): Promise<boolean> {
    for (const id of siblingIdsOf(chrome.runtime.id)) {
        try {
            const res = (await chrome.runtime.sendMessage(id, { type: SIBLING_MESSAGE_TYPE, op: pref.getOp })) as
                | { ok?: boolean; on?: unknown }
                | undefined;
            if (res?.ok === true && res.on === value) return true;
        } catch {
            // that id is not installed
        }
    }
    return false;
}
