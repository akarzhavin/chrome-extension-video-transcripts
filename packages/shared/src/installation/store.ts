// The installation in chrome.storage.local (english repo spec 034): its ID, minted once and kept across
// updates and sign-outs, which backend recorded it and a link still owed. Never imports analytics: the two IDs must not meet.

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

/** What the backend at base has yet to record: 'recorded', the ID with its fresh flag, or null without an ID. Throws when storage does. */
export async function pendingRecord(base: string): Promise<'recorded' | { id: string; fresh: boolean } | null> {
    const got = await chrome.storage.local.get([INSTALLATION_KEYS.id, INSTALLATION_KEYS.fresh, INSTALLATION_KEYS.recorded]);
    // An earlier build kept `true`, naming no backend: recorded once more, which the server takes as a no-op.
    if (got[INSTALLATION_KEYS.recorded] === base) return 'recorded';
    const id = got[INSTALLATION_KEYS.id];
    return typeof id === 'string' && id ? { id, fresh: got[INSTALLATION_KEYS.fresh] === true } : null;
}

/** The backend at base recorded it: the fresh flag has done its job. Throws when storage does. */
export async function markRecorded(base: string): Promise<void> {
    await chrome.storage.local.set({ [INSTALLATION_KEYS.recorded]: base });
    await chrome.storage.local.remove(INSTALLATION_KEYS.fresh);
}

/** The base URL a failed sign-in link waits to be retried on; null when none. Throws when storage does. */
export async function pendingLink(): Promise<string | null> {
    const base: unknown = (await chrome.storage.local.get(INSTALLATION_KEYS.linkPending))[INSTALLATION_KEYS.linkPending];
    return typeof base === 'string' && base ? base : null;
}

/** A link failed (base) or landed (null). Throws when storage does. */
export async function keepLinkPending(base: string | null): Promise<void> {
    if (base) await chrome.storage.local.set({ [INSTALLATION_KEYS.linkPending]: base });
    else await chrome.storage.local.remove(INSTALLATION_KEYS.linkPending);
}
