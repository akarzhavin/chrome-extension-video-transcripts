/**
 * Behaviour map §14 — saving a word, the part that happens on the page.
 *
 * The save itself writes to a real dictionary and is deliberately not driven
 * here. What IS covered is everything the reader sees afterwards, which is pure
 * page work and writes nothing: every word of the saved phrase is highlighted,
 * and nothing is inserted into the line.
 *
 * That last one is the point of this file now. The highlight used to come with
 * a "✓ saved" pill inserted after the last word, and inserting anything into a
 * subtitle line reflows it — the neighbouring words jump sideways while the
 * reader is mid-sentence. The card's heart, its Remove label and the toast
 * already announce the save, so the marker stays a decoration of the words
 * themselves and adds no node.
 *
 * Not to be confused with `vtt-saved-mark` (packages/shared/tests/saved-marks):
 * that one is fed by the word mirror and says "this word is in your
 * dictionary". This one is momentary feedback and consults nothing.
 */

(global as any).chrome = {
    runtime: { id: 'test-extension-id', getManifest: () => ({ version: '1.0.0' }) },
    i18n: { getMessage: () => '', getUILanguage: () => 'en' },
    storage: {
        local: { get: jest.fn().mockResolvedValue({}), set: jest.fn().mockResolvedValue(undefined) },
        onChanged: { addListener: jest.fn() },
    },
};

import {
    MAX_TERM_LEN,
    clearSpansSaved,
    markSpansSaved,
} from '@video-transcripts/shared/src/content/quick-add-overlay';

const LINE = '.vtt-main-text';

const wordSpans = (...words: string[]): HTMLElement[] => {
    document.body.innerHTML = `<div class="vtt-main-text">${words
        .map((w) => `<span data-word="${w}">${w}</span>`)
        .join(' ')}</div>`;
    return [...document.querySelectorAll<HTMLElement>('span[data-word]')];
};

const marked = () => document.querySelectorAll('.vtt-saved-word').length;
const line = () => document.querySelector(LINE)!;

describe('a saved word is marked on the page', () => {
    test('one word: the word is marked', () => {
        const spans = wordSpans('ephemeral');
        markSpansSaved(spans);

        expect(marked()).toBe(1);
        expect(spans[0].classList.contains('vtt-saved-word')).toBe(true);
    });

    test('a phrase: every word is marked', () => {
        const spans = wordSpans('once', 'in', 'a', 'while');
        markSpansSaved(spans);

        expect(marked()).toBe(4);
    });

    test('marking inserts nothing into the line', () => {
        // The reflow guard. Counting nodes rather than looking for one known
        // class, so any future pill — under any name — fails here too.
        const spans = wordSpans('once', 'in', 'a', 'while');
        const before = line().childNodes.length;

        markSpansSaved(spans);

        expect(line().childNodes.length).toBe(before);
        expect(document.querySelectorAll(`${LINE} > *`).length).toBe(4);
        expect(line().textContent).toBe('once in a while');
    });

    test('marking twice changes nothing the second time', () => {
        const spans = wordSpans('once', 'in', 'a', 'while');
        markSpansSaved(spans);
        const afterFirst = line().innerHTML;

        markSpansSaved(spans);

        expect(line().innerHTML).toBe(afterFirst);
        expect(marked()).toBe(4);
    });

    test('clearing leaves the line as it was found', () => {
        const spans = wordSpans('once', 'in', 'a', 'while');
        const nodes = line().childNodes.length;
        const text = line().textContent;

        markSpansSaved(spans);
        expect(marked()).toBe(4);

        clearSpansSaved(spans);
        // An empty class attribute may survive `classList.remove`; what must
        // not survive is a node or a character.
        expect(marked()).toBe(0);
        expect(line().childNodes.length).toBe(nodes);
        expect(line().textContent).toBe(text);
    });

    test('marking nothing does nothing', () => {
        wordSpans('untouched');
        const before = line().innerHTML;

        markSpansSaved([]);

        expect(marked()).toBe(0);
        expect(line().innerHTML).toBe(before);
    });

    test('the longest saveable phrase is capped', () => {
        // A cap exists so a stray selection cannot submit half a transcript as
        // one dictionary entry.
        expect(MAX_TERM_LEN).toBe(256);
    });
});
