// The card line for an empty answer: the AI part was skipped, or Google failed on a phrase.

import { msg } from '../i18n';
import { aiNoticeHtml } from '../ai-balance/notice';
import { escapeHtml } from '../escape-html';
import { isPhrase } from './shape';
import type { LookupAnswer } from './types';

/** The notice as markup, '' when neither applies; wire it with wireAINotice once in the DOM. */
export function emptyNoticeHtml(r: LookupAnswer): string {
    if (r.ai_status) return aiNoticeHtml(r.ai_status, isPhrase(r.lemma));
    if (r.googleFailed) {
        return `<span class="lg-ai-notice">${escapeHtml(msg('lookupGoogleFailed', 'Google did not answer, try again'))}</span>`;
    }
    return '';
}
