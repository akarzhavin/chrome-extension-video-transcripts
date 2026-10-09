// The AI translation switch, one for both editions (english spec 023), the way
// analytics-consent.ts keeps the stats choice: written here and passed to the
// other edition; an edition installed later starts from the other one's "on".
// Dev-only until it ships: every caller is behind the __EXT_ENV__ literal.

import { loadPrefs, savePrefs } from '../prefs';
import { SIBLING_MESSAGE_TYPE, siblingIdsOf } from '../sibling';

export type AiTranslateRequest =
    | { type: typeof SIBLING_MESSAGE_TYPE; op: 'aiTranslateGet' }
    | { type: typeof SIBLING_MESSAGE_TYPE; op: 'aiTranslateSet'; on: boolean };

/** Stores the switch here and in the other edition, if it is installed. */
export async function setAiTranslateEverywhere(on: boolean): Promise<void> {
    await savePrefs({ aiTranslate: on });
    await Promise.all(
        siblingIdsOf(chrome.runtime.id).map(async (id) => {
            try {
                await chrome.runtime.sendMessage(id, { type: SIBLING_MESSAGE_TYPE, op: 'aiTranslateSet', on } satisfies AiTranslateRequest);
            } catch {
                // not installed, or too old to know the op
            }
        }),
    );
}

/** The other edition's get and set; null for any other message. */
export async function answerAiTranslateRequest(message: unknown): Promise<{ ok: boolean; on?: boolean; error?: string } | null> {
    const m = message as Partial<AiTranslateRequest> & { on?: unknown };
    if (m?.type !== SIBLING_MESSAGE_TYPE) return null;
    if (m.op === 'aiTranslateGet') return { ok: true, on: (await loadPrefs()).aiTranslate };
    if (m.op !== 'aiTranslateSet') return null;
    if (typeof m.on !== 'boolean') return { ok: false, error: 'on must be a boolean' };
    await savePrefs({ aiTranslate: m.on });
    return { ok: true };
}

/** On a fresh install: on if the other edition has it on. Off is the default already. */
export async function adoptAiTranslate(): Promise<void> {
    for (const id of siblingIdsOf(chrome.runtime.id)) {
        try {
            const res = (await chrome.runtime.sendMessage(id, {
                type: SIBLING_MESSAGE_TYPE,
                op: 'aiTranslateGet',
            } satisfies AiTranslateRequest)) as { ok?: boolean; on?: unknown } | undefined;
            if (res?.ok === true && res.on === true) {
                await savePrefs({ aiTranslate: true });
                return;
            }
        } catch {
            // that id is not installed
        }
    }
}
