// The wire contract for POST /dictionary/lookup, plus the message contract a
// content script uses to reach it.
//
// Type-only imports, deliberately: a service worker, a content script and a test
// all need these shapes, and none of them should drag the client, the cache or
// any DOM code along to get them.
import type { AIStatus } from '../ai-balance/types';

/**
 * Longest term worth sending. The service refuses past 200 runes, so anything
 * longer is a round-trip that can only 400 — and the hover path's term comes
 * from a subtitle track we did not write.
 */
export const MAX_LOOKUP_TERM_LEN = 200;

export interface LookupExample {
    text: string;
    translation: string;
    highlight: string;
}

export interface LookupSense {
    translations: string[];
    definition: string;
    examples: LookupExample[];
}

export interface LookupPartOfSpeech {
    tag: string;
    label: string;
    senses: LookupSense[];
}

/** The wire shape of one answer, exactly as the service returns it. */
export interface LookupResult {
    term: string;
    lemma: string;
    translations: string[];
    parts_of_speech: LookupPartOfSpeech[];
    source: string;
    /** Why the answer has no model part (spec 024); absent when it was not skipped. */
    ai_status?: AIStatus;
    /** A signed-in caller's AI balance, raw; the worker keeps it, views read storage. */
    wallet?: unknown;
}

/** What LOOKUP_WORD hands a content script: the wire answer plus what only the worker knows. */
export interface LookupAnswer extends LookupResult {
    /** An empty phrase answer because Google did not answer. */
    googleFailed?: true;
}

export interface LookupRequest {
    term: string;
    targetLang: string;
    /** The signed-in caller's ID token: lets the model complete the card from their wallet. */
    idToken?: string;
    /** The subtitle line the word was selected from; improves sense order. */
    context?: string;
    maxPartsOfSpeech?: number;
    maxSenses?: number;
    maxExamples?: number;
}

/** The message a content script posts to the worker. */
export const LOOKUP_WORD_ACTION = 'LOOKUP_WORD' as const;

// The server bounds the whole call at ~6s (dictionary 1s + model 5s); one
// extra second covers the hop to Cloud Run. Past that the strip has long
// since stopped being useful, so the request is abandoned, not retried.
export const LOOKUP_TIMEOUT_MS = 7000;
