export interface AuthState {
    idToken: string;
    refreshToken: string;
    expiresAt: number; // unix ms
    email: string;
    uid: string;
}

// Value-moment threshold for the store-rating prompt (P1.8): a user who has
// saved this many words has clearly gotten value, and asking then — rather
// than on install — is the ASO rating-flywheel play, not a UX nicety. Fires
// exactly once per install (guarded by ratePromptShown).
export const RATE_PROMPT_WORD_THRESHOLD = 5;

const KEYS = {
    idToken: 'auth.idToken',
    refreshToken: 'auth.refreshToken',
    expiresAt: 'auth.expiresAt',
    email: 'auth.email',
    uid: 'auth.uid',
    inboxCount: 'inbox.count',
    // Lifetime count of words saved on this install, and a one-shot flag set
    // once we've asked for a store rating. Both survive sign-out (the user is
    // the same person) and drive the value-moment rating prompt — see
    // RATE_PROMPT_WORD_THRESHOLD above.
    savedWordCount: 'rate.savedWordCount',
    ratePromptShown: 'rate.promptShown',
} as const;

// The saved-word mirror. Read/written only by ../word-mirror.ts; declared here
// so this file stays the single inventory the privacy policy's "Local Storage"
// section documents. Unlike the notification and analytics keys below, this one
// IS derived from the account: it holds the normalized terms this learner has
// saved, so it is cleared with the credentials on sign-out — see clearAuthState.
export const WORD_KEYS = {
    mirror: 'words.v1',
} as const;

// Remote-notification storage keys. Read/written only by ../notifications.ts;
// declared here so this file stays the single inventory the privacy policy's
// "Local Storage" section documents. All four are extension-authored content
// and local state — a cached copy of the public notifications collection, its
// fetch timestamp, a backoff stamp, and the ids the user has closed. Nothing
// here is derived from auth.uid / auth.email, and the fetch that fills the
// cache sends no identifier at all: only version, platform, edition and locale.
// The dismissed list is self-limiting: an id drops out once its notification is
// gone or expired (see pruneDismissals), so it does not grow for the life of
// the install.
export const NOTIFICATION_KEYS = {
    cachedAt: 'notif.cachedAt',
    cachedDocs: 'notif.cachedDocs',
    retryAfter: 'notif.retryAfter',
    dismissed: 'notif.dismissed',
} as const;

// Anonymous-analytics storage keys. Read/written only by analytics-bg.ts;
// declared here so this file stays the single inventory of extension storage
// keys that the privacy policy's "Local Storage" section documents. None of
// these is ever derived from (or joined to) auth.uid / auth.email above —
// that separation is what the policy's "not linked to your account" claim
// rests on.
export const ANALYTICS_KEYS = {
    // Random per-install UUID (chrome.storage.local). The GA4 client_id.
    clientId: 'analytics.clientId',
    // UTC midnight of the install day; absent on installs that predate
    // analytics (their events simply carry no days_since_install).
    installedAt: 'analytics.installedAt',
    // One-shot flags for the retention milestone events.
    d2Sent: 'analytics.d2Sent',
    d7Sent: 'analytics.d7Sent',
    d14Sent: 'analytics.d14Sent',
} as const;

// chrome.storage.session (cleared on browser restart — exactly GA4's session
// semantics; survives MV3 service-worker recycling, unlike module scope).
export const ANALYTICS_SESSION_KEYS = {
    sessionId: 'analytics.sessionId',
    sessionAt: 'analytics.sessionAt',
} as const;

export async function getAuthState(): Promise<AuthState | null> {
    const v = (await chrome.storage.local.get([
        KEYS.idToken,
        KEYS.refreshToken,
        KEYS.expiresAt,
        KEYS.email,
        KEYS.uid,
    ])) as Partial<Record<string, string | number>>;
    const idToken = v[KEYS.idToken];
    const uid = v[KEYS.uid];
    if (!idToken || !uid) return null;
    return {
        idToken: String(idToken),
        refreshToken: String(v[KEYS.refreshToken] ?? ''),
        expiresAt: Number(v[KEYS.expiresAt] ?? 0),
        email: String(v[KEYS.email] ?? ''),
        uid: String(uid),
    };
}

export async function setAuthState(s: AuthState): Promise<void> {
    await chrome.storage.local.set({
        [KEYS.idToken]: s.idToken,
        [KEYS.refreshToken]: s.refreshToken,
        [KEYS.expiresAt]: s.expiresAt,
        [KEYS.email]: s.email,
        [KEYS.uid]: s.uid,
    });
}

