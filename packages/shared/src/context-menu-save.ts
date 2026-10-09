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

import { adoptAnalyticsOptOut, answerAnalyticsRequest } from './analytics-consent';
import { adoptAiTranslate, answerAiTranslateRequest } from './subtitle-ai/sync';
import { handleAuthMessage } from './auth/background';
import { AUTH_UID_KEY, getAuthState, SIBLING_KEYS } from './auth/storage';
import { answerHighlightRequest, takeHighlightPrefsFrom } from './highlight-prefs';
import { msg } from './i18n';
import {
    editionOf,
    isSiblingMessage,
    ownsSharedFeatures,
    siblingIdsOf,
    SIBLING_MESSAGE_TYPE,
    askSiblingStatus,
    type SiblingStatus,
} from './sibling';
import { setMirrorEntry } from './word-mirror';

const MENU_ID = 'lingogram-add-to-inbox';
export const MAX_TERM_LEN = 256;
export const MAX_CONTEXT_LEN = 1000;
const TOAST_MS = 2500;

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

function tellSibling(): void {
    for (const id of siblingIdsOf(chrome.runtime.id)) {
        chrome.runtime.sendMessage(id, { type: SIBLING_MESSAGE_TYPE, op: 'sync' }).catch(() => {
            // not installed — nothing to tell.
        });
    }
}

async function decideAndApply(): Promise<void> {
    const signedIn = !!(await getAuthState());
    const sibling = await askSiblingStatus();
    let yieldedBefore = false;
    try {
        yieldedBefore = (await chrome.storage?.local?.get(SIBLING_KEYS.otherOwns))?.[SIBLING_KEYS.otherOwns] === true;
    } catch {
        // unknown: nothing to take over
    }
    const owns = ownsSharedFeatures(editionOf(chrome.runtime.id), signedIn, sibling);
    const ownerEdition = sibling ? editionOf(sibling.id) : null;
    // The same answer decides who paints saved words on web pages: a content
    // script cannot message another extension, so it reads the worker's answer.
    try {
        await chrome.storage?.local?.set({
            [SIBLING_KEYS.otherOwns]: !owns,
            // Who, so the popup and the site can point there instead of showing switches nobody reads.
            [SIBLING_KEYS.owner]: !owns && sibling && ownerEdition ? { edition: ownerEdition, id: sibling.id } : null,
        });
    } catch {
        // storage unavailable — the page script then paints, a duplicate at worst.
    }
    // Ownership moved here while the previous owner still answers: its
    // highlight settings are the ones the learner last saw, so they come along.
    if (owns && yieldedBefore && sibling) await takeHighlightPrefsFrom(sibling.id);
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
    chrome.runtime.onInstalled.addListener((details) => {
        // A learner who opted out of stats in the other edition is out here too.
        if (details?.reason === 'install') void adoptAnalyticsOptOut();
        // Likewise the AI translation switch, on if it is on there (dev builds only).
        if (__EXT_ENV__ === 'dev' && details?.reason === 'install') void adoptAiTranslate();
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
            if (message.op === 'highlightGet' || message.op === 'highlightSet') {
                void answerHighlightRequest(message).then(sendResponse);
                return true;
            }
            if (message.op === 'analyticsGet' || message.op === 'analyticsSet') {
                void answerAnalyticsRequest(message).then(sendResponse);
                return true;
            }
            if (__EXT_ENV__ === 'dev' && (message.op === 'aiTranslateGet' || message.op === 'aiTranslateSet')) {
                void answerAiTranslateRequest(message).then(sendResponse);
                return true;
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

    // The surrounding paragraph, for context in the inbox. Injection is refused
    // on some pages (chrome://, the Web Store, PDFs): save without context then.
    let context = '';
    if (tabId != null) {
        try {
            const [res] = await chrome.scripting.executeScript({
                // The frame the selection is in: the top frame's getSelection()
                // knows nothing about a selection inside an iframe.
                target: typeof info.frameId === 'number' ? { tabId, frameIds: [info.frameId] } : { tabId },
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
        // A signed-out learner never lands here: the word is kept in the
        // browser and the save succeeds. A dead session does not either — the
        // worker keeps the word locally then too. What is left is a real
        // failure (a refusal by the rules: a save within a second of another,
        // the daily cap), shown as one.
        await toast(tabId, msg('ytQuickAddFailed', "Couldn't save: {error}").replace('{error}', message), false);
    }
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

/**
 * The text around the selection, at most `limit` characters, for the inbox.
 *
 * The prose block the selection starts in: a paragraph, list item, cell or
 * heading. Never a generic wrapper (div, section, article), which can hold a
 * whole page. Read without scripts and styles, and when the block is longer
 * than `limit`, a window centred on the selection rather than its first
 * `limit` characters, which would often not contain the word at all.
 *
 * Exported for tests; injected into the page, so it must stay self-contained.
 */
export function grabSelectionContext(limit: number): string {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return '';
    const range = sel.getRangeAt(0);
    const picked = sel.toString().replace(/\s+/g, ' ').trim();
    const start = range.startContainer;
    const startEl = start.nodeType === Node.ELEMENT_NODE ? (start as Element) : start.parentElement;
    const block =
        startEl?.closest('p, li, dd, dt, td, th, blockquote, figcaption, caption, h1, h2, h3, h4, h5, h6') ??
        startEl;
    if (!block) return picked.slice(0, limit);

    const clone = block.cloneNode(true) as Element;
    clone.querySelectorAll('script, style, noscript, template').forEach((n) => n.remove());
    const text = (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text.length <= limit) return text;

    // Where the selection starts within the block, approximately (whitespace is
    // collapsed differently), then the occurrence of the selected text nearest
    // to that point.
    const before = document.createRange();
    before.selectNodeContents(block);
    before.setEnd(range.startContainer, range.startOffset);
    const approx = before.toString().replace(/\s+/g, ' ').trimStart().length;
    let at = -1;
    if (picked) {
        for (let i = text.indexOf(picked); i !== -1; i = text.indexOf(picked, i + 1)) {
            if (at === -1 || Math.abs(i - approx) < Math.abs(at - approx)) at = i;
        }
    }
    if (at === -1) at = Math.min(approx, text.length);

    const room = Math.max(0, limit - picked.length);
    let from = Math.max(0, at - Math.floor(room / 2));
    const to = Math.min(text.length, from + limit);
    from = Math.max(0, to - limit);
    let out = text.slice(from, to);
    // Whole words only at a cut edge.
    if (from > 0) out = out.replace(/^\S*\s/, '');
    if (to < text.length) out = out.replace(/\s\S*$/, '');
    return out.trim();
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
