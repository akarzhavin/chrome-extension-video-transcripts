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

// Remote-notification storage keys. Read/written only by ../notifications.ts;
// declared here so this file stays the single inventory the privacy policy's
// "Local Storage" section documents. All four are extension-authored content
// and local state — a cached copy of the public notifications collection, its
// fetch timestamp, a backoff stamp, and the ids the user has closed. Nothing
// here is derived from auth.uid / auth.email, and the fetch that fills the
// cache sends no identifier at all: only version, platform, edition and locale.
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

export async function clearAuthState(): Promise<void> {
    await chrome.storage.local.remove([
        KEYS.idToken,
        KEYS.refreshToken,
        KEYS.expiresAt,
        KEYS.email,
        KEYS.uid,
    ]);
}

export async function getInboxCount(): Promise<number> {
    const v = (await chrome.storage.local.get(KEYS.inboxCount)) as Record<string, number | undefined>;
    return v[KEYS.inboxCount] ?? 0;
}

export async function bumpInboxCount(): Promise<number> {
    const next = (await getInboxCount()) + 1;
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
