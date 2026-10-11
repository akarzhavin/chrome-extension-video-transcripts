// The card line for an answer whose model part was skipped (spec 024): sign in
// to let AI complete it, or which AI limit ran out and when it resets. Shared
// by the hover strip, the word screen and the page-highlight card.

import { msg } from '../i18n';
import { statusText } from './format';
import { loadBalance } from './store';
import type { AIStatus } from './types';

const esc = (s: string): string =>
    s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** The notice as markup; wire it with wireAINotice once it is in the DOM. */
export function aiNoticeHtml(status: AIStatus): string {
    const button =
        status === 'sign_in_required'
            ? ` <button type="button" class="lg-ai-signin" data-ai-signin="1">${esc(msg('popupSignInLead', 'Sign in'))}</button>`
            : '';
    return `<span class="lg-ai-notice" data-ai-status="${esc(status)}">${esc(statusText(status, null))}</span>${button}`;
}

/** Fills the reset time from the stored balance and makes the sign-in button work. */
export function wireAINotice(root: HTMLElement): void {
    const notice = root.querySelector<HTMLElement>('.lg-ai-notice');
    const status = notice?.dataset.aiStatus as AIStatus | undefined;
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
