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
import { SIBLING_MESSAGE_TYPE, siblingIdsOf } from './sibling';

export type AnalyticsRequest =
    | { type: typeof SIBLING_MESSAGE_TYPE; op: 'analyticsGet' }
    | { type: typeof SIBLING_MESSAGE_TYPE; op: 'analyticsSet'; on: boolean };

/** Stores the choice in this edition. */
async function applyLocal(on: boolean): Promise<void> {
    // Reported BEFORE the flag is written: the event is the last one the gate
    // lets through. Only when it is on right now, so a repeated "off" does not
    // report an opt-out that already happened.
    if (!on && (await loadPrefs()).analyticsEnabled) await track('analytics_opt_out');
    await savePrefs({ analyticsEnabled: on });
}

/** Stores the choice here and in the other edition, if it is installed. */
export async function setAnalyticsEverywhere(on: boolean): Promise<void> {
    await applyLocal(on);
    await Promise.all(
        siblingIdsOf(chrome.runtime.id).map(async (id) => {
            try {
                await chrome.runtime.sendMessage(id, { type: SIBLING_MESSAGE_TYPE, op: 'analyticsSet', on } satisfies AnalyticsRequest);
            } catch {
                // not installed, or too old to know the op
            }
        }),
    );
}

/**
 * The other edition's get and set. Returns null for any other message, so the
 * caller can pass it on.
 */
export async function answerAnalyticsRequest(message: unknown): Promise<{ ok: boolean; on?: boolean; error?: string } | null> {
    const m = message as Partial<AnalyticsRequest> & { on?: unknown };
    if (m?.type !== SIBLING_MESSAGE_TYPE) return null;
    if (m.op === 'analyticsGet') return { ok: true, on: (await loadPrefs()).analyticsEnabled };
    if (m.op !== 'analyticsSet') return null;
    if (typeof m.on !== 'boolean') return { ok: false, error: 'on must be a boolean' };
    await applyLocal(m.on);
    return { ok: true };
}

/**
 * On a fresh install: if the other edition is already opted out, so is this
 * one. Never turns analytics on: an edition that is on, absent or silent
 * leaves the default alone.
 */
export async function adoptAnalyticsOptOut(): Promise<void> {
    for (const id of siblingIdsOf(chrome.runtime.id)) {
        try {
            const res = (await chrome.runtime.sendMessage(id, {
                type: SIBLING_MESSAGE_TYPE,
                op: 'analyticsGet',
            } satisfies AnalyticsRequest)) as { ok?: boolean; on?: unknown } | undefined;
            if (res?.ok === true && res.on === false) {
                await savePrefs({ analyticsEnabled: false });
                return;
            }
        } catch {
            // that id is not installed
        }
    }
}
