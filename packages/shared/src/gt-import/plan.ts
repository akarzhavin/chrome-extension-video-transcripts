// Which of the learner's Google Translate phrases become Lingogram saves.
//
// Pure: no chrome, no storage. The worker supplies the pairs it read and the
// state of every word the server already holds, and gets back the terms to
// write plus the counts the preview shows.

import { normalizeTerm } from '../word-key';
import type { SavedPair } from './read-saved';

export type KnownState = 'active' | 'removed';

export interface ImportPlan {
    /** Terms to write, in list order, first occurrence wins. */
    toAdd: string[];
    /** Already in the list as active words. */
    already: number;
    /** Removed by the learner earlier; never brought back. */
    removed: number;
    /** Pairs without the learning language, or terms too long to save. */
    skipped: number;
}

/** `en` matches `en`, `en-US`, `en-GB`: Google tags some rows with a region. */
function primary(lang: string): string {
    return lang.toLowerCase().split('-')[0];
}

/**
 * The side of the pair in the learning language, or null when neither side is.
 * Google keeps the pair in the direction it was typed, so the learning side is
 * on the left for some rows and on the right for others.
 */
export function learningSide(pair: SavedPair, learning: string): string | null {
    const want = primary(learning);
    if (primary(pair.srcLang) === want) return pair.srcText;
    if (primary(pair.dstLang) === want) return pair.dstText;
    return null;
}

const utf8 = new TextEncoder();

export function planImport(
    pairs: readonly SavedPair[],
    learning: string,
    known: ReadonlyMap<string, KnownState>,
    maxTermBytes: number,
): ImportPlan {
    const plan: ImportPlan = { toAdd: [], already: 0, removed: 0, skipped: 0 };
    const seen = new Set<string>();
    for (const pair of pairs) {
        const side = learningSide(pair, learning);
        if (side === null) {
            plan.skipped++;
            continue;
        }
        // One save of two lines ("overestimate\nunderestimate") is two words
        // to the learner. Joined, normalizeTerm would fold the line break into
        // a space and make a phrase nobody typed.
        for (const line of side.split('\n')) {
            const term = line.trim();
            if (!term) continue;
            if (utf8.encode(term).length > maxTermBytes) {
                plan.skipped++;
                continue;
            }
            const key = normalizeTerm(term);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            const state = known.get(key);
            if (state === 'active') plan.already++;
            else if (state === 'removed') plan.removed++;
            else plan.toAdd.push(term);
        }
    }
    return plan;
}
