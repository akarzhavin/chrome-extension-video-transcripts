// The account's feature answer in chrome.storage.local: every view reads it, the worker writes it.
// The server still refuses a feature the account lacks, so this cache only saves wasted requests.

import { isFeatureKey, isGateOpen, type Gate, type Kept } from './rules';

const KEY = 'features';
/** When the last read failed; a separate key, so watchers do not wake on it. */
const TRIED_KEY = 'featuresTried';

const asKept = (raw: unknown): Kept | null => {
    const got = raw as Kept | undefined;
    return got && typeof got.at === 'number' && got.features ? got : null;
};

export async function loadFeatures(): Promise<Kept | null> {
    try {
        return asKept((await chrome.storage.local.get(KEY))[KEY]);
    } catch {
        return null;
    }
}

/** When the last read failed; null when none did, or storage is gone. */
export async function loadTried(): Promise<number | null> {
    try {
        const tried: unknown = (await chrome.storage.local.get(TRIED_KEY))[TRIED_KEY];
        return typeof tried === 'number' ? tried : null;
    } catch {
        return null;
    }
}

/** Whether the account may use gate now, by the last answer. */
export async function gateOpen(gate: Gate): Promise<boolean> {
    return isGateOpen(await loadFeatures(), gate);
}

/** Calls cb with whether gate is open now and on every change of the answer; returns the stop. */
export function watchGate(gate: Gate, cb: (open: boolean) => void): () => void {
    let last: boolean | undefined;
    let changed = false;
    const report = (open: boolean) => {
        if (open === last) return;
        last = open;
        cb(open);
    };
    // A change seen first is newer than the first read; the change carries the answer, so no read.
    void gateOpen(gate).then((open) => changed || report(open));
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
        if (area !== 'local' || !(KEY in changes)) return;
        changed = true;
        report(isGateOpen(asKept(changes[KEY].newValue), gate));
    };
    try {
        chrome.storage.onChanged.addListener(listener);
    } catch {
        return () => undefined;
    }
    return () => chrome.storage.onChanged.removeListener(listener);
}

// --- Writes. Only the worker writes, so only the worker's copy of `account` guards anything.

// Bumped at sign-out: a write begun under the old account is dropped, the answer was its.
let account = 0;

/** The sign-out count; a write passes the value read when its request began. */
export const accountGeneration = (): number => account;

/** Keeps a server answer, unless a sign-out came since; returns whether it was kept. */
export async function keepAnswer(features: Record<string, boolean>, at: number, since: number): Promise<boolean> {
    if (since !== account) return false;
    await chrome.storage.local.set({ [KEY]: { features, at } satisfies Kept });
    return true;
}

/** Stamps a failed read, unless a sign-out came since. */
export async function keepTried(at: number, since: number): Promise<void> {
    if (since === account) await chrome.storage.local.set({ [TRIED_KEY]: at });
}

/** The server refused key: off until the next answer, unless a sign-out came since; unread keys are ignored. */
export async function markOff(key: string, since: number): Promise<void> {
    if (!isFeatureKey(key) || since !== account) return;
    const kept = (await loadFeatures()) ?? { features: {}, at: 0 };
    if (since !== account) return;
    await chrome.storage.local.set({ [KEY]: { ...kept, features: { ...kept.features, [key]: false } } });
}

/** Dropped with the credentials: the answer is this account's. */
export async function forgetFeatures(): Promise<void> {
    account++;
    await chrome.storage.local.remove([KEY, TRIED_KEY]);
}
