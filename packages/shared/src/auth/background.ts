import { config } from './config';
import { exchangeCustomToken } from './firebaseRest';
import { addInboxWord } from './firestoreRest';
import {
    bumpInboxCount,
    clearAuthState,
    getAuthState,
    getInboxCount,
    setAuthState,
} from './storage';

export type AuthAction =
    | 'AUTH_STATUS'
    | 'AUTH_SIGN_IN_VIA_LINGOGRAM'
    | 'AUTH_SIGN_OUT'
    | 'ADD_WORD';

export const AUTH_ACTIONS: ReadonlySet<AuthAction> = new Set<AuthAction>([
    'AUTH_STATUS',
    'AUTH_SIGN_IN_VIA_LINGOGRAM',
    'AUTH_SIGN_OUT',
    'ADD_WORD',
]);

export function isAuthAction(action: unknown): action is AuthAction {
    return typeof action === 'string' && (AUTH_ACTIONS as ReadonlySet<string>).has(action);
}

export interface AuthMessage {
    action: string;
    [k: string]: unknown;
}

// Surface "the extension needs to be re-authorized" via the toolbar badge.
// Refresh-token failures (revoked session, very long inactivity) now require
// the user to open a normal /extension-auth tab — no silent recovery path.
function setNeedsReauthBadge(): void {
    try {
        chrome.action?.setBadgeText({ text: '!' });
        chrome.action?.setBadgeBackgroundColor?.({ color: '#dc2626' });
    } catch {
        // chrome.action unavailable in some test contexts; silent ignore.
    }
}

function clearNeedsReauthBadge(): void {
    try {
        chrome.action?.setBadgeText({ text: '' });
    } catch {
        // see setNeedsReauthBadge.
    }
}

function isAuthFailure(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const m = err.message;
    return (
        m.includes('Not signed in') ||
        m.includes('Firebase REST 400') ||
        m.includes('Firebase REST 401') ||
        m.includes('Firebase REST 403') ||
        m.includes('Firestore commit 401') ||
        m.includes('Firestore commit 403') ||
        m.includes('Firestore sentinel 401') ||
        m.includes('INVALID_REFRESH_TOKEN') ||
        m.includes('TOKEN_EXPIRED')
    );
}

export async function handleAuthMessage(request: AuthMessage): Promise<unknown> {
    switch (request.action as AuthAction) {
        case 'AUTH_STATUS': {
            const state = await getAuthState();
            const inboxCount = await getInboxCount();
            return state
                ? { signedIn: true, email: state.email, uid: state.uid, inboxCount }
                : { signedIn: false, inboxCount };
        }
        case 'AUTH_SIGN_IN_VIA_LINGOGRAM': {
            const extId = chrome.runtime.id;
            const url = `${config.frontendBaseUrl}/extension-auth?ext=${encodeURIComponent(extId)}`;
            await chrome.tabs.create({ url });
            return { ok: true };
        }
        case 'AUTH_SIGN_OUT': {
            await clearAuthState();
            clearNeedsReauthBadge();
            return { ok: true };
        }
        case 'ADD_WORD': {
            const term = String(request.term ?? '').trim();
            const sourceUrl = String(request.sourceUrl ?? '');
            const context = typeof request.context === 'string' ? request.context : '';
            const title = typeof request.title === 'string' ? request.title : '';
            if (!term) throw new Error('term required');
            const input = { term, sourceUrl, context, title };
            try {
                const r = await addInboxWord(config, input);
                const inboxCount = await bumpInboxCount();
                return { ok: true, wordId: r.wordId, inboxCount };
            } catch (err) {
                // Refresh-token revoked / Firestore rejected the token —
                // wipe state and prompt the user to re-authorize via a
                // normal visible tab. No silent recovery: the scoped
                // session is gone and a fresh handoff is the only path.
                if (isAuthFailure(err)) {
                    await clearAuthState();
                    setNeedsReauthBadge();
                }
                throw err;
            }
        }
        default:
            throw new Error(`unknown action: ${request.action}`);
    }
}

interface ExternalAuthPayload {
    customToken?: unknown;
    email?: unknown;
    uid?: unknown;
}

interface ExternalAuthMessage {
    type?: unknown;
    payload?: ExternalAuthPayload;
}

