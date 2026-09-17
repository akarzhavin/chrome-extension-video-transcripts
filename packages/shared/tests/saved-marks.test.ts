/**
 * @jest-environment jsdom
 *
 * The standing mark on words the learner already owns.
 *
 * The question this answers is "do I already have this word", asked of a
 * caption line that is moving, without a pointer ever touching it. That forces
 * three properties, and each one is a test below:
 *
 *   - the answer is SYNCHRONOUS (a render cannot await storage),
 *   - it is keyed the way the dictionary keys it (normalizeTerm, never
 *     toLowerCase — see the one-key-per-store rule this project already broke
 *     once), and
 *   - it tracks the mirror, because a mark that can go stale claims a fact and
 *     then lies about it.
 *
 * The degradation test matters as much as the rest: packages/embed ships this
 * code to the marketing site with no extension storage behind it, and there the
 * correct behaviour is "nothing is marked", not a thrown error.
 */

const store: Record<string, unknown> = {};
const listeners: Array<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void> = [];

const chromeStub = {
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
            remove: jest.fn(() => Promise.resolve()),
        },
        onChanged: {
            addListener: jest.fn((l: any) => { listeners.push(l); }),
            removeListener: jest.fn((l: any) => {
                const i = listeners.indexOf(l);
                if (i !== -1) listeners.splice(i, 1);
            }),
        },
    },
    runtime: { id: 'test-extension-id', getManifest: () => ({ version: '0.0.0' }) },
    i18n: { getMessage: () => '' },
};

(global as any).chrome = chromeStub;

import { MIRROR_KEY, setMirrorEntry } from '../src/word-mirror';
import {
    SAVED_MARK_CLASS,
    isSaved,
    markSavedIn,
    onSavedWordsChanged,
    startSavedMarks,
    __resetSavedMarksForTest,
} from '../src/transcript/saved-marks';

let stop: (() => void) | undefined;

beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
    listeners.length = 0;
    document.body.innerHTML = '';
    __resetSavedMarksForTest();
    (global as any).chrome = chromeStub;
});

afterEach(() => {
    stop?.();
    stop = undefined;
});

/** A caption line as the builders produce it: one span per word. */
const line = (...words: string[]): HTMLElement => {
    const el = document.createElement('div');
    el.className = 'vtt-main-text';
    words.forEach((w, i) => {
        if (i > 0) el.appendChild(document.createTextNode(' '));
        const span = document.createElement('span');
        span.dataset.word = w;
        span.textContent = w;
        el.appendChild(span);
    });
    document.body.appendChild(el);
    return el;
};

const markedWords = (): string[] =>
    [...document.querySelectorAll<HTMLElement>(`.${SAVED_MARK_CLASS}`)]
        .map((s) => s.dataset.word ?? '');

describe('the mark reports what the dictionary holds', () => {
    test('a word saved before the page loaded is marked on the first render', async () => {
        // The seed path. Without it the first line would render unmarked and
        // only repaint on some later mirror event — which, for a learner who
        // saved nothing this session, never comes.
        await setMirrorEntry('beautiful', 'active');

        stop = startSavedMarks();
        await Promise.resolve();
        await Promise.resolve();

        markSavedIn(line('It', 'was', 'a', 'beautiful', 'evening'));

        expect(markedWords()).toEqual(['beautiful']);
    });

    test('a word the mirror has never heard of is not marked', async () => {
        await setMirrorEntry('beautiful', 'active');
        stop = startSavedMarks();
        await Promise.resolve();
        await Promise.resolve();

        markSavedIn(line('a', 'perfectly', 'ordinary', 'line'));

        expect(markedWords()).toEqual([]);
    });

    test('a REMOVED word is not marked — a tombstone is not a save', async () => {
        // `removed` exists in the mirror precisely so it can be told apart from
        // absence during sync. For the question "is it in my dictionary" the two
        // answers are the same, and marking a tombstone would put the mark back
        // on a word the learner just took off their list.
        await setMirrorEntry('beautiful', 'active');
        await setMirrorEntry('evening', 'removed');

        stop = startSavedMarks();
        await Promise.resolve();
        await Promise.resolve();

        markSavedIn(line('beautiful', 'evening'));

        expect(markedWords()).toEqual(['beautiful']);
    });

    test('the answer is synchronous — no await between asking and painting', async () => {
        // The structural claim: a render path cannot await. If isSaved ever
        // returned a promise this reads as truthy and the test would pass, so
        // the assertion is on the VALUE being a boolean, not on truthiness.
        await setMirrorEntry('beautiful', 'active');
        stop = startSavedMarks();
        await Promise.resolve();
        await Promise.resolve();

        const answer = isSaved('beautiful');

        expect(typeof answer).toBe('boolean');
        expect(answer).toBe(true);
    });
});

