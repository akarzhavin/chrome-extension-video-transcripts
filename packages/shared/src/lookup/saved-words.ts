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
// is also why it is keyed by the lowercased term rather than by the hash the
// documents use: the hash is only obtainable asynchronously.
//
// At this commit the object is still populated only by saves made in this
// session — the mirror seeding arrives with the next task, and behaviour here
// is deliberately identical to the two Sets it replaces.

import type { WordState } from '../word-mirror';

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
 * A fresh, empty view. Terms are normalized to lower case on the way in and on
 * the way out, so callers that already lowercase (both of them, today) and any
 * that forget agree on the same key.
 */
export function createSavedWords(): SavedWords {
    const active = new Set<string>();
    return {
        has: (term) => active.has(term.toLowerCase()),
        add: (term) => {
            active.add(term.toLowerCase());
        },
        delete: (term) => {
            active.delete(term.toLowerCase());
        },
        reset: (words) => {
            active.clear();
            // Only `active` becomes membership. A `removed` entry is kept in
            // the mirror precisely so it can be told apart from a word that was
            // never saved, but here — where the question is only "is the heart
            // filled" — it reads exactly like absence.
            for (const [term, state] of Object.entries(words)) {
                if (state === 'active') active.add(term.toLowerCase());
            }
        },
        get size() {
            return active.size;
        },
    };
}
