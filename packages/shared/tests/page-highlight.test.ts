/**
 * @jest-environment jsdom
 *
 * Saved words marked on any web page.
 *
 * What the learner relies on: a word they saved is marked wherever it appears
 * in ordinary page text, and nowhere it is not prose (a form field, code, the
 * extension's own panel); removing the word takes the mark away; text the page
 * adds later gets marked too; and switching the setting off, or the other
 * edition being the one that paints, leaves the page untouched.
 */

// jsdom has neither the Highlight API nor its registry.
class FakeHighlight extends Set<Range> {}
(global as any).Highlight = FakeHighlight;
const registry = new Map<string, FakeHighlight>();
(global as any).CSS = { highlights: registry };

const store: Record<string, unknown> = {};
const changeListeners: Array<(c: Record<string, chrome.storage.StorageChange>, area: string) => void> = [];
(global as any).chrome = {
    runtime: { id: 'test-extension-id' },
    storage: {
        local: {
            get: jest.fn(async (keys: string | string[]) => {
                const list = Array.isArray(keys) ? keys : [keys];
                return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, store[k]]));
            }),
            set: jest.fn(async (o: Record<string, unknown>) => {
                const changes: Record<string, chrome.storage.StorageChange> = {};
                for (const [k, v] of Object.entries(o)) {
                    changes[k] = { oldValue: store[k], newValue: v };
                    store[k] = v;
                }
                for (const l of changeListeners) l(changes, 'local');
            }),
        },
        onChanged: {
            addListener: (l: any) => changeListeners.push(l),
            removeListener: jest.fn(),
        },
    },
};

import { HIGHLIGHT_NAME, createPageHighlighter, findSaved, indexSaved, installPageHighlight } from '../src/page-highlight';
import { PREFS_KEY } from '../src/prefs';
import { setMirrorEntry } from '../src/word-mirror';
import { SIBLING_KEYS } from '../src/auth/storage';

const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
/** Everything the idle slices and the mutation debounce had time to do. */
const settle = async () => {
    for (let i = 0; i < 5; i++) await wait(20);
};
/** The text under every mark, as the reader sees it. Works for StaticRange too. */
const painted = (): string[] =>
    [...(registry.get(HIGHLIGHT_NAME) ?? [])]
        .map((r: AbstractRange) => (r.startContainer as Text).data.slice(r.startOffset, r.endOffset))
        .sort();

const words = (...terms: string[]) => Object.fromEntries(terms.map((t) => [t, 'active' as const]));

beforeEach(() => {
    document.body.innerHTML = '';
    registry.clear();
    for (const k of Object.keys(store)) delete store[k];
    changeListeners.length = 0;
});

describe('findSaved', () => {
    // Through the real index, so the phrase index is under test as well.
    const run = (text: string, saved: string[]) =>
        findSaved(text, indexSaved(words(...saved))).map(([a, b]) => text.slice(a, b));

    it('finds a saved word whatever its case, and not inside another word', () => {
        expect(run('Run! Then run again, rerun.', ['run'])).toEqual(['Run', 'run']);
    });

    it('keeps an inner apostrophe or hyphen as part of the word', () => {
        expect(run("I don't know a well-known word", ["don't", 'well-known'])).toEqual(["don't", 'well-known']);
    });

    it('marks a saved phrase as one mark, not as its saved words', () => {
        expect(run('We had to run away fast', ['run', 'run away'])).toEqual(['run away']);
    });

    it('does not read a phrase across punctuation', () => {
        expect(run('run, away', ['run away'])).toEqual([]);
    });

    it('matches a curly apostrophe on the page to a straight one saved, and back', () => {
        expect(run('I don’t know', ["don't"])).toEqual(['don’t']);
        expect(run("I don't know", ['don’t'])).toEqual(["don't"]);
    });

    it('ignores punctuation saved at the ends of a selection', () => {
        expect(run('A word here, and by the way more', ['word.', 'by the way,'])).toEqual(['word', 'by the way']);
    });

    it('prefers the longest saved phrase that starts at a word', () => {
        expect(run('take it for granted', ['take it', 'take it for granted'])).toEqual(['take it for granted']);
    });

    it('finds words in other scripts', () => {
        expect(run('Это слово, а не другое', ['слово'])).toEqual(['слово']);
    });
});

