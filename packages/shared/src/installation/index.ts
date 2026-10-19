// The installation (english repo spec 034-guest-ai-rollout): its ID, its record on the server,
// the guest check and the link at sign-in. Worker-only; not on the package barrel, and the only entry.

import { config } from '../auth/config';
import { refreshGuestFeatures, type FeatureDeps } from '../features/worker';
import type { Edition } from '../sibling';
import { mintInstallationId, readInstallationId } from './id';
import { linkInstallation } from './link';
import { recordInstallation } from './record';

export { readInstallationId } from './id';

const plainFetch = { fetch: (u: string, i: RequestInit) => fetch(u, i) };

// Named by installInstallation; null in a build that never did, which then asks and links nothing.
let edition: Edition | null = null;

/** Mints the ID if missing (fresh decides its flag only then) and records it unless recorded; null when storage fails. */
async function ensureInstallation(ed: Edition, fresh: boolean): Promise<string | null> {
    const id = await mintInstallationId(fresh);
    if (id) await recordInstallation(config.apiBaseUrl, ed, plainFetch);
    return id;
}

/** Worker start: mint at install/update, independent of the analytics switch; retry a pending record now. */
export function installInstallation(ed: Edition): void {
    edition = ed;
    chrome.runtime.onInstalled.addListener((details) => {
        if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) void ensureInstallation(ed, true);
        else if (details.reason === chrome.runtime.OnInstalledReason.UPDATE) void ensureInstallation(ed, false);
    });
    // No mint here: on a fresh install it would beat the INSTALL event and record the install as an update.
    // No record without an ID either: the INSTALL event's record would share one that found none.
    void readInstallationId().then((id) => {
        if (id) void recordInstallation(config.apiBaseUrl, ed, plainFetch);
    });
}

/** Signed out: which features the server shows this installation, kept as a guest answer; null without an edition, ID or answer. */
export function guestCheck(): Promise<Record<string, boolean> | null> {
    const ed = edition;
    if (!ed) return Promise.resolve(null);
    return refreshGuestFeatures(config.apiBaseUrl, { ...plainFetch, id: () => ensureInstallation(ed, false) });
}

/** At a sign-in hand-off only: links this installation to the account; false without an edition or on failure. Never throws. */
export function linkAtSignIn(signedIn: Pick<FeatureDeps, 'fetch' | 'token'>): Promise<boolean> {
    const ed = edition;
    if (!ed) return Promise.resolve(false);
    return linkInstallation(config.apiBaseUrl, ed, { ...signedIn, id: () => ensureInstallation(ed, false) });
}
