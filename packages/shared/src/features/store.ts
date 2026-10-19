// The account's feature answer in chrome.storage.local: every view reads it, the worker writes it.
// The server still refuses a feature the account lacks, so this cache only saves wasted requests.

import { AUTH_STATE_KEYS, getAuthState } from '../auth/storage';
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

/** Signed in by the worker's own rule (getAuthState), so a view and the worker never disagree. */
async function readSignedIn(): Promise<boolean> {
    try {
        return (await getAuthState()) !== null;
    } catch {
        return false;
    }
}

/** Whether gate is open now, by the last answer and who is signed in. */
export async function gateOpen(gate: Gate): Promise<boolean> {
    const [kept, signedIn] = await Promise.all([loadFeatures(), readSignedIn()]);
    return isGateOpen(kept, gate, signedIn);
}

/** Calls cb with whether gate is open, once both the answer and the sign-in are known, and on every change; returns the stop. */
export function watchGate(gate: Gate, cb: (open: boolean) => void): () => void {
    let last: boolean | undefined;
    let kept: Kept | null | undefined;
    let signedIn: boolean | undefined;
    const report = () => {
        if (kept === undefined || signedIn === undefined) return;
        const open = isGateOpen(kept, gate, signedIn);
        if (open === last) return;
        last = open;
        cb(open);
    };
    // A change seen first is newer than the first read; the change carries the answer, so no read.
    void loadFeatures().then((k) => {
        if (kept !== undefined) return;
        kept = k;
        report();
    });
    // Only the latest auth read lands, so a slow first one cannot undo a sign-in seen since.
    let check = 0;
    const checkSignedIn = () => {
        const mine = ++check;
        void readSignedIn().then((s) => {
            if (mine !== check) return;
            signedIn = s;
            report();
        });
    };
    checkSignedIn();
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
        if (area !== 'local') return;
        if (KEY in changes) {
            kept = asKept(changes[KEY].newValue);
            report();
        }
        if (AUTH_STATE_KEYS.some((k) => k in changes)) checkSignedIn();
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

// One write at a time, so markOff's read and write never straddle a newer answer's write.
let writes: Promise<unknown> = Promise.resolve();
function serial<T>(write: () => Promise<T>): Promise<T> {
    const run = writes.then(write);
    writes = run.catch(() => undefined);
    return run;
}

/** Keeps a server answer, unless a sign-out or sign-in came since; returns whether it was kept. */
export function keepAnswer(features: Record<string, boolean>, at: number, since: number, as?: 'guest'): Promise<boolean> {
    return serial(async () => {
        if (since !== account) return false;
        await chrome.storage.local.set({ [KEY]: { features, at, ...(as ? { as } : {}) } satisfies Kept });
        return true;
    });
}

/** Stamps a failed read, unless a sign-out came since. */
export function keepTried(at: number, since: number): Promise<void> {
    return serial(async () => {
        if (since === account) await chrome.storage.local.set({ [TRIED_KEY]: at });
    });
}

/** The server refused key: off until the next answer, unless a sign-out came since; unread keys are ignored. */
export function markOff(key: string, since: number): Promise<void> {
    return serial(async () => {
        if (!isFeatureKey(key) || since !== account) return;
        const kept = (await loadFeatures()) ?? { features: {}, at: 0 };
        await chrome.storage.local.set({ [KEY]: { ...kept, features: { ...kept.features, [key]: false } } });
    });
}

/** Dropped with the credentials, and at sign-in (a guest's answer is not the account's). Queued, so writes begun before it land first. */
export function forgetFeatures(): Promise<void> {
    account++;
    return serial(() => chrome.storage.local.remove([KEY, TRIED_KEY]));
}
