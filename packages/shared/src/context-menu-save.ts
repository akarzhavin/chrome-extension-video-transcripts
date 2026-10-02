// "Save to Lingogram" in the page's right-click menu: select a word or phrase on
// any site and it lands in the same inbox the subtitle panel saves to.
//
// Worker-side only. It rides on `activeTab` + `scripting` — the click itself
// grants access to that one page — so no host permission is added. Imported by
// path from each edition's background script, never through the package barrel:
// it reaches analytics-bg, which carries the GA4 api_secret.
//
// Two editions can be installed side by side, and Chrome lists each extension's
// menu item separately. A click only ever reaches the extension whose item was
// pressed, so the same selection is never saved twice; the problem is purely two
// identical items. The two agree on one owner, the edition the learner is signed
// in to (sibling.ts, ownsSharedFeatures), and the other hides its item.

import { track } from './analytics-bg';
import { handleAuthMessage } from './auth/background';
import { AUTH_UID_KEY, getAuthState } from './auth/storage';
import { msg } from './i18n';
import {
    editionOf,
    isSiblingMessage,
    ownsSharedFeatures,
    siblingIdsOf,
    SIBLING_MESSAGE_TYPE,
    type SiblingStatus,
} from './sibling';
import { setMirrorEntry } from './word-mirror';

const MENU_ID = 'lingogram-add-to-inbox';
export const MAX_TERM_LEN = 256;
export const MAX_CONTEXT_LEN = 1000;
const TOAST_MS = 2500;

/** Auth failures that mean "sign in again", not "try later". */
const SIGN_IN_ERROR = /Not signed in|sign in|INVALID_REFRESH_TOKEN|TOKEN_EXPIRED|40[013]/i;

/** Reads chrome.runtime.lastError so Chrome does not log it as unchecked. */
const quiet = (): void => {
    void chrome.runtime.lastError;
};

function showItem(): Promise<void> {
    return new Promise((done) => {
        // Recreated from scratch every time, so a renamed title or changed
        // contexts can never leave a stale duplicate behind.
        chrome.contextMenus.removeAll(() => {
            quiet();
            chrome.contextMenus.create(
                { id: MENU_ID, title: msg('ctxMenuSave', 'Save to Lingogram'), contexts: ['selection'] },
                () => {
                    quiet();
                    done();
                },
            );
        });
    });
}

function hideItem(): Promise<void> {
    return new Promise((done) =>
        chrome.contextMenus.removeAll(() => {
            quiet();
            done();
        }),
    );
}

/**
 * The other edition's answer, or null when it is not installed, disabled, or an
 * old version that does not accept this message. Null makes this edition show
 * its item: a duplicate is a nuisance, a missing item is a broken feature.
 */
async function siblingStatus(): Promise<{ signedIn: boolean } | null> {
    for (const id of siblingIdsOf(chrome.runtime.id)) {
        try {
            const res = (await chrome.runtime.sendMessage(id, {
                type: SIBLING_MESSAGE_TYPE,
                op: 'status',
            })) as Partial<SiblingStatus> | undefined;
            if (res?.ok === true && typeof res.signedIn === 'boolean') return { signedIn: res.signedIn };
        } catch {
            // that id is not installed — try the next one.
        }
    }
    return null;
}

function tellSibling(): void {
    for (const id of siblingIdsOf(chrome.runtime.id)) {
        chrome.runtime.sendMessage(id, { type: SIBLING_MESSAGE_TYPE, op: 'sync' }).catch(() => {
            // not installed — nothing to tell.
        });
    }
}

async function decideAndApply(): Promise<void> {
    const signedIn = !!(await getAuthState());
    const owns = ownsSharedFeatures(editionOf(chrome.runtime.id), signedIn, await siblingStatus());
    await (owns ? showItem() : hideItem());
}

// One decision at a time. A worker wakes on install/startup and also runs the
// top-level sync, and two overlapping removeAll/create pairs would interleave
// into a duplicate-id error.
let chain: Promise<void> = Promise.resolve();

/** Shows or hides this edition's item. Exported for tests. */
export function syncMenu(): Promise<void> {
    chain = chain.then(decideAndApply, decideAndApply);
    return chain;
}

export function installContextMenuSave(): void {
    const siblings = siblingIdsOf(chrome.runtime.id);

    // Every worker start, not only install/startup: the worker wakes many times
    // a day, so a removed or signed-out sibling is noticed within one wake.
    void syncMenu();
    chrome.runtime.onInstalled.addListener(() => {
        void syncMenu();
        tellSibling();
    });
    chrome.runtime.onStartup.addListener(() => void syncMenu());

    // Signing in or out here can move the item to or from the other edition.
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !(AUTH_UID_KEY in changes)) return;
        void syncMenu();
        tellSibling();
    });

    if (siblings.length > 0) {
        chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
            // Only the other edition, and only this one message; the sign-in
            // handoff listener answers everything else.
            if (!sender.id || !siblings.includes(sender.id) || !isSiblingMessage(message)) return false;
            if (message.op === 'sync') {
                void syncMenu();
                sendResponse({ ok: true });
                return false;
            }
            void getAuthState().then((state) => sendResponse({ ok: true, signedIn: !!state } satisfies SiblingStatus));
            return true; // answered asynchronously
        });
    }

    chrome.contextMenus.onClicked.addListener((info, tab) => {
        if (info.menuItemId !== MENU_ID) return;
        void saveSelection(info, tab);
    });
}

