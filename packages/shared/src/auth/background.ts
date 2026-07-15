import { config } from './config';
import { exchangeCustomToken } from './firebaseRest';
import { addInboxWord, addNoSubsReport } from './firestoreRest';
import {
    bumpInboxCount,
    bumpSavedWordCount,
    clearAuthState,
    clearPendingAuthNonce,
    getAuthState,
    getInboxCount,
    getRatePromptShown,
    markRatePromptShown,
    RATE_PROMPT_WORD_THRESHOLD,
    setAuthState,
    setPendingAuthNonce,
    validatePendingAuthNonce,
} from './storage';

export type AuthAction =
    | 'AUTH_STATUS'
    | 'AUTH_SIGN_IN_VIA_LINGOGRAM'
    | 'AUTH_SIGN_OUT'
    | 'ADD_WORD'
    | 'REPORT_NO_SUBS';

export const AUTH_ACTIONS: ReadonlySet<AuthAction> = new Set<AuthAction>([
    'AUTH_STATUS',
    'AUTH_SIGN_IN_VIA_LINGOGRAM',
    'AUTH_SIGN_OUT',
    'ADD_WORD',
    'REPORT_NO_SUBS',
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
            // Fresh one-shot challenge: SPA reads it from the URL and echoes
            // it in the handoff payload, so an XSS in a trusted-origin tab
            // that we did NOT open can't push a token at us (it doesn't know
            // the value). Stored in chrome.storage.session because the MV3
            // service worker may recycle before the user finishes signing in.
            const nonce = crypto.randomUUID();
            await setPendingAuthNonce(nonce);
            const url =
                `${config.frontendBaseUrl}/extension-auth` +
                `?ext=${encodeURIComponent(extId)}` +
                `&nonce=${encodeURIComponent(nonce)}`;
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
            const context = typeof request.context === 'string' ? request.context : '';
            if (!term) throw new Error('term required');
            const input = { term, context };
            try {
                const r = await addInboxWord(config, input);
                const inboxCount = await bumpInboxCount();
                // Value-moment rating prompt (P1.8): once this install crosses
                // the saved-word threshold, ask for a store rating — exactly
                // once, ever. The content script renders the actual banner when
                // it sees promptRate; here we only decide + burn the one-shot.
                const savedWordCount = await bumpSavedWordCount();
                let promptRate = false;
                if (savedWordCount >= RATE_PROMPT_WORD_THRESHOLD && !(await getRatePromptShown())) {
                    await markRatePromptShown();
                    promptRate = true;
                }
                return { ok: true, wordId: r.wordId, inboxCount, promptRate };
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
        case 'REPORT_NO_SUBS': {
            // Best-effort diagnostics from the emergency "Reload page" button —
            // the page is about to reload, nobody is watching the result. Swallow
            // every failure (signed-out user, rules rejection, network): a report
            // must never surface an error or touch the auth state / badge.
            const videoRef = String(request.videoRef ?? '');
            if (!videoRef) return { ok: false };
            try {
                await addNoSubsReport(config, {
                    site: String(request.site ?? ''),
                    videoRef,
                    version: String(request.version ?? ''),
                    locale: String(request.locale ?? ''),
                    learning: String(request.learning ?? ''),
                    native: String(request.native ?? ''),
                });
                return { ok: true };
            } catch {
                return { ok: false };
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
    // Echo of the one-shot challenge the extension placed in the auth URL
    // when it opened the tab. Required — handoffs without a matching nonce
    // are rejected to block XSS-initiated unsolicited token pushes.
    nonce?: unknown;
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
        const nonce = typeof p.nonce === 'string' ? p.nonce : '';
        if (!customToken || !uid) {
            sendResponse({ ok: false, error: 'customToken and uid required' });
            return false;
        }
        (async () => {
            // Validate the pending nonce up front but DON'T clear yet — a
            // transient exchange failure (network blip, CREDENTIAL_MISMATCH
            // during a backend rollout, etc.) would otherwise burn the nonce
            // and force the user back through the popup. We clear only after
            // the entire handoff has succeeded.
            const nonceOk = await validatePendingAuthNonce(nonce);
            if (!nonceOk) {
                sendResponse({
                    ok: false,
                    error:
                        'invalid or expired auth challenge — open the extension popup ' +
                        'and start the sign-in flow from there',
                });
                return;
            }
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
                // Success — burn the nonce so the same URL can't be replayed.
                await clearPendingAuthNonce();
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
