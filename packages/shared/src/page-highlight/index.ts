// Saved words, marked in the text of any web page.
//
// A content script on every http(s) page. It reads the page's visible text
// locally, matches it against the learner's word mirror and paints the matches
// with the CSS Custom Highlight API. Nothing is sent anywhere, and nothing is
// written into the host page: a Highlight is a set of ranges the browser draws
// over the text, so the site's DOM, layout and handlers stay exactly as the
// site built them.
//
// What the page CAN see: the highlight registry belongs to the page, so the
// site's own scripts can read which of its words are marked. That cannot be
// avoided for any mark drawn on someone else's page; it is narrowed by marking
// only text that is actually shown (a hidden dictionary planted to probe the
// learner's list gets nothing), and it is stated in the privacy policy.
//
// Deliberately cheap: it runs on every page a learner opens. The walk and the
// painting both run in idle-time slices that stop when the browser needs the
// thread back, text that changes is re-read on its own, a removed word drops
// its marks without a walk, a hidden tab waits until it is shown, and nothing
// runs at all when there is nothing saved or the setting is off.

import { SIBLING_KEYS } from '../auth/storage';
import { loadPrefs, onPrefsChanged } from '../prefs';
import { loadMirror, onMirrorChanged, type WordState } from '../word-mirror';
import { normalizeTerm } from '../word-key';

/** The highlight name the stylesheet paints: `::highlight(lingogram-saved)`. */
export const HIGHLIGHT_NAME = 'lingogram-saved';

/**
 * Text that is not prose a learner reads, is hidden, or is ours. Rejected with
 * its whole subtree. The extension's own panel and overlay mark saved words
 * themselves (transcript/saved-marks.ts); painting them again would double the
 * mark. Our classes all begin `vtt-`, matched as a whole class name, so a
 * site's `webvtt-cue` is not mistaken for ours.
 */
const SKIP_SELECTOR = [
    'script',
    'style',
    'noscript',
    'template',
    'textarea',
    'input',
    'select',
    'code',
    'pre',
    'svg',
    'title',
    '[hidden]',
    '[aria-hidden="true"]',
    '[contenteditable=""]',
    '[contenteditable="true"]',
    '[contenteditable="plaintext-only"]',
    '[id^="vtt-"]',
    '[id^="lingogram-"]',
    '[class^="vtt-"]',
    '[class*=" vtt-"]',
].join(',');

