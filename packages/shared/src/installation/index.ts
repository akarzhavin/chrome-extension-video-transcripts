// The installation (english repo spec 034-guest-ai-rollout): its ID, its record on the server,
// the guest check and the link at sign-in. Worker-only; not on the package barrel.

import { mintInstallationId } from './id';

export type Edition = 'youtube' | 'rezka';

export { readInstallationId } from './id';

/** Mints the ID if missing (fresh decides its flag only then); returns it, null when storage fails. */
export async function ensureInstallation(opts: { edition: Edition; fresh: boolean }): Promise<string | null> {
    return mintInstallationId(opts.fresh);
}
