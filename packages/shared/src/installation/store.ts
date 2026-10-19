// The installation in chrome.storage.local (english repo spec 034): its ID, minted once and kept across
// updates and sign-outs, and whether the server recorded it. Never imports analytics: the two IDs must not meet.

import { INSTALLATION_KEYS } from '../auth/keys';

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

/** What the server has yet to record: 'recorded', the ID with its fresh flag, or null without an ID. Throws when storage does. */
export async function pendingRecord(): Promise<'recorded' | { id: string; fresh: boolean } | null> {
    const got = await chrome.storage.local.get([INSTALLATION_KEYS.id, INSTALLATION_KEYS.fresh, INSTALLATION_KEYS.recorded]);
    if (got[INSTALLATION_KEYS.recorded] === true) return 'recorded';
    const id = got[INSTALLATION_KEYS.id];
    return typeof id === 'string' && id ? { id, fresh: got[INSTALLATION_KEYS.fresh] === true } : null;
}

/** The server recorded it: the fresh flag has done its job. Throws when storage does. */
export async function markRecorded(): Promise<void> {
    await chrome.storage.local.set({ [INSTALLATION_KEYS.recorded]: true });
    await chrome.storage.local.remove(INSTALLATION_KEYS.fresh);
}
