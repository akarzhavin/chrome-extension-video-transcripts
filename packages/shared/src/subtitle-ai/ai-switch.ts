// The dev-only switch that forces AI translation even over a site's native
// track, one for both editions, kept like the stats choice (analytics-consent.ts);
// an edition installed later starts from the other one's "on".
// Every caller is behind the __EXT_ENV__ literal.

import { loadPrefs, savePrefs } from '../prefs';
import { answerPrefRequest, setPrefEverywhere, siblingHas, type SiblingPref } from '../sibling-pref';

const AI_FORCE: SiblingPref = {
    getOp: 'aiTranslateForceGet',
    setOp: 'aiTranslateForceSet',
    read: async () => (await loadPrefs()).aiTranslateForce,
    apply: (on) => savePrefs({ aiTranslateForce: on }),
};

export const setAiTranslateForceEverywhere = (on: boolean) => setPrefEverywhere(AI_FORCE, on);

export const answerAiTranslateForceRequest = (message: unknown) => answerPrefRequest(AI_FORCE, message);

/** On a fresh install: on if the other edition has it on. Off is the default already. */
export async function adoptAiTranslateForce(): Promise<void> {
    if (await siblingHas(AI_FORCE, true)) await savePrefs({ aiTranslateForce: true });
}
