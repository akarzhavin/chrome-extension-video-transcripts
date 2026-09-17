/**
 * @jest-environment jsdom
 *
 * The builders' half of the saved-word mark.
 *
 * `saved-marks.test.ts` covers the view of the dictionary; this covers the two
 * functions that turn a subtitle line into spans, and it exists mostly for one
 * rule: in guess mode a word that is still hidden MUST NOT betray that the
 * learner has saved it. The mark is a hint — "you have studied this one" — and
 * a hint on a capsule narrows the guess the mode exists to pose.
 *
 * That rule is checked by rendering the SAME line twice, once with the word
 * saved and once without, and comparing the masked span byte for byte. An
 * assertion that merely looked for the absence of one known class would stay
 * green if a future change leaked the fact through a data attribute or a second
 * class instead (Constitution VII).
 */

(global as any).chrome = {
    runtime: { id: 'test-extension-id', getManifest: () => ({ version: '0.0.0' }) },
    i18n: { getMessage: () => '', getUILanguage: () => 'en' },
    storage: {
        local: { get: jest.fn().mockResolvedValue({}), set: jest.fn().mockResolvedValue(undefined) },
        onChanged: { addListener: jest.fn(), removeListener: jest.fn() },
    },
};

import { fillMaskedWordsInto, fillPlainWordsInto } from '../src/transcript/word-markup';
import { SAVED_MARK_CLASS } from '../src/transcript/saved-marks';

const LINE = 'It was a beautiful evening';

/** Only "beautiful" is in the learner's dictionary. */
const savedIsBeautiful = (term: string): boolean => term === 'beautiful';
const savedIsNothing = (): boolean => false;

const container = (): HTMLElement => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
};

const marks = (el: HTMLElement): string[] =>
    [...el.querySelectorAll<HTMLElement>(`.${SAVED_MARK_CLASS}`)]
        .map((s) => s.textContent ?? '');

beforeEach(() => {
    document.body.innerHTML = '';
});

describe('plain lines (sidebar and overlay, non-guess)', () => {
    test('a saved word is marked and its neighbours are not', () => {
        const el = container();
        fillPlainWordsInto(el, LINE, savedIsBeautiful);

        expect(marks(el)).toEqual(['beautiful']);
    });

    test('with nothing saved, no word is marked', () => {
        const el = container();
        fillPlainWordsInto(el, LINE, savedIsNothing);

        expect(marks(el)).toEqual([]);
    });

    test('marking adds no node and no character', () => {
        // The badge's failure mode, stated as a rule. Comparing whole renders
        // rather than counting one class, so any inserted pill fails here under
        // any name it might be given.
        const bare = container();
        fillPlainWordsInto(bare, LINE, savedIsNothing);
        const marked = container();
        fillPlainWordsInto(marked, LINE, savedIsBeautiful);

        expect(marked.childNodes.length).toBe(bare.childNodes.length);
        expect(marked.textContent).toBe(bare.textContent);
        expect(marked.querySelectorAll('*').length).toBe(bare.querySelectorAll('*').length);
    });

    test('called without a predicate nothing is marked', () => {
        // The two-argument form is what every existing caller uses; it has to
        // keep meaning exactly what it did.
        const el = container();
        fillPlainWordsInto(el, LINE);

        expect(marks(el)).toEqual([]);
        expect(el.textContent).toBe(LINE);
    });
});

describe('guess mode', () => {
    test('a revealed saved word carries the mark', () => {
        const el = container();
        // Reveal everything, so "beautiful" is out and readable.
        fillMaskedWordsInto(el, LINE, 99, savedIsBeautiful);

        expect(marks(el)).toEqual(['beautiful']);
    });

    test('a masked saved word is byte-identical to a masked unsaved one', () => {
        // THE rule of this file. Not "has no class" — identical, so a leak
        // through any attribute or second class fails too.
        const withSave = container();
        fillMaskedWordsInto(withSave, LINE, 0, savedIsBeautiful);

        const withoutSave = container();
        fillMaskedWordsInto(withoutSave, LINE, 0, savedIsNothing);

        expect(withSave.innerHTML).toBe(withoutSave.innerHTML);
        expect(marks(withSave)).toEqual([]);
    });

    test('the mark appears exactly when the word is uncovered', () => {
        // Same line, same saved word, one reveal apart: hidden wears nothing,
        // revealed wears the mark. This is the moment the rule is about.
        const hidden = container();
        fillMaskedWordsInto(hidden, LINE, 3, savedIsBeautiful);
        expect(marks(hidden)).toEqual([]);

        const shown = container();
        fillMaskedWordsInto(shown, LINE, 4, savedIsBeautiful);
        expect(marks(shown)).toEqual(['beautiful']);
    });

    test('called without a predicate nothing is marked', () => {
        const el = container();
        fillMaskedWordsInto(el, LINE, 99);

        expect(marks(el)).toEqual([]);
    });
});
