// The installation (english repo spec 034-guest-ai-rollout): its ID, its record on the server,
// the guest check and the link at sign-in. Worker-only; not on the package barrel.

import { config } from '../auth/config';
import { mintInstallationId, readInstallationId } from './id';
import { recordInstallation } from './record';

export type Edition = 'youtube' | 'rezka';

export { readInstallationId } from './id';

const plainFetch = { fetch: (u: string, i: RequestInit) => fetch(u, i) };

/** Mints the ID if missing (fresh decides its flag only then) and records it unless recorded; null when storage fails. */
export async function ensureInstallation(opts: { edition: Edition; fresh: boolean }): Promise<string | null> {
    const id = await mintInstallationId(opts.fresh);
    if (id) await recordInstallation(config.apiBaseUrl, opts.edition, plainFetch);
    return id;
}

let edition: Edition | null = null;

/** The edition this worker runs, once installInstallation named it; null in other builds. */
export const installationEdition = (): Edition | null => edition;

/** Worker start: mint at install/update, independent of the analytics switch; retry a pending record now. */
export function installInstallation(ed: Edition): void {
    edition = ed;
    chrome.runtime.onInstalled.addListener((details) => {
        if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) void ensureInstallation({ edition: ed, fresh: true });
        else if (details.reason === chrome.runtime.OnInstalledReason.UPDATE) void ensureInstallation({ edition: ed, fresh: false });
    });
    // No mint here: on a fresh install it would beat the INSTALL event and record the install as an update.
    void readInstallationId().then((id) => id && recordInstallation(config.apiBaseUrl, ed, plainFetch));
}