/** A word: letters/marks/digits, joined by an inner apostrophe or hyphen. */
const WORD = /[\p{L}\p{M}\p{N}]+(?:['’ʼ‘-][\p{L}\p{M}\p{N}]+)*/gu;

/** Quiet time before text the page added is read. */
const MUTATION_DEBOUNCE_MS = 400;
/** Nodes handled between deadline checks. */
const BATCH = 50;
/** Without requestIdleCallback: how long one slice may run. */
const FALLBACK_SLICE_MS = 8;

/**
 * The key a saved term and a word on the page are compared by: the store's own
 * normalizeTerm, plus two folds that only matter here. Typographic apostrophes
 * become `'` (subtitles use straight ones, published text curly ones), and
 * punctuation at either end is dropped (a selection saved from the menu often
 * carries the full stop after the word). Applied to BOTH sides of the
 * comparison; the stored key itself is untouched.
 */
export function matchKey(term: string): string {
    return normalizeTerm(term)
        .replace(/[’ʼ‘]/g, "'")
        .replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, '');
}

/** The saved terms as the matcher holds them. */
export interface SavedIndex {
    words: Set<string>;
    phrasesByFirst: Map<string, string[][]>;
}

export function indexSaved(words: Record<string, WordState>): SavedIndex {
    const out: SavedIndex = { words: new Set(), phrasesByFirst: new Map() };
    for (const [term, state] of Object.entries(words)) {
        if (state !== 'active') continue;
        const key = matchKey(term);
        if (!key) continue;
        out.words.add(key);
        const parts = key.split(' ');
        if (parts.length < 2) continue;
        const list = out.phrasesByFirst.get(parts[0]);
        if (list) list.push(parts);
        else out.phrasesByFirst.set(parts[0], [parts]);
    }
    return out;
}

/**
 * Every saved term found in `text`, as [start, end, key]. A saved phrase wins
 * over the saved words inside it: the learner saved those words together, and
 * one mark across the phrase says so. Exported for tests.
 */
export function findSaved(text: string, saved: SavedIndex): Array<[number, number, string]> {
    const tokens: Array<{ key: string; start: number; end: number }> = [];
    for (const m of text.matchAll(WORD)) {
        const start = m.index ?? 0;
        tokens.push({ key: matchKey(m[0]), start, end: start + m[0].length });
    }
    const out: Array<[number, number, string]> = [];
    for (let i = 0; i < tokens.length; i++) {
        let matched: string[] | null = null;
        for (const words of saved.phrasesByFirst.get(tokens[i].key) ?? []) {
            if ((matched && words.length <= matched.length) || i + words.length > tokens.length) continue;
            let ok = true;
            for (let k = 1; k < words.length && ok; k++) {
                const prev = tokens[i + k - 1];
                const cur = tokens[i + k];
                // Only whitespace between the words: "run, away" is not "run away".
                ok = cur.key === words[k] && /^\s+$/.test(text.slice(prev.end, cur.start));
            }
            if (ok) matched = words;
        }
        if (matched) {
            out.push([tokens[i].start, tokens[i + matched.length - 1].end, matched.join(' ')]);
            i += matched.length - 1;
        } else if (saved.words.has(tokens[i].key)) {
            out.push([tokens[i].start, tokens[i].end, tokens[i].key]);
        }
    }
    return out;
}

/** Whether an element is rendered. checkVisibility where the browser has it. */
function isShown(el: Element): boolean {
    const check = (el as Element & { checkVisibility?: (o?: object) => boolean }).checkVisibility;
    if (typeof check === 'function') {
        return check.call(el, { checkOpacity: true, checkVisibilityCSS: true });
    }
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
}

/**
 * Whether text in `el` is drawn in a colour with no alpha. Sites keep copies of
 * text that way (translate.google.com's Saved list repeats every phrase in a
 * transparent block): the letters are invisible but a highlight would still
 * draw its underline. Gradient text is the exception — it is transparent text
 * painted through `background-clip: text`, and it is what the reader sees.
 *
 * Asked only of text that already holds a saved word, so the walk over the rest
 * of the page pays nothing for it.
 */
function hasInvisibleInk(el: Element): boolean {
    const style = getComputedStyle(el);
    const c = style.color.replace(/\s+/g, '');
    const transparent = c === 'transparent' || /^rgba\([^)]*,0(\.0+)?\)$/.test(c) || /\/0(\.0+)?\)$/.test(c);
    if (!transparent) return false;
    const clip = style.getPropertyValue('background-clip') || style.getPropertyValue('-webkit-background-clip');
    return !/\btext\b/.test(clip);
}

type Deadline = { timeRemaining(): number };
const idle: (cb: (d: Deadline) => void) => void =
    typeof requestIdleCallback === 'function'
        ? (cb) => requestIdleCallback(cb, { timeout: 1000 })
        : (cb) =>
              setTimeout(() => {
                  const end = Date.now() + FALLBACK_SLICE_MS;
                  cb({ timeRemaining: () => Math.max(0, end - Date.now()) });
              }, 16);

interface Mark {
    range: AbstractRange;
    key: string;
}

/**
 * The painter for one document. Exported for tests; the content script only
 * calls installPageHighlight().
 */
