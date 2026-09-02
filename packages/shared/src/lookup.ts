// Word lookup — the client for POST /dictionary/lookup and the pure helpers
// that shape its answer for the UI.
//
// The network call runs ONLY in the service worker: the edge's CORS allow-list
// carries the web origins, not chrome-extension://, so a content-script fetch
// dies on the preflight. The worker sends no Origin (and the manifest grants
// the host), so its request goes through. Content scripts reach this module
// for the pure helpers and the message types alone.
//
// Deliberately NOT exported from the package barrel: nothing secret lives
// here, but the barrel is the embed's surface too, and the embed has no
// backend to call — keeping this out makes "lookup exists" an extension fact.

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
}

export interface LookupRequest {
    term: string;
    targetLang: string;
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
        parts_of_speech: (Array.isArray(raw.parts_of_speech) ? raw.parts_of_speech : []).map((p) => ({
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

/** Whether the answer says anything — an unknown word is a 200 with none of this. */
export function hasLookupContent(r: LookupResult): boolean {
    if (r.translations.length > 0) return true;
    return r.parts_of_speech.some((p) => p.senses.length > 0);
}

/**
 * The translations the strip shows. The two sources are mirror images:
 * wiktionary fills the top-level list and leaves the per-sense ones empty; the
 * model does the reverse. Reading only one side renders the other source as an
 * empty strip, so both are consulted.
 */
export function stripTranslations(r: LookupResult, max = 3): string[] {
    const top = r.translations;
    if (top.length) return top.slice(0, max);
    const perSense = r.parts_of_speech[0]?.senses[0]?.translations ?? [];
    return perSense.slice(0, max);
}

/**
 * Whether the base form is worth showing next to the term.
 *
 * Not simply "lemma !== term". The dictionary resolves an inflection by
 * scanning every part of speech, so any word ending in -er/-est can be read as
 * a comparative and come back with THAT lemma even when its leading sense is
 * something else entirely: `number` answers lemma `numb`, `fitter` answers
 * `fit`. Rendering "number → numb" over a noun entry is worse than showing no
 * base form at all.
 *
 * The guard: the lemma is shown only when the entry actually leads with the
 * part of speech the inflection belongs to. A real inflection puts its own
 * part of speech first — the dictionary leads with the word's dominant
 * reading — so `running` (v. first) keeps its `run`, while `number` (n.
 * first, comparative claim) drops a lemma that describes a sense nobody was
 * reading.
 */
export function showsLemma(r: LookupResult): boolean {
    const lemma = r.lemma.trim();
    if (!lemma || lemma.toLowerCase() === r.term.trim().toLowerCase()) return false;
    const lead = r.parts_of_speech[0]?.tag;
    // No parts of speech at all: nothing to contradict the lemma.
    if (!lead) return true;
    // A comparative/superlative lemma is only credible when the entry leads
    // with an adjective or adverb — the parts of speech that inflect that way.
    const term = r.term.trim().toLowerCase();
    if (/(er|est)$/.test(term) && !lemma.toLowerCase().endsWith(term)) {
        return lead === 'adj.' || lead === 'adv.';
    }
    return true;
}

/**
 * The strip's fallback line for a word the dictionary defines but has no
 * equivalents for in the target language ("sloppily" → an honest empty list,
 * per the service's no-guessing rule). A definition beats an empty strip.
 */
/**
 * Whether the answer's translations are attached to senses — the model's
 * shape, ordered by the sentence — rather than the dictionary's flat,
 * context-blind list. The two sources are mirror images (see
 * stripTranslations), so per-sense translations are the fingerprint of a
 * context-aware answer, and the UI may only claim "this is the sense used in
 * the phrase" when this returns true.
 */
export function isContextual(r: LookupResult): boolean {
    return r.parts_of_speech.some((p) => p.senses.some((s) => s.translations.length > 0));
}

export function stripDefinition(r: LookupResult): string {
    for (const p of r.parts_of_speech) {
        for (const s of p.senses) {
            if (s.definition) return s.definition;
        }
    }
    return '';
}

/**
 * Part-of-speech tags in server order. That order is NOT contextual for the
 * dictionary — it lists the word's dominant reading first and never sees the
 * sentence (verified: opposite contexts return byte-identical answers); only
 * a model answer is ordered by the phrase. Duplicates collapse: "and" arrives
 * as conj., n., n. These are a LIST of the word's roles, never labels on
 * individual translations — wiktionary's translations are one flat list with
 * no per-tag split, so labelling them would be a guess.
 */
export function posTags(r: LookupResult, max = 3): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of r.parts_of_speech) {
        const tag = p.tag.trim();
        if (!tag || seen.has(tag)) continue;
        seen.add(tag);
        out.push(tag);
        if (out.length >= max) break;
    }
    return out;
}

/** Coarse latency label for analytics — never the raw number. */
export function latencyBucket(ms: number): string {
    if (ms < 300) return 'lt300';
    if (ms < 1000) return 'lt1000';
    if (ms < 3000) return 'lt3000';
    return 'slow';
}

// ---------------------------------------------------------------------------
// Worker-side cache
// ---------------------------------------------------------------------------

// Keyed by (detail level, language, term) — context deliberately excluded: the
// first answer's sense order is reused for later sightings of the same word,
// which trades a little precision for not re-spending the 30/min budget every
// time a common word recurs. The server keeps its own context-aware cache.
const cache = new Map<string, LookupResult>();
const CACHE_MAX = 200;

export function cacheKey(detail: boolean, targetLang: string, term: string): string {
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
    if (hit) return { result: hit, cached: true };
    const result = await fetchLookup(baseUrl, req);
    // An empty answer is cached too: the service treats "no entry" as a stable
    // fact, and re-asking on every hover would burn the rate limit on typos.
    if (cache.size >= CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, result);
    return { result, cached: false };
}

/** Test seam: the cache is module state, and tests must not share it. */
export function clearLookupCache(): void {
    cache.clear();
}
