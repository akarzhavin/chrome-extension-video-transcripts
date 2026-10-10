// The AI translation switch, one for both editions, kept like the stats choice
// (analytics-consent.ts); an edition installed later starts from the other one's "on".
// Dev-only until it ships: every caller is behind the __EXT_ENV__ literal.

import { loadPrefs, savePrefs } from '../prefs';
import { answerPrefRequest, setPrefEverywhere, siblingHas, type SiblingPref } from '../sibling-pref';

const AI_SWITCH: SiblingPref = {
    getOp: 'aiTranslateGet',
    setOp: 'aiTranslateSet',
    read: async () => (await loadPrefs()).aiTranslate,
    apply: (on) => savePrefs({ aiTranslate: on }),
};

export const setAiTranslateEverywhere = (on: boolean) => setPrefEverywhere(AI_SWITCH, on);

export const answerAiTranslateRequest = (message: unknown) => answerPrefRequest(AI_SWITCH, message);

/** On a fresh install: on if the other edition has it on. Off is the default already. */
export async function adoptAiTranslate(): Promise<void> {
    if (await siblingHas(AI_SWITCH, true)) await savePrefs({ aiTranslate: true });
}
