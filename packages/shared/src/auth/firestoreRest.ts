import { AuthConfig } from './config';
import { refreshIdToken } from './firebaseRest';
import { AuthState, getAuthState, setAuthState } from './storage';

// Injected at build time from infrastructure/lingogram-limits.json — the same
// file the Firestore rule generator consumes. Single source of truth.
const MAX_WORDS_PER_DAY = __LIMIT_MAX_WORDS_PER_DAY__;
const MAX_TERM_BYTES = __LIMIT_MAX_TERM_BYTES__;
const MAX_CONTEXT_BYTES = __LIMIT_MAX_CONTEXT_BYTES__;
const MAX_FEEDBACK_TEXT_BYTES = __LIMIT_MAX_FEEDBACK_TEXT_BYTES__;

const REFRESH_LEEWAY_MS = 60_000;

async function ensureFreshToken(cfg: AuthConfig): Promise<AuthState> {
    const state = await getAuthState();
    if (!state) throw new Error('Not signed in');
    if (state.expiresAt > Date.now() + REFRESH_LEEWAY_MS) return state;
    const refreshed = await refreshIdToken(cfg, state.refreshToken);
    const next: AuthState = { ...state, ...refreshed };
    await setAuthState(next);
    return next;
}

function todayBucket(): number {
    const d = new Date();
    return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

// Firestore web SDK auto-IDs use 20 chars from this charset. We mirror it so
// the generated paths look indistinguishable from server-allocated ones.
const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function generateFirestoreId(): string {
    const buf = new Uint8Array(20);
    crypto.getRandomValues(buf);
    let id = '';
    for (let i = 0; i < 20; i++) id += ID_CHARS[buf[i] % ID_CHARS.length];
    return id;
}

interface SentinelState {
    dailyCount: number;
    dayBucket: number;
}

interface FirestoreDocument {
    name: string;
    fields?: Record<string, { integerValue?: string }>;
}

function sentinelDocPath(cfg: AuthConfig, uid: string): string {
    return `${cfg.firestoreUrl}/v1/projects/${cfg.projectId}/databases/(default)/documents/inbox/${encodeURIComponent(uid)}`;
}

async function getSentinel(cfg: AuthConfig, idToken: string, uid: string): Promise<SentinelState | null> {
    const res = await fetch(sentinelDocPath(cfg, uid), {
        headers: { 'Authorization': `Bearer ${idToken}` },
    });
    if (res.status === 404) return null;
    if (res.status === 401) {
        // Caller catches this sentinel to trigger a token refresh.
        throw new Error('Firestore sentinel 401');
    }
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Firestore GET sentinel ${res.status}: ${text || res.statusText}`);
    }
    const doc = (await res.json()) as FirestoreDocument;
    const fields = doc.fields ?? {};
    const dailyCount = parseInt(fields.dailyCount?.integerValue ?? '0', 10);
    const dayBucket = parseInt(fields.dayBucket?.integerValue ?? '0', 10);
    return { dailyCount, dayBucket };
}

interface CommitWrite {
    update: {
        name: string;
        fields: Record<string, unknown>;
    };
    currentDocument?: { exists?: boolean };
    updateTransforms?: Array<{ fieldPath: string; setToServerValue?: string }>;
}

interface AddInboxWordInput {
    term: string;
    // prev + current + next subtitle lines, main language only. Empty when the
    // pill was created outside of a subtitle item (defensive — quick-add only
    // ever fires inside one today).
    context?: string;
}

interface AddInboxWordResult {
    wordId: string;
    documentPath: string;
}

interface CommitResponse {
    writeResults?: Array<unknown>;
    commitTime?: string;
}

function buildWrites(
    cfg: AuthConfig,
    uid: string,
    input: AddInboxWordInput,
    sentinel: SentinelState | null,
): { writes: CommitWrite[]; wordId: string; documentPath: string } {
    const today = todayBucket();
    const newCount = sentinel && sentinel.dayBucket === today ? sentinel.dailyCount + 1 : 1;
    if (newCount > MAX_WORDS_PER_DAY) {
        throw new Error(`Daily limit of ${MAX_WORDS_PER_DAY} words reached. Try again tomorrow.`);
    }
    const wordId = generateFirestoreId();
    const basePath = `projects/${cfg.projectId}/databases/(default)/documents/inbox/${uid}`;
    const wordPath = `${basePath}/words/${wordId}`;

    const wordFields: Record<string, unknown> = {
        term: { stringValue: input.term },
        source: { stringValue: cfg.source },
        processed: { booleanValue: false },
    };
    // Only emit context when non-empty — Firestore rules treat it as optional
    // and writing an empty string would burn bytes for nothing.
    if (input.context) wordFields.context = { stringValue: input.context };

    const writes: CommitWrite[] = [
        {
            update: {
                name: wordPath,
                fields: wordFields,
            },
            currentDocument: { exists: false },
            // Set addedAt to server's request.time so the rule's
            // `addedAt == request.time` always holds — a client-side
            // `new Date().toISOString()` drifts by network latency and
            // mismatches at millisecond precision.
            updateTransforms: [
                { fieldPath: 'addedAt', setToServerValue: 'REQUEST_TIME' },
            ],
        },
        {
            update: {
                name: basePath,
                fields: {
                    dailyCount: { integerValue: String(newCount) },
                    dayBucket: { integerValue: String(today) },
                },
            },
            updateTransforms: [
                { fieldPath: 'lastAddedAt', setToServerValue: 'REQUEST_TIME' },
            ],
        },
    ];
    return { writes, wordId, documentPath: wordPath };
}

// Firestore rules' string.size() counts UTF-8 bytes, not JS chars. Match
// the same units client-side so the friendly error stays in sync with what
// the server would reject.
function utf8Bytes(s: string): number {
    return new TextEncoder().encode(s).length;
}

export function truncateBytes(s: string, maxBytes: number): string {
    const enc = new TextEncoder();
    if (enc.encode(s).length <= maxBytes) return s;
    let lo = 0, hi = s.length;
    while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if (enc.encode(s.slice(0, mid)).length <= maxBytes) lo = mid;
        else hi = mid - 1;
    }
    // Step back if `lo` landed inside a UTF-16 surrogate pair — TextEncoder
    // turns a lone high surrogate into U+FFFD (3 bytes), which the binary
    // search would otherwise accept as a "valid" partial result.
    while (lo > 0) {
        const code = s.charCodeAt(lo - 1);
        if (code >= 0xD800 && code <= 0xDBFF) lo--;
        else break;
    }
    return s.slice(0, lo);
}

export interface FeedbackInput {
    /** What the user typed. Truncated to MAX_FEEDBACK_TEXT_BYTES before send. */
    text: string;
    /** Hostname the card was shown on. */
    site: string;
    /** Extension version (manifest). */
    version: string;
    /** Browser UI locale. */
    locale: string;
}

// Free-text feedback from the rating prompt's "not really" branch.
//
// Unlike every other write here this one runs SIGNED OUT as well: the people
// most worth hearing from are the ones who never made an account, and asking
// them to sign in first would lose exactly that feedback. Auth, when present,
// only stamps the uid so a reply is possible later.
//
// Signed-out writes cost us the per-user daily cap that guards /diagnostics
// (no uid to pin a doc id to), so the cap is global: one counter doc per UTC
// day that this commit must advance by exactly +1. The read-then-write is
// racy by construction — two concurrent submissions compute the same next
// count and one loses on the rule's getAfter() check. That is a dropped
// message, not a corrupted counter, and the caller swallows it.
export async function addFeedback(cfg: AuthConfig, input: FeedbackInput): Promise<void> {
    const text = truncateBytes(input.text.trim(), MAX_FEEDBACK_TEXT_BYTES);
    if (!text) throw new Error('empty feedback');

    // Best-effort auth: a signed-in user gets their uid on the doc, a signed-out
    // one (or one whose refresh fails) still gets to send.
    let uid = '';
    let idToken = '';
    try {
        const state = await ensureFreshToken(cfg);
        uid = state.uid;
        idToken = state.idToken;
    } catch {
        /* signed out — the rules allow this path with uid === '' */
    }

    const dayId = String(todayBucket());
    const quotaName = `projects/${cfg.projectId}/databases/(default)/documents/feedbackQuota/${dayId}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (idToken) headers['Authorization'] = `Bearer ${idToken}`;

    // Read today's counter to compute the next value. A 404 means nobody has
    // written today yet, so we open the day at 1.
    const quotaRes = await fetch(
        `${cfg.firestoreUrl}/v1/${quotaName}`,
        { headers },
    );
    let nextCount = 1;
    if (quotaRes.ok) {
        const doc = (await quotaRes.json()) as FirestoreDocument;
        const current = Number(doc.fields?.count?.integerValue ?? 0);
        nextCount = (Number.isFinite(current) ? current : 0) + 1;
    } else if (quotaRes.status !== 404) {
        throw new Error(`Firestore feedbackQuota get ${quotaRes.status}`);
    }

    const writes: CommitWrite[] = [
        {
            update: {
                // Id is pinned to `{day}_{count}` — the rules use it to stop N
                // docs riding one counter bump (two would need the same id).
                name: `projects/${cfg.projectId}/databases/(default)/documents/feedback/${dayId}_${nextCount}`,
                fields: {
                    text: { stringValue: text },
                    uid: { stringValue: uid },
                    site: { stringValue: truncateBytes(input.site, 100) },
                    version: { stringValue: truncateBytes(input.version, 32) },
                    locale: { stringValue: truncateBytes(input.locale, 16) },
                    source: { stringValue: cfg.source },
                },
            },
            currentDocument: { exists: false },
            updateTransforms: [{ fieldPath: 'addedAt', setToServerValue: 'REQUEST_TIME' }],
        },
        {
            update: {
                name: quotaName,
                fields: { count: { integerValue: String(nextCount) } },
            },
            updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        },
    ];

    const res = await fetch(
        `${cfg.firestoreUrl}/v1/projects/${cfg.projectId}/databases/(default)/documents:commit`,
        { method: 'POST', headers, body: JSON.stringify({ writes }) },
    );
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Firestore feedback commit ${res.status}: ${body || res.statusText}`);
    }
}

export interface NoSubsReportInput {
    /** Hostname the failure happened on (rezka mirror / youtube / netflix). */
    site: string;
    /** Video id when the site has one, else the page URL. */
    videoRef: string;
    /** Extension version (manifest). */
    version: string;
    /** Browser UI locale. */
    locale: string;
    /** The language the user is learning (their chosen pair; e.g. "es"). */
    learning: string;
    /** The user's native language from the same pair (e.g. "ru"). */
    native: string;
}

// One-shot diagnostic written when the user hits the emergency "Reload page"
// button on the no-subtitles banner — the qualifier copy ("this video HAS
// subtitles but we aren't showing them") makes each click a meaningful bug
// report for the admins. Best-effort: callers swallow failures (signed-out,
// rules rejection, daily-dupe) — a report must never get in the way of the
// reload. The doc id is pinned to `{uid}_{YYYYMMDD}` and the write is
// create-only: the Firestore rules use that as a sentinel-free spam cap of
// one report per user per UTC day (a same-day second click is rejected and
// swallowed — systemic breakage shows up as many users, not many clicks).
export async function addNoSubsReport(cfg: AuthConfig, input: NoSubsReportInput): Promise<void> {
    const state = await ensureFreshToken(cfg);
    const reportId = `${state.uid}_${todayBucket()}`;
    const name = `projects/${cfg.projectId}/databases/(default)/documents/diagnostics/${reportId}`;
    const writes: CommitWrite[] = [
        {
            update: {
                name,
                fields: {
                    kind: { stringValue: 'no_subs_after_retry' },
                    site: { stringValue: truncateBytes(input.site, 100) },
                    videoRef: { stringValue: truncateBytes(input.videoRef, 500) },
                    version: { stringValue: truncateBytes(input.version, 32) },
                    locale: { stringValue: truncateBytes(input.locale, 16) },
                    learning: { stringValue: truncateBytes(input.learning, 16) },
                    native: { stringValue: truncateBytes(input.native, 16) },
                    source: { stringValue: cfg.source },
                },
            },
            currentDocument: { exists: false },
            updateTransforms: [{ fieldPath: 'addedAt', setToServerValue: 'REQUEST_TIME' }],
        },
    ];
    const res = await fetch(
        `${cfg.firestoreUrl}/v1/projects/${cfg.projectId}/databases/(default)/documents:commit`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${state.idToken}`,
            },
            body: JSON.stringify({ writes }),
        },
    );
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Firestore diagnostics commit ${res.status}: ${text || res.statusText}`);
    }
}

export async function addInboxWord(cfg: AuthConfig, input: AddInboxWordInput): Promise<AddInboxWordResult> {
    const termBytes = utf8Bytes(input.term);
    if (termBytes === 0 || termBytes > MAX_TERM_BYTES) {
        throw new Error(`term must be 1..${MAX_TERM_BYTES} bytes (UTF-8)`);
    }
    if (input.context && utf8Bytes(input.context) > MAX_CONTEXT_BYTES) {
        // Truncating silently keeps the term submission going. Trim from the
        // end so the keyword's own subtitle (in the middle) survives.
        input = { ...input, context: truncateBytes(input.context, MAX_CONTEXT_BYTES) };
    }

    let state = await ensureFreshToken(cfg);

    let sentinel: SentinelState | null;
    try {
        sentinel = await getSentinel(cfg, state.idToken, state.uid);
    } catch (err) {
        // The proactive ensureFreshToken usually prevents 401s on the read,
        // but if Firestore disagrees about token expiry we retry once.
        if (err instanceof Error && err.message === 'Firestore sentinel 401') {
            const refreshed = await refreshIdToken(cfg, state.refreshToken);
            state = { ...state, ...refreshed };
            await setAuthState(state);
            sentinel = await getSentinel(cfg, state.idToken, state.uid);
        } else {
            throw err;
        }
    }

    const { writes, wordId, documentPath } = buildWrites(cfg, state.uid, input, sentinel);
    const commitUrl = `${cfg.firestoreUrl}/v1/projects/${cfg.projectId}/databases/(default)/documents:commit`;
    const body = JSON.stringify({ writes });

    let res = await fetch(commitUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${state.idToken}`,
        },
        body,
    });

    if (res.status === 401) {
        const refreshed = await refreshIdToken(cfg, state.refreshToken);
        state = { ...state, ...refreshed };
        await setAuthState(state);
        res = await fetch(commitUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${state.idToken}`,
            },
            body,
        });
    }

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Firestore commit ${res.status}: ${text || res.statusText}`);
    }

    await res.json() as CommitResponse;
    return { wordId, documentPath };
}
