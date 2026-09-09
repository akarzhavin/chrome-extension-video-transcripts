// The local mirror of what the learner has saved. One key, one blob, following
// the prefs.v1 pattern next door.
//
// It exists to keep the render path synchronous. strip.ts and word-screen.ts
// decide whether a word is painted as saved while building a frame; they can
// await neither storage nor crypto.subtle. That is also why this is keyed by
// the NORMALIZED TERM and not by the hash the documents are keyed by: the hash
// is only obtainable asynchronously, and a render cannot wait for it.
//
// `normalizeTerm` is the ONE key function, and this module applies it itself
// rather than trusting callers to. A caller reaching for `toLowerCase()`
// instead is not a style slip: `normalizeTerm` also trims, collapses runs of
// whitespace, and closes the two host-lowercase divergences, so the two forms
// part on any term carrying a double space, an NBSP between spans, a BOM, a
// Turkish İ or a Greek final sigma. The server writes documents under
// `normalizeTerm`, so a mirror entry written under the other form is a SECOND
// entry for one word, and the heart over it never fills. `key()` below is the
// only door in.
//
// Written by the worker only. Content scripts read it and subscribe; they never
// write. Cleared with the auth state on sign-out.
//
// Removed entries are KEPT. An entry that vanishes is indistinguishable from a
// word that was never saved, and that distinction is the whole reason the
// mirror can be trusted to paint a heart.

import { WORD_KEYS } from './auth/storage';
import { normalizeTerm } from './word-key';

export type WordState = 'active' | 'removed';

export interface WordMirror {
    v: 1;
    // normalized term → state
    words: Record<string, WordState>;
    // Largest updatedAt (epoch ms) already applied. 0 means "never synced": the
    // next sync downloads the whole list, which is also the recovery path after
    // the mirror is lost.
    cursor: number;
}

// Re-exported from the storage inventory rather than declared here, so the
// privacy policy's "Local Storage" section keeps a single list to document.
export const MIRROR_KEY = WORD_KEYS.mirror;

const CURRENT_VERSION = 1;

// A synced document, reduced to the three fields the mirror keeps. Everything
// else the document carries — translations, context, timestamps per word —
// stays out on purpose: holding it here would make this a second copy of the
// dictionary that would need synchronising in its own right.
export interface SyncedDoc {
    term: string;
    state: WordState;
    updatedAt: number;
}

/**
 * The mirror's key for a term — the same normalization the documents are
 * written under.
 *
 * Applied here rather than at each call site so that the entry a save writes
 * and the entry a sync writes cannot end up under different keys. Callers pass
 * raw terms; DOM text is exactly what this has to absorb.
 */
function key(term: string): string {
    return normalizeTerm(term);
}

function empty(): WordMirror {
    return { v: CURRENT_VERSION, words: {}, cursor: 0 };
}

function isWordState(v: unknown): v is WordState {
    return v === 'active' || v === 'removed';
}

/**
 * Storage bytes → a mirror. A stored blob is untrusted input: it may have been
 * written by a newer build, truncated by a failed write, or never written at
 * all. All three resolve to the empty mirror, because a render path that throws
 * on a frame is not a recoverable failure.
 *
 * Coercion is per-field on purpose. One unrecognised word state must not cost
 * the other nine hundred entries — that would silently un-save a learner's
 * whole list, which is the most expensive way this file could be wrong.
 */
function coerce(raw: unknown): WordMirror {
    if (typeof raw !== 'object' || raw === null) return empty();
    const blob = raw as Partial<WordMirror>;
    // A future version is not read even when its shape looks familiar: the
    // fields may mean something this build does not know. Starting empty costs
    // one sync; misreading them costs correctness with no signal.
    if (blob.v !== CURRENT_VERSION) return empty();

    const out = empty();
    if (typeof blob.words === 'object' && blob.words !== null) {
        for (const [term, state] of Object.entries(blob.words)) {
            if (typeof term === 'string' && term && isWordState(state)) out.words[term] = state;
        }
    }
    // Never Date.now(): server timestamps are the only clock in this system,
    // and a locally-invented cursor would skip documents permanently.
    if (typeof blob.cursor === 'number' && Number.isFinite(blob.cursor) && blob.cursor >= 0) {
        out.cursor = blob.cursor;
    }
    return out;
}

