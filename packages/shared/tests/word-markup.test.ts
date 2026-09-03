// The word-level markup shared by the transcript and the on-video overlay.
//
// These four functions look like formatting, but three separate features read
// their output as an interface: quick-add finds saveable words with a
// `span[data-word]` query, guess mode's reveal order walks maskable tokens
// only, and the stylesheet paints the capsules by class. So the assertions
// below are about the CONTRACT — which attribute carries the word, which class
// lands where — and not about how the markup happens to be nested.
//
// One of them guards something that is not obvious from reading the code:
// a masked span holds the REAL word as its text (the mask is the frosted pane
// in CSS, not a substitute string), so `translate="no"` is the only thing
// stopping a page translator from rewriting a hidden word into a legible one.

import {
    fillMaskedWordsInto,
    fillPlainWordsInto,
    makeMaskedSpan,
    maskGlyphs,
} from '../src/transcript/word-markup';

const div = (): HTMLDivElement => document.createElement('div');

describe('fillPlainWordsInto', () => {
    it('wraps every token in a data-word span so quick-add can snap to whole words', () => {
        const c = div();
        fillPlainWordsInto(c, 'we are going home');
        expect([...c.querySelectorAll('span[data-word]')].map((s) => s.getAttribute('data-word')))
            .toEqual(['we', 'are', 'going', 'home']);
    });

    it('keeps the separators, so the line reads exactly as its source text', () => {
        const c = div();
        fillPlainWordsInto(c, 'we are going home');
        expect(c.textContent).toBe('we are going home');
    });
});

describe('makeMaskedSpan', () => {
    it('a revealed word carries data-word — quick-add may save it', () => {
        const s = makeMaskedSpan('going', true, 'going');
        expect(s.dataset.word).toBe('going');
        expect(s.dataset.hidden).toBeUndefined();
        expect(s.className).toBe('vtt-revealed-word');
    });

    it('a masked word parks the real word in data-hidden, out of quick-add\'s reach', () => {
        // The two attributes are what makes quick-add's span[data-word] query
        // skip masked words without quick-add knowing guess mode exists.
        const s = makeMaskedSpan('going', false, 'going');
        expect(s.dataset.hidden).toBe('going');
        expect(s.dataset.word).toBeUndefined();
        expect(s.className).toBe('vtt-masked-word');
    });

    it('a masked word is marked translate=no', () => {
        // The node really contains the word (see maskGlyphs), so without this a
        // page translator would rewrite it into a legible one — exposing it to
        // a user who never asked to look.
        //
        // Asserted on the attribute rather than on `.translate`, because the
        // attribute is what a translator actually reads.
        const masked = makeMaskedSpan('going', false, 'going');
        expect(masked.getAttribute('translate')).toBe('no');
        // A revealed word is ordinary text and carries no such marker.
        expect(makeMaskedSpan('going', true, 'going').hasAttribute('translate')).toBe(false);
    });
});

describe('maskGlyphs', () => {
    it('returns the token itself — the mask is the CSS pane, not a filler string', () => {
        // This is why the peek animation can swap faces without the line
        // re-flowing: both sides measure the same. A filler of a different
        // length would put that width change back.
        expect(maskGlyphs('going', true)).toBe('going');
    });
});

describe('fillMaskedWordsInto', () => {
    it('reveals exactly the first N maskable words and masks the rest', () => {
        const c = div();
        fillMaskedWordsInto(c, 'we are going home', 2);
        expect([...c.querySelectorAll('.vtt-revealed-word')].map((s) => s.textContent))
            .toEqual(['we', 'are']);
        expect([...c.querySelectorAll('.vtt-masked-word')].map((s) => (s as HTMLElement).dataset.hidden))
            .toEqual(['going', 'home']);
    });

    it('lights exactly the word that opens next, and only while one is left', () => {
        const c = div();
        fillMaskedWordsInto(c, 'we are going home', 2);
        const next = c.querySelectorAll('.vtt-next-word');
        expect(next).toHaveLength(1);
        expect((next[0] as HTMLElement).dataset.hidden).toBe('going');

        const solved = div();
        fillMaskedWordsInto(solved, 'we are going home', 4);
        expect(solved.querySelectorAll('.vtt-next-word')).toHaveLength(0);
    });

    it('renders punctuation as filler and does not spend a reveal on it', () => {
        // Counting a lone symbol as maskable let the "free" first word come up
        // as a stray bracket or a musical note.
        const c = div();
        fillMaskedWordsInto(c, '- we are going', 1);
        expect(c.querySelector('.vtt-guess-filler')?.textContent).toBe('-');
        expect([...c.querySelectorAll('.vtt-revealed-word')].map((s) => s.textContent)).toEqual(['we']);
    });

    it('leaves the sentence readable end to end whatever is masked', () => {
        const c = div();
        fillMaskedWordsInto(c, 'we are going home', 1);
        expect(c.textContent).toBe('we are going home');
    });
});