describe('the painter', () => {
    it('marks saved words in page text and nowhere else', async () => {
        document.body.innerHTML = `
            <p>The cat sat on the mat.</p>
            <textarea>cat</textarea>
            <script>var cat = 1;</script>
            <code>cat</code>
            <div contenteditable="true">cat</div>
            <div id="vtt-sidebar"><span>cat</span></div>
            <div class="vtt-overlay-main">cat</div>
            <div style="display:none">cat</div>
            <div style="visibility:hidden">cat</div>
            <div hidden>cat</div>
            <div aria-hidden="true">cat</div>
            <div class="webvtt-cue">cat</div>`;
        const p = createPageHighlighter(document);
        p.setWords(words('cat', 'mat'));
        p.start();
        await settle();
        // The page's own `webvtt-cue` is not ours and is shown: marked.
        expect(painted()).toEqual(['cat', 'cat', 'mat']);
    });

    // translate.google.com's Saved list repeats each phrase in a block whose
    // text colour is fully transparent: invisible letters, but a highlight
    // underline drawn under them showed as a stray red dash beside the card.
    it('leaves text with a transparent colour alone, but not gradient text', async () => {
        document.body.innerHTML = `
            <p>cat</p>
            <div style="color: rgba(0, 0, 0, 0)">cat</div>
            <div style="color: transparent">cat</div>
            <div style="color: transparent; background-clip: text; background-image: linear-gradient(red, blue)">mat</div>`;
        const p = createPageHighlighter(document);
        p.setWords(words('cat', 'mat'));
        p.start();
        await settle();
        expect(painted()).toEqual(['cat', 'mat']);
    });

    it('takes the mark away when the word is removed', async () => {
        document.body.innerHTML = '<p>cat and dog</p>';
        const p = createPageHighlighter(document);
        p.setWords(words('cat', 'dog'));
        p.start();
        await settle();
        expect(painted()).toEqual(['cat', 'dog']);
        p.setWords({ cat: 'removed', dog: 'active' });
        await settle();
        expect(painted()).toEqual(['dog']);
    });

    it('marks text the page adds later', async () => {
        document.body.innerHTML = '<p>nothing here</p>';
        const p = createPageHighlighter(document);
        p.setWords(words('cat'));
        p.start();
        await settle();
        expect(painted()).toEqual([]);
        const more = document.createElement('p');
        more.textContent = 'a cat appears';
        document.body.appendChild(more);
        await wait(500); // past the mutation debounce
        await settle();
        expect(painted()).toEqual(['cat']);
    });

    it('with nothing saved, paints nothing and does not watch the page', async () => {
        const observe = jest.spyOn(MutationObserver.prototype, 'observe');
        document.body.innerHTML = '<p>cat</p>';
        const p = createPageHighlighter(document);
        p.setWords({});
        p.start();
        await settle();
        expect(painted()).toEqual([]);
        expect(observe).not.toHaveBeenCalled();
        observe.mockRestore();
    });

    it('stop() clears the marks and leaves the registry', async () => {
        document.body.innerHTML = '<p>cat</p>';
        const p = createPageHighlighter(document);
        p.setWords(words('cat'));
        p.start();
        await settle();
        expect(registry.has(HIGHLIGHT_NAME)).toBe(true);
        p.stop();
        expect(registry.has(HIGHLIGHT_NAME)).toBe(false);
        expect(p.size).toBe(0);
    });

    it('an edition that stands down leaves the other edition\'s marks alone', async () => {
        document.body.innerHTML = '<p>cat</p>';
        const painting = createPageHighlighter(document);
        painting.setWords(words('cat'));
        painting.start();
        await settle();
        const yielding = createPageHighlighter(document);
        yielding.setWords(words('cat'));
        yielding.stop();
        expect(painted()).toEqual(['cat']);
        painting.stop();
    });

    it('a saved phrase is one mark on the page', async () => {
        document.body.innerHTML = '<p>We had to run away fast.</p>';
        const p = createPageHighlighter(document);
        p.setWords(words('run', 'run away'));
        p.start();
        await settle();
        expect(painted()).toEqual(['run away']);
        p.stop();
    });

    it('a removed word loses its marks at once, without reading the page again', async () => {
        document.body.innerHTML = '<p>cat and dog</p>';
        const p = createPageHighlighter(document);
        p.setWords(words('cat', 'dog'));
        p.start();
        await settle();
        const walk = jest.spyOn(document, 'createTreeWalker');
        p.setWords({ cat: 'removed', dog: 'active' });
        expect(painted()).toEqual(['dog']);
        expect(walk).not.toHaveBeenCalled();
        walk.mockRestore();
        p.stop();
    });

    it('an added word keeps the existing marks on screen while the page is read again', async () => {
        document.body.innerHTML = '<p>cat and dog</p>';
        const p = createPageHighlighter(document);
        p.setWords(words('cat'));
        p.start();
        await settle();
        p.setWords(words('cat', 'dog'));
        expect(painted()).toEqual(['cat']); // not cleared first
        await settle();
        expect(painted()).toEqual(['cat', 'dog']);
        p.stop();
    });

    it('a background tab is read when it is shown, not on every save', async () => {
        document.body.innerHTML = '<p>cat and dog</p>';
        const p = createPageHighlighter(document);
        p.setWords(words('cat'));
        p.start();
        await settle();
        Object.defineProperty(document, 'hidden', { value: true, configurable: true });
        p.setWords(words('cat', 'dog'));
        await settle();
        expect(painted()).toEqual(['cat']);
        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        await settle();
        expect(painted()).toEqual(['cat', 'dog']);
        p.stop();
    });

    it('a long page is read in slices, and all of it', async () => {
        document.body.innerHTML = Array.from({ length: 3000 }, (_, i) => `<p>line ${i} cat</p>`).join('');
        const p = createPageHighlighter(document);
        p.setWords(words('cat'));
        p.start();
        for (let i = 0; i < 200 && p.size < 3000; i++) await wait(20);
        expect(p.size).toBe(3000);
        p.stop();
    });

    it('never changes the page itself', async () => {
        document.body.innerHTML = '<p>The cat sat.</p>';
        const before = document.body.innerHTML;
        const p = createPageHighlighter(document);
        p.setWords(words('cat'));
        p.start();
        await settle();
        expect(painted()).toEqual(['cat']);
        expect(document.body.innerHTML).toBe(before);
    });
});

