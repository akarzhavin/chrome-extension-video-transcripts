// The account's AI budget as the server reports it with every AI answer
// (english repo: specs/024-ai-token-wallet/contracts/wallet-balance.md).
// Zero imports: the worker, content scripts and the popup all parse it.

export interface AIWindow {
    used: number;
    limit: number;
    /** Epoch ms of the window's next reset (00:00 UTC). */
    resetsAt: number;
}

export interface AIBalance {
    day: AIWindow;
    month: AIWindow;
    exhausted: 'day' | 'month' | null;
    /** Share of a window at which to warn once. */
    warnRatio: number;
    /** When the worker received it. */
    at: number;
}

/** Why the model part of an answer is missing. */
export type AIStatus = 'sign_in_required' | 'limit_day' | 'limit_month' | 'ai_paused';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function parseWindow(raw: unknown): AIWindow | null {
    if (!raw || typeof raw !== 'object') return null;
    const w = raw as Record<string, unknown>;
    const used = num(w.used);
    const limit = num(w.limit);
    const resetsAt = num(w.resets_at ?? w.resetsAt);
    return used === null || limit === null || resetsAt === null ? null : { used, limit, resetsAt };
}

/** The wire `wallet` object (or a stored one), or null when it is not one. */
export function parseBalance(raw: unknown, now: number = Date.now()): AIBalance | null {
    if (!raw || typeof raw !== 'object') return null;
    const b = raw as Record<string, unknown>;
    const day = parseWindow(b.day);
    const month = parseWindow(b.month);
    if (!day || !month) return null;
    const exhausted = b.exhausted === 'day' || b.exhausted === 'month' ? b.exhausted : null;
    const ratio = num(b.warn_ratio ?? b.warnRatio);
    return {
        day,
        month,
        exhausted,
        warnRatio: ratio !== null && ratio > 0 && ratio < 1 ? ratio : 0.8,
        at: num(b.at) ?? now,
    };
}

export function parseAIStatus(raw: unknown): AIStatus | undefined {
    return raw === 'sign_in_required' || raw === 'limit_day' || raw === 'limit_month' || raw === 'ai_paused' ? raw : undefined;
}
