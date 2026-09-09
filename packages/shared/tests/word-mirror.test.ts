/**
 * @jest-environment jsdom
 *
 * The mirror: the local copy of what the learner has saved.
 *
 * It exists so the render path can stay synchronous. `strip.ts` and
 * `word-screen.ts` paint a word as saved or not saved while the frame is being
 * built; they cannot await storage and they cannot await crypto.subtle, which
 * is why the mirror is keyed by the normalized term rather than by the hash
 * the server uses.
 *
 * Everything here is read back from `chrome.storage.local` — a store the
 * extension shares with its own past versions and with whatever a half-failed
 * write left behind. A stored blob is therefore untrusted input, and the
 * defaults are not a convenience: absent, corrupt and future-version data all
 * have to resolve to the same empty mirror, because the alternative is a
 * render path that throws on a frame.
 *
 * Shape and defaults come from data-model.md in this repository's own spec
 * package — not from the Firestore contract, which describes the document and
 * not this.
 */

const store: Record<string, unknown> = {};
const removed: string[][] = [];
const listeners: Array<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void> = [];

(global as any).chrome = {
    storage: {
        local: {
            get: jest.fn((keys: any) => {
                const arr = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
                const out: Record<string, unknown> = {};
                for (const k of arr) if (k in store) out[k] = store[k];
                return Promise.resolve(out);
            }),
            set: jest.fn((items: Record<string, unknown>) => {
                const changes: Record<string, chrome.storage.StorageChange> = {};
                for (const [k, v] of Object.entries(items)) {
                    changes[k] = { oldValue: store[k], newValue: v };
                    store[k] = v;
                }
                listeners.forEach((l) => l(changes, 'local'));
                return Promise.resolve();
            }),
            remove: jest.fn((keys: string[]) => {
                const arr = typeof keys === 'string' ? [keys as unknown as string] : keys;
                removed.push(arr);
                const changes: Record<string, chrome.storage.StorageChange> = {};
                for (const k of arr) {
                    changes[k] = { oldValue: store[k], newValue: undefined };
                    delete store[k];
                }
                listeners.forEach((l) => l(changes, 'local'));
                return Promise.resolve();
            }),
        },
        onChanged: {
            addListener: jest.fn((l: any) => {
                listeners.push(l);
            }),
            removeListener: jest.fn((l: any) => {
                const i = listeners.indexOf(l);
                if (i >= 0) listeners.splice(i, 1);
            }),
        },
    },
    runtime: { id: 'test-extension-id' },
};

import {
    MIRROR_KEY,
    applySyncedDocs,
    clearMirror,
    deleteMirrorEntry,
    loadMirror,
    onMirrorChanged,
    setMirrorEntry,
} from '../src/word-mirror';
import { normalizeTerm } from '../src/word-key';
import { createSavedWords } from '../src/lookup/saved-words';
import { WORD_KEYS, clearAuthState } from '../src/auth/storage';

beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
    removed.length = 0;
    listeners.length = 0;
});

const EMPTY = { v: 1, words: {}, cursor: 0 };

describe('the mirror defaults rather than throwing', () => {
    // Three different ways of having nothing usable, one answer. They are
    // listed separately because they fail differently in production: absent is
    // the first run, corrupt is a partial write, and a future `v` is this build
    // reading what a newer build wrote after a downgrade or a staged rollout.
    test('an absent key reads as the empty mirror', async () => {
        expect(await loadMirror()).toEqual(EMPTY);
    });

    test('unparseable data reads as the empty mirror', async () => {
        store[MIRROR_KEY] = 'not an object at all';
        expect(await loadMirror()).toEqual(EMPTY);
    });

    test('a future version reads as the empty mirror rather than being trusted', async () => {
        // A newer build may have written fields this one does not understand.
        // Reading its `words` anyway is the tempting bug: the shape looks
        // right, and the meaning may not be.
        store[MIRROR_KEY] = { v: 2, words: { hello: 'active' }, cursor: 99 };
        expect(await loadMirror()).toEqual(EMPTY);
    });

    test('every field is coerced independently, so one bad field does not lose the others', async () => {
        store[MIRROR_KEY] = { v: 1, words: { keep: 'active', bogus: 'sideways' }, cursor: 'soon' };
        const m = await loadMirror();
        expect(m.words.keep).toBe('active');
        // Not a state the type permits; dropped rather than carried.
        expect(m.words.bogus).toBeUndefined();
        expect(m.cursor).toBe(0);
    });
});

describe('a write is visible to the next reader', () => {
    test('a saved term reads back as active', async () => {
        await setMirrorEntry('hello', 'active');
        expect((await loadMirror()).words.hello).toBe('active');
    });

    test('a removed term is kept as removed, not deleted', async () => {
        // The distinction the whole design rests on: an entry that vanishes is
        // indistinguishable from a word that was never saved, and that is
        // exactly what would make the heart lie.
        await setMirrorEntry('hello', 'active');
        await setMirrorEntry('hello', 'removed');
        const m = await loadMirror();
        expect(m.words.hello).toBe('removed');
        expect('hello' in m.words).toBe(true);
    });

    test('applying synced documents advances the cursor to the largest updatedAt applied', async () => {
        await applySyncedDocs([
            { term: 'alpha', state: 'active', updatedAt: 1700000000500 },
            { term: 'beta', state: 'removed', updatedAt: 1700000000100 },
        ]);
        const m = await loadMirror();
        expect(m.words.alpha).toBe('active');
        expect(m.words.beta).toBe('removed');
        expect(m.cursor).toBe(1700000000500);
    });

    test('the cursor never moves backwards when older documents arrive', async () => {
        // The query subtracts a 60-second overlap, so documents already applied
        // come back on the next sync. Re-application is idempotent; the cursor
        // must not rewind because of it.
        await applySyncedDocs([{ term: 'alpha', state: 'active', updatedAt: 1700000000500 }]);
        await applySyncedDocs([{ term: 'beta', state: 'active', updatedAt: 1700000000200 }]);
        expect((await loadMirror()).cursor).toBe(1700000000500);
    });

    test('clearMirror empties it', async () => {
        await setMirrorEntry('hello', 'active');
        await clearMirror();
        expect(await loadMirror()).toEqual(EMPTY);
    });
});

