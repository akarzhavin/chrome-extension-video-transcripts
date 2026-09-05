/**
 * Behaviour map §14 — saving a word, the part that happens on the page.
 *
 * The save itself writes to a real dictionary and is deliberately not driven
 * here. What IS covered is everything the reader sees afterwards, which is pure
 * page work and writes nothing: the saved word is marked, it carries one badge
 * however many words the phrase spans, and marking the same phrase twice does
 * not stack a second badge on it.
 *
 * That last one matters because a phrase can be re-saved — from the card, from
 * a selection, or by saving an overlapping phrase — and a badge per attempt
 * would litter the transcript.
 */

(global as any).chrome = {
    runtime: { id: 'test-extension-id', getManifest: () => ({ version: '1.0.0' }) },
    i18n: { getMessage: () => '', getUILanguage: () => 'en' },
    storage: {
        local: { get: jest.fn().mockResolvedValue({}), set: jest.fn().mockResolvedValue(undefined) },
        onChanged: { addListener: jest.fn() },
    },
};

import { MAX_TERM_LEN, markSpansSaved } from '@video-transcripts/shared/src/content/quick-add-overlay';

const wordSpans = (...words: string[]): HTMLElement[] => {
    document.body.innerHTML = `<div class="vtt-main-text">${words
        .map((w) => `<span data-word="${w}">${w}</span>`)
        .join(' ')}</div>`;
    return [...document.querySelectorAll<HTMLElement>('span[data-word]')];
};

const badges = () => document.querySelectorAll('.vtt-saved-badge').length;
const marked = () => document.querySelectorAll('.vtt-saved-word').length;

describe('a saved word is marked on the page', () => {
    test('one word: the word is marked and carries a badge', () => {
        const spans = wordSpans('ephemeral');
        markSpansSaved(spans);

        expect(marked()).toBe(1);
        expect(badges()).toBe(1);
        expect(document.querySelector('.vtt-saved-badge')?.textContent).toMatch(/✓/);
    });

    test('a phrase: every word is marked, but only one badge', () => {
        const spans = wordSpans('once', 'in', 'a', 'while');
        markSpansSaved(spans);

        expect(marked()).toBe(4);
        // One badge for the phrase, not one per word — four ticks in a row
        // would read as four saves.
        expect(badges()).toBe(1);
    });

    test('the badge sits after the last word of the phrase', () => {
        const spans = wordSpans('once', 'in', 'a', 'while');
        markSpansSaved(spans);

        const badge = document.querySelector('.vtt-saved-badge');
        expect(badge?.previousElementSibling?.getAttribute('data-word')).toBe('while');
    });

    test('marking the same phrase again does not stack a second badge', () => {
        const spans = wordSpans('once', 'in', 'a', 'while');
        markSpansSaved(spans);
        markSpansSaved(spans);
        markSpansSaved(spans);

        expect(badges()).toBe(1);
        expect(marked()).toBe(4);
    });

    test('marking nothing does nothing', () => {
        wordSpans('untouched');
        markSpansSaved([]);

        expect(marked()).toBe(0);
        expect(badges()).toBe(0);
    });

    test('the longest saveable phrase is capped', () => {
        // A cap exists so a stray selection cannot submit half a transcript as
        // one dictionary entry.
        expect(MAX_TERM_LEN).toBe(256);
    });
});
