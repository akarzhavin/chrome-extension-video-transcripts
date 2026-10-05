// What the toolbar popup, the settings page and the words page have in common:
// the worker's account answer, the few tabs they open, and the small DOM
// helpers. One module, so the three cannot drift apart on where a link leads.

import { config } from '../auth/config';
import { msg as i18nMsg } from '../i18n';
import type { Edition } from '../sibling';

/** The worker's AUTH_STATUS answer. */
export interface AuthStatus {
    signedIn: boolean;
    email?: string;
    uid?: string;
    /** Active words in the mirror; for a signed-out learner, the words kept in this browser. */
    inboxCount?: number;
    /** Words stored only in this browser, waiting for an account. */
    localCount?: number;
    /** The session expired (the red "!" on the icon). */
    needsReauth?: boolean;
}

export function send<T = unknown>(msg: object): Promise<T> {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(msg, (res) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(res as T);
        });
    });
}

/** `{name}` placeholders replaced in JS: Chrome's own `$NAME$` kind is not used. */
export function fill(template: string, vars: Record<string, string | number>): string {
    let s = template;
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
}

/**
 * Start the sign-in on the site. `from` tells the funnel which surface the
 * learner came from. Throws with a sentence the learner can read.
 */
export async function startSignIn(from: 'popup' | 'settings' | 'words'): Promise<void> {
    const res = await send<{ ok: boolean; error?: string }>({ action: 'AUTH_SIGN_IN_VIA_LINGOGRAM', from });
    if (!res.ok) throw new Error(res.error ?? i18nMsg('ytAuthOpenFailed', "Couldn't open the sign-in page. Try again."));
}

// Read at call time: a dev build retargets config.frontendBaseUrl at runtime.
/** The signed-in vocabulary on the site. */
export function vocabUrl(): string {
    return `${config.frontendBaseUrl}/app/vocab`;
}

/** The site's own settings page for this extension. */
export function siteSettingsUrl(edition: Edition): string {
    const q = new URLSearchParams({ ext: chrome.runtime.id, edition });
    return `${config.frontendBaseUrl}/app/vocab/extension?${q.toString()}`;
}

/** The extension's own full-tab pages. */
export const WORDS_PAGE = 'words.html';
export const SETTINGS_PAGE = 'settings.html';

export async function openTab(url: string): Promise<void> {
    await chrome.tabs.create({ url });
}

export function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string,
): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
}

/** The extension's icon, as the header of each of the three surfaces. */
export function iconImage(size: number): HTMLImageElement {
    const img = el('img', 'brand-icon');
    img.src = 'src/assets/icons/icon48.png';
    img.alt = '';
    img.width = size;
    img.height = size;
    return img;
}