describe('the mark is keyed the way the dictionary is keyed', () => {
    test('a capitalised word at the start of a sentence matches its entry', async () => {
        // normalizeTerm, not toLowerCase: this project has already shipped a
        // bug where a second key function produced a second entry and an
        // unfilled heart.
        await setMirrorEntry('beautiful', 'active');
        stop = startSavedMarks();
        await Promise.resolve();
        await Promise.resolve();

        markSavedIn(line('Beautiful', 'evening'));

        expect(markedWords()).toEqual(['Beautiful']);
    });

    test('a term stored with surrounding whitespace still matches', async () => {
        await setMirrorEntry('  evening  ', 'active');
        stop = startSavedMarks();
        await Promise.resolve();
        await Promise.resolve();

        markSavedIn(line('evening'));

        expect(markedWords()).toEqual(['evening']);
    });

    test('a decomposed accent in the subtitle matches its composed entry', async () => {
        // The case that separates normalizeTerm from toLowerCase. Subtitle
        // files carry either Unicode form, and NFC folding is the half a
        // lowercase pass does not do: "café" spelled with a combining acute
        // (U+0065 U+0301) and the same word spelled with U+00E9 are one
        // dictionary entry and must be one mark.
        await setMirrorEntry('café', 'active');
        stop = startSavedMarks();
        await Promise.resolve();
        await Promise.resolve();

        markSavedIn(line('café'));

        expect(markedWords()).toEqual(['café']);
    });

    test('a non-breaking space inside a phrase matches its collapsed entry', async () => {
        // The other half: subtitle markup is a rich source of NBSP and tabs,
        // and normalizeTerm collapses them to one U+0020. toLowerCase leaves
        // them, so a phrase saved as "once in a while" would never match the
        // span text that carries an NBSP.
        await setMirrorEntry('once in a while', 'active');
        stop = startSavedMarks();
        await Promise.resolve();
        await Promise.resolve();

        const el = document.createElement('div');
        const span = document.createElement('span');
        span.dataset.word = 'once in a while';
        span.textContent = 'once in a while';
        el.appendChild(span);
        document.body.appendChild(el);

        markSavedIn(el);

        expect(span.classList.contains(SAVED_MARK_CLASS)).toBe(true);
    });
});

describe('the mark tracks the dictionary', () => {
    test('saving a word marks it on lines already on screen', async () => {
        stop = startSavedMarks();
        await Promise.resolve();
        await Promise.resolve();

        const el = line('It', 'was', 'a', 'beautiful', 'evening');
        markSavedIn(el);
        expect(markedWords()).toEqual([]);

        const repainted = jest.fn(() => markSavedIn(el));
        onSavedWordsChanged(repainted);

        await setMirrorEntry('beautiful', 'active');
        await Promise.resolve();

        expect(repainted).toHaveBeenCalled();
        expect(markedWords()).toEqual(['beautiful']);
    });

    test('removing a word clears the mark from lines already on screen', async () => {
        await setMirrorEntry('beautiful', 'active');
        stop = startSavedMarks();
        await Promise.resolve();
        await Promise.resolve();

        const el = line('a', 'beautiful', 'evening');
        markSavedIn(el);
        expect(markedWords()).toEqual(['beautiful']);

        onSavedWordsChanged(() => markSavedIn(el));
        await setMirrorEntry('beautiful', 'removed');
        await Promise.resolve();

        expect(markedWords()).toEqual([]);
    });

    test('re-marking the same container does not stack anything', async () => {
        await setMirrorEntry('beautiful', 'active');
        stop = startSavedMarks();
        await Promise.resolve();
        await Promise.resolve();

        const el = line('a', 'beautiful', 'evening');
        const before = el.childNodes.length;

        markSavedIn(el);
        markSavedIn(el);
        markSavedIn(el);

        expect(markedWords()).toEqual(['beautiful']);
        expect(el.childNodes.length).toBe(before);
    });

    test('unsubscribing stops the repaints', async () => {
        stop = startSavedMarks();
        await Promise.resolve();
        await Promise.resolve();

        const cb = jest.fn();
        const off = onSavedWordsChanged(cb);
        off();

        await setMirrorEntry('beautiful', 'active');
        await Promise.resolve();

        expect(cb).not.toHaveBeenCalled();
    });
});