describe('installPageHighlight', () => {
    it('paints the mirror on a normal page', async () => {
        await setMirrorEntry('cat', 'active');
        document.body.innerHTML = '<p>a cat</p>';
        await installPageHighlight();
        await settle();
        expect(painted()).toEqual(['cat']);
    });

    it('stands down while the other edition is the one that paints', async () => {
        await setMirrorEntry('cat', 'active');
        store[SIBLING_KEYS.otherOwns] = true;
        document.body.innerHTML = '<p>a cat</p>';
        await installPageHighlight();
        await settle();
        expect(registry.has(HIGHLIGHT_NAME)).toBe(false);
    });

    it('follows the setting live', async () => {
        await setMirrorEntry('cat', 'active');
        document.body.innerHTML = '<p>a cat</p>';
        await installPageHighlight();
        await settle();
        expect(painted()).toEqual(['cat']);
        await chrome.storage.local.set({ [PREFS_KEY]: { pageHighlight: false } });
        await settle();
        expect(registry.has(HIGHLIGHT_NAME)).toBe(false);
        await chrome.storage.local.set({ [PREFS_KEY]: { pageHighlight: true } });
        await settle();
        expect(painted()).toEqual(['cat']);
    });

    it('does nothing in a browser without the Highlight API', async () => {
        const saved = (global as any).CSS;
        (global as any).CSS = {};
        await setMirrorEntry('cat', 'active');
        document.body.innerHTML = '<p>a cat</p>';
        await expect(installPageHighlight()).resolves.toBeUndefined();
        (global as any).CSS = saved;
        expect(registry.has(HIGHLIGHT_NAME)).toBe(false);
    });
});
