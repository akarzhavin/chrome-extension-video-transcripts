// The AI credits run out for now: what every offer of AI translation checks
// before it offers (the sidebar's row, Netflix's panel, HDrezka's CC menu).
// The stored balance marks a window exhausted with the answer that ran it
// out; the mark holds until that window resets, not until the next answer.

import { limitText, resetShort } from './format';
import { loadBalance, onBalance } from './store';
import type { AIBalance } from './types';

export interface AISpent {
    /** When it comes back, short: "02:00", or a date for the month. */
    until: string;
    /** The sentence: "AI limit for today reached, resets at 02:00". */
    text: string;
}

/** The window run out at `now`, said; null when credits are left (or unknown). */
export function spentNow(b: AIBalance | null, now: number = Date.now()): AISpent | null {
    if (!b?.exhausted) return null;
    const w = b.exhausted === 'day' ? b.day : b.month;
    if (w.resetsAt <= now) return null;
    return { until: resetShort(b.exhausted, b), text: limitText(b.exhausted, b) };
}

/**
 * Calls back with whether the credits are spent: once read, on every
 * balance change, and when the window resets. Returns the unsubscribe.
 */
export function watchSpent(cb: (spent: AISpent | null) => void): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let done = false;
    const take = (b: AIBalance | null) => {
        if (done) return;
        clearTimeout(timer);
        cb(spentNow(b));
        const w = b?.exhausted === 'day' ? b.day : b?.exhausted === 'month' ? b.month : null;
        // Back at the reset: said then, without waiting for an answer.
        if (w && w.resetsAt > Date.now()) timer = setTimeout(() => take(b), Math.min(w.resetsAt - Date.now() + 1000, 2 ** 31 - 1));
    };
    const unsubscribe = onBalance(take);
    void loadBalance().then(take);
    return () => {
        done = true;
        clearTimeout(timer);
        unsubscribe();
    };
}
