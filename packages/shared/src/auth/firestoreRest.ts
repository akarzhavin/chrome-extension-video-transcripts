import { AuthConfig } from './config';
import { displayForm, normalizeTerm, wordKey } from '../word-key';
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
    // Names exactly the fields this write touches. Without it a commit is a
    // full REPLACE of the document — which for a re-activation would drop or
    // re-stamp `addedAt`, and this client could not build a correct replacement
    // anyway: its mirror holds state, not dates.
    updateMask?: { fieldPaths: string[] };
    currentDocument?: { exists?: boolean };
    updateTransforms?: Array<{ fieldPath: string; setToServerValue?: string }>;
}

export interface AddInboxWordInput {
    term: string;
    // prev + current + next subtitle lines, main language only. Empty when the
    // pill was created outside of a subtitle item (defensive — quick-add only
    // ever fires inside one today).
    context?: string;
    // The base form, when the caller has one. Carried into the document so the
    // site can group inflections without re-deriving them.
    lemma?: string;
}

export interface AddInboxWordResult {
    wordId: string;
    documentPath: string;
    // What the document says after this write. The caller mirrors it locally;
    // without it a save and a re-activation are indistinguishable to the mirror.
    state?: 'active' | 'removed';
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
    reactivate = false,
): { writes: CommitWrite[]; wordId: string; documentPath: string } {
    const today = todayBucket();
    const newCount = sentinel && sentinel.dayBucket === today ? sentinel.dailyCount + 1 : 1;
    if (newCount > MAX_WORDS_PER_DAY) {
        throw new Error(`Daily limit of ${MAX_WORDS_PER_DAY} words reached. Try again tomorrow.`);
    }
    // The id is the word's address, not a fresh random string: one word, one
    // document, addressable by any client that can compute the key.
    const wordId = wordKey(input.term);
    const basePath = `projects/${cfg.projectId}/databases/(default)/documents/inbox/${uid}`;
    const wordPath = `${basePath}/words/${wordId}`;

    // Two activation forms, chosen by what the mirror knows. Re-activation
    // cannot simply re-send the field set: a maskless commit is a full replace,
    // and the immutable fields would be dropped or re-stamped.
    const wordWrite: CommitWrite = reactivate
        ? {
            update: {
                name: wordPath,
                fields: { state: { stringValue: 'active' } },
            },
            // No addedAt transform: the immutable fields are never sent, so
            // they cannot be damaged. The rules compare against the STORED
            // document, so they still hold with nothing sent.
            updateMask: { fieldPaths: ['state', 'updatedAt'] },
            updateTransforms: [
                { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
            ],
        }
        : (() => {
            const wordFields: Record<string, unknown> = {
                term: { stringValue: normalizeTerm(input.term) },
                display: { stringValue: displayForm(input.term) },
                state: { stringValue: 'active' },
                source: { stringValue: cfg.source },
                // NO `processed`. It belonged to the legacy import-and-delete
                // flow, where the field is required, and it is absent from
                // every hashed document — the durable rule's allowlist does not
                // name it, so a body carrying it is REFUSED outright. Measured
                // on the emulator: the same body with and without this one
                // field is refused and accepted respectively.
            };
            // Only emit context when non-empty — Firestore rules treat it as
            // optional and writing an empty string would burn bytes for
            // nothing. A reader must not assume the field is always present.
            if (input.context) wordFields.context = { stringValue: input.context };
            if (input.lemma) wordFields.lemma = { stringValue: input.lemma };
            return {
                update: { name: wordPath, fields: wordFields },
                updateMask: {
                    fieldPaths: [...Object.keys(wordFields), 'addedAt', 'updatedAt'],
                },
                // Kept, and deliberately: it is what makes the seam work. A
                // device that has never synced uses this form, the server
                // refuses it because the document exists, and the client
                // retries with re-activation.
                currentDocument: { exists: false },
                // Set from the server's request.time so the rule's
                // `addedAt == request.time` always holds — a client clock
                // drifts by network latency and mismatches at ms precision.
                updateTransforms: [
                    { fieldPath: 'addedAt', setToServerValue: 'REQUEST_TIME' },
                    { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
                ],
            } as CommitWrite;
        })();

    const writes: CommitWrite[] = [
        wordWrite,
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
    /**
     * Why the fetch failed, in the extension's own vocabulary ('rate-limited',
     * 'not-offered', …). The app already computes this for the UI; without it
     * a report says only that subtitles were missing, which is the one thing we
     * could already tell from the fact that a report exists.
     */
    failure?: string;
    /** HTTP status behind the failure, when there was one. */
    status?: number;
    /** How many fetch attempts were made before giving up. */
    attempts?: number;
    /** Tracks that DID load — distinguishes "nothing" from "half of it". */
    tracksLoaded?: number;
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
                    failure: { stringValue: truncateBytes(input.failure ?? '', 32) },
                    status: { integerValue: String(input.status ?? 0) },
                    attempts: { integerValue: String(input.attempts ?? 0) },
                    tracksLoaded: { integerValue: String(input.tracksLoaded ?? 0) },
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

export async function addInboxWord(
    cfg: AuthConfig,
    input: AddInboxWordInput,
    opts: { reactivate?: boolean } = {},
): Promise<AddInboxWordResult> {
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

    const { writes, wordId, documentPath } = buildWrites(cfg, state.uid, input, sentinel, opts.reactivate);
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

    // THE SEAM. A device that has never synced cannot know whether this word
    // already has a document, so it sends the create form and lets the server
    // decide: `currentDocument: { exists: false }` against an existing document
    // is refused, and the correct answer is the re-activation form.
    //
    // The retry lives HERE, and the placement is the whole point. The refusal
    // arrives as `Firestore commit 403` — one of the exact strings
    // `isAuthFailure` matches in background.ts. Retried one level up, the first
    // save of an unsynced word would clear the auth state and raise the
    // re-authorisation badge: the learner signed out for saving a word they had
    // saved before. Below the classifier, the refusal never reaches it.
    //
    // Exactly once, and only for the create form. A second refusal escapes —
    // but NOT as a dead session.
    //
    // The earlier wording here said a second refusal "is a real one", which is
    // false for the commonest case: two saves inside MIN_INTERVAL_MS are both
    // refused by the rules, the second because the first second has not yet
    // elapsed. It is the same refusal, not a new one. A comment asserting the
    // very property that fails is worse than none — it reads as though the case
    // was considered and ruled out, and it is why this survived a review.
    //
    // What actually escapes is classified below, where the token's fate is
    // still known: a 403 past this point is the rules refusing the WRITE, and
    // it must not be spelled like the classifier's dead-session string.
    //
    // 403 OR 409, and the second is the one that actually happens. The create
    // form carries `currentDocument: { exists: false }`, which is a Firestore
    // PRECONDITION rather than a rule: violating it is answered
    // `409 ALREADY_EXISTS`. The rules answer 403. Both mean the identical
    // thing here — the word already has a document — and the contract's
    // permission table says only "refused", naming no code, which is how a
    // 403-only reading passed review and then failed on the first live save of
    // an already-saved word.
    if (!res.ok && (res.status === 403 || res.status === 409) && !opts.reactivate) {
        const retry = buildWrites(cfg, state.uid, input, sentinel, true);
        res = await fetch(commitUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${state.idToken}`,
            },
            body: JSON.stringify({ writes: retry.writes }),
        });
    }

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        // A 403 SURVIVING THE RETRY IS THE RULES, NOT THE SESSION — and the
        // two are indistinguishable by their body, so the seam is drawn here
        // where the difference is still known rather than at the classifier
        // where it is not.
        //
        // What is known here: the token was accepted. A rejected token answers
        // 401, which the refresh above already handled; a request that got this
        // far carries credentials Firestore was willing to read. So the write
        // was refused for what it ASKED, not for who asked it — a rate limit
        // (MIN_INTERVAL_MS, tripped by any two saves inside a second), the
        // daily cap, or a document shape the rules decline.
        //
        // Measured on the emulator: both refusals carry `permission-denied`,
        // and the only text separating them is emulator diagnostics that
        // production does not emit. Nothing downstream can tell them apart, so
        // nothing downstream is asked to.
        //
        // The distinct prefix is what `isAuthFailure` does NOT match. Sending
        // `Firestore commit 403` from here would sign the learner out for
        // saving two words quickly — the whole defect this branch exists to
        // remove.
        if (res.status === 403) {
            throw new Error(`Firestore rules ${res.status}: ${text || res.statusText}`);
        }
        throw new Error(`Firestore commit ${res.status}: ${text || res.statusText}`);
    }

    await res.json() as CommitResponse;
    return { wordId, documentPath, state: 'active' };
}

/** One saved word as the sync sees it: enough to update the mirror, no more. */
export interface SyncedWord {
    key: string;
    term: string;
    state: 'active' | 'removed';
    updatedAt: number;
}

/**
 * List what changed since `sinceMs`, or everything when it is 0.
 *
 * `0` is not a timestamp — it means "never synced", which is also the recovery
 * path after the mirror is lost. In that case the query carries no filter at
 * all and the whole collection comes back.
 *
 * Ordered by `updatedAt` so the caller can advance its cursor to the largest
 * value it actually applied, rather than to whatever arrived last.
 */
export async function listInboxWords(cfg: AuthConfig, sinceMs: number): Promise<SyncedWord[]> {
    const state = await ensureFreshToken(cfg);
    const parent = `projects/${cfg.projectId}/databases/(default)/documents/inbox/${state.uid}`;
    const structuredQuery: Record<string, unknown> = {
        from: [{ collectionId: 'words' }],
        orderBy: [{ field: { fieldPath: 'updatedAt' }, direction: 'ASCENDING' }],
    };
    if (sinceMs > 0) {
        structuredQuery.where = {
            fieldFilter: {
                field: { fieldPath: 'updatedAt' },
                op: 'GREATER_THAN',
                value: { timestampValue: new Date(sinceMs).toISOString() },
            },
        };
    }

    const res = await fetch(`${cfg.firestoreUrl}/v1/${parent}:runQuery`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${state.idToken}`,
        },
        body: JSON.stringify({ structuredQuery }),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Firestore runQuery ${res.status}: ${text || res.statusText}`);
    }

    const rows = (await res.json()) as Array<{ document?: { name?: string; fields?: Record<string, any> } }>;
    const out: SyncedWord[] = [];
    for (const row of Array.isArray(rows) ? rows : []) {
        const doc = row?.document;
        if (!doc?.name || !doc.fields) continue;
        const term = doc.fields.term?.stringValue;
        const stateValue = doc.fields.state?.stringValue;
        const updatedAt = Date.parse(doc.fields.updatedAt?.timestampValue ?? '');
        // A legacy document has no `state` and is not part of this projection:
        // the site converts it, and until then it is invisible here rather than
        // guessed at.
        if (typeof term !== 'string' || (stateValue !== 'active' && stateValue !== 'removed')) continue;
        // An unparseable `updatedAt` drops the document too, rather than
        // reporting it with a 0. The caller advances its cursor to the largest
        // value it applied, and 0 can never be the largest — so a single such
        // document among the results would hold the cursor at 0 and make EVERY
        // later sync re-run the unfiltered whole-collection query, on every
        // worker wake, page open and tab focus, forever, while reporting
        // success. The document is also unreachable by the `updatedAt` ordering
        // this query is built on, so there is no window that could carry it.
        if (!Number.isFinite(updatedAt)) continue;
        out.push({
            key: doc.name.split('/').pop() ?? '',
            term,
            state: stateValue,
            updatedAt,
        });
    }
    return out;
}

/**
 * Take a word off the learner's list.
 *
 * One masked write, and no sentinel — deliberately. A removal costs no counter
 * units and carries no rate condition at all, so it needs no read of the
 * sentinel either; an implementation that fetches it here has copied the
 * activation path too closely. The counter is untouched, which is why a
 * save-remove-save loop still spends cap on every save and cannot be used to
 * escape it.
 *
 * The document is addressed by `wordKey`, so this reaches the same document a
 * save would — the whole point of a deterministic id.
 */
export async function removeInboxWord(
    cfg: AuthConfig,
    input: { term: string },
): Promise<{ wordId: string; documentPath: string; state: 'removed' }> {
    const termBytes = utf8Bytes(input.term);
    if (termBytes === 0 || termBytes > MAX_TERM_BYTES) {
        throw new Error(`term must be 1..${MAX_TERM_BYTES} bytes (UTF-8)`);
    }

    let state = await ensureFreshToken(cfg);
    const wordId = wordKey(input.term);
    const documentPath =
        `projects/${cfg.projectId}/databases/(default)/documents/inbox/${state.uid}/words/${wordId}`;

    const writes: CommitWrite[] = [
        {
            update: {
                name: documentPath,
                fields: { state: { stringValue: 'removed' } },
            },
            updateMask: { fieldPaths: ['state', 'updatedAt'] },
            // No `currentDocument` precondition, and it is not an omission.
            //
            // A masked write to a MISSING document is evaluated by Firestore as
            // a create, so it lands on the word rule's create branch — which
            // demands `term`, `source`, `processed == false`, a server-stamped
            // `addedAt` and a same-commit sentinel advance. This body carries
            // none of them, so the rules refuse it on their own and no
            // term-less stub can be written. Measured against firestore.rules
            // on the emulator (2026-09-09): refused, and no document created.
            //
            // Adding `{ exists: true }` here would be redundant, and it would
            // trade a rules refusal for a precondition failure — a different
            // status for a case the handler below already treats as success.
            updateTransforms: [
                { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
            ],
        },
    ];

    const commitUrl = `${cfg.firestoreUrl}/v1/projects/${cfg.projectId}/databases/(default)/documents:commit`;
    const body = JSON.stringify({ writes });
    const post = (): Promise<Response> => fetch(commitUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${state.idToken}`,
        },
        body,
    });

    let res = await post();
    if (res.status === 401) {
        const refreshed = await refreshIdToken(cfg, state.refreshToken);
        state = { ...state, ...refreshed };
        await setAuthState(state);
        res = await post();
    }
    // TWO REFUSALS THAT ARE NOT FAILURES, from the contract's own table.
    //
    // A removal refused because the document is not `active`, and a removal
    // against a document that does not exist, both mean the word is already in
    // the state the learner asked for. Reporting a failure would ask them to
    // retry something that has already happened, and would leave the mirror
    // claiming the word is still saved.
    //
    // Both arrive as 403, because both are the RULES refusing: the removal
    // branch requires `resource.data.state == 'active'`, which a `removed`
    // document fails and a missing document fails by having no `resource` at
    // all. Verified on the emulator against firestore.rules — see the note on
    // the write above.
    //
    // ⚠ This must NOT be read as "a 403 on a word write is fine". The third
    // refusal in that table — a create refused because the document exists —
    // looks identical over the wire and means the opposite: the word is NOT
    // saved, and answering success there would leave it unsaved while telling
    // the learner otherwise. That one is a retry, and it lives in
    // `addInboxWord`. The two paths are separate for exactly this reason.
    if (!res.ok && res.status === 403) {
        return { wordId, documentPath, state: 'removed' };
    }

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Firestore commit ${res.status}: ${text || res.statusText}`);
    }
    await res.json() as CommitResponse;
    return { wordId, documentPath, state: 'removed' };
}
