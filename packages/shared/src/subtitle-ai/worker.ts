// Service-worker half of server-side subtitle translation (english repo, spec
// 023, contracts/subtitle-part-endpoint.md and firestore-subtitle-tracks.md).
//
// Every outcome is returned, never thrown: a thrown "Firestore commit 403"
// matches background.ts' isAuthFailure and would sign the learner out.

import type { AuthConfig } from '../auth/config';
import { SUBTITLE_TTL_DAYS, type WireCue } from './track';

// Mirror SUBTITLE_* in english/infrastructure/lingogram-limits.json.
const WRITES_PER_DAY = 30;
// Firestore's document limit is 1 MiB; field names and framing need headroom.
const MAX_DOC_BYTES = 1_000_000;

export interface WorkerDeps {
    fetch: (url: string, init: RequestInit) => Promise<Response>;
    /** refresh=true forces a new ID token (after a 401). Throws when not signed in. */
    token: (refresh: boolean) => Promise<{ idToken: string; uid: string }>;
    now: () => number;
}

export interface PartRequest {
    fingerprint: string;
    lang: string;
    from: number;
    to: number;
}

export type PartCode = 'track_unknown' | 'auth' | 'quota' | 'invalid' | 'quarantined' | 'unavailable';

export type PartReply =
    | { ok: true; from: number; to: number; lines: string[] }
    | { ok: false; code: PartCode; retryAfterMs?: number; resetsAt?: number };

export interface StoredTrack {
    fingerprint: string;
    sourceLang: string;
    site: string;
    durationMs: number;
    cues: WireCue[];
}

export type StoreReply = { ok: true } | { ok: false; reason: 'refused' | 'too_long' | 'auth' | 'network' };

// The id goes into a URL path and a Firestore document name: nothing but the fingerprint.
const FINGERPRINT = /^[0-9a-f]{64}$/;

function retryAfterMs(res: Response): number | undefined {
    const s = Number(res.headers.get('Retry-After'));
    return Number.isFinite(s) && s > 0 ? s * 1000 : undefined;
}

async function body(res: Response): Promise<Record<string, unknown>> {
    try {
        const b = await res.json();
        return b && typeof b === 'object' ? (b as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

export async function requestPart(cfg: AuthConfig, req: PartRequest, deps: WorkerDeps): Promise<PartReply> {
    if (!FINGERPRINT.test(req.fingerprint)) return { ok: false, code: 'invalid' };
    const url = `${cfg.apiBaseUrl}/dictionary/subtitles/${req.fingerprint}/part`;
    const ask = async (refresh: boolean) => {
        const { idToken } = await deps.token(refresh);
        return deps.fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
            body: JSON.stringify({ lang: req.lang, from: req.from, to: req.to }),
        });
    };
    let res: Response;
    try {
        res = await ask(false);
        if (res.status === 401) res = await ask(true);
    } catch (err) {
        return { ok: false, code: err instanceof Error && err.message === 'Not signed in' ? 'auth' : 'unavailable' };
    }
    const b = await body(res);
    if (res.ok) {
        const lines = Array.isArray(b.lines) ? b.lines.map((l) => (typeof l === 'string' ? l : '')) : [];
        return { ok: true, from: Number(b.from), to: Number(b.to), lines };
    }
    switch (res.status) {
        case 401:
        case 403:
            return { ok: false, code: 'auth' };
        case 404:
            return { ok: false, code: b.code === 'track_unknown' ? 'track_unknown' : 'unavailable' };
        case 422:
            return { ok: false, code: 'invalid' };
        case 429:
            return typeof b.resets_at === 'number'
                ? { ok: false, code: 'quota', resetsAt: b.resets_at }
                : { ok: false, code: 'quota', ...(retryAfterMs(res) ? { retryAfterMs: retryAfterMs(res) } : {}) };
        case 503:
            if (b.code === 'quarantined') return { ok: false, code: 'quarantined' };
            return { ok: false, code: 'unavailable', ...(retryAfterMs(res) ? { retryAfterMs: retryAfterMs(res) } : {}) };
        default:
            return { ok: false, code: 'unavailable' };
    }
}

const dayBucket = (ms: number): number => {
    const d = new Date(ms);
    return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
};

const int = (n: number) => ({ integerValue: String(n) });

/**
 * Creates subtitle_tracks/{fingerprint} and advances write_limits/{uid} in one
 * commit, as the rules require. Any refusal — exists, too soon, over the day —
 * looks the same: the caller asks the backend once more.
 */
export async function storeTrack(cfg: AuthConfig, track: StoredTrack, deps: WorkerDeps): Promise<StoreReply> {
    if (!FINGERPRINT.test(track.fingerprint)) return { ok: false, reason: 'refused' };
    let approx = 200;
    for (const c of track.cues) approx += new TextEncoder().encode(c.text).length + 48;
    if (approx > MAX_DOC_BYTES) return { ok: false, reason: 'too_long' };

    const docs = `projects/${cfg.projectId}/databases/(default)/documents`;
    let auth: { idToken: string; uid: string };
    try {
        auth = await deps.token(false);
    } catch {
        return { ok: false, reason: 'auth' };
    }
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.idToken}` };
    const now = deps.now();
    const today = dayBucket(now);
    try {
        const cur = await deps.fetch(`${cfg.firestoreUrl}/v1/${docs}/write_limits/${auth.uid}`, { method: 'GET', headers });
        let count = 1;
        if (cur.ok) {
            const f = ((await body(cur)).fields ?? {}) as Record<string, { integerValue?: string }>;
            if (Number(f.day?.integerValue) === today) count = Number(f.day_count?.integerValue ?? 0) + 1;
        } else if (cur.status !== 404) {
            return { ok: false, reason: 'refused' };
        }
        if (count > WRITES_PER_DAY) return { ok: false, reason: 'refused' };

        const writes = [
            {
                update: { name: `${docs}/write_limits/${auth.uid}`, fields: { day: int(today), day_count: int(count) } },
                updateTransforms: [{ fieldPath: 'last_at', setToServerValue: 'REQUEST_TIME' }],
            },
            {
                update: {
                    name: `${docs}/subtitle_tracks/${track.fingerprint}`,
                    fields: {
                        source_lang: { stringValue: track.sourceLang },
                        site: { stringValue: track.site },
                        cue_count: int(track.cues.length),
                        duration_ms: int(track.durationMs),
                        cues: {
                            arrayValue: {
                                values: track.cues.map((c) => ({
                                    mapValue: { fields: { start_ms: int(c.start_ms), end_ms: int(c.end_ms), text: { stringValue: c.text } } },
                                })),
                            },
                        },
                        expire_at: { timestampValue: new Date(now + SUBTITLE_TTL_DAYS * 86_400_000).toISOString() },
                    },
                },
                currentDocument: { exists: false },
                updateTransforms: [{ fieldPath: 'created_at', setToServerValue: 'REQUEST_TIME' }],
            },
        ];
        const res = await deps.fetch(`${cfg.firestoreUrl}/v1/${docs}:commit`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ writes }),
        });
        return res.ok ? { ok: true } : { ok: false, reason: 'refused' };
    } catch {
        return { ok: false, reason: 'network' };
    }
}
