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