export async function loadMirror(): Promise<WordMirror> {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return empty();
    try {
        const v = (await chrome.storage.local.get(MIRROR_KEY)) as Record<string, unknown>;
        return coerce(v[MIRROR_KEY]);
    } catch {
        return empty();
    }
}

async function write(next: WordMirror): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    // An orphaned content script (extension reloaded under it) would throw
    // 'Extension context invalidated' here — the same guard savePrefs carries.
    if (!chrome.runtime?.id) return;
    try {
        await chrome.storage.local.set({ [MIRROR_KEY]: next });
    } catch {
        // Best-effort, like prefs. A failed mirror write is corrected by the
        // next sync; throwing here would take down the save that triggered it.
    }
}

/**
 * Record one word's state. Read-modify-write, like savePrefs, and with the same
 * absence of compare-and-swap: the worker is the only writer, so there is no
 * second party to race.
 */
export async function setMirrorEntry(term: string, state: WordState): Promise<void> {
    const m = await loadMirror();
    m.words[key(term)] = state;
    await write(m);
}

/**
 * Forget a term entirely — not the same as recording it as 'removed'.
 *
 * Used only to roll a failed save back to "absent". A 'removed' entry means the
 * learner took the word off their list; writing one where there had been
 * nothing would make the next save look like a re-activation of something that
 * never existed, and would suppress the retry.
 */
export async function deleteMirrorEntry(term: string): Promise<void> {
    const m = await loadMirror();
    delete m.words[key(term)];
    await write(m);
}

/**
 * Apply documents from a sync and advance the cursor.
 *
 * The cursor moves only to the largest updatedAt among documents ACTUALLY
 * applied, and never backwards. The query subtracts a 60-second overlap so that
 * documents committed while a query was in flight are re-fetched rather than
 * missed; those re-fetched documents arrive with timestamps already passed, and
 * letting them rewind the cursor would re-download the same window forever.
 */
export async function applySyncedDocs(docs: SyncedDoc[]): Promise<void> {
    const m = await loadMirror();
    for (const doc of docs) {
        if (!doc || typeof doc.term !== 'string' || !doc.term || !isWordState(doc.state)) continue;
        // Through `key` too, and not because the server's `term` is
        // suspect: it is already `normalizeTerm` output, so this is a
        // no-op on every well-formed document. It is here so that the
        // sync path and the save path cannot be given different keys by a
        // later edit to one of them — and so a legacy document written
        // before the field was normalized lands on the same entry a save
        // would write, instead of beside it.
        const k = key(doc.term);
        if (!k) continue;
        m.words[k] = doc.state;
        if (typeof doc.updatedAt === 'number' && Number.isFinite(doc.updatedAt) && doc.updatedAt > m.cursor) {
            m.cursor = doc.updatedAt;
        }
    }
    await write(m);
}

/**
 * Drop the whole mirror. Called on sign-out, where keeping it would leave one
 * account's saved words visible to whoever signs in next on this profile.
 */
export async function clearMirror(): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    if (!chrome.runtime?.id) return;
    try {
        await chrome.storage.local.remove(MIRROR_KEY);
    } catch {
        // As above: best-effort.
    }
}

/**
 * Subscribe to mirror changes, filtered to the local area and this key.
 *
 * The filter is not an optimisation. Every key in the profile shares one
 * onChanged stream, so an unfiltered subscriber would repaint every open tab
 * each time the sidebar was collapsed.
 */
export function onMirrorChanged(cb: (mirror: WordMirror) => void): () => void {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
        if (area !== 'local' || !(MIRROR_KEY in changes)) return;
        cb(coerce(changes[MIRROR_KEY].newValue));
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
}
