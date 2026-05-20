import { config } from './config';
import { signInWithPassword } from './firebaseRest';
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
    | 'AUTH_SIGN_IN_PASSWORD'
    | 'AUTH_SIGN_IN_VIA_LINGOGRAM'
    | 'AUTH_SIGN_OUT'
    | 'ADD_WORD';

export const AUTH_ACTIONS: ReadonlySet<AuthAction> = new Set<AuthAction>([
    'AUTH_STATUS',
    'AUTH_SIGN_IN_PASSWORD',
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

export async function handleAuthMessage(request: AuthMessage): Promise<unknown> {
    switch (request.action as AuthAction) {
        case 'AUTH_STATUS': {
            const state = await getAuthState();
            const inboxCount = await getInboxCount();
            return state
                ? { signedIn: true, email: state.email, uid: state.uid, inboxCount }
                : { signedIn: false, inboxCount };
        }
        case 'AUTH_SIGN_IN_PASSWORD': {
            const email = String(request.email ?? '');
            const password = String(request.password ?? '');
            if (!email || !password) throw new Error('email and password required');
            const state = await signInWithPassword(config, email, password);
            await setAuthState(state);
            return { ok: true };
        }
        case 'AUTH_SIGN_IN_VIA_LINGOGRAM': {
            const extId = chrome.runtime.id;
            const url = `${config.frontendBaseUrl}/extension-auth?ext=${encodeURIComponent(extId)}`;
            await chrome.tabs.create({ url });
            return { ok: true };
        }
        case 'AUTH_SIGN_OUT': {
            await clearAuthState();
            return { ok: true };
        }
        case 'ADD_WORD': {
            const term = String(request.term ?? '').trim();
            const sourceUrl = String(request.sourceUrl ?? '');
            if (!term) throw new Error('term required');
            const r = await addInboxWord(config, { term, sourceUrl });
            const inboxCount = await bumpInboxCount();
            return { ok: true, wordId: r.wordId, inboxCount };
        }
        default:
            throw new Error(`unknown action: ${request.action}`);
    }
}

interface ExternalAuthPayload {
    idToken?: unknown;
    refreshToken?: unknown;
    expiresAt?: unknown;
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
        const idToken = typeof p.idToken === 'string' ? p.idToken : '';
        const refreshToken = typeof p.refreshToken === 'string' ? p.refreshToken : '';
        const expiresAt = typeof p.expiresAt === 'number' ? p.expiresAt : 0;
        const email = typeof p.email === 'string' ? p.email : '';
        const uid = typeof p.uid === 'string' ? p.uid : '';
        if (!idToken || !uid) {
            sendResponse({ ok: false, error: 'idToken and uid required' });
            return false;
        }
        (async () => {
            try {
                await setAuthState({ idToken, refreshToken, expiresAt, email, uid });
                console.log('[Lingogram] external auth handoff accepted for', email || uid);
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

export function installAuthBackground(): void {
    installAuthMessageHandler();
    installExternalAuthHandoff();
}
