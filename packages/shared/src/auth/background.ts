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
            const context = typeof request.context === 'string' ? request.context : '';
            const title = typeof request.title === 'string' ? request.title : '';
            if (!term) throw new Error('term required');
            const input = { term, sourceUrl, context, title };
            try {
                const r = await addInboxWord(config, input);
                const inboxCount = await bumpInboxCount();
                return { ok: true, wordId: r.wordId, inboxCount };
            } catch (err) {
                // Post-handoff steady state: refresh token is empty (the web
                // SSO flow ships ID tokens only), so once the cached token
                // hits its 1h expiry refreshIdToken('') fails. Re-acquire a
                // fresh ID token via a hidden /extension-auth?silent=1 tab
                // and retry once. If the user has fully signed out of
                // Lingogram, silentReauth() rejects after a timeout and
                // clears auth state so the badge can prompt them to sign in.
                if (!(await canSilentReauth())) throw err;
                await silentReauth();
                const r = await addInboxWord(config, input);
                const inboxCount = await bumpInboxCount();
                return { ok: true, wordId: r.wordId, inboxCount };
            }
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
    // Set when the page was opened by silentReauth() below in a background
    // tab — the listener uses this (combined with tab-id tracking) to close
    // the tab and resolve the pending reauth promise instead of leaving the
    // "Extension authorized" UI sitting around.
    silent?: unknown;
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

// Hidden background tab(s) opened by silentReauth() — the listener uses this
// set to decide whether to close the tab + resolve the pending reauth after
// the handoff arrives.
const silentReauthTabIds = new Set<number>();
// Singleton: multiple ADD_WORDs racing on an expired token must share one
// reauth attempt (one tab, one round-trip).
let pendingSilentReauth: Promise<void> | null = null;
let silentReauthResolvers:
    | { resolve: () => void; reject: (err: Error) => void }
    | null = null;
const SILENT_REAUTH_TIMEOUT_MS = 30_000;
const REFRESH_LEEWAY_MS = 60_000;

// True iff the cached token can't be refreshed via Google's secure token
// endpoint (no refresh token shipped, or it's already invalid) AND the token
// is at/past its expiry. Anything else is a different failure mode — let the
// original error propagate so we don't silently mask bugs.
async function canSilentReauth(): Promise<boolean> {
    const state = await getAuthState();
    if (!state) return false;
    if (state.refreshToken) return false;
    return state.expiresAt <= Date.now() + REFRESH_LEEWAY_MS;
}

async function silentReauth(): Promise<void> {
    if (pendingSilentReauth) return pendingSilentReauth;

    pendingSilentReauth = (async () => {
        const url = `${config.frontendBaseUrl}/extension-auth?ext=${encodeURIComponent(chrome.runtime.id)}&silent=1`;
        const tab = await chrome.tabs.create({ url, active: false });
        const tabId = tab.id;
        if (tabId === undefined) {
            throw new Error('silent reauth: tabs.create returned no id');
        }
        silentReauthTabIds.add(tabId);

        try {
            await new Promise<void>((resolve, reject) => {
                silentReauthResolvers = { resolve, reject };
                setTimeout(() => {
                    // Listener may have resolved already; check before
                    // rejecting so we don't double-settle.
                    if (silentReauthResolvers) {
                        const r = silentReauthResolvers;
                        silentReauthResolvers = null;
                        r.reject(
                            new Error(
                                'silent reauth timed out — sign in via the Lingogram badge',
                            ),
                        );
                    }
                }, SILENT_REAUTH_TIMEOUT_MS);
            });
        } finally {
            silentReauthTabIds.delete(tabId);
            try {
                await chrome.tabs.remove(tabId);
            } catch {
                // Tab may already be gone (closed by listener or user).
            }
        }
    })();

    try {
        await pendingSilentReauth;
    } catch (err) {
        // Either the user is fully signed out of Lingogram or the page
        // couldn't reach us. Clearing auth state lets the badge prompt for
        // a fresh sign-in and stops further token-hopeful Firestore writes.
        await clearAuthState();
        throw err;
    } finally {
        pendingSilentReauth = null;
    }
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
        const senderTabId = sender.tab?.id;
        // Page either declared itself silent via the payload or arrived from
        // a tab we created via silentReauth(). Either signal is sufficient —
        // tab tracking is the safety net in case payload.silent is dropped.
        const fromSilentTab =
            (typeof p.silent === 'boolean' && p.silent) ||
            (senderTabId !== undefined && silentReauthTabIds.has(senderTabId));
        (async () => {
            try {
                await setAuthState({ idToken, refreshToken, expiresAt, email, uid });
                console.log('[Lingogram] external auth handoff accepted for', email || uid);
                sendResponse({ ok: true });
                if (fromSilentTab) {
                    // Resolve before closing the tab so the awaiting ADD_WORD
                    // retry can proceed even if tabs.remove takes a moment.
                    silentReauthResolvers?.resolve();
                    silentReauthResolvers = null;
                    if (senderTabId !== undefined) {
                        silentReauthTabIds.delete(senderTabId);
                        try {
                            await chrome.tabs.remove(senderTabId);
                        } catch {
                            // Tab already gone.
                        }
                    }
                }
            } catch (err) {
                sendResponse({ ok: false, error: String(err instanceof Error ? err.message : err) });
                if (fromSilentTab) {
                    silentReauthResolvers?.reject(
                        err instanceof Error ? err : new Error(String(err)),
                    );
                    silentReauthResolvers = null;
                }
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
