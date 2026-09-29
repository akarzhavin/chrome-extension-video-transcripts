// Phrase translation straight from Google's mobile web translator.
//
// A port of dictionary-service's translate.GoogleWeb (internal/translate/
// google.go): GET translate.google.com/m?sl=&tl=&q= and read the answer out of
// the returned markup. No API key, no official API.
//
// It runs in the worker, from the user's own IP, so one busy Cloud Run egress
// address is never what Google sees — and the manifest's host permission is
// what lets the worker read the cross-origin reply at all. The worker has no
// DOMParser, hence the two regexes below instead of a parse.
//
// Deliberately NOT the Go wrapper's behaviour on failure: Translator.Do hands
// back the input text when anything goes wrong, which on a card would read as
// a translation identical to the phrase. Here a failure throws and "nothing
// useful" is null, so the caller can fall back to /dictionary/lookup.
import type { LookupResult } from './types';

const GOOGLE_WEB_URL = 'https://translate.google.com/m';
// The JSON endpoint Google's own widgets call. Asked first: measured on
// 2026-09-28 from a network the /m page answers with a captcha (302 to
// google.com/sorry, for curl and the extension alike), this one still
// returned 200 with the whole phrase translated.
const GOOGLE_GTX_URL = 'https://translate.googleapis.com/translate_a/single';

// The strip has already waited for a mouseup; a phrase that takes longer than
// this is better answered by the fallback than by a spinner. One budget for
// the whole Google leg, not per request: fetchGooglePhrase asks two endpoints
// in turn, and 3 s each would hold a paused video for 6 s before the fallback
// even starts.
export const GOOGLE_WEB_TIMEOUT_MS = 3000;

/** When a Google request started now has to give up, as a Date.now() value. */
function freshDeadline(): number {
    return Date.now() + GOOGLE_WEB_TIMEOUT_MS;
}

// deep-translator reads div.t0 first and falls back to div.result-container;
// the page has carried each at different times.
const RESULT_NODES = [
    /<div[^>]*class="t0"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class="result-container"[^>]*>([\s\S]*?)<\/div>/i,
];

const NAMED_ENTITIES: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'",
};

function decodeEntities(s: string): string {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9#]+);/gi, (whole, body: string) => {
        const lower = body.toLowerCase();
        if (lower in NAMED_ENTITIES) return NAMED_ENTITIES[lower];
        if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16));
        if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10));
        return whole;
    });
}

/** The translation in a /m page, or '' when the page carries none. */
export function parseGoogleWebHtml(html: string): string {
    for (const node of RESULT_NODES) {
        const m = node.exec(html);
        if (!m) continue;
        const text = decodeEntities(m[1].replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
        if (text) return text;
    }
    return '';
}

/** One translated phrase as the card's answer shape. */
function phraseAnswer(phrase: string, translation: string): LookupResult | null {
    if (!translation || translation.toLowerCase() === phrase.toLowerCase()) return null;
    return {
        term: phrase,
        lemma: phrase,
        translations: [translation],
        parts_of_speech: [],
        source: 'google',
    };
}

/** GET without cookies until `deadline`; throws on timeout or a non-2xx. */
async function getText(url: string, deadline: number): Promise<string> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('google timeout');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    try {
        // No cookies: the request must not carry the user's Google session,
        // which is also what the privacy policy promises (Section 1e).
        const res = await fetch(url, { credentials: 'omit', signal: controller.signal });
        if (!res.ok) throw new Error(`google HTTP ${res.status}`);
        return await res.text();
    } catch (err) {
        if ((err as { name?: string } | null)?.name === 'AbortError') throw new Error('google timeout');
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * The translation in a translate_a/single reply, or '' when it carries none.
 * The reply is nested arrays: [0] lists the sentence segments, each with its
 * translation first and its own trailing space, so they join as they are.
 */
export function parseGoogleGtx(body: string): string {
    let data: unknown;
    try {
        data = JSON.parse(body);
    } catch {
        return '';
    }
    const segments = Array.isArray(data) && Array.isArray(data[0]) ? data[0] : [];
    return segments
        .map((seg: unknown) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : ''))
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
}

/** One phrase through Google's JSON endpoint. Same contract as fetchGoogleWeb. */
export async function fetchGoogleGtx(
    term: string,
    targetLang: string,
    deadline = freshDeadline(),
): Promise<LookupResult | null> {
    const phrase = term.trim();
    const params = new URLSearchParams({ client: 'gtx', sl: 'auto', tl: targetLang, dt: 't', q: phrase });
    return phraseAnswer(phrase, parseGoogleGtx(await getText(`${GOOGLE_GTX_URL}?${params.toString()}`, deadline)));
}

/**
 * A phrase through Google: the JSON endpoint, then the /m page, both inside
 * one GOOGLE_WEB_TIMEOUT_MS budget. The first translation wins. Null when both answered with nothing; when neither
 * answered at all, the last failure is thrown, so a caller with no fallback
 * can tell "untranslatable" from "unreachable".
 */
export async function fetchGooglePhrase(term: string, targetLang: string): Promise<LookupResult | null> {
    let failure: unknown = null;
    let answered = false;
    const deadline = freshDeadline();
    for (const attempt of [fetchGoogleGtx, fetchGoogleWeb]) {
        try {
            const answer = await attempt(term, targetLang, deadline);
            if (answer) return answer;
            answered = true;
        } catch (err) {
            failure = err;
        }
    }
    if (!answered && failure) throw failure;
    return null;
}

/**
 * One phrase through Google's /m page. Resolves to a one-translation answer, or null when
 * the page has no translation or merely echoes the phrase back. Throws on
 * timeout, transport failure or a non-2xx (429 included) — every one of which
 * the caller answers with the fallback.
 */
export async function fetchGoogleWeb(
    term: string,
    targetLang: string,
    deadline = freshDeadline(),
): Promise<LookupResult | null> {
    const phrase = term.trim();
    const params = new URLSearchParams({ sl: 'auto', tl: targetLang, q: phrase });
    return phraseAnswer(phrase, parseGoogleWebHtml(await getText(`${GOOGLE_WEB_URL}?${params.toString()}`, deadline)));
}
