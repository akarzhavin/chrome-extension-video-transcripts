// The installation (english repo spec 034-guest-ai-rollout): its ID, its record on the server,
// the guest check and the link at sign-in. Worker-only; not on the package barrel.

import { config } from '../auth/config';
import { mintInstallationId } from './id';
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
