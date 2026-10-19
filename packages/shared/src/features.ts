// Which gated features this account has (english repo spec 032-feature-rollout-admin).
// The worker asks GET /dictionary/features and keeps the answer in
// chrome.storage.local; the server still refuses a feature the account lacks
// (404 feature_off), so this cache only saves wasted requests.

export const FEATURE_AI = 'ai';
export const FEATURE_SUBTITLES = 'subtitles.ai_translate';
export const FEATURE_SECOND_TRACK = 'subtitles.second_track';

const KEY = 'features';
/** When the last read failed; a separate key, so watchers do not wake on it. */
const TRIED_KEY = 'featuresTried';
/** How long an answer stands before the worker asks again. */
const MAX_AGE_MS = 10 * 60 * 1000;
/** After a failed read, how long a translation part waits before asking again. */
const RETRY_MS = 60 * 1000;

// On for everyone on the server; a failed read must not switch it off.
const DEFAULTS: Record<string, boolean> = { [FEATURE_AI]: true, [FEATURE_SUBTITLES]: true };

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

/** True when there is no answer or it is older than MAX_AGE_MS, unless a read failed under RETRY_MS ago. */
export async function staleFeatures(now: number = Date.now()): Promise<boolean> {
    const kept = await load();
    if (kept && now - kept.at < MAX_AGE_MS && now >= kept.at) return false;
    let tried: unknown;
    try {
        tried = (await chrome.storage.local.get(TRIED_KEY))[TRIED_KEY];
    } catch {
        return true;
    }
    return typeof tried !== 'number' || now - tried >= RETRY_MS || now < tried;
}

/** The server refused key: off until the next answer. */
export async function markFeatureOff(key: string): Promise<void> {
    const kept = (await load()) ?? { features: {}, at: 0 };
    await chrome.storage.local.set({ [KEY]: { ...kept, features: { ...kept.features, [key]: false } } });
}

/** Dropped with the credentials: the answer is this account's. */
export async function forgetFeatures(): Promise<void> {
    await chrome.storage.local.remove(KEY);
    await chrome.storage.local.remove(TRIED_KEY);
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
    const now = deps.now ?? Date.now;
    try {
        let res = await ask(false);
        if (res.status === 401) res = await ask(true);
        const features = res.ok ? parseFeatures(await res.json()) : null;
        if (features) await chrome.storage.local.set({ [KEY]: { features, at: now() } });
        else await chrome.storage.local.set({ [TRIED_KEY]: now() });
        return features;
    } catch {
        try {
            await chrome.storage.local.set({ [TRIED_KEY]: now() });
        } catch {
            // Storage gone: the next part simply asks again.
        }
        return null;
    }
}

/** Calls cb with whether the account has key now and on every change of the answer. */
export function watchFeature(key: string, cb: (on: boolean) => void): () => void {
    return watchFeatures([key], cb);
}

/** Like watchFeature, on only while the account has every one of keys. */
export function watchFeatures(keys: string[], cb: (on: boolean) => void): () => void {
    let last: boolean | undefined;
    const check = () =>
        void Promise.all(keys.map(hasFeature)).then((all) => {
            const on = all.every(Boolean);
            if (on === last) return;
            last = on;
            cb(on);
        });
    check();
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
        if (area === 'local' && KEY in changes) check();
    };
    try {
        chrome.storage.onChanged.addListener(listener);
    } catch {
        return () => undefined;
    }
    return () => chrome.storage.onChanged.removeListener(listener);
}
