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

const PILL_ID = 'lingogram-quick-add-pill';
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

describe('quick-add selection across subtitles', () => {
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

    it('does not double a word when the second cue contributes no spans', async () => {
        // Releasing in the next cue's whitespace leaves that scope with no
        // intersecting span. extractTerm's fallback is range.toString(), which
        // is the WHOLE selection — so the word came back twice ("b0 b0").
        const list = buildList(4);
        const from = wordSpans(list, 0)[1];
        const secondCueMain = list.querySelectorAll('.vtt-main-text')[1];

        const range = document.createRange();
        range.setStart(from.firstChild!, 0);
        range.setEnd(secondCueMain, 0); // before any word of cue 1
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);

        document.dispatchEvent(new Event('mouseup'));
        await new Promise((r) => setTimeout(r, 0));
        const pill = document.getElementById(PILL_ID);
        if (!pill) return; // no offer at all is also acceptable here

        const send = (global as any).chrome.runtime.sendMessage as jest.Mock;
        send.mockClear();
        send.mockImplementation((_m: unknown, cb?: (r: unknown) => void) => {
            cb?.({ ok: true, wordId: 'w1' });
            return Promise.resolve({ ok: true, wordId: 'w1' });
        });
        pill.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 0));

        const sent = send.mock.calls.find((c) => (c[0] as any)?.action === 'ADD_WORD');
        const term: string = (sent![0] as any).term;
        const words = term.split(/\s+/);
        expect(new Set(words).size).toBe(words.length); // no repeats
    });

    it('saves a term joining both cues, without the translation', async () => {
        const list = buildList(4);
        selectAcross(list, 0, 1);
        document.dispatchEvent(new Event('mouseup'));
        await new Promise((r) => setTimeout(r, 0));

        const pill = document.getElementById(PILL_ID);
        expect(pill).not.toBeNull();

        const send = (global as any).chrome.runtime.sendMessage as jest.Mock;
        send.mockClear();
        send.mockImplementation((_m: unknown, cb?: (r: unknown) => void) => {
            cb?.({ ok: true, wordId: 'w1' });
            return Promise.resolve({ ok: true, wordId: 'w1' });
        });

        pill!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 0));

        const sent = send.mock.calls.find((c) => (c[0] as any)?.action === 'ADD_WORD');
        expect(sent).toBeDefined();
        expect((sent![0] as any).term).toBe('a0 b0 a1 b1');
        expect((sent![0] as any).term).not.toContain('translation');
    });

    it('offers no pill for a three-cue selection', async () => {
        const list = buildList(4);
        selectAcross(list, 0, 2);
        document.dispatchEvent(new Event('mouseup'));
        await new Promise((r) => setTimeout(r, 0));

        expect(document.getElementById(PILL_ID)).toBeNull();
    });

    // In the browser, `user-select: none` keeps masked words out of the range
    // entirely. jsdom has no CSS layout, so these exercise the code-level rule
    // instead — which is exactly why that rule exists and is not left to CSS.
    describe('guess mode: hidden words are not dictionary candidates', () => {
        it('offers no pill when only masked words are selected', async () => {
            const list = buildGuessList(['alpha', 'beta', 'gamma'], 1);
            const spans = list.querySelectorAll<HTMLElement>('.vtt-masked-word');
            selectSpans(spans[0], spans[1]);
            document.dispatchEvent(new Event('mouseup'));
            await new Promise((r) => setTimeout(r, 0));

            expect(document.getElementById(PILL_ID)).toBeNull();
        });

        it('saves only the revealed words from a mixed selection', async () => {
            const list = buildGuessList(['alpha', 'beta', 'gamma'], 2);
            const all = list.querySelectorAll<HTMLElement>('.vtt-revealed-word, .vtt-masked-word');
            selectSpans(all[0], all[2]); // spans revealed + revealed + masked
            document.dispatchEvent(new Event('mouseup'));
            await new Promise((r) => setTimeout(r, 0));

            const pill = document.getElementById(PILL_ID);
            expect(pill).not.toBeNull();

            const send = (global as any).chrome.runtime.sendMessage as jest.Mock;
            send.mockClear();
            send.mockImplementation((_m: unknown, cb?: (r: unknown) => void) => {
                cb?.({ ok: true, wordId: 'w1' });
                return Promise.resolve({ ok: true, wordId: 'w1' });
            });

            pill!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await new Promise((r) => setTimeout(r, 0));

            const sent = send.mock.calls.find((c) => (c[0] as any)?.action === 'ADD_WORD');
            expect(sent).toBeDefined();
            expect((sent![0] as any).term).toBe('alpha beta');
            expect((sent![0] as any).term).not.toContain('gamma');
            expect((sent![0] as any).term).not.toContain('*');
        });

        it('keeps the whole sentence as saved context', async () => {
            const list = buildGuessList(['alpha', 'beta', 'gamma'], 1);
            const revealed = list.querySelector<HTMLElement>('.vtt-revealed-word')!;
            selectSpans(revealed, revealed);
            document.dispatchEvent(new Event('mouseup'));
            await new Promise((r) => setTimeout(r, 0));

            const send = (global as any).chrome.runtime.sendMessage as jest.Mock;
            send.mockClear();
            send.mockImplementation((_m: unknown, cb?: (r: unknown) => void) => {
                cb?.({ ok: true, wordId: 'w1' });
                return Promise.resolve({ ok: true, wordId: 'w1' });
            });

            document.getElementById(PILL_ID)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await new Promise((r) => setTimeout(r, 0));

            const sent = send.mock.calls.find((c) => (c[0] as any)?.action === 'ADD_WORD');
            // Context is stored, never painted onto the masked line, so it may
            // hold words the user has not uncovered yet.
            expect((sent![0] as any).context).toContain('alpha beta gamma');
        });
    });
});
