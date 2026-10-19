// The installation ID (english repo spec 034): minted once, kept across updates and sign-outs.
// Never imports analytics, and analytics never imports this: the two IDs must not meet.

import { INSTALLATION_KEYS } from '../auth/storage';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Concurrent callers share one mint, or two would both see no ID and the second write would win.
let minting: Promise<string | null> | null = null;

async function stored(): Promise<string | null> {
    const id: unknown = (await chrome.storage.local.get(INSTALLATION_KEYS.id))[INSTALLATION_KEYS.id];
    return typeof id === 'string' && UUID.test(id) ? id : null;
}

/** The stored ID; null when there is none or storage cannot be read. Mints nothing. */
export const readInstallationId = (): Promise<string | null> => stored().catch(() => null);

/** The ID, minted with fresh when there is none; null when storage fails. */
export function mintInstallationId(fresh: boolean): Promise<string | null> {
    minting ??= mintOrRead(fresh).finally(() => {
        minting = null;
    });
    return minting;
}

async function mintOrRead(fresh: boolean): Promise<string | null> {
    try {
        const got = await stored();
        if (got) return got;
        const id = crypto.randomUUID().toLowerCase();
        await chrome.storage.local.set({ [INSTALLATION_KEYS.id]: id, [INSTALLATION_KEYS.fresh]: fresh });
        return id;
    } catch {
        // Fails closed: an ID minted on an unreadable store would be a new install every wake.
        return null;
    }
}