/**
 * Dev-only: one parked session per backend, so the switch does not cost a
 * sign-in every time.
 *
 * A session is only meaningful inside the project that issued it — an ID token
 * is signed by one project and no other will verify it, and a `uid` names a
 * DIFFERENT person in each. So a switch cannot carry the live session across;
 * what it can do is set it aside and hand back the one belonging to the target
 * being entered.
 *
 * Keyed by project id, not by the target's label: the label is whatever a build
 * chose to call a row, and two builds may spell the same project differently.
 * The project id is what the credentials actually belong to.
 *
 * `__EXT_ENV__`-guarded and therefore absent from production, where there is
 * one backend and nothing to park. The guard is on the module constant rather
 * than inside each function so the whole thing folds away.
 *
 * That guard is also why these two keys are NOT in the privacy policy's
 * "Local Storage" inventory, unlike every other key in this file: the policy
 * describes the published extension, and no published build can write them.
 * Verified against a prod build of both editions — zero occurrences in any
 * bundle. Should parking ever reach a release, Section 3 gains an entry.
 */
const PARKED_PREFIX = 'dev.parkedAuth.';

/**
 * The projects that currently have something parked.
 *
 * An explicit index rather than a `chrome.storage.local.get(null)` scan. Two
 * reasons, and the second is the one that bit: reading the WHOLE of local
 * storage to find a handful of keys pulls the word mirror and every cached
 * notification through the worker for no reason — and `get(null)` is a corner
 * of the API that stubs routinely do not implement, so code depending on it
 * throws where a plain keyed read would have worked. That is not a test
 * problem: a service worker whose sign-out throws leaves the user signed in.
 */
// NOT under PARKED_PREFIX. Sharing the prefix makes "every parked session"
// and "every parking key" the same query by accident, so any sweep over the
// prefix silently includes the index — a trap that already cost one wrong
// assertion before the key was moved out.
const PARKED_INDEX_KEY = 'dev.parkedIndex';

/** Whether parking exists at all in this build. */
const PARKING_ENABLED = __EXT_ENV__ === 'dev';

interface ParkedSession {
    auth: AuthState;
    /** The saved-word mirror, which is per-account and travels with it. */
    mirror?: unknown;
}

/**
 * Park the live session under the project it belongs to, and clear it.
 *
 * The mirror goes with it. It lists the terms THIS account saved, so leaving it
 * behind would show one environment's words while signed into another — and
 * hand them to whoever signs in next on this profile.
 */
export async function parkAuthState(projectId: string): Promise<void> {
    if (!PARKING_ENABLED || !projectId) return;
    const auth = await getAuthState();
    if (!auth) {
        await clearAuthState();
        return;
    }
    const v = (await chrome.storage.local.get(WORD_KEYS.mirror)) as Record<string, unknown>;
    const parked: ParkedSession = { auth, mirror: v[WORD_KEYS.mirror] };
    await chrome.storage.local.set({
        [PARKED_PREFIX + projectId]: parked,
        [PARKED_INDEX_KEY]: [...new Set([...(await parkedProjectIds()), projectId])],
    });
    await clearAuthState();
}