export async function saveSelection(
    info: chrome.contextMenus.OnClickData,
    tab: chrome.tabs.Tab | undefined,
): Promise<void> {
    const term = (info.selectionText ?? '').trim();
    if (!term || term.length > MAX_TERM_LEN) return;
    const tabId = tab?.id;

    // Signed out: show the sign-in popup rather than failing silently. The click
    // is a user gesture, which openPopup() needs, so nothing async comes first.
    if (!(await getAuthState())) {
        await promptSignIn(tab);
        return;
    }

    // The surrounding paragraph, for context in the inbox. Injection is refused
    // on some pages (chrome://, the Web Store, PDFs): save without context then.
    let context = '';
    if (tabId != null) {
        try {
            const [res] = await chrome.scripting.executeScript({
                target: { tabId },
                func: grabSelectionContext,
                args: [MAX_CONTEXT_LEN],
            });
            context = typeof res?.result === 'string' ? res.result : '';
        } catch {
            // no page access here — proceed without context.
        }
    }

    try {
        // The term goes as selected: the store keys it by itself (normalizeTerm),
        // and a lowercase here would be a second spelling of the same word.
        await handleAuthMessage({
            action: 'ADD_WORD',
            term,
            // Only the word and its surrounding text are stored; the page's
            // address and title are deliberately not sent.
            context,
            // Coarse platform label for analytics; the page itself is never named.
            site: 'web',
            // No page UI of ours to show the rating banner on.
            silent: true,
        });
        // So the same word reads as saved in a transcript without waiting for a sync.
        await setMirrorEntry(term, 'active');
        await toast(tabId, msg('ytQuickAddSaved', 'Saved: {term}').replace('{term}', term), true);
    } catch (err) {
        const message = String(err instanceof Error ? err.message : err);
        // Token revoked mid-save: handleAuthMessage already wiped the cached
        // state and raised the badge; the popup is the way back in.
        if (SIGN_IN_ERROR.test(message)) {
            await promptSignIn(tab);
            return;
        }
        await toast(tabId, msg('ytQuickAddFailed', "Couldn't save: {error}").replace('{error}', message), false);
    }
}

// openPopup() is Chrome 127+ and can still fail (no focused window), so a badge
// and a toast back it up and the prompt is never silently dropped.
async function promptSignIn(tab: chrome.tabs.Tab | undefined): Promise<void> {
    void track('signin_started', { from: 'context_menu' });
    try {
        chrome.action.setBadgeText({ text: '!' });
        chrome.action.setBadgeBackgroundColor?.({ color: '#dc2626' });
    } catch {
        // badge unavailable — non-fatal.
    }
    try {
        await (tab?.windowId != null
            ? chrome.action.openPopup({ windowId: tab.windowId })
            : chrome.action.openPopup());
        return;
    } catch {
        // fall through to the toast hint.
    }
    await toast(tab?.id, msg('ytSignInToSave', 'Sign in to save words'), false);
}

async function toast(tabId: number | undefined, text: string, ok: boolean): Promise<void> {
    if (tabId == null) return;
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            func: showToastInPage,
            args: [text, ok, TOAST_MS],
        });
    } catch {
        // injection blocked — the action badge still reflects auth state.
    }
}

// --- Injected into the page: self-contained, no references to the module ---

function grabSelectionContext(limit: number): string {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return '';
    const node: Node = sel.getRangeAt(0).commonAncestorContainer;
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    const block =
        el?.closest('p, li, td, blockquote, h1, h2, h3, h4, h5, h6, article, section, div') ?? el;
    return (block?.textContent ?? sel.toString()).replace(/\s+/g, ' ').trim().slice(0, limit);
}

function showToastInPage(text: string, ok: boolean, ms: number): void {
    const ID = 'lingogram-quick-add-toast';
    document.getElementById(ID)?.remove();
    const t = document.createElement('div');
    t.id = ID;
    t.setAttribute('role', ok ? 'status' : 'alert');
    t.textContent = text;
    Object.assign(t.style, {
        position: 'fixed',
        right: '20px',
        bottom: '20px',
        zIndex: '2147483647',
        padding: '10px 14px',
        borderRadius: '8px',
        background: ok ? '#0f766e' : '#b42318',
        color: '#fff',
        fontSize: '13px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
    } as Partial<CSSStyleDeclaration>);
    (document.fullscreenElement ?? document.body).appendChild(t);
    setTimeout(() => t.remove(), ms);
}
