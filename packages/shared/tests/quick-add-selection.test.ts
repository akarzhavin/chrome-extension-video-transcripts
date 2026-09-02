/**
 * @jest-environment jsdom
 */

import { installQuickAddOverlay } from '../src/content/quick-add-overlay';

(global as any).chrome = {
    runtime: { id: 'test-extension-id', sendMessage: jest.fn() },
    storage: {
        local: {
            get: jest.fn(() => Promise.resolve({})),
            set: jest.fn(() => Promise.resolve()),
        },
    },
    i18n: { getMessage: jest.fn(() => '') },
};

const PHRASE_CLASS = 'vtt-phrase-selecting';

// jsdom gives every range a zero rect; the payload drops those, so hand back a
// non-empty one to let the pill render.
function stubRects(): void {
    (Range.prototype as any).getBoundingClientRect = () =>
        ({ width: 50, height: 10, top: 5, left: 5, bottom: 15, right: 55 });
    (Range.prototype as any).getClientRects = () => [{}];
}

/** Builds `count` cues, each a main-text row of words plus a translation row. */
function buildList(count: number): HTMLElement {
    const list = document.createElement('div');
    list.id = 'vtt-list';
    for (let i = 0; i < count; i++) {
        const item = document.createElement('div');
        item.className = 'vtt-item';
        item.dataset.index = String(i);

        const main = document.createElement('div');
        main.className = 'vtt-main-text';
        for (const w of [`a${i}`, `b${i}`]) {
            const span = document.createElement('span');
            span.dataset.word = w;
            span.textContent = w;
            main.appendChild(span);
        }

        const sub = document.createElement('div');
        sub.className = 'vtt-sub-text';
        sub.textContent = `translation ${i}`;

        item.append(main, sub);
        list.appendChild(item);
    }
    document.body.appendChild(list);
    return list;
}

/**
 * A guess-mode cue: `revealed` leading words carry data-word, the rest are
 * masked and park the real word in data-hidden. Mirrors makeMaskedSpan.
 */
function buildGuessList(words: string[], revealed: number): HTMLElement {
    const list = document.createElement('div');
    list.id = 'vtt-list';
    const item = document.createElement('div');
    item.className = 'vtt-item';
    item.dataset.index = '0';

    const main = document.createElement('div');
    main.className = 'vtt-main-text';
    words.forEach((w, i) => {
        if (i > 0) main.appendChild(document.createTextNode(' '));
        const span = document.createElement('span');
        span.dataset.mask = '***';
        if (i < revealed) {
            span.dataset.word = w;
            span.className = 'vtt-revealed-word';
            span.textContent = w;
        } else {
            span.dataset.hidden = w;
            span.className = 'vtt-masked-word';
            span.textContent = '***';
        }
        main.appendChild(span);
    });

    item.appendChild(main);
    list.appendChild(item);
    document.body.appendChild(list);
    return list;
}

function selectSpans(from: HTMLElement, to: HTMLElement): void {
    const range = document.createRange();
    range.setStart(from.firstChild!, 0);
    range.setEnd(to.firstChild!, to.textContent!.length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
}

function wordSpans(list: HTMLElement, cue: number): HTMLElement[] {
    return Array.from(
        list.querySelectorAll<HTMLElement>(
            `.vtt-item[data-index="${cue}"] .vtt-main-text span[data-word]`,
        ),
    );
}

/** Selects from the first word of `fromCue` to the last word of `toCue`. */
function selectAcross(list: HTMLElement, fromCue: number, toCue: number): void {
    const start = wordSpans(list, fromCue)[0];
    const endSpans = wordSpans(list, toCue);
    const end = endSpans[endSpans.length - 1];

    const range = document.createRange();
    range.setStart(start.firstChild!, 0);
    range.setEnd(end.firstChild!, end.textContent!.length);

    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
}

// The pill these once exercised is gone — selection now opens the lookup card
// (see "selection — dragging a phrase opens the same card" in lookup.test.ts).
// What stays here is the part that was never the pill's: while a drag straddles
// two cues, the translation row caught between them must not be highlighted.
describe('translation highlight suppression during a phrase drag', () => {
    let teardown: () => void;

    beforeEach(() => {
        stubRects();
        document.body.innerHTML = '';
        teardown = installQuickAddOverlay();
    });

    afterEach(() => {
        teardown();
        window.getSelection()?.removeAllRanges();
    });

    it('suppresses translation highlight for a two-cue selection', () => {
        const list = buildList(4);
        selectAcross(list, 0, 1);
        expect(list.classList.contains(PHRASE_CLASS)).toBe(true);
    });

    it('leaves a three-cue selection alone', () => {
        const list = buildList(4);
        selectAcross(list, 0, 2);
        expect(list.classList.contains(PHRASE_CLASS)).toBe(false);
    });

    it('does not suppress within a single cue', () => {
        const list = buildList(4);
        selectAcross(list, 1, 1);
        expect(list.classList.contains(PHRASE_CLASS)).toBe(false);
    });

    it('clears suppression once the selection collapses', () => {
        const list = buildList(4);
        selectAcross(list, 0, 1);
        expect(list.classList.contains(PHRASE_CLASS)).toBe(true);

        window.getSelection()!.removeAllRanges();
        document.dispatchEvent(new Event('selectionchange'));
        expect(list.classList.contains(PHRASE_CLASS)).toBe(false);
    });

});
