import { config } from '../auth/config';
import { exchangeGoogleAccessToken, signInWithPassword } from '../auth/firebaseRest';
import { clearCachedGoogleTokens, getGoogleAccessToken } from '../auth/identity';
import { addInboxWord } from '../auth/firestoreRest';
import {
    bumpInboxCount,
    clearAuthState,
    getAuthState,
    getInboxCount,
    setAuthState,
} from '../auth/storage';

// Function to download a file with automatic retry on error
export async function fetchWithRetry(url: string, retries: number = 3, delay: number = 1000): Promise<string> {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return await response.text();
        } catch (err: any) {
            console.warn(`Fetch attempt ${i + 1} failed for ${url}:`, err.message);
            if (i < retries - 1) {
                await new Promise(res => setTimeout(res, delay));
            } else {
                throw err;
            }
        }
    }
    throw new Error(`Failed to fetch ${url} after ${retries} attempts`);
}

type Action =
    | 'TIME_UPDATE' | 'SEEK_VIDEO' | 'VTT_LOADED' | 'FETCH_VTT'
    | 'AUTH_STATUS' | 'AUTH_SIGN_IN' | 'AUTH_SIGN_IN_PASSWORD' | 'AUTH_SIGN_IN_VIA_LINGOGRAM' | 'AUTH_SIGN_OUT'
    | 'ADD_WORD';

interface Message {
    action: Action;
    [k: string]: unknown;
}

async function handleAuth(request: Message): Promise<unknown> {
    switch (request.action) {
        case 'AUTH_STATUS': {
            const state = await getAuthState();
            const inboxCount = await getInboxCount();
            return state
                ? { signedIn: true, email: state.email, uid: state.uid, inboxCount }
                : { signedIn: false, inboxCount };
        }
        case 'AUTH_SIGN_IN': {
            const accessToken = await getGoogleAccessToken();
            const state = await exchangeGoogleAccessToken(config, accessToken);
            await setAuthState(state);
            return { ok: true };
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
            await clearCachedGoogleTokens();
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

const AUTH_ACTIONS: ReadonlySet<Action> = new Set([
    'AUTH_STATUS', 'AUTH_SIGN_IN', 'AUTH_SIGN_IN_PASSWORD', 'AUTH_SIGN_IN_VIA_LINGOGRAM', 'AUTH_SIGN_OUT', 'ADD_WORD',
]);

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

function isAllowedExternalSender(sender: chrome.runtime.MessageSender): boolean {
    const origin = sender.origin ?? (sender.url ? new URL(sender.url).origin : undefined);
    if (!origin) return false;
    if (origin === 'http://localhost:5173') return true;
    try {
        const host = new URL(origin).hostname;
        return /(^|\.)lingogram\.(app|com|dev)$/.test(host);
    } catch {
        return false;
    }
}

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

// Message Relay for data exchange between frames
// Also handles VTT download requests and auth/inbox actions
chrome.runtime.onMessage.addListener((request: Message, sender, sendResponse) => {
    if (request.action === "TIME_UPDATE" || request.action === "SEEK_VIDEO" || request.action === "VTT_LOADED") {
        if (sender.tab && sender.tab.id) {
            chrome.tabs.sendMessage(sender.tab.id, request);
        }
        return true;
    }
    if (request.action === "FETCH_VTT") {
        fetchWithRetry(request.url as string)
            .then(text => {
                // Send result back to the tab
                if (sender.tab && sender.tab.id) {
                    chrome.tabs.sendMessage(sender.tab.id, {
                        action: "VTT_LOADED",
                        payload: text,
                        url: request.url
                    });
                }
            })
            .catch(err => {
                console.error("Background: Failed to fetch VTT:", err);
            });
        return true;
    }
    if (AUTH_ACTIONS.has(request.action)) {
        (async () => {
            try {
                const result = await handleAuth(request);
                sendResponse(result);
            } catch (err) {
                console.error('Background auth handler error:', err);
                sendResponse({ ok: false, error: String(err instanceof Error ? err.message : err) });
            }
        })();
        return true;
    }
    return true; // Keep the channel open for asynchronous responses if needed
});
