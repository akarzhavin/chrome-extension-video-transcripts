import { getAuthState, handleAuthMessage, installAuthBackground } from '@video-transcripts/shared';

// Reuse the exact auth stack shipped in the youtube / rezka extensions:
// popup sign-in (AUTH_* messages), the external token handoff from the
// Lingogram SPA, and ADD_WORD → Firestore writes.
installAuthBackground();

const MENU_ID = 'lingogram-add-to-inbox';
const MAX_TERM_LEN = 256;

// --- Debug logging -------------------------------------------------------
// All background logs land in the service-worker console:
//   chrome://extensions → this extension → "Inspect views: service worker".
const LOG = '[Lingogram BG]';
function log(...args: unknown[]): void {
    console.log(LOG, ...args);
}
function logErr(...args: unknown[]): void {
    console.error(LOG, ...args);
}
log('service worker booted', new Date().toISOString());

// Recreate from scratch on every install/update/startup so a renamed title or
// changed contexts can't leave a stale duplicate behind.
function createMenu(): void {
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: MENU_ID,
            title: 'Add to Lingogram',
            contexts: ['selection'],
        });
    });
}

chrome.runtime.onInstalled.addListener(createMenu);
chrome.runtime.onStartup.addListener(createMenu);

chrome.contextMenus.onClicked.addListener((info, tab) => {
    log('contextMenus.onClicked', { menuItemId: info.menuItemId, hasSelection: !!info.selectionText });
    if (info.menuItemId !== MENU_ID) return;
    void handleAddToInbox(info, tab);
});

async function handleAddToInbox(
    info: chrome.contextMenus.OnClickData,
    tab: chrome.tabs.Tab | undefined,
): Promise<void> {
    const term = (info.selectionText ?? '').trim();
    const tabId = tab?.id;
    log('handleAddToInbox: start', {
        term,
        termLen: term.length,
        tabId,
        pageUrl: info.pageUrl,
        tabUrl: tab?.url,
    });

    if (!term || term.length > MAX_TERM_LEN) {
        log('handleAddToInbox: aborted — empty or too-long term');
        return;
    }

    // Not signed in? Pop the toolbar popup (which renders the sign-in button)
    // instead of silently failing the add. The context menu click is a user
    // gesture, so openPopup() is allowed — do it before any other async work
    // so the gesture isn't spent. Bail out: the word isn't lost on the user,
    // they re-select after signing in.
    const authState = await getAuthState();
    log('auth state', authState
        ? {
              signedIn: true,
              uid: authState.uid,
              email: authState.email,
              hasIdToken: !!authState.idToken,
              hasRefreshToken: !!authState.refreshToken,
              expiresAt: new Date(authState.expiresAt).toISOString(),
              expired: authState.expiresAt <= Date.now(),
          }
        : { signedIn: false });
    if (!authState) {
        log('not signed in → opening sign-in popup');
        await promptSignIn(tab);
        return;
    }

    // Grab the surrounding sentence/block for richer inbox context. The
    // context menu click grants `activeTab`, so executeScript works without a
    // broad <all_urls> host permission. Injection is forbidden on some pages
    // (chrome://, the Web Store, PDFs) — degrade gracefully to no context.
    let context = '';
    if (tabId != null) {
        try {
            const [res] = await chrome.scripting.executeScript({
                target: { tabId },
                func: grabSelectionContext,
            });
            context = typeof res?.result === 'string' ? res.result : '';
            log('context grabbed', { contextLen: context.length });
        } catch (e) {
            logErr('executeScript(grabSelectionContext) failed (proceeding without context)', e);
        }
    }

    const payload = {
        action: 'ADD_WORD' as const,
        term: term.toLowerCase(),
        context,
    };
    log('ADD_WORD → sending', { term: payload.term, contextLen: context.length });

    try {
        const result = await handleAuthMessage(payload);
        log('ADD_WORD ← success', result);
        await toast(tabId, `Added to Lingogram: ${term}`, true);
    } catch (err) {
        const msg = String(err instanceof Error ? err.message : err);
        // Full error incl. Firestore status + response body (e.g.
        // "Firestore commit 403: <details>") — this is the line to read.
        logErr('ADD_WORD ← FAILED', {
            message: msg,
            stack: err instanceof Error ? err.stack : undefined,
            raw: err,
        });
        // Re-check auth: the shared ADD_WORD handler wipes the cached session on
        // any failure it classifies as an auth failure (incl. Firestore 401/403,
        // which a rules rejection by `source` also triggers — that is NOT really
        // an expired session). Log whether the session survived so we can tell a
        // genuine token problem from a rules rejection.
        const after = await getAuthState();
        log('auth state AFTER failure', { stillSignedIn: !!after });

        // Always surface the real error in-page so debugging doesn't require the
        // SW console — then, only for genuine "needs sign-in" cases, also pop the
        // popup. A 403 with the session already wiped looks like auth loss but is
        // usually a Firestore rules rejection; show its text rather than hiding it.
        await toast(tabId, `Lingogram error: ${msg}`, false);
        if (/Not signed in|INVALID_REFRESH_TOKEN|TOKEN_EXPIRED/i.test(msg)) {
            await promptSignIn(tab);
        }
    }
}