describe('marking changes no geometry', () => {
    test('marking inserts and removes no node, and no text', async () => {
        // The reason the badge was removed. Counting nodes rather than looking
        // for one known class, so any future pill fails here under any name.
        await setMirrorEntry('beautiful', 'active');
        stop = startSavedMarks();
        await Promise.resolve();
        await Promise.resolve();

        const el = line('It', 'was', 'a', 'beautiful', 'evening');
        const nodes = el.childNodes.length;
        const text = el.textContent;

        markSavedIn(el);

        expect(el.childNodes.length).toBe(nodes);
        expect(el.textContent).toBe(text);
        expect(el.querySelectorAll('*').length).toBe(5);
    });
});

describe('without extension storage nothing is marked and nothing throws', () => {
    test('the embed build renders an unmarked line', async () => {
        // packages/embed puts this code on a web page behind a chrome shim with
        // no storage. loadMirror resolves empty and onMirrorChanged is a no-op;
        // the correct outcome is a plain line, not an exception.
        delete (global as any).chrome;

        expect(() => {
            stop = startSavedMarks();
        }).not.toThrow();
        await Promise.resolve();
        await Promise.resolve();

        const el = line('It', 'was', 'a', 'beautiful', 'evening');
        expect(() => markSavedIn(el)).not.toThrow();
        expect(markedWords()).toEqual([]);
        expect(isSaved('beautiful')).toBe(false);
    });
});

describe('the class name is part of the DOM contract', () => {
    test('it is vtt-saved-mark, and distinct from the promo highlight', () => {
        // Pinned to a literal (Constitution VII): comparing the constant with
        // itself would be green for any value. `vtt-saved-word` is the promo
        // decoration and a different thing — the two must never collapse.
        expect(SAVED_MARK_CLASS).toBe('vtt-saved-mark');
        expect(SAVED_MARK_CLASS).not.toBe('vtt-saved-word');
    });
});

describe('the mark answers the press, not the round trip', () => {
    // What the user reported: pressing the heart flipped the card's button to
    // Remove, but the bar under the word stayed the hover colour, so the press
    // looked like it had done nothing to the line.
    //
    // Two separate causes, one symptom, and both are pinned here: the mark has
    // to change on the OPTIMISTIC mirror write (before any network round trip),
    // and it has to be visible while the card is still open over the word.
    test('marking follows the optimistic write, before the worker answers', async () => {
        stop = startSavedMarks();
        await Promise.resolve();
        await Promise.resolve();

        const el = line('It', 'was', 'a', 'beautiful', 'evening');
        onSavedWordsChanged(() => markSavedIn(el));
        markSavedIn(el);
        expect(markedWords()).toEqual([]);

        // saveTerm writes the mirror first and only then messages the worker.
        // No worker is wired in this test at all, which is the point: the mark
        // must already be there.
        await setMirrorEntry('beautiful', 'active');
        await Promise.resolve();

        expect(markedWords()).toEqual(['beautiful']);
    });

    test('a rollback puts the mark back the way it was', async () => {
        // The save failed after the optimistic write, so removeTerm/saveTerm
        // restore the previous entry — and the bar has to follow that too,
        // or the line would keep claiming a word the dictionary rejected.
        stop = startSavedMarks();
        await Promise.resolve();
        await Promise.resolve();

        const el = line('a', 'beautiful', 'evening');
        onSavedWordsChanged(() => markSavedIn(el));

        await setMirrorEntry('beautiful', 'active');
        await Promise.resolve();
        expect(markedWords()).toEqual(['beautiful']);

        await setMirrorEntry('beautiful', 'removed');
        await Promise.resolve();
        expect(markedWords()).toEqual([]);
    });

    test('the mark is applied to a word the open card is anchored on', async () => {
        // The card marks its word with .vtt-lookup-hit. That class must not
        // stop the saved mark from being applied — the two live on one span,
        // and which colour wins between them is settled in the stylesheet
        // (.vtt-saved-mark.vtt-lookup-hit::after), not here.
        await setMirrorEntry('beautiful', 'active');
        stop = startSavedMarks();
        await Promise.resolve();
        await Promise.resolve();

        const el = line('a', 'beautiful', 'evening');
        const span = el.querySelector<HTMLElement>('[data-word="beautiful"]')!;
        span.classList.add('vtt-lookup-hit');

        markSavedIn(el);

        expect(span.classList.contains(SAVED_MARK_CLASS)).toBe(true);
        expect(span.classList.contains('vtt-lookup-hit')).toBe(true);
    });
});
