// The "Share anonymous usage stats" choice, one for both editions.
//
// Each edition sends its own events and reads its own flag (analytics-bg.ts,
// isAnalyticsEnabled). A learner who opts out on the settings page means both,
// so the change is written here and passed to the other edition over the
// channel the editions already use. A second edition installed later starts
// from the first one's "off" instead of the default "on".
//
// Worker-side only: it reaches analytics-bg, which carries the GA4 api_secret.

import { track } from './analytics-bg';
import { loadPrefs, savePrefs } from './prefs';
import { answerPrefRequest, setPrefEverywhere, siblingHas, type SiblingPref } from './sibling-pref';

const ANALYTICS: SiblingPref = {
    getOp: 'analyticsGet',
    setOp: 'analyticsSet',
    read: async () => (await loadPrefs()).analyticsEnabled,
    async apply(on) {
        // Reported BEFORE the flag is written: the event is the last one the gate
        // lets through. Only when it is on right now, so a repeated "off" does not
        // report an opt-out that already happened.
        if (!on && (await loadPrefs()).analyticsEnabled) await track('analytics_opt_out');
        await savePrefs({ analyticsEnabled: on });
    },
};

export const setAnalyticsEverywhere = (on: boolean) => setPrefEverywhere(ANALYTICS, on);

export const answerAnalyticsRequest = (message: unknown) => answerPrefRequest(ANALYTICS, message);

/**
 * On a fresh install: if the other edition is already opted out, so is this
 * one. Never turns analytics on: an edition that is on, absent or silent
 * leaves the default alone.
 */
export async function adoptAnalyticsOptOut(): Promise<void> {
    if (await siblingHas(ANALYTICS, false)) await savePrefs({ analyticsEnabled: false });
}
