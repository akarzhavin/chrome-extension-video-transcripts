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
    | 'AUTH_STATUS' | 'AUTH_SIGN_IN' | 'AUTH_SIGN_IN_PASSWORD' | 'AUTH_SIGN_OUT'
    | 'ADD_WORD';

interface Message {
    action: Action;
    [k: string]: unknown;
}

// Dev convenience: at most one auto-sign-in attempt per service worker life
// against the seeded emulator user, so the user never sees the password form.
// Cleared on manual sign-out so a deliberate sign-out sticks.
const DEV_AUTO_SIGN_IN_EMAIL = 'student@example.com';
const DEV_AUTO_SIGN_IN_PASSWORD = 'SecurePass123!';
let devAutoSignInPending: Promise<boolean> | null = null;
let devAutoSignInDisabled = false;

async function maybeDevAutoSignIn(): Promise<boolean> {
    if (config.env !== 'dev' || devAutoSignInDisabled) return false;
    if (devAutoSignInPending) return devAutoSignInPending;
    devAutoSignInPending = (async () => {
        try {
            const state = await signInWithPassword(config, DEV_AUTO_SIGN_IN_EMAIL, DEV_AUTO_SIGN_IN_PASSWORD);
            await setAuthState(state);
            console.log('[Lingogram] dev auto-sign-in as', state.email);
            return true;
        } catch (err) {
            console.warn('[Lingogram] dev auto-sign-in failed:', err);
            return false;
        }
    })();
    return devAutoSignInPending;
}

async function handleAuth(request: Message): Promise<unknown> {
    switch (request.action) {
        case 'AUTH_STATUS': {
            let state = await getAuthState();
            if (!state) {
                const signedIn = await maybeDevAutoSignIn();
                if (signedIn) state = await getAuthState();
            }
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
            devAutoSignInDisabled = false;
            devAutoSignInPending = null;
            return { ok: true };
        }
        case 'AUTH_SIGN_OUT': {
            await clearCachedGoogleTokens();
            await clearAuthState();
            // Don't immediately re-login: a deliberate sign-out should stick
            // until the user explicitly signs in again (or reloads the extension).
            devAutoSignInDisabled = true;
            devAutoSignInPending = null;
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
    'AUTH_STATUS', 'AUTH_SIGN_IN', 'AUTH_SIGN_IN_PASSWORD', 'AUTH_SIGN_OUT', 'ADD_WORD',
]);

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
