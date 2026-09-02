// Pure helpers that shape one answer for display. No DOM, no network, no
// state — both surfaces (the hover card and the word screen) read the same
// answer through these, so the two can never disagree about what it says.
import { LookupResult } from './types';

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

/**
 * The strip's fallback line for a word the dictionary defines but has no
 * equivalents for in the target language ("sloppily" → an honest empty list,
 * per the service's no-guessing rule). A definition beats an empty strip.
 */
export function stripDefinition(r: LookupResult): string {
    for (const p of r.parts_of_speech) {
        for (const s of p.senses) {
            if (s.definition) return s.definition;
        }
    }
    return '';
}

/**
 * Deep link into Oxford Learner's Dictionaries for the word screen's footer.
 *
 * The scheme is /definition/<lang>/<word>, but <lang> is not a free slot:
 * the site's own picker offers exactly two — `english` and
 * `american_english` — and probing confirms everything else 404s (german,
 * french, spanish), because it is a monolingual dictionary OF English. So
 * the link exists only when the LEARNING language is English — that is the
 * language the looked-up word is in — and an American track (en-US) gets
 * the American edition.
 *
 * The term goes in as typed, lowercased with spaces hyphenated: Oxford
 * redirects bare forms to its numbered entries (going -> going_1) and
 * resolves irregular inflections (went) and hyphenated phrases (look-at).
 */
export function oxfordLookupUrl(term: string, learningLang: string): string | null {
    const tag = learningLang.trim();
    if (!/^en(-|_|$)/i.test(tag)) return null;
    const edition = /^en[-_]us$/i.test(tag) ? 'american_english' : 'english';
    const word = term.trim().toLowerCase().replace(/\s+/g, '-');
    if (!word) return null;
    return `https://www.oxfordlearnersdictionaries.com/definition/${edition}/${encodeURIComponent(word)}`;
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
