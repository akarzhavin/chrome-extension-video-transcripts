// Who is signed in, read by the worker and every view. A leaf: no imports, so features/ and
// ai-balance/ can read it without importing storage.ts, which imports them.

export interface AuthState {
    idToken: string;
    refreshToken: string;
    expiresAt: number; // unix ms
    email: string;
    uid: string;
}

/** The credential keys; storage.ts writes and clears them. */
export const AUTH_KEYS = {
    idToken: 'auth.idToken',
    refreshToken: 'auth.refreshToken',
    expiresAt: 'auth.expiresAt',
    email: 'auth.email',
    uid: 'auth.uid',
} as const;

/** Written on sign-in and removed on sign-out: a change to it is a change of who is signed in. */
export const AUTH_UID_KEY = AUTH_KEYS.uid;
/** Both keys getAuthState() needs; a change to either can flip it. */
export const AUTH_STATE_KEYS: readonly string[] = [AUTH_KEYS.idToken, AUTH_KEYS.uid];

export async function getAuthState(): Promise<AuthState | null> {
    const v = (await chrome.storage.local.get([
        AUTH_KEYS.idToken,
        AUTH_KEYS.refreshToken,
        AUTH_KEYS.expiresAt,
        AUTH_KEYS.email,
        AUTH_KEYS.uid,
    ])) as Partial<Record<string, string | number>>;
    const idToken = v[AUTH_KEYS.idToken];
    const uid = v[AUTH_KEYS.uid];
    if (!idToken || !uid) return null;
    return {
        idToken: String(idToken),
        refreshToken: String(v[AUTH_KEYS.refreshToken] ?? ''),
        expiresAt: Number(v[AUTH_KEYS.expiresAt] ?? 0),
        email: String(v[AUTH_KEYS.email] ?? ''),
        uid: String(uid),
    };
}
