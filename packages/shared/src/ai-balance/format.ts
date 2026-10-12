import { msg } from '../i18n';
import type { AIBalance, AIStatus, AIWindow } from './types';

/** Share used, 0–100, rounded down: 100 only when the window is spent. */
export function percentUsed(w: AIWindow): number {
    if (w.limit <= 0 || w.used >= w.limit) return 100;
    return Math.floor((w.used * 100) / w.limit);
}

/** Past the warn ratio but not yet spent: the amber bar and the one-time warning. */
export const isHigh = (w: AIWindow, warnRatio: number): boolean =>
    w.limit > 0 && w.used >= warnRatio * w.limit && w.used < w.limit;

/** Tokens left, compact: 380k, 1.2M. */
export function formatTokens(n: number): string {
    const left = Math.max(0, Math.floor(n));
    if (left >= 1_000_000) return `${Math.floor(left / 100_000) / 10}M`;
    if (left >= 1_000) return `${Math.floor(left / 1_000)}k`;
    return String(left);
}

export const tokensLeft = (w: AIWindow): number => Math.max(0, w.limit - w.used);

/** The reset's local time of day, e.g. 03:00. */
function localTime(ms: number): string {
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** The reset's local date, e.g. 1 Nov. */
function localDate(ms: number): string {
    return new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export function resetsAtText(w: AIWindow): string {
    return msg('aiResetsAt', 'Resets at $1', [localTime(w.resetsAt)]);
}

export function resetsOnText(w: AIWindow): string {
    return msg('aiResetsOn', 'Resets on $1', [localDate(w.resetsAt)]);
}

/** The spent window's reset, short: a time for the day, a date for the month. */
export function resetShort(window: 'day' | 'month', b: AIBalance): string {
    return window === 'month' ? localDate(b.month.resetsAt) : localTime(b.day.resetsAt);
}

/** What to say when a window ran out. */
export function limitText(window: 'day' | 'month', b: AIBalance | null): string {
    const month = window === 'month';
    // No balance yet: no reset to name, so the short message without the clause.
    if (!b) return msg(month ? 'aiLimitMonthShort' : 'aiLimitDayShort', month ? 'AI limit for this month reached' : 'AI limit for today reached');
    return msg(
        month ? 'aiLimitMonth' : 'aiLimitDay',
        month ? 'AI limit for this month reached, resets on $1' : 'AI limit for today reached, resets at $1',
        [month ? localDate(b.month.resetsAt) : localTime(b.day.resetsAt)],
    );
}

/** The card notice for an answer whose model part was skipped. */
export function statusText(status: AIStatus, b: AIBalance | null, phrase = false): string {
    if (status === 'sign_in_required' && phrase) return msg('aiSignInTranslate', 'Sign in \u2014 AI will translate');
    if (status === 'sign_in_required') return msg('aiSignInCard', 'Sign in so AI can complete the card');
    if (status === 'ai_paused') return msg('aiPaused', 'AI is paused for today for everyone. The dictionary still works.');
    return limitText(status === 'limit_month' ? 'month' : 'day', b);
}
