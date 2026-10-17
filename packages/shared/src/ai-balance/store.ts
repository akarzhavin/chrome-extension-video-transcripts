// The latest AI balance, kept by the service worker in chrome.storage.local:
// every view (sidebar, popup, cards) already listens there, so one write
// reaches all open tabs without the worker messaging each.

import { parseBalance, parseDefaultAILimits, type AIBalance, type DefaultAILimits } from './types';
import { clearWarned } from './warn';

const BALANCE_KEY = 'ai.balance';
/** Not the account's: the server's default limits, kept across sign-outs. */
const DEFAULT_LIMITS_KEY = 'ai.defaultLimits';

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

export async function saveDefaultAILimits(d: DefaultAILimits): Promise<void> {
    await chrome.storage.local.set({ [DEFAULT_LIMITS_KEY]: d });
}

/** The stored default limits; null when never read or unreadable. */
export async function loadDefaultAILimits(): Promise<DefaultAILimits | null> {
    try {
        const got = await chrome.storage.local.get(DEFAULT_LIMITS_KEY);
        return parseDefaultAILimits(got[DEFAULT_LIMITS_KEY]);
    } catch {
        return null;
    }
}

/** Calls back on every change of the stored default limits; returns the unsubscribe. */
export function onDefaultAILimits(cb: (d: DefaultAILimits | null) => void): () => void {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
        if (area !== 'local' || !(DEFAULT_LIMITS_KEY in changes)) return;
        cb(parseDefaultAILimits(changes[DEFAULT_LIMITS_KEY].newValue));
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
