// The card line for an answer whose model part was skipped (spec 024): sign in
// to let AI complete it, or which AI limit ran out and when it resets. Shared
// by the hover strip, the word screen and the page-highlight card.

import { escapeHtml } from '../escape-html';
import { msg } from '../i18n';
import { statusText } from './format';
import { loadBalance } from './store';
import { parseAIStatus, type AIStatus } from './types';


/** The notice as markup; wire it with wireAINotice once it is in the DOM. */
export function aiNoticeHtml(status: AIStatus, phrase = false): string {
    const button =
        status === 'sign_in_required'
            ? ` <button type="button" class="lg-ai-signin" data-ai-signin="1">${escapeHtml(msg('popupSignInLead', 'Sign in'))}</button>`
            : '';
    return `<span class="lg-ai-notice" data-ai-status="${escapeHtml(status)}">${escapeHtml(statusText(status, null, phrase))}</span>${button}`;
}

/** Fills the reset time from the stored balance and makes the sign-in button work. */
export function wireAINotice(root: HTMLElement): void {
    const notice = root.querySelector<HTMLElement>('.lg-ai-notice');
    const status = parseAIStatus(notice?.dataset.aiStatus);
    if (notice && status && status !== 'sign_in_required') {
        void loadBalance().then((b) => {
            if (b) notice.textContent = statusText(status, b);
        });
    }
    root.querySelector<HTMLButtonElement>('[data-ai-signin]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        try {
            chrome.runtime.sendMessage({ action: 'AUTH_SIGN_IN_VIA_LINGOGRAM', from: 'lookup' }, () => void chrome.runtime.lastError);
        } catch {
            /* orphaned context */
        }
    });
}
