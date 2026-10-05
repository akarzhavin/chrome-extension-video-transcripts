// Words saved without an account. They live in the browser until the learner
// signs in, and the worker then moves them into the account (auth/background.ts).
//
// One key, one blob, like the word mirror. The record key is the mirror's own
// `normalizeTerm`, applied here and never by callers, so a word saved twice with
// different capitalisation is one record. `term` keeps what the learner saved,
// untouched: it is what the account document is written from later.
//
// Written by the worker only. Every change goes through one queue: the upload
// removes words while a save may be adding one, and a plain read-modify-write
// would lose whichever finished first.

import { WORD_KEYS } from './auth/storage';
import { normalizeTerm } from './word-key';

export interface LocalWord {
    /** As saved by the learner. */
    term: string;
    context: string;
    /** Coarse platform label of the save (youtube, netflix, rezka, web). */
    site: string;
    /** Epoch ms of the first save. A repeat save keeps it. */
    addedAt: number;
    translation?: string;
}

export interface LocalWordsBlob {
    words: Record<string, LocalWord>;
}

export const LOCAL_WORDS_KEY = WORD_KEYS.local;

// A translation is a word or a short phrase; the cap keeps a runaway string
// from sitting in storage.
const MAX_TRANSLATION_LEN = 500;

function isLocalWord(v: unknown): v is LocalWord {
    if (typeof v !== 'object' || v === null) return false;
    const w = v as Partial<LocalWord>;
    return (
        typeof w.term === 'string' &&
        w.term !== '' &&
        typeof w.context === 'string' &&
        typeof w.site === 'string' &&
        typeof w.addedAt === 'number' &&
        Number.isFinite(w.addedAt)
    );
}

/**
 * Stored bytes → a blob. A missing or damaged value is empty, and a damaged
 * record costs only itself, not the rest of the list.
 */
function coerce(raw: unknown): LocalWordsBlob {
    const out: LocalWordsBlob = { words: {} };
    if (typeof raw !== 'object' || raw === null) return out;
    const words = (raw as { words?: unknown }).words;
    if (typeof words !== 'object' || words === null) return out;
    for (const [k, v] of Object.entries(words)) {
        if (!k || !isLocalWord(v)) continue;
        const w: LocalWord = { term: v.term, context: v.context, site: v.site, addedAt: v.addedAt };
        if (typeof v.translation === 'string' && v.translation) w.translation = v.translation;
        out.words[k] = w;
    }
    return out;
}

async function load(): Promise<LocalWordsBlob> {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return { words: {} };
    try {
        const v = (await chrome.storage.local.get(LOCAL_WORDS_KEY)) as Record<string, unknown>;
        return coerce(v[LOCAL_WORDS_KEY]);
    } catch {
        return { words: {} };
    }
}

async function write(blob: LocalWordsBlob): Promise<void> {
    // Unlike the mirror this must not swallow a failure: a save that reported
    // success while nothing was stored would lose the word for good.
    await chrome.storage.local.set({ [LOCAL_WORDS_KEY]: blob });
}

let queue: Promise<unknown> = Promise.resolve();

/** Run a change after the ones before it, whether or not they succeeded. */
function serial<T>(job: () => Promise<T>): Promise<T> {
    const run = queue.then(job, job);
    queue = run.catch(() => undefined);
    return run;
}

/**
 * Keep a word. Saving a word that is already here keeps its `addedAt` and its
 * translation, and replaces the context only when the new one is not empty:
 * a second save from a place with no sentence must not erase the first one's.
 */
export function addLocalWord(input: { term: string; context?: string; site?: string }): Promise<LocalWord> {
    return serial(async () => {
        const k = normalizeTerm(input.term);
        if (!k) throw new Error('term required');
        const blob = await load();
        const context = input.context ?? '';
        const prev = blob.words[k];
        const next: LocalWord = prev
            ? { ...prev, context: context || prev.context }
            : { term: input.term, context, site: input.site ?? '', addedAt: Date.now() };
        blob.words[k] = next;
        await write(blob);
        return next;
    });
}

export function removeLocalWord(term: string): Promise<void> {
    return removeLocalWords([term]);
}

export function removeLocalWords(terms: readonly string[]): Promise<void> {
    return serial(async () => {
        const blob = await load();
        let changed = false;
        for (const t of terms) {
            const k = normalizeTerm(t);
            if (k in blob.words) {
                delete blob.words[k];
                changed = true;
            }
        }
        if (changed) await write(blob);
    });
}

/** Newest first. */
export async function listLocalWords(): Promise<LocalWord[]> {
    const { words } = await load();
    return Object.values(words).sort((a, b) => b.addedAt - a.addedAt);
}

export async function countLocalWords(): Promise<number> {
    return Object.keys((await load()).words).length;
}

/**
 * Attach a translation to a kept word. A word that is not here (already moved
 * into the account while the translation was on its way) is left alone, and an
 * empty string clears the translation.
 */
export function setLocalTranslation(term: string, translation: string): Promise<void> {
    return serial(async () => {
        const blob = await load();
        const w = blob.words[normalizeTerm(term)];
        if (!w) return;
        const t = translation.slice(0, MAX_TRANSLATION_LEN);
        if (t) w.translation = t;
        else delete w.translation;
        await write(blob);
    });
}
