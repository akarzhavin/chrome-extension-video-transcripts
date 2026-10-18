// Which gated features this account has (english repo spec 032-feature-rollout-admin).
// The worker asks GET /dictionary/features and keeps the answer in
// chrome.storage.local; the server still refuses a feature the account lacks
// (404 feature_off), so this cache only saves wasted requests.

export const FEATURE_SUBTITLES = 'subtitles.ai_translate';
export const FEATURE_SECOND_TRACK = 'subtitles.second_track';

const KEY = 'features';
/** How long an answer stands before the worker asks again. */
const MAX_AGE_MS = 10 * 60 * 1000;

// On for everyone on the server; a failed read must not switch it off.
const DEFAULTS: Record<string, boolean> = { [FEATURE_SUBTITLES]: true };

interface Kept {
    features: Record<string, boolean>;
    at: number;
}

/** The server's map of feature key to on/off; null when malformed. */
export function parseFeatures(raw: unknown): Record<string, boolean> | null {
    const f = (raw as { features?: unknown } | null)?.features;
    if (!f || typeof f !== 'object') return null;
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(f)) if (typeof v === 'boolean') out[k] = v;
    return out;
}

async function load(): Promise<Kept | null> {
    try {
        const got = (await chrome.storage.local.get(KEY))[KEY] as Kept | undefined;
        return got && typeof got.at === 'number' && got.features ? got : null;
    } catch {
        return null;
    }
}

/** Whether the account has key, by the last answer; unknown keys use the defaults. */
export async function hasFeature(key: string): Promise<boolean> {
    const kept = await load();
    return kept?.features[key] ?? DEFAULTS[key] ?? false;
}

/** True when there is no answer or it is older than MAX_AGE_MS. */
export async function staleFeatures(now: number = Date.now()): Promise<boolean> {
    const kept = await load();
    return !kept || now - kept.at >= MAX_AGE_MS || now < kept.at;
}

/** The server refused key: off until the next answer. */
export async function markFeatureOff(key: string): Promise<void> {
    const kept = (await load()) ?? { features: {}, at: 0 };
    await chrome.storage.local.set({ [KEY]: { ...kept, features: { ...kept.features, [key]: false } } });
}

/** Dropped with the credentials: the answer is this account's. */
export async function forgetFeatures(): Promise<void> {
    await chrome.storage.local.remove(KEY);
}

export interface FeatureDeps {
    fetch: (url: string, init: RequestInit) => Promise<Response>;
    /** refresh=true forces a new ID token (after a 401). Throws when not signed in. */
    token: (refresh: boolean) => Promise<{ idToken: string }>;
    now?: () => number;
}

/** Asks the server and keeps the answer; null when signed out, unreachable or malformed. */
export async function refreshFeatures(baseUrl: string, deps: FeatureDeps): Promise<Record<string, boolean> | null> {
    if (!baseUrl) return null;
    const url = `${baseUrl.replace(/\/+$/, '')}/dictionary/features`;
    const ask = async (refresh: boolean) => {
        const { idToken } = await deps.token(refresh);
        return deps.fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${idToken}` } });
    };
    try {
        let res = await ask(false);
        if (res.status === 401) res = await ask(true);
        if (!res.ok) return null;
        const features = parseFeatures(await res.json());
        if (features) await chrome.storage.local.set({ [KEY]: { features, at: (deps.now ?? Date.now)() } });
        return features;
    } catch {
        return null;
    }
}
