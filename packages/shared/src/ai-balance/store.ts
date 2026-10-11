// The latest AI balance, kept by the service worker in chrome.storage.local:
// every view (sidebar, popup, cards) already listens there, so one write
// reaches all open tabs without the worker messaging each.

import { parseBalance, type AIBalance } from './types';

export const BALANCE_KEY = 'ai.balance';

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

/** Dropped with the credentials: it is this account's budget. */
export async function clearBalance(): Promise<void> {
    await chrome.storage.local.remove(BALANCE_KEY);
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
