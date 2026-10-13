// The latest AI balance, kept by the service worker in chrome.storage.local:
// every view (sidebar, popup, cards) already listens there, so one write
// reaches all open tabs without the worker messaging each.

import { parseBalance, parseDefaults, type AIBalance, type AIDefaults } from './types';
import { clearWarned } from './warn';

const BALANCE_KEY = 'ai.balance';
/** Not the account's: the server's default windows, kept across sign-outs. */
const DEFAULTS_KEY = 'ai.limits';

export async function saveBalance(b: AIBalance): Promise<void> {
    await chrome.storage.local.set({ [BALANCE_KEY]: b });
}

/** The stored balance; null when signed out, never fetched, or unreadable. */
export async function loadBalance(): Promise<AIBalance | null> {
    try {
        const got = await chrome.storage.local.get(BALANCE_KEY);
        return parseBalance(got[BALANCE_KEY]);
    } catch {
        return null;
    }
}

/** Dropped with the credentials: the balance and the warned marks are this account's. */
export async function clearAccountAI(): Promise<void> {
    await chrome.storage.local.remove(BALANCE_KEY);
    await clearWarned();
}

/** Calls back on every change of the stored balance; returns the unsubscribe. */
export function onBalance(cb: (b: AIBalance | null) => void): () => void {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
        if (area !== 'local' || !(BALANCE_KEY in changes)) return;
        cb(parseBalance(changes[BALANCE_KEY].newValue));
    };
    try {
        chrome.storage.onChanged.addListener(listener);
    } catch {
        return () => {};
    }
    return () => {
        try {
            chrome.storage.onChanged.removeListener(listener);
        } catch {
            /* orphaned context */
        }
    };
}

export async function saveDefaults(d: AIDefaults): Promise<void> {
    await chrome.storage.local.set({ [DEFAULTS_KEY]: d });
}

/** The stored default windows; null when never read or unreadable. */
export async function loadDefaults(): Promise<AIDefaults | null> {
    try {
        const got = await chrome.storage.local.get(DEFAULTS_KEY);
        return parseDefaults(got[DEFAULTS_KEY]);
    } catch {
        return null;
    }
}

/** Calls back on every change of the stored default windows; returns the unsubscribe. */
export function onDefaults(cb: (d: AIDefaults | null) => void): () => void {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
        if (area !== 'local' || !(DEFAULTS_KEY in changes)) return;
        cb(parseDefaults(changes[DEFAULTS_KEY].newValue));
    };
    try {
        chrome.storage.onChanged.addListener(listener);
    } catch {
        return () => {};
    }
    return () => {
        try {
            chrome.storage.onChanged.removeListener(listener);
        } catch {
            /* orphaned context */
        }
    };
}
