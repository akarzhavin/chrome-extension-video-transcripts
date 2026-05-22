export interface AuthState {
    idToken: string;
    refreshToken: string;
    expiresAt: number; // unix ms
    email: string;
    uid: string;
}

const KEYS = {
    idToken: 'auth.idToken',
    refreshToken: 'auth.refreshToken',
    expiresAt: 'auth.expiresAt',
    email: 'auth.email',
    uid: 'auth.uid',
    inboxCount: 'inbox.count',
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

// Compare-and-clear: always wipes the stored nonce so a leaked value can't
// be replayed even if it would otherwise match. Returns true only when both
// the value matches AND the issue time is within NONCE_TTL_MS.
export async function consumePendingAuthNonce(provided: string): Promise<boolean> {
    const v = (await chrome.storage.session.get([
        NONCE_KEYS.value,
        NONCE_KEYS.issuedAt,
    ])) as Partial<Record<string, string | number>>;
    await chrome.storage.session.remove([NONCE_KEYS.value, NONCE_KEYS.issuedAt]);
    const rawValue = v[NONCE_KEYS.value];
    const rawIssuedAt = v[NONCE_KEYS.issuedAt];
    const stored = typeof rawValue === 'string' ? rawValue : '';
    const issuedAt = typeof rawIssuedAt === 'number' ? rawIssuedAt : 0;
    if (!stored || !provided) return false;
    if (Date.now() - issuedAt > NONCE_TTL_MS) return false;
    return stored === provided;
}
