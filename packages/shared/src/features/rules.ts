// Which gated features an account has (english repo spec 032-feature-rollout-admin): the rules.
// Pure — no chrome.*, no DOM, no fetch: ./store keeps the answer, ./worker asks for it.

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

export const isFeatureKey = (k: string): k is FeatureKey =>
    k === FEATURE_AI || k === FEATURE_AI_TRANSLATE || k === FEATURE_SECOND_TRACK;

/** How long an answer stands before a translation part asks again. */
export const MAX_AGE_MS = 10 * 60 * 1000;
/** After a failed read, how long a translation part waits before asking again. */
export const RETRY_MS = 60 * 1000;

// On for everyone on the server; a failed read must not switch it off.
export const DEFAULTS: Readonly<Partial<Record<FeatureKey, boolean>>> = { [FEATURE_AI]: true, [FEATURE_AI_TRANSLATE]: true };

/** The last answer as kept: the server's map and when it came. */
export interface Kept {
    features: Record<string, boolean>;
    at: number;
    /** 'guest': the signed-out answer for this installation (spec 034); absent: the account's. */
    as?: 'guest';
}

/** Whether key is on by kept; a key it lacks, or no answer at all, takes the default. */
export const isOn = (kept: Kept | null, key: FeatureKey): boolean => kept?.features[key] ?? DEFAULTS[key] ?? false;

/** Whether gate is open, by kept: signed in, the account's answer or the defaults; signed out, a guest answer true for every key, no defaults (spec 034). */
export function isGateOpen(kept: Kept | null, gate: Gate, signedIn = true): boolean {
    if (!signedIn) return kept?.as === 'guest' && keysOf(gate).every((k) => kept.features[k] === true);
    const own = kept?.as === 'guest' ? null : kept;
    return keysOf(gate).every((k) => isOn(own, k));
}

/** True when there is no answer or it is older than MAX_AGE_MS, unless a read failed under RETRY_MS ago. */
export function isStale(kept: Kept | null, triedAt: number | null, now: number): boolean {
    if (kept && now - kept.at < MAX_AGE_MS && now >= kept.at) return false;
    return triedAt === null || now - triedAt >= RETRY_MS || now < triedAt;
}

/** The server's map of feature key to on/off; null when malformed. */
export function parseFeatures(raw: unknown): Record<string, boolean> | null {
    const f = (raw as { features?: unknown } | null)?.features;
    if (!f || typeof f !== 'object') return null;
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(f)) if (typeof v === 'boolean') out[k] = v;
    return out;
}

/** The key a 404 {code: 'feature_off', feature} refuses ('' when unnamed); null for any other reply. */
export function parseRefusal(status: number, body: Record<string, unknown>): string | null {
    if (status !== 404 || body.code !== 'feature_off') return null;
    return typeof body.feature === 'string' ? body.feature : '';
}
