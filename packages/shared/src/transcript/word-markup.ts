// The word-level markup shared by the transcript and the on-video overlay.
//
// These four were methods on SidebarUI, but they read no field of it: their
// only inputs are their arguments and the tokenizer. Pure functions in method
// clothing, so they leave without a host port of any kind — inventing one "for
// symmetry" would be manufacturing the coupling this split exists to remove.
//
// Every class name and data attribute below is load-bearing beyond this file:
// quick-add's `span[data-word]` query, the guess-mode reveal order and the
// stylesheet all key on them.
import { tokenizeForGuess, isMaskableToken } from '../guess-tokenize';

// What sits under the frosted pane: the word itself, painted transparent.
// Its only job is to give the pane a width, and the word is the one string
// guaranteed to give it the RIGHT width — the pane and the peeked word are
// the same box, so opening one no longer moves the line around it.
//
// This replaced a run of repeated 'n' glyphs, half the word's length. That
// filler was always a guess at the word's width and always wrong: peek had
// to animate the capsule from filler width to word width, and the line
// visibly re-flowed every time the cursor crossed a word. Halving was
// itself a patch — one 'n' per letter ran WIDER than real text, which broke
// lines onto two rows — so the width was wrong in both directions and only
// roughly wrong in between.
//
// The word being really in the node means it can be selected or copied out.
// That is deliberate: guess mode is a puzzle the user sets for themselves,
// and someone who reaches for the clipboard to beat it has simply chosen to
// look. The blur is the puzzle, not a lock. translate="no" on the capsule
// stops the one reader that would expose it WITHOUT being asked — a page
// translator rewriting the node in place.
export function maskGlyphs(token: string, _spaced: boolean): string {
    return token;
}

// Both sidebar and on-screen overlay share this layout so the quick-add
// selection extractor can recover the real word from data-word — even when
// the visible glyphs are masked.
export function fillMaskedWordsInto(
    container: HTMLElement,
    text: string,
    revealedCount: number,
    isRevealed?: (tokenIndex: number) => boolean,
): void {
    const { tokens, sep } = tokenizeForGuess(text);
    const spaced = sep === ' ';
    // Out by the prefix unless the caller knows better. Words can also be
    // uncovered out of order by pointing at them (AppState.pickedWords), and
    // only the state can answer that — but the two-argument form has to keep
    // meaning exactly what it did, so the prefix stays the default.
    const revealed = isRevealed ?? ((m: number) => m < revealedCount);
    // The reveal index walks maskable tokens only. Punctuation and sound
    // cues ("-", "♪", a stray bracket) render as plain text: a capsule over
    // them is nothing anyone can guess, and counting them let the "free"
    // first word come up as a lone symbol.
    let m = 0;
    // Which capsule gets the accent. Once words can be opened out of order
    // "the next one" is no longer `m === revealedCount`: that slot may already
    // be out, and lighting it would point at a word that is plainly visible.
    // The first still-hidden word is the honest target, and it is also what a
    // plain run of in-order reveals produces, so nothing changes there.
    let lit = -1;
    let probe = 0;
    for (const token of tokens) {
        if (!isMaskableToken(token)) continue;
        if (!revealed(probe)) { lit = probe; break; }
        probe++;
    }
    tokens.forEach((word, i) => {
        if (i > 0 && sep) container.appendChild(document.createTextNode(sep));
        if (!isMaskableToken(word)) {
            const plain = document.createElement('span');
            plain.className = 'vtt-guess-filler';
            plain.textContent = word;
            container.appendChild(plain);
            return;
        }
        const span = makeMaskedSpan(word, revealed(m), maskGlyphs(word, spaced));
        // The token's own index, so a click can name the word it landed on
        // rather than inferring one from the reveal count. Stamped on every
        // word, revealed or not: updateGuessItem patches spans in place and a
        // word that comes out must not lose its identity on the way.
        span.dataset.ti = String(m);
        if (m === lit) span.classList.add('vtt-next-word');
        container.appendChild(span);
        m++;
    });
}

// data-word is what the quick-add selection reads, so it carries the real
// word only while that word is on screen. A word still masked is parked in
// data-hidden instead: offering to save a word the user has not been shown
// is the confusing half of the reveal/quick-add collision, and dropping the
// attribute is also what makes quick-add's `span[data-word]` queries skip
// masked words without any change on their side.
export function makeMaskedSpan(word: string, revealed: boolean, maskText: string): HTMLSpanElement {
    const span = document.createElement('span');
    span.dataset.mask = maskText;
    if (revealed) {
        span.dataset.word = word;
        span.className = 'vtt-revealed-word';
        span.textContent = word;
    } else {
        span.dataset.hidden = word;
        span.className = 'vtt-masked-word';
        // The masked node holds the real word (see maskGlyphs), so this is
        // what keeps a page translator from rewriting it into a legible
        // one: a user reaching for the clipboard chose to look, a browser
        // translating the page did not ask.
        span.translate = false;
        span.textContent = maskText;
    }
    return span;
}

// Non-guess subtitles still wrap each word in a span carrying data-word
// so the quick-add selection can snap to whole-word boundaries. Inline
// spans without a class read identically to the previous text node.
export function fillPlainWordsInto(container: HTMLElement, text: string): void {
    const { tokens, sep } = tokenizeForGuess(text);
    tokens.forEach((word, i) => {
        if (i > 0 && sep) container.appendChild(document.createTextNode(sep));
        const span = document.createElement('span');
        span.dataset.word = word;
        span.textContent = word;
        container.appendChild(span);
    });
}
