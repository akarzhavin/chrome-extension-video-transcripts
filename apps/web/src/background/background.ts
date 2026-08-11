import { getAuthState, handleAuthMessage, installAuthBackground, installOnboarding } from '@video-transcripts/shared';
// Relative path, not the barrel: analytics-bg carries the GA4 api_secret and
// must stay out of anything a content script can pull in.
import { markInstalled, track } from '../../../../packages/shared/src/analytics-bg';

// No backend resolver here, unlike the youtube and rezka editions. This build
// has no alternate backend to switch to: vite.config.ts defines no __EXT_ALT_*__
// constants, so importing auth/devEnvSwitch would pull an undefined identifier
// into the worker and throw during module evaluation — before a single listener
// is registered, which silently disables the whole extension. Events from this
// edition simply carry no `backend` param, which is correct: there is only one.

// Reuse the exact auth stack shipped in the youtube / rezka extensions:
// popup sign-in (AUTH_* messages), the external token handoff from the
// Lingogram SPA, and ADD_WORD → Firestore writes.
installAuthBackground();
installOnboarding('web', {
    onInstall: () => {
        void markInstalled();
        void track('extension_installed', { ext: 'web' });
    },
    onUpdate: (previousVersion) => {
        void track('extension_updated', { previous_version: previousVersion });
    },
});

const MENU_ID = 'lingogram-add-to-inbox';
const MAX_TERM_LEN = 256;

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
    if (info.menuItemId !== MENU_ID) return;
    void handleAddToInbox(info, tab);
});

async function handleAddToInbox(
    info: chrome.contextMenus.OnClickData,
    tab: chrome.tabs.Tab | undefined,
): Promise<void> {
    const term = (info.selectionText ?? '').trim();
    if (!term || term.length > MAX_TERM_LEN) return;
    const tabId = tab?.id;

    // Not signed in? Pop the toolbar popup (which renders the sign-in button)
    // instead of silently failing the add. The context menu click is a user
    // gesture, so openPopup() is allowed — do it before any other async work
    // so the gesture isn't spent. Bail out: the word isn't lost on the user,
    // they re-select after signing in.
    if (!(await getAuthState())) {
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
        } catch {
            // injection blocked on this page — proceed without context.
        }
    }

    try {
        await handleAuthMessage({
            action: 'ADD_WORD',
            term: term.toLowerCase(),
            sourceUrl: info.pageUrl ?? tab?.url ?? '',
            context,
            title: tab?.title ?? '',
            // Coarse platform label for analytics — this edition saves from
            // anywhere on the web, so it reports itself rather than a hostname.
            site: 'web',
        });
        await toast(tabId, `Added to Lingogram: ${term}`, true);
    } catch (err) {
        const msg = String(err instanceof Error ? err.message : err);
        // Token revoked / session gone mid-add: handleAuthMessage already wiped
        // the cached state and raised the badge — also pop the sign-in popup.
        if (/Not signed in|sign in|INVALID_REFRESH_TOKEN|TOKEN_EXPIRED|40[013]/i.test(msg)) {
            await promptSignIn(tab);
            return;
        }
        await toast(tabId, `Lingogram: ${msg}`, false);
    }
}

// Open the toolbar popup so the user can sign in. openPopup() is Chrome 127+
// and can still fail (no focused window, unsupported channel) — fall back to a
// badge + toast so the prompt is never silently dropped.
async function promptSignIn(tab: chrome.tabs.Tab | undefined): Promise<void> {
    // This edition's sign-in prompt doesn't go through
    // AUTH_SIGN_IN_VIA_LINGOGRAM (it opens the popup instead), so the event is
    // recorded here to keep the funnel comparable across editions.
    void track('signin_started', { from: 'context_menu' });
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
        return;
    } catch {
        // openPopup unsupported/failed — fall through to the toast hint.
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