// Open the toolbar popup so the user can sign in. openPopup() is Chrome 127+
// and can still fail (no focused window, unsupported channel) — fall back to a
// badge + toast so the prompt is never silently dropped.
async function promptSignIn(tab: chrome.tabs.Tab | undefined): Promise<void> {
    log('promptSignIn', { windowId: tab?.windowId });
    try {
        chrome.action.setBadgeText({ text: '!' });
        chrome.action.setBadgeBackgroundColor?.({ color: '#dc2626' });
    } catch {
        // chrome.action badge unavailable — non-fatal.
    }
    try {
        // Target the window the click came from when we know it; otherwise let
        // Chrome pick the last-focused window.
        await (tab?.windowId != null
            ? chrome.action.openPopup({ windowId: tab.windowId })
            : chrome.action.openPopup());
        log('openPopup ok');
        return;
    } catch (e) {
        logErr('openPopup failed → toast fallback', e);
    }
    await toast(tab?.id, 'Sign in via the Lingogram icon in the toolbar to add words.', false);
}

async function toast(tabId: number | undefined, text: string, ok: boolean): Promise<void> {
    if (tabId == null) return;
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            func: showToastInPage,
            args: [text, ok],
        });
    } catch {
        // injection blocked — silent (the action badge still reflects auth state).
    }
}

// --- Injected into the page (must be self-contained, no outer closure refs) ---

function grabSelectionContext(): string {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return '';
    const range = sel.getRangeAt(0);
    const node: Node = range.commonAncestorContainer;
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    const block =
        el?.closest('p, li, td, blockquote, h1, h2, h3, h4, h5, h6, article, section, div') ?? el;
    const text = (block?.textContent ?? sel.toString()).replace(/\s+/g, ' ').trim();
    return text.slice(0, 1000);
}

function showToastInPage(text: string, ok: boolean): void {
    const ID = 'lingogram-quick-add-toast';
    document.getElementById(ID)?.remove();
    const t = document.createElement('div');
    t.id = ID;
    t.textContent = text;
    Object.assign(t.style, {
        position: 'fixed',
        right: '20px',
        bottom: '20px',
        zIndex: '2147483647',
        padding: '10px 14px',
        borderRadius: '8px',
        background: ok ? 'rgba(22,163,74,0.95)' : 'rgba(185,28,28,0.95)',
        color: '#fff',
        fontSize: '13px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
    } as Partial<CSSStyleDeclaration>);
    (document.fullscreenElement ?? document.body).appendChild(t);
    setTimeout(() => t.remove(), 2500);
}