/** Which projects have a parked session, per the index. */
async function parkedProjectIds(): Promise<string[]> {
    const v = (await chrome.storage.local.get(PARKED_INDEX_KEY)) as Record<string, unknown>;
    const ids = v[PARKED_INDEX_KEY];
    // Stored input: an index written by an older build, or truncated, must not
    // throw here — sign-out runs through this path.
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Restore a previously parked session for a project, if one is there.
 *
 * Returns whether anything was restored, so the caller can tell "you are back
 * where you were" from "you need to sign in here".
 *
 * An expired token is restored anyway rather than discarded: the refresh token
 * outlives it, and the normal refresh path is what turns one into a fresh
 * session. Dropping it here would make the switch cost a sign-in exactly in
 * the case parking exists to avoid.
 */
export async function unparkAuthState(projectId: string): Promise<boolean> {
    if (!PARKING_ENABLED || !projectId) return false;
    const key = PARKED_PREFIX + projectId;
    const v = (await chrome.storage.local.get(key)) as Record<string, unknown>;
    const parked = v[key] as ParkedSession | undefined;
    // A parked blob is stored input like any other: a shape that does not carry
    // both halves of an identity is not a session, and restoring half of one
    // would leave the worker believing it is signed in.
    if (!parked?.auth?.idToken || !parked.auth.uid) return false;
    await setAuthState({
        idToken: String(parked.auth.idToken),
        refreshToken: String(parked.auth.refreshToken ?? ''),
        expiresAt: Number(parked.auth.expiresAt ?? 0),
        email: String(parked.auth.email ?? ''),
        uid: String(parked.auth.uid),
    });
    if (parked.mirror !== undefined) {
        await chrome.storage.local.set({ [WORD_KEYS.mirror]: parked.mirror });
    }
    await chrome.storage.local.remove(key);
    await chrome.storage.local.set({
        [PARKED_INDEX_KEY]: (await parkedProjectIds()).filter((id) => id !== projectId),
    });
    return true;
}

/**
 * Forget every parked session. Called on an explicit sign-out: the user asked
 * to be signed out, and leaving other environments' credentials parked would
 * make that untrue on the next switch.
 */
export async function clearParkedAuthStates(): Promise<void> {
    if (!PARKING_ENABLED) return;
    const ids = await parkedProjectIds();
    await chrome.storage.local.remove([
        ...ids.map((id) => PARKED_PREFIX + id),
        PARKED_INDEX_KEY,
    ]);
}

export async function clearAuthState(): Promise<void> {
    await chrome.storage.local.remove([
        KEYS.idToken,
        KEYS.refreshToken,
        KEYS.expiresAt,
        KEYS.email,
        KEYS.uid,
        // The saved-word mirror goes with the credentials: it names the words
        // THIS account saved, and leaving it behind would show them to whoever
        // signs in next on this profile. Note what still stays — the lifetime
        // saved-word count and the rating flag two keys up are deliberately not
        // in this list, because the person is the same person.
        WORD_KEYS.mirror,
    ]);
}

export async function getInboxCount(): Promise<number> {
    const v = (await chrome.storage.local.get(KEYS.inboxCount)) as Record<string, number | undefined>;
    return v[KEYS.inboxCount] ?? 0;
}

/**
 * Move the inbox tally. `by` is +1 on a save and -1 on a removal.
 *
 * Clamped at zero: a learner can remove a word this install never counted —
 * saved on another device, or before this counter existed — and a negative
 * badge would be a visible artefact of bookkeeping the person never saw.
 */
export async function bumpInboxCount(by = 1): Promise<number> {
    const next = Math.max(0, (await getInboxCount()) + by);
    await chrome.storage.local.set({ [KEYS.inboxCount]: next });
    return next;
}

// Lifetime saved-word count driving the value-moment rating prompt. Bumped on
// every successful save (background ADD_WORD handler); read to decide whether
// the user has reached RATE_PROMPT_WORD_THRESHOLD.
export async function getSavedWordCount(): Promise<number> {
    const v = (await chrome.storage.local.get(KEYS.savedWordCount)) as Record<string, number | undefined>;
    return v[KEYS.savedWordCount] ?? 0;
}

export async function bumpSavedWordCount(): Promise<number> {
    const next = (await getSavedWordCount()) + 1;
    await chrome.storage.local.set({ [KEYS.savedWordCount]: next });
    return next;
}

// One-shot guard so the rating prompt fires exactly once per install, ever.
export async function getRatePromptShown(): Promise<boolean> {
    const v = (await chrome.storage.local.get(KEYS.ratePromptShown)) as Record<string, boolean | undefined>;
    return v[KEYS.ratePromptShown] === true;
}

export async function markRatePromptShown(): Promise<void> {
    await chrome.storage.local.set({ [KEYS.ratePromptShown]: true });
}

// One-shot challenge used to pin the extension-auth handoff to a sign-in
// the extension itself initiated (popup click → opens /extension-auth?nonce=…).
// The SPA echoes the value back in the handoff payload; without a match, an
// XSS in a trusted-origin tab cannot push an unsolicited token to the
// extension even though Chrome's externally_connectable filter passes.
//
// Lives in chrome.storage.session (MV3, cleared on browser restart) so MV3
// service-worker recycling doesn't lose the pending challenge across the
// ~30s idle timeout. Local storage would persist past restart, which isn't
// what we want for a per-attempt nonce.
const NONCE_TTL_MS = 10 * 60 * 1000;
const NONCE_KEYS = {
    value: 'auth.pendingNonce',
    issuedAt: 'auth.pendingNonceAt',
} as const;

export async function setPendingAuthNonce(nonce: string): Promise<void> {
    await chrome.storage.session.set({
        [NONCE_KEYS.value]: nonce,
        [NONCE_KEYS.issuedAt]: Date.now(),
    });
}

// Validate without mutating storage. Returns true iff a non-empty `provided`
// matches the stored value AND the issue time is within NONCE_TTL_MS.
// Callers must call clearPendingAuthNonce() themselves once the entire
// handoff has succeeded — that keeps the nonce available for retries when
// downstream steps (e.g. signInWithCustomToken) fail transiently.
export async function validatePendingAuthNonce(provided: string): Promise<boolean> {
    const v = (await chrome.storage.session.get([
        NONCE_KEYS.value,
        NONCE_KEYS.issuedAt,
    ])) as Partial<Record<string, string | number>>;
    const rawValue = v[NONCE_KEYS.value];
    const rawIssuedAt = v[NONCE_KEYS.issuedAt];
    const stored = typeof rawValue === 'string' ? rawValue : '';
    const issuedAt = typeof rawIssuedAt === 'number' ? rawIssuedAt : 0;
    if (!stored || !provided) return false;
    if (Date.now() - issuedAt > NONCE_TTL_MS) return false;
    return stored === provided;
}

export async function clearPendingAuthNonce(): Promise<void> {
    await chrome.storage.session.remove([NONCE_KEYS.value, NONCE_KEYS.issuedAt]);
}
