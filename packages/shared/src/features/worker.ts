// Worker-only: GET /dictionary/features, asked when a view opens, at sign-in, and before a part
// when the answer is stale. Never imported by a content script (it holds the token and the fetch).

import { isStale, parseFeatures, parseRefusal } from './rules';
import { accountGeneration, keepAnswer, keepTried, loadFeatures, loadTried, markOff } from './store';

export interface FeatureDeps {
    fetch: (url: string, init: RequestInit) => Promise<Response>;
    /** refresh=true forces a new ID token (after a 401). Throws when not signed in. */
    token: (refresh: boolean) => Promise<{ idToken: string }>;
    now?: () => number;
}

type Answer = Record<string, boolean> | null;

export interface FeatureClient {
    /** Asks the server and keeps the answer; null when signed out, unreachable or malformed. */
    refreshFeatures(baseUrl: string, deps: FeatureDeps): Promise<Answer>;
    /** Before a translation part: asks only when the answer is stale (rules.ts MAX_AGE_MS, RETRY_MS). */
    ensureFresh(baseUrl: string, deps: FeatureDeps): Promise<void>;
}

/** A client with its own request in flight: the worker uses the one exported below, a test its own. */
export function featureClient(): FeatureClient {
    // Views opening together, and parts asked meanwhile, share the one request in flight.
    let inFlight: { account: number; answer: Promise<Answer> } | null = null;

    const refreshFeatures = (baseUrl: string, deps: FeatureDeps): Promise<Answer> => {
        if (!baseUrl) return Promise.resolve(null);
        const account = accountGeneration();
        if (inFlight?.account === account) return inFlight.answer;
        const mine = { account, answer: ask(baseUrl, deps, account) };
        inFlight = mine;
        void mine.answer.finally(() => {
            if (inFlight === mine) inFlight = null;
        });
        return mine.answer;
    };

    const ensureFresh = async (baseUrl: string, deps: FeatureDeps): Promise<void> => {
        const now = (deps.now ?? Date.now)();
        if (isStale(await loadFeatures(), await loadTried(), now)) await refreshFeatures(baseUrl, deps);
    };

    return { refreshFeatures, ensureFresh };
}

export const { refreshFeatures, ensureFresh } = featureClient();

async function ask(baseUrl: string, deps: FeatureDeps, asker: number): Promise<Answer> {
    const url = `${baseUrl.replace(/\/+$/, '')}/dictionary/features`;
    const get = async (refresh: boolean) => {
        const { idToken } = await deps.token(refresh);
        return deps.fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${idToken}` } });
    };
    const now = deps.now ?? Date.now;
    try {
        let res = await get(false);
        if (res.status === 401) res = await get(true);
        const features = res.ok ? parseFeatures(await res.json()) : null;
        if (features) await keepAnswer(features, now(), asker);
        else await keepTried(now(), asker);
        return asker === accountGeneration() ? features : null;
    } catch {
        try {
            await keepTried(now(), asker);
        } catch {
            // Storage gone: the next part simply asks again.
        }
        return null;
    }
}

/** Parses a refusal and keeps it (off until the next answer); never throws. */
export async function featureRefused(status: number, body: Record<string, unknown>): Promise<string | null> {
    const key = parseRefusal(status, body);
    try {
        if (key) await markOff(key);
    } catch {
        // Storage gone: the server refuses again next time.
    }
    return key;
}
