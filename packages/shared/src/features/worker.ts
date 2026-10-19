// Worker-only: GET /dictionary/features, asked when a view opens, at sign-in, and before a part
// when the answer is stale; signed out, the guest route for the installation (spec 034).
// Never imported by a content script (it holds the token and the fetch).

import { isStale, parseFeatures } from './rules';
import { accountGeneration, keepAnswer, keepTried, loadFeatures, loadTried, markOff } from './store';

export interface FeatureDeps {
    fetch: (url: string, init: RequestInit) => Promise<Response>;
    /** refresh=true forces a new ID token (after a 401). Throws when not signed in. */
    token: (refresh: boolean) => Promise<{ idToken: string }>;
    now?: () => number;
}

export interface GuestDeps {
    fetch: (url: string, init: RequestInit) => Promise<Response>;
    /** The installation ID; null when there is none. */
    id: () => Promise<string | null>;
    now?: () => number;
}

type Answer = Record<string, boolean> | null;

export interface FeatureClient {
    /** Asks the server and keeps the answer; null when signed out, unreachable or malformed. */
    refreshFeatures(baseUrl: string, deps: FeatureDeps): Promise<Answer>;
    /** Signed out: asks for the installation, no token, and keeps the answer as a guest's; null on no ID or a failure. */
    refreshGuestFeatures(baseUrl: string, deps: GuestDeps): Promise<Answer>;
    /** Before a translation part: asks only when the answer is stale (rules.ts MAX_AGE_MS, RETRY_MS). */
    ensureFresh(baseUrl: string, deps: FeatureDeps): Promise<void>;
}

/** Callers meanwhile share the request in flight, unless a sign-in or sign-out came since it began. */
function oneAtATime(): (ask: (account: number) => Promise<Answer>) => Promise<Answer> {
    let inFlight: { account: number; answer: Promise<Answer> } | null = null;
    return (ask) => {
        const account = accountGeneration();
        if (inFlight?.account === account) return inFlight.answer;
        const mine = { account, answer: ask(account) };
        inFlight = mine;
        void mine.answer.finally(() => {
            if (inFlight === mine) inFlight = null;
        });
        return mine.answer;
    };
}

/** A client with its own requests in flight: the worker uses the one exported below, a test its own. */
export function featureClient(): FeatureClient {
    // Views opening together, and parts asked meanwhile, share the one request in flight.
    const asAccount = oneAtATime();
    const asGuest = oneAtATime();

    const refreshFeatures = (baseUrl: string, deps: FeatureDeps): Promise<Answer> =>
        baseUrl ? asAccount((account) => ask(baseUrl, deps, account)) : Promise.resolve(null);

    const refreshGuestFeatures = (baseUrl: string, deps: GuestDeps): Promise<Answer> =>
        baseUrl ? asGuest((account) => askAsGuest(baseUrl, deps, account)) : Promise.resolve(null);

    const ensureFresh = async (baseUrl: string, deps: FeatureDeps): Promise<void> => {
        const now = (deps.now ?? Date.now)();
        if (isStale(await loadFeatures(), await loadTried(), now)) await refreshFeatures(baseUrl, deps);
    };

    return { refreshFeatures, refreshGuestFeatures, ensureFresh };
}

// Made on first use, so importing this module starts nothing.
let worker: FeatureClient | undefined;
const client = () => (worker ??= featureClient());
export const refreshFeatures: FeatureClient['refreshFeatures'] = (baseUrl, deps) => client().refreshFeatures(baseUrl, deps);
export const refreshGuestFeatures: FeatureClient['refreshGuestFeatures'] = (baseUrl, deps) =>
    client().refreshGuestFeatures(baseUrl, deps);
export const ensureFresh: FeatureClient['ensureFresh'] = (baseUrl, deps) => client().ensureFresh(baseUrl, deps);

async function askAsGuest(baseUrl: string, deps: GuestDeps, asker: number): Promise<Answer> {
    try {
        const id = await deps.id();
        if (!id) return null;
        const url = `${baseUrl.replace(/\/+$/, '')}/dictionary/guest/features?installation=${encodeURIComponent(id)}`;
        const res = await deps.fetch(url, { method: 'GET' });
        const features = res.ok ? parseFeatures(await res.json()) : null;
        if (!features) return null;
        return (await keepAnswer(features, (deps.now ?? Date.now)(), asker, 'guest')) ? features : null;
    } catch {
        return null;
    }
}

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

/** For one request, made as it begins: keeps a feature the server refused, off until the next answer; never throws. */
export function refusalKeeper(): (key: string) => Promise<void> {
    // A refusal for a request begun before a sign-out was the old account's.
    const since = accountGeneration();
    return async (key) => {
        try {
            await markOff(key, since);
        } catch {
            // Storage gone: the server refuses again next time.
        }
    };
}