export function createPageHighlighter(doc: Document = document) {
    let saved: SavedIndex = { words: new Set(), phrasesByFirst: new Map() };
    const highlight = new Highlight();
    const marksOf = new Map<Text, Mark[]>();
    /** Subtrees still to walk, and the walk in progress. */
    const roots: Node[] = [];
    let walker: TreeWalker | null = null;
    let working = false;
    let running = false;
    let staleWhileHidden = false;
    let observer: MutationObserver | undefined;
    const pending = new Set<Node>();
    let debounce: ReturnType<typeof setTimeout> | undefined;

    const clearNode = (text: Text): void => {
        for (const m of marksOf.get(text) ?? []) highlight.delete(m.range as Range);
        marksOf.delete(text);
    };

    const paintText = (text: Text): void => {
        clearNode(text);
        if (!text.isConnected) return;
        const data = text.data;
        if (data.length < 2) return;
        const hits = findSaved(data, saved);
        if (hits.length === 0) return;
        if (text.parentElement && hasInvisibleInk(text.parentElement)) return;
        // StaticRange: the browser does not have to keep it in step with every
        // DOM change on the page, which a live Range costs on each mutation.
        // A text node that changes is re-read anyway (see the observer).
        const marks = hits.map(([start, end, key]) => {
            const range = new StaticRange({ startContainer: text, startOffset: start, endContainer: text, endOffset: end });
            highlight.add(range as unknown as Range);
            return { range, key };
        });
        marksOf.set(text, marks);
    };

    const accept = (node: Node): number => {
        if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as Element;
            return el.matches(SKIP_SELECTOR) || !isShown(el) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
    };

    /** The element to walk from for `node`, or null when it must be skipped. */
    const entryOf = (node: Node): Element | null => {
        const el =
            node.nodeType === Node.DOCUMENT_NODE
                ? (node as Document).body
                : node.nodeType === Node.ELEMENT_NODE
                  ? (node as Element)
                  : node.parentElement;
        if (!el || el.closest(SKIP_SELECTOR)) return null;
        // A whole subtree that is not shown is skipped here; the walk checks
        // each element below it again.
        for (let a: Element | null = el; a; a = a.parentElement) if (!isShown(a)) return null;
        return el;
    };

    const work = (deadline: Deadline): void => {
        if (!running) {
            roots.length = 0;
            walker = null;
            working = false;
            return;
        }
        while (deadline.timeRemaining() > 1) {
            if (!walker) {
                const next = roots.shift();
                if (!next) break;
                if (next.nodeType === Node.TEXT_NODE) {
                    if (next.isConnected && entryOf(next)) paintText(next as Text);
                    continue;
                }
                const el = next.isConnected ? entryOf(next) : null;
                if (!el) continue;
                walker = doc.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: accept });
            }
            let n: Node | null = null;
            for (let i = 0; i < BATCH && (n = walker.nextNode()); i++) paintText(n as Text);
            if (!n) walker = null;
        }
        if (walker || roots.length > 0) idle(work);
        else working = false;
    };

    /** Read the text under `node` (and paint it) in idle slices. */
    const scan = (node: Node): void => {
        roots.push(node);
        if (!working) {
            working = true;
            idle(work);
        }
    };

    /** Drop every mark whose text has left the page. */
    const prune = (): void => {
        for (const text of [...marksOf.keys()]) if (!text.isConnected) clearNode(text);
    };

    const flushMutations = (): void => {
        debounce = undefined;
        prune();
        // A node inside another pending node is read with it.
        const nodes = [...pending].filter((n) => n.isConnected);
        pending.clear();
        for (const n of nodes) {
            let covered = false;
            for (let a = n.parentNode; a && !covered; a = a.parentNode) covered = nodes.includes(a);
            if (!covered) scan(n);
        }
    };

    const observe = (): void => {
        if (observer) return;
        observer = new MutationObserver((records) => {
            for (const rec of records) {
                if (rec.type === 'characterData') pending.add(rec.target);
                else rec.addedNodes.forEach((n) => pending.add(n));
            }
            // Waits for the page to go quiet, so a burst of changes is one read.
            if (debounce) clearTimeout(debounce);
            debounce = setTimeout(flushMutations, MUTATION_DEBOUNCE_MS);
        });
        observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true });
    };

    const stopObserving = (): void => {
        observer?.disconnect();
        observer = undefined;
        if (debounce) clearTimeout(debounce);
        debounce = undefined;
        pending.clear();
    };

    const forgetAll = (): void => {
        highlight.clear();
        marksOf.clear();
        roots.length = 0;
        walker = null;
    };

    /**
     * Read the whole page again. Marks are replaced node by node as the walk
     * reaches them rather than cleared first, so nothing flickers off and on.
     */
    const rewalk = (): void => {
        if (!running) return;
        if (saved.words.size === 0) {
            // Nothing to find: no marks, and no watching the page.
            forgetAll();
            stopObserving();
            return;
        }
        if (doc.hidden) {
            // A background tab is read when it is shown, not on every save.
            staleWhileHidden = true;
            return;
        }
        observe();
        prune();
        roots.length = 0;
        walker = null;
        scan(doc);
    };

    const onVisibility = (): void => {
        if (!doc.hidden && staleWhileHidden) {
            staleWhileHidden = false;
            rewalk();
        }
    };

    return {
        /** Replace the saved words (a mirror snapshot) and update the marks. */
        setWords(words: Record<string, WordState>): void {
            const next = indexSaved(words);
            const onlyRemoved = [...next.words].every((k) => saved.words.has(k));
            saved = next;
            if (!running) return;
            if (onlyRemoved && next.words.size > 0) {
                // A word taken off the list: drop its marks, no walk needed.
                for (const [text, marks] of [...marksOf]) {
                    const keep = marks.filter((m) => next.words.has(m.key));
                    if (keep.length === marks.length) continue;
                    for (const m of marks) if (!next.words.has(m.key)) highlight.delete(m.range as Range);
                    if (keep.length) marksOf.set(text, keep);
                    else marksOf.delete(text);
                }
                return;
            }
            rewalk();
        },
        start(): void {
            if (running) return;
            running = true;
            CSS.highlights.set(HIGHLIGHT_NAME, highlight);
            doc.addEventListener('visibilitychange', onVisibility);
            rewalk();
        },
        stop(): void {
            running = false;
            staleWhileHidden = false;
            doc.removeEventListener('visibilitychange', onVisibility);
            stopObserving();
            forgetAll();
            // The registry belongs to the page and is shared by both editions'
            // content scripts. Remove only our own entry: an edition that
            // stands down must not wipe the marks the other one is painting.
            if (CSS.highlights.get(HIGHLIGHT_NAME) === highlight) CSS.highlights.delete(HIGHLIGHT_NAME);
        },
        /** For tests: how many marks are painted now. */
        get size(): number {
            return highlight.size;
        },
    };
}

