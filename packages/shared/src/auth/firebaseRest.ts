import { AuthConfig } from './config';
import { AuthState } from './storage';

interface SignInResponse {
    idToken: string;
    refreshToken: string;
    expiresIn: string; // seconds, as string
    localId: string;
    email: string;
}

interface RefreshResponse {
    id_token: string;
    refresh_token: string;
    expires_in: string;
    user_id: string;
}

interface SignInWithCustomTokenResponse {
    idToken: string;
    refreshToken: string;
    expiresIn: string;
    localId?: string;
}

function expiresAtFromSeconds(secondsStr: string): number {
    const seconds = parseInt(secondsStr, 10);
    return Date.now() + seconds * 1000;
}

async function postJson<T>(url: string, body: object | string, contentType = 'application/json'): Promise<T> {
    const init: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    };
    const res = await fetch(url, init);
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Firebase REST ${res.status}: ${text || res.statusText}`);
    }
    return res.json() as Promise<T>;
}

export async function signInWithPassword(cfg: AuthConfig, email: string, password: string): Promise<AuthState> {
    const url = `${cfg.identityToolkitUrl}/v1/accounts:signInWithPassword?key=${encodeURIComponent(cfg.apiKey)}`;
    const body = { email, password, returnSecureToken: true };
    const r = await postJson<SignInResponse>(url, body);
    return {
        idToken: r.idToken,
        refreshToken: r.refreshToken,
        expiresAt: expiresAtFromSeconds(r.expiresIn),
        email: r.email,
        uid: r.localId,
    };
}

export async function refreshIdToken(cfg: AuthConfig, refreshToken: string): Promise<Pick<AuthState, 'idToken' | 'refreshToken' | 'expiresAt' | 'uid'>> {
    const url = `${cfg.secureTokenUrl}/v1/token?key=${encodeURIComponent(cfg.apiKey)}`;
    const form = `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`;
    const r = await postJson<RefreshResponse>(url, form, 'application/x-www-form-urlencoded');
    return {
        idToken: r.id_token,
        refreshToken: r.refresh_token,
        expiresAt: expiresAtFromSeconds(r.expires_in),
        uid: r.user_id,
    };
}

// Exchange a Firebase custom token (minted by auth-service /auth/extension-token
// with scopes:["extension:add_word"]) for an id+refresh pair. The resulting
// session lives independent of the web app's Firebase session, and the
// `scopes` claim rides along in every refreshed id token — so refresh runs
// entirely against securetoken.googleapis.com with no backend involvement.
export async function exchangeCustomToken(
    cfg: AuthConfig,
    customToken: string,
    fallbackUid: string,
): Promise<Pick<AuthState, 'idToken' | 'refreshToken' | 'expiresAt' | 'uid'>> {
    const url = `${cfg.identityToolkitUrl}/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(cfg.apiKey)}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Firebase REST ${res.status}: ${text || res.statusText}`);
    }
    const r = (await res.json()) as SignInWithCustomTokenResponse;
    return {
        idToken: r.idToken,
        refreshToken: r.refreshToken,
        expiresAt: expiresAtFromSeconds(r.expiresIn),
        uid: r.localId || fallbackUid,
    };
}