// Derived from the build-time frontend URL so a staging deploy (EXT_FRONTEND_BASE_URL=...)
// stays accepted. For Firebase Hosting `.web.app` sites the `.firebaseapp.com` mirror
// is added automatically. The manifest's externally_connectable.matches must list the
// same hosts — Chrome filters by that first, this is a belt-and-braces re-check.
export function buildAllowedExternalOrigins(baseUrl: string): ReadonlySet<string> {
    const origins = new Set<string>();
    try {
        const url = new URL(baseUrl);
        origins.add(url.origin);
        if (url.hostname.endsWith('.web.app')) {
            const mirror = url.hostname.replace(/\.web\.app$/, '.firebaseapp.com');
            origins.add(`${url.protocol}//${mirror}`);
        } else if (url.hostname.endsWith('.firebaseapp.com')) {
            const mirror = url.hostname.replace(/\.firebaseapp\.com$/, '.web.app');
            origins.add(`${url.protocol}//${mirror}`);
        }
    } catch {
        // Malformed baseUrl — origin set stays empty so handoffs are rejected.
    }
    return origins;
}

const ALLOWED_EXTERNAL_ORIGINS: ReadonlySet<string> = buildAllowedExternalOrigins(config.frontendBaseUrl);

function isAllowedExternalSender(sender: chrome.runtime.MessageSender): boolean {
    const origin = sender.origin ?? (sender.url ? new URL(sender.url).origin : undefined);
    return !!origin && ALLOWED_EXTERNAL_ORIGINS.has(origin);
}

export function installExternalAuthHandoff(): void {
    chrome.runtime.onMessageExternal.addListener((message: ExternalAuthMessage, sender, sendResponse) => {
        if (!isAllowedExternalSender(sender)) {
            sendResponse({ ok: false, error: 'unauthorized origin' });
            return false;
        }
        if (message?.type !== 'lingogram-extension-auth') {
            sendResponse({ ok: false, error: 'unknown message type' });
            return false;
        }
        const p = message.payload ?? {};
        const customToken = typeof p.customToken === 'string' ? p.customToken : '';
        const email = typeof p.email === 'string' ? p.email : '';
        const uid = typeof p.uid === 'string' ? p.uid : '';
        if (!customToken || !uid) {
            sendResponse({ ok: false, error: 'customToken and uid required' });
            return false;
        }
        (async () => {
            try {
                // Exchange the scoped Firebase custom token for our own
                // id+refresh pair. The `scopes` claim rides along through
                // refresh, so the extension stays restricted to inbox writes
                // even after the initial id token expires.
                const exchanged = await exchangeCustomToken(config, customToken, uid);
                await setAuthState({
                    idToken: exchanged.idToken,
                    refreshToken: exchanged.refreshToken,
                    expiresAt: exchanged.expiresAt,
                    email,
                    uid: exchanged.uid,
                });
                clearNeedsReauthBadge();
                sendResponse({ ok: true });
            } catch (err) {
                sendResponse({ ok: false, error: String(err instanceof Error ? err.message : err) });
            }
        })();
        return true;
    });
}

export function installAuthMessageHandler(): void {
    chrome.runtime.onMessage.addListener((request: AuthMessage, _sender, sendResponse) => {
        if (!isAuthAction(request?.action)) return false;
        (async () => {
            try {
                const result = await handleAuthMessage(request);
                sendResponse(result);
            } catch (err) {
                console.error('Background auth handler error:', err);
                sendResponse({ ok: false, error: String(err instanceof Error ? err.message : err) });
            }
        })();
        return true;
    });
}

// One-shot migration: installs that signed in before the scoped-token rollout
// have `refreshToken === ''` and rely on the now-removed silent reauth path.
// Wipe their cached state on startup so the next ADD_WORD asks the user to
// re-authorize through the normal visible tab instead of failing silently.
export async function migrateLegacyAuthState(): Promise<void> {
    const state = await getAuthState();
    if (state && !state.refreshToken) {
        await clearAuthState();
        setNeedsReauthBadge();
    }
}

export function installAuthBackground(): void {
    installAuthMessageHandler();
    installExternalAuthHandoff();
    void migrateLegacyAuthState();
}
