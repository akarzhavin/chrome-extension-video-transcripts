// The one-time warning when a window crosses its warn ratio: remembered per
// window, so it shows once a day and once a month, whichever view saw it first.

import { isHigh } from './format';
import type { AIBalance } from './types';

const WARNED_KEYS = { day: 'ai.warned.day', month: 'ai.warned.month' } as const;

/** Warned marks belong to the account: the next one must be warned. */
export async function clearWarned(): Promise<void> {
    await chrome.storage.local.remove([WARNED_KEYS.day, WARNED_KEYS.month]);
}

/** The window's identity, from the UTC day before its reset: YYYYMMDD or YYYYMM. */
export function windowKey(window: 'day' | 'month', b: AIBalance): string {
    const d = new Date((window === 'day' ? b.day.resetsAt : b.month.resetsAt) - 1);
    const ym = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    return window === 'day' ? ym + String(d.getUTCDate()).padStart(2, '0') : ym;
}

/**
 * The window to warn about now, if any (the month first), recorded so it is
 * not warned again; null otherwise. An exhausted window is said by the limit
 * message instead.
 */
export async function takeWarning(b: AIBalance): Promise<'day' | 'month' | null> {
    const due = (['month', 'day'] as const).filter((w) => isHigh(b[w], b.warnRatio));
    if (due.length === 0) return null;
    try {
        const seen = await chrome.storage.local.get([WARNED_KEYS.day, WARNED_KEYS.month]);
        for (const w of due) {
            const key = windowKey(w, b);
            if (seen[WARNED_KEYS[w]] !== key) {
                await chrome.storage.local.set({ [WARNED_KEYS[w]]: key });
                return w;
            }
        }
    } catch {
        /* storage gone (orphaned context): no warning beats a repeated one */
    }
    return null;
}