describe('subscribers hear about this key and nothing else', () => {
    test('onMirrorChanged fires when the mirror is written', async () => {
        const seen: Array<Record<string, string>> = [];
        onMirrorChanged((m) => seen.push({ ...m.words }));
        await setMirrorEntry('hello', 'active');
        expect(seen).toHaveLength(1);
        expect(seen[0].hello).toBe('active');
    });

    test('onMirrorChanged stays silent for prefs.v1', async () => {
        // One storage area, many keys. A subscriber that woke on every write
        // would repaint every open tab each time the sidebar was collapsed.
        const cb = jest.fn();
        onMirrorChanged(cb);
        await (global as any).chrome.storage.local.set({ 'prefs.v1': { displayMode: 'dual' } });
        expect(cb).not.toHaveBeenCalled();
    });

    test('the returned unsubscribe stops the callback', async () => {
        const cb = jest.fn();
        const off = onMirrorChanged(cb);
        off();
        await setMirrorEntry('hello', 'active');
        expect(cb).not.toHaveBeenCalled();
    });
});

// T006's red, written here and before it, so the registration has something to
// fail against. The privacy policy documents one inventory of storage keys; a
// key that saves what the learner has looked up and is missing from it is a
// disclosure gap, not an oversight in a constant.
describe('the mirror is part of the documented storage inventory', () => {
    test('the key inventory names the mirror key', () => {
        expect(Object.values(WORD_KEYS)).toContain(MIRROR_KEY);
    });

    test('signing out clears the mirror', async () => {
        await setMirrorEntry('hello', 'active');
        await clearAuthState();
        expect(await loadMirror()).toEqual(EMPTY);
    });
});
// The two normalizations, and the entry that split between them.
//
// The mirror is written from two directions: `setMirrorEntry` on a local save,
// and `applySyncedDocs` on a sync. The server writes its documents' `term`
// under `normalizeTerm`, so an entry written under any OTHER key is a second
// entry for one word — and the heart, which asks under the first key, never
// fills.
//
// These are not hypotheticals about Unicode trivia. Every input below is
// something DOM text actually carries: a phrase selected across two subtitle
// spans arrives with a tab or a double space in it, subtitle markup carries
// NBSP, and a Turkish or Greek learner's own words carry the rest.
describe('one term, one key, whichever side writes it', () => {
    const SPLITTERS = [
        // Two spaces between words — a phrase dragged across a line break.
        ['a double space', 'café  de  paris'],
        // NBSP from subtitle markup.
        ['a non-breaking space', 'café de paris'],
        // A tab between the spans of a phrase.
        ['a tab', 'café\tde\tparis'],
        // A BOM riding along on a copy.
        ['a BOM', '﻿café de paris'],
        // Turkish dotted capital I: JS lowercases it to i + U+0307.
        ['a Turkish dotted I', 'İstanbul'],
        // Greek final sigma: JS picks U+03C2 at a word's end, Go never does.
        ['a Greek final sigma', 'ΣΟΦΟΣ'],
        // Leading and trailing whitespace, which trim() and the contract's set
        // disagree about.
        ['surrounding whitespace', '  going  '],
    ] as const;

    test.each(SPLITTERS)('a save then a sync of %s land on ONE entry', async (_label, raw) => {
        // The learner saves the word from the page: the raw DOM text.
        await setMirrorEntry(raw, 'active');
        // The server then reports the same word back, under its own key — the
        // `term` field of a document is `normalizeTerm` output.
        await applySyncedDocs([
            { term: normalizeTerm(raw), state: 'removed', updatedAt: 1_700_000_000_000 },
        ]);

        const m = await loadMirror();
        // ONE entry, not two. Two would mean the sync's `removed` sat beside
        // the save's `active` and the heart kept answering from the stale one.
        expect(Object.keys(m.words)).toEqual([normalizeTerm(raw)]);
        expect(m.words[normalizeTerm(raw)]).toBe('removed');
    });

    test.each(SPLITTERS)('a rollback of %s finds the entry the save wrote', async (_label, raw) => {
        // deleteMirrorEntry is the failed-save rollback. Keyed differently from
        // setMirrorEntry it would delete nothing, leaving the optimistic
        // `active` behind for a word that was never saved.
        await setMirrorEntry(raw, 'active');
        await deleteMirrorEntry(raw);
        expect(await loadMirror()).toEqual(EMPTY);
    });

    test('the in-tab view answers for the raw term the page hands it', async () => {
        // saved-words.ts is filled from a mirror snapshot and questioned with
        // raw DOM text. Keyed by toLowerCase() it would answer "not saved" for
        // exactly the terms above — the heart the mirror exists to fill.
        const raw = 'café  de  paris';
        const view = createSavedWords();
        view.reset({ [normalizeTerm(raw)]: 'active' });
        expect(view.has(raw)).toBe(true);
    });
});
