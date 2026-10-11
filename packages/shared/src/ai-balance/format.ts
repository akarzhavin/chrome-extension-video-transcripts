import { msg } from '../i18n';
import type { AIBalance, AIStatus, AIWindow } from './types';

/** Share of the window used, 0–100; a window may overrun by one call. */
export function percentUsed(w: AIWindow): number {
    if (w.limit <= 0) return 100;
    return Math.min(100, Math.round((w.used * 100) / w.limit));
}

/** Tokens left, compact: 380k, 1.2M. */
export function formatTokens(n: number): string {
    const left = Math.max(0, Math.floor(n));
    if (left >= 1_000_000) return `${Math.floor(left / 100_000) / 10}M`;
    if (left >= 1_000) return `${Math.floor(left / 1_000)}k`;
    return String(left);
}

export const tokensLeft = (w: AIWindow): number => Math.max(0, w.limit - w.used);

/** The reset's local time of day, e.g. 03:00. */
export function localTime(ms: number): string {
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** The reset's local date, e.g. 1 Nov. */
export function localDate(ms: number): string {
    return new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export function resetsAtText(w: AIWindow): string {
    return msg('aiResetsAt', 'Resets at $1').replace('$1', localTime(w.resetsAt));
}

export function resetsOnText(w: AIWindow): string {
    return msg('aiResetsOn', 'Resets on $1').replace('$1', localDate(w.resetsAt));
}

/** What to say when a window ran out. */
export function limitText(window: 'day' | 'month', b: AIBalance | null): string {
    if (window === 'month') {
        const when = b ? localDate(b.month.resetsAt) : '';
        return msg('aiLimitMonth', 'AI limit for this month reached, resets on $1').replace('$1', when).replace(/,\s*$/, '');
    }
    const when = b ? localTime(b.day.resetsAt) : '';
    return msg('aiLimitDay', 'AI limit for today reached, resets at $1').replace('$1', when).replace(/,\s*$/, '');
}

/** The card notice for an answer whose model part was skipped. */
export function statusText(status: AIStatus, b: AIBalance | null): string {
    if (status === 'sign_in_required') return msg('aiSignInCard', 'Sign in so AI can complete the card');
    if (status === 'ai_paused') return msg('aiPaused', 'AI is paused for today for everyone. The dictionary still works.');
    return limitText(status === 'limit_month' ? 'month' : 'day', b);
}