/** True when this browser can paint highlights without touching the DOM. */
export function canHighlight(): boolean {
    return (
        typeof CSS !== 'undefined' &&
        'highlights' in CSS &&
        typeof Highlight === 'function' &&
        typeof StaticRange === 'function'
    );
}

/**
 * Entry point of the content script. Paints while the setting is on and this
 * edition is the one that paints (see sibling.ts), and follows both, and the
 * mirror, live.
 */
export async function installPageHighlight(): Promise<void> {
    if (!canHighlight() || !document.body) return;
    const painter = createPageHighlighter(document);

    let enabled = (await loadPrefs()).pageHighlight;
    let yields = false;
    try {
        const got = await chrome.storage.local.get(SIBLING_KEYS.otherOwns);
        yields = got[SIBLING_KEYS.otherOwns] === true;
    } catch {
        // no storage — paint.
    }
    const apply = (): void => {
        if (enabled && !yields) painter.start();
        else painter.stop();
    };

    painter.setWords((await loadMirror()).words);
    apply();

    onMirrorChanged((m) => painter.setWords(m.words));
    onPrefsChanged((p) => {
        if (p.pageHighlight === enabled) return;
        enabled = p.pageHighlight;
        apply();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !(SIBLING_KEYS.otherOwns in changes)) return;
        yields = changes[SIBLING_KEYS.otherOwns].newValue === true;
        apply();
    });
}
