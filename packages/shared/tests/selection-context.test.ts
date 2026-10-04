/**
 * @jest-environment jsdom
 *
 * The context saved with a word from the right-click menu: the text around the
 * selection, run inside the page. It has to contain the word, read like the
 * page reads (no script or style text), and stay within the limit.
 */
import { grabSelectionContext } from '../src/context-menu-save';

jest.mock('../src/analytics-bg', () => ({ track: jest.fn() }));
jest.mock('../src/auth/background', () => ({ handleAuthMessage: jest.fn() }));

/** Select `word` (its `nth` occurrence) inside the element matched by `selector`. */
function select(selector: string, word: string, nth = 0): void {
    const el = document.querySelector(selector)!;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let seen = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = (n as Text).data;
        for (let i = text.indexOf(word); i !== -1; i = text.indexOf(word, i + 1)) {
            if (seen++ === nth) {
                const r = document.createRange();
                r.setStart(n, i);
                r.setEnd(n, i + word.length);
                const sel = window.getSelection()!;
                sel.removeAllRanges();
                sel.addRange(r);
                return;
            }
        }
    }
    throw new Error(`no ${word} #${nth} in ${selector}`);
}

const filler = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

beforeEach(() => {
    document.body.innerHTML = '';
    window.getSelection()?.removeAllRanges();
});

it('is the paragraph the word is in, not the page around it', () => {
    document.body.innerHTML = `<div><p>Intro text here.</p><p>The cat sat on the mat.</p><p>Outro text.</p></div>`;
    select('p:nth-child(2)', 'cat');
    expect(grabSelectionContext(1000)).toBe('The cat sat on the mat.');
});

it('leaves out script and style text inside the block', () => {
    document.body.innerHTML = `<p>A <script>var secret = 1;</script><style>.x{}</style>cat appears.</p>`;
    select('p', 'cat');
    expect(grabSelectionContext(1000)).toBe('A cat appears.');
});

it('in a long block, is a window around the word, not the start of the block', () => {
    document.body.innerHTML = `<p>${filler(400)} NEEDLE ${filler(400)}</p>`;
    select('p', 'NEEDLE');
    const out = grabSelectionContext(200);
    expect(out).toContain('NEEDLE');
    expect(out.length).toBeLessThanOrEqual(200);
    // Whole words at both cut edges.
    expect(out).toMatch(/^word\d+ /);
    expect(out).toMatch(/ word\d+$/);
});

it('picks the occurrence that was selected, not the first one', () => {
    document.body.innerHTML = `<p>cat ${filler(300)} MARK cat ${filler(300)}</p>`;
    select('p', 'cat', 1);
    expect(grabSelectionContext(120)).toContain('MARK');
});

it('reads text placed straight in a wrapper, still within the limit', () => {
    document.body.innerHTML = `<div>${filler(500)} NEEDLE ${filler(500)}</div>`;
    select('div', 'NEEDLE');
    const out = grabSelectionContext(300);
    expect(out).toContain('NEEDLE');
    expect(out.length).toBeLessThanOrEqual(300);
});

it('returns nothing without a selection', () => {
    document.body.innerHTML = '<p>cat</p>';
    expect(grabSelectionContext(1000)).toBe('');
});
