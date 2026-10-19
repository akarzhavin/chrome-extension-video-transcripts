// Which gated features this account has (english repo spec 032-feature-rollout-admin).
// The worker asks GET /dictionary/features and keeps the answer in
// chrome.storage.local; the server still refuses a feature the account lacks
// (404 feature_off), so this cache only saves wasted requests.

import { onTabReturn } from './tab-return';

export const FEATURE_AI = 'ai';
export const FEATURE_AI_TRANSLATE = 'subtitles.ai_translate';
export const FEATURE_SECOND_TRACK = 'subtitles.second_track';

/** The keys the extension reads; the server's map may carry others. */
export type FeatureKey = typeof FEATURE_AI | typeof FEATURE_AI_TRANSLATE | typeof FEATURE_SECOND_TRACK;

/** Which keys each capability needs; callers name the capability, never the keys. */
const NEEDS = {
    /** The AI credits badge, its panel and its warning note. */
    badge: [],
    translation: [FEATURE_AI_TRANSLATE],
    /** The second track named in a part request, the gender hint. */
    hint: [FEATURE_AI_TRANSLATE, FEATURE_SECOND_TRACK],
} satisfies Record<string, FeatureKey[]>;
export type Gate = keyof typeof NEEDS;

// AI is the master switch: off, every AI capability is closed.
const keysOf = (gate: Gate): FeatureKey[] => [FEATURE_AI, ...NEEDS[gate]];

/** Whether gate needs key, e.g. to tell a refused hint from refused translation. */
export function gateNeeds(gate: Gate, key: string): boolean {
    return (keysOf(gate) as string[]).includes(key);
}

const isKey = (k: string): k is FeatureKey => k === FEATURE_AI || k === FEATURE_AI_TRANSLATE || k === FEATURE_SECOND_TRACK;

/** The worker message a view sends to have the features asked (auth/background.ts). */
const FEATURES_REFRESH = 'FEATURES_REFRESH';

const KEY = 'features';
/** When the last read failed; a separate key, so watchers do not wake on it. */
const TRIED_KEY = 'featuresTried';
/** How long an answer stands before a translation part asks again. */
const MAX_AGE_MS = 10 * 60 * 1000;
/** After a failed read, how long a translation part waits before asking again. */
const RETRY_MS = 60 * 1000;
/** A view asks again on a return to its tab at most this often. */
const REASK_MS = 60 * 1000;

// On for everyone on the server; a failed read must not switch it off.
const DEFAULTS: Partial<Record<FeatureKey, boolean>> = { [FEATURE_AI]: true, [FEATURE_AI_TRANSLATE]: true };

interface Kept {
    features: Record<string, boolean>;
    at: number;
}

/** The server's map of feature key to on/off; null when malformed. */
function parseFeatures(raw: unknown): Record<string, boolean> | null {
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

const on = (kept: Kept | null, key: FeatureKey): boolean => kept?.features[key] ?? DEFAULTS[key] ?? false;

/** Whether the account has key, by the last answer; unknown keys use the defaults. */
export async function hasFeature(key: FeatureKey): Promise<boolean> {
    return on(await load(), key);
}

/** Whether the account may use gate now, by the last answer. */
export async function gateOpen(gate: Gate): Promise<boolean> {
    const kept = await load();
    return keysOf(gate).every((k) => on(kept, k));
}

/** Calls cb with whether gate is open now and on every change of the answer; returns the stop. */
export function watchGate(gate: Gate, cb: (open: boolean) => void): () => void {
    let last: boolean | undefined;
    const check = () =>
        void gateOpen(gate).then((open) => {
            if (open === last) return;
            last = open;
            cb(open);
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

// --- The worker's side: asking the server, and its refusals.

/** True when there is no answer or it is older than MAX_AGE_MS, unless a read failed under RETRY_MS ago. */
async function stale(now: number): Promise<boolean> {
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
async function markFeatureOff(key: FeatureKey): Promise<void> {
    const kept = (await load()) ?? { features: {}, at: 0 };
    await chrome.storage.local.set({ [KEY]: { ...kept, features: { ...kept.features, [key]: false } } });
}

/**
 * A 404 {code: 'feature_off', feature} names the feature the account lacks: it is off until the
 * next answer. Returns the named key ('' when unnamed), or null for any other reply; never throws.
 */
export async function featureRefused(status: number, body: Record<string, unknown>): Promise<string | null> {
    if (status !== 404 || body.code !== 'feature_off') return null;
    const key = typeof body.feature === 'string' ? body.feature : '';
    try {
        if (isKey(key)) await markFeatureOff(key);
    } catch {
        // Storage gone: the server refuses again next time.
    }
    return key;
}

// Bumped at sign-out: an ask begun before it writes nothing, its answer was the old account's.
let account = 0;

/** Dropped with the credentials: the answer is this account's. */
export async function forgetFeatures(): Promise<void> {
    account++;
    await chrome.storage.local.remove([KEY, TRIED_KEY]);
}

export interface FeatureDeps {
    fetch: (url: string, init: RequestInit) => Promise<Response>;
    /** refresh=true forces a new ID token (after a 401). Throws when not signed in. */
    token: (refresh: boolean) => Promise<{ idToken: string }>;
    now?: () => number;
}

type Answer = Record<string, boolean> | null;

// Views opening together, and parts asked meanwhile, share the one request in flight.
let inFlight: { account: number; answer: Promise<Answer> } | null = null;

/** Asks the server and keeps the answer; null when signed out, unreachable or malformed. */
export function refreshFeatures(baseUrl: string, deps: FeatureDeps): Promise<Answer> {
    if (!baseUrl) return Promise.resolve(null);
    if (inFlight?.account === account) return inFlight.answer;
    const mine = { account, answer: ask(baseUrl, deps, account) };
    inFlight = mine;
    void mine.answer.finally(() => {
        if (inFlight === mine) inFlight = null;
    });
    return mine.answer;
}

/** Before a translation part: asks only when the answer is stale (see MAX_AGE_MS, RETRY_MS). */
export async function ensureFresh(baseUrl: string, deps: FeatureDeps): Promise<void> {
    if (await stale((deps.now ?? Date.now)())) await refreshFeatures(baseUrl, deps);
}

async function ask(baseUrl: string, deps: FeatureDeps, asker: number): Promise<Answer> {
    const url = `${baseUrl.replace(/\/+$/, '')}/dictionary/features`;
    const get = async (refresh: boolean) => {
        const { idToken } = await deps.token(refresh);
        return deps.fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${idToken}` } });
    };
    const now = deps.now ?? Date.now;
    const keep = async (o: Record<string, unknown>) => {
        if (asker === account) await chrome.storage.local.set(o);
    };
    try {
        let res = await get(false);
        if (res.status === 401) res = await get(true);
        const features = res.ok ? parseFeatures(await res.json()) : null;
        if (features) await keep({ [KEY]: { features, at: now() } });
        else await keep({ [TRIED_KEY]: now() });
        return asker === account ? features : null;
    } catch {
        try {
            await keep({ [TRIED_KEY]: now() });
        } catch {
            // Storage gone: the next part simply asks again.
        }
        return null;
    }
}

// --- A view's side: when to have the worker ask.

function askWorker(): void {
    try {
        chrome.runtime.sendMessage({ action: FEATURES_REFRESH }, () => void chrome.runtime.lastError);
    } catch {
        // Orphaned context: the gates keep the last answer.
    }
}

/** A view opening asks at once, and again on each return to its tab, at most once a minute; returns the stop. */
export function followFeatures(doc: Document): () => void {
    askWorker();
    return onTabReturn(doc, REASK_MS, askWorker);
}
