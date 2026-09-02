// The client for POST /dictionary/lookup, and the worker-side cache in front
// of it.
//
// The network call runs ONLY in the service worker: the edge's CORS allow-list
// carries the web origins, not chrome-extension://, so a content-script fetch
// dies on the preflight. The worker sends no Origin (and the manifest grants
// the host), so its request goes through. Content scripts never import this
// file — they post LOOKUP_WORD and let the worker answer.
import {
    LOOKUP_TIMEOUT_MS,
    LookupPartOfSpeech,
    LookupRequest,
    LookupResult,
} from './types';
import { hasLookupContent } from './shape';

/**
 * One POST to the dictionary service. Resolves to the parsed answer; throws on
 * timeout, transport failure or a non-200. An unknown word is NOT an error —
 * the service answers 200 with empty content, and hasLookupContent() is how
 * callers tell that case apart.
 */
export async function fetchLookup(baseUrl: string, req: LookupRequest): Promise<LookupResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
    let res: Response;
    try {
        res = await fetch(`${baseUrl.replace(/\/+$/, '')}/dictionary/lookup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                term: req.term,
                target_lang: req.targetLang,
                ...(req.context ? { context: req.context } : {}),
                ...(req.maxPartsOfSpeech ? { max_parts_of_speech: req.maxPartsOfSpeech } : {}),
                ...(req.maxSenses ? { max_senses: req.maxSenses } : {}),
                ...(req.maxExamples ? { max_examples: req.maxExamples } : {}),
            }),
            signal: controller.signal,
        });
    } catch (err) {
        const timedOut = (err as { name?: string } | null)?.name === 'AbortError';
        throw new Error(timedOut ? 'lookup timeout' : 'lookup network failure');
    } finally {
        clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`lookup HTTP ${res.status}`);
    return normalizeLookup((await res.json()) as Partial<LookupResult>, req.term);
}

// The service promises no nulls, but this result crosses an extension message
// boundary and is rendered verbatim — a defensive fill here beats optional
// chaining sprinkled through every renderer.
function normalizeLookup(raw: Partial<LookupResult>, term: string): LookupResult {
    return {
        term: typeof raw.term === 'string' ? raw.term : term,
        lemma: typeof raw.lemma === 'string' ? raw.lemma : term,
        translations: Array.isArray(raw.translations) ? raw.translations.filter(isStr) : [],
        parts_of_speech: (Array.isArray(raw.parts_of_speech) ? raw.parts_of_speech : []).map((p: Partial<LookupPartOfSpeech>) => ({
            tag: isStr(p?.tag) ? p.tag : '',
            label: isStr(p?.label) ? p.label : '',
            senses: (Array.isArray(p?.senses) ? p.senses : []).map((s) => ({
                translations: Array.isArray(s?.translations) ? s.translations.filter(isStr) : [],
                definition: isStr(s?.definition) ? s.definition : '',
                examples: (Array.isArray(s?.examples) ? s.examples : []).map((e) => ({
                    text: isStr(e?.text) ? e.text : '',
                    translation: isStr(e?.translation) ? e.translation : '',
                    highlight: isStr(e?.highlight) ? e.highlight : '',
                })),
            })),
        })),
        source: typeof raw.source === 'string' ? raw.source : '',
    };
}

function isStr(v: unknown): v is string {
    return typeof v === 'string';
}

// ---------------------------------------------------------------------------
// Worker-side cache
// ---------------------------------------------------------------------------

// Keyed by (detail level, language, term) — context deliberately excluded: the
// first answer's sense order is reused for later sightings of the same word,
// which trades a little precision for not re-spending the 30/min budget every
// time a common word recurs. The server keeps its own context-aware cache.
/** A cached answer, with the moment it stops counting (Infinity = never). */
interface CacheEntry {
    result: LookupResult;
    until: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_MAX = 200;

/**
 * How long an empty answer is trusted. Long enough that scrubbing back over
 * the same line does not re-ask for a word that genuinely has no entry, short
 * enough that a service that was briefly degraded answers properly on the next
 * hover rather than at the end of the session.
 */
const EMPTY_TTL_MS = 60_000;

const expired = (e: CacheEntry): boolean => Date.now() >= e.until;

function cacheKey(detail: boolean, targetLang: string, term: string): string {
    return `${detail ? 'd' : 's'}|${targetLang.toLowerCase()}|${term.toLowerCase().trim()}`;
}

/** fetchLookup through the in-memory cache. `cached` reports which path answered. */
export async function lookupCached(
    baseUrl: string,
    req: LookupRequest,
    detail: boolean,
): Promise<{ result: LookupResult; cached: boolean }> {
    const key = cacheKey(detail, req.targetLang, req.term);
    const hit = cache.get(key);
    if (hit && !expired(hit)) return { result: hit.result, cached: true };
    const result = await fetchLookup(baseUrl, req);
    // An empty answer is cached too — re-asking on every hover would burn the
    // rate limit on typos — but only briefly. The service does NOT store one
    // (its own cache treats "no content" as a miss), because empty is not
    // always the stable fact it looks like: a degraded model answers 200 with
    // nothing in it. Keeping that forever would leave a word permanently
    // blank for the life of the worker, long after the service recovered.
    const until = hasLookupContent(result) ? Infinity : Date.now() + EMPTY_TTL_MS;
    if (cache.size >= CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, { result, until });
    return { result, cached: false };
}

/**
 * Drop every cached answer.
 *
 * Two callers, and the second is the reason this is public API rather than a
 * test seam: the dev-only backend switch calls it, because the cache is keyed
 * by term and language but NOT by backend — without this, answers fetched from
 * one side would keep being served after switching to the other, and checking
 * that a dictionary change reached the other side is exactly why anyone
 * switches. Tests call it too, since the cache is module state they must not
 * share.
 */
export function clearLookupCache(): void {
    cache.clear();
}
