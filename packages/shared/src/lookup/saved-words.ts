// The in-tab view of which words are saved.
//
// One object per content script, read by both faces of the save control: the
// strip's heart (strip.ts) and the word screen's pair of controls
// (word-screen.ts). They used to hold a `Set` each — one a module-local, one a
// private field — which meant the same word could be filled on one and empty on
// the other, and nothing in the code said they should agree.
//
// Reads are synchronous by design. Both callers decide how to paint while
// building a frame, so this can await neither storage nor crypto.subtle. That
// is also why it is keyed by the normalized term rather than by the hash the
// documents use: the hash is only obtainable asynchronously.
//
// The key is `normalizeTerm`, the mirror's own — not `toLowerCase()`. This
// object is filled from a mirror snapshot and questioned with raw DOM text, so
// the two sides have to agree on more than case: a phrase carrying a tab
// between its spans or an NBSP from subtitle markup reaches `has()` in a form
// no lowercase pass would ever match to the entry `reset()` put in.
//
// At this commit the object is still populated only by saves made in this
// session — the mirror seeding arrives with the next task, and behaviour here
// is deliberately identical to the two Sets it replaces.

import type { WordState } from '../word-mirror';
import { normalizeTerm } from '../word-key';

export interface SavedWords {
    /** Whether the term is currently saved. Synchronous, for the render path. */
    has(term: string): boolean;
    /** Record a save made in this tab. */
    add(term: string): void;
    /** Record a removal made in this tab. */
    delete(term: string): void;
    /** Replace the whole view — how a mirror snapshot is applied. */
    reset(words: Record<string, WordState>): void;
    /** How many terms read as saved. Exposed for tests and diagnostics. */
    readonly size: number;
}

/**
 * A fresh, empty view. Terms go through `normalizeTerm` on the way in and on the
 * way out, so a caller that already normalized and one that hands over raw DOM
 * text agree on the same key.
 */
export function createSavedWords(): SavedWords {
    const active = new Set<string>();
    return {
        has: (term) => active.has(normalizeTerm(term)),
        add: (term) => {
            active.add(normalizeTerm(term));
        },
        delete: (term) => {
            active.delete(normalizeTerm(term));
        },
        reset: (words) => {
            active.clear();
            // Only `active` becomes membership. A `removed` entry is kept in
            // the mirror precisely so it can be told apart from a word that was
            // never saved, but here — where the question is only "is the heart
            // filled" — it reads exactly like absence.
            for (const [term, state] of Object.entries(words)) {
                if (state === 'active') active.add(normalizeTerm(term));
            }
        },
        get size() {
            return active.size;
        },
    };
}
