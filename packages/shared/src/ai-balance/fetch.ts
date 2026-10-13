// Worker-only: GET /dictionary/ai/balance (signed in) and /dictionary/ai/limits
// (public), asked once when a view opens.
// Never imported by a content script (the edge's CORS list has no
// chrome-extension:// origin; the worker sends none).

import { parseBalance, parseLimits, type AIBalance, type AILimits } from './types';
import { loadLimits, saveBalance, saveLimits } from './store';
import { getAuthState } from '../auth/storage';

// A sign-out during the call already cleared the balance; it must not come back.
async function saveIfSignedIn(b: AIBalance): Promise<void> {
    if (await getAuthState()) await saveBalance(b);
}

export interface BalanceDeps {
    fetch: (url: string, init: RequestInit) => Promise<Response>;
    /** refresh=true forces a new ID token (after a 401). Throws when not signed in. */
    token: (refresh: boolean) => Promise<{ idToken: string }>;
}

/** The caller's balance, stored for every view; null when signed out or unreachable. */
export async function refreshBalance(baseUrl: string, deps: BalanceDeps): Promise<AIBalance | null> {
    if (!baseUrl) return null;
    const url = `${baseUrl.replace(/\/+$/, '')}/dictionary/ai/balance`;
    const ask = async (refresh: boolean) => {
        const { idToken } = await deps.token(refresh);
        return deps.fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${idToken}` } });
    };
    try {
        let res = await ask(false);
        if (res.status === 401) res = await ask(true);
        if (!res.ok) return null;
        const b = parseBalance(await res.json());
        if (b) await saveIfSignedIn(b);
        return b;
    } catch {
        return null;
    }
}

/** Keeps a balance an AI answer carried; a missing or malformed one is ignored. */
export async function keepBalance(raw: unknown): Promise<void> {
    const b = parseBalance(raw);
    if (b) await saveIfSignedIn(b);
}

/** How long stored limits stand in for a read: an operator setting, it rarely moves. */
const LIMITS_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * The server's default limits, GET /dictionary/ai/limits: public, no token.
 * Read for a signed-out view, which shows what signing in unlocks; stored for
 * every view. Stored ones younger than LIMITS_MAX_AGE_MS are reused without
 * a request. Null when unreachable or malformed, and nothing is stored.
 */
export async function refreshLimits(
    baseUrl: string,
    deps: Pick<BalanceDeps, 'fetch'>,
    now: number = Date.now(),
): Promise<AILimits | null> {
    if (!baseUrl) return null;
    const kept = await loadLimits();
    if (kept && now - kept.at >= 0 && now - kept.at < LIMITS_MAX_AGE_MS) return kept;
    try {
        const res = await deps.fetch(`${baseUrl.replace(/\/+$/, '')}/dictionary/ai/limits`, { method: 'GET' });
        if (!res.ok) return null;
        const d = parseLimits(await res.json(), now);
        if (d) await saveLimits(d);
        return d;
    } catch {
        return null;
    }
}
