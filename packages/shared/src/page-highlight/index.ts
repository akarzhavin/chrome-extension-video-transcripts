// Saved words, marked in the text of any web page.
//
// A content script on every http(s) page. It reads the page's text locally,
// matches it against the learner's word mirror (the same normalizeTerm key the
// transcript marks use) and paints the matches with the CSS Custom Highlight
// API. Nothing is sent anywhere, and nothing is written into the host page: a
// Highlight is a set of Ranges the browser draws over the text, so the site's
// DOM, layout and handlers stay exactly as the site built them.
//
// Deliberately small and self-contained: it runs on every page a learner opens,
// so it must never cost what a blocked input or a long scan would. Work is done
// in idle-time chunks, repeated only for text that changed, and not at all when
// there is nothing saved or the setting is off.

import { SIBLING_KEYS } from '../auth/storage';
import { createSavedWords } from '../lookup/saved-words';
import { loadPrefs, onPrefsChanged } from '../prefs';
import { loadMirror, onMirrorChanged } from '../word-mirror';
import { normalizeTerm } from '../word-key';

/** The highlight name the stylesheet paints: `::highlight(lingogram-saved)`. */
export const HIGHLIGHT_NAME = 'lingogram-saved';

/**
 * Text that is not prose a learner reads, or is ours. Rejected with its whole
 * subtree. The extension's own panel and overlay mark saved words themselves
 * (transcript/saved-marks.ts); painting them again would double the mark.
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
    '[contenteditable=""]',
    '[contenteditable="true"]',
    '[id^="vtt-"]',
    '[id^="lingogram-"]',
    '[class*="vtt-"]',
].join(',');

/** A word: letters/marks/digits, joined by an inner apostrophe or hyphen. */
const WORD = /[\p{L}\p{M}\p{N}]+(?:['’-][\p{L}\p{M}\p{N}]+)*/gu;

/** Text nodes handled per idle slice. */
const CHUNK = 200;
/** Quiet time before text added by the page is scanned. */
const MUTATION_DEBOUNCE_MS = 400;

interface Token {
    key: string;
    start: number;
    end: number;
}

/**
 * Every saved term found in `text`, as [start, end) offsets. A saved phrase
 * wins over the saved words inside it: the learner saved those words together,
 * and one mark across the phrase says so. Exported for tests.
 */
export function findSaved(
    text: string,
    has: (key: string) => boolean,
    phrasesByFirst: Map<string, string[][]>,
): Array<[number, number]> {
    const tokens: Token[] = [];
    for (const m of text.matchAll(WORD)) {
        const start = m.index ?? 0;
        tokens.push({ key: normalizeTerm(m[0]), start, end: start + m[0].length });
    }
    const out: Array<[number, number]> = [];
    for (let i = 0; i < tokens.length; i++) {
        let matched = 0;
        for (const words of phrasesByFirst.get(tokens[i].key) ?? []) {
            if (words.length <= matched || i + words.length > tokens.length) continue;
            let ok = true;
            for (let k = 1; k < words.length && ok; k++) {
                const prev = tokens[i + k - 1];
                const cur = tokens[i + k];
                // Only whitespace between the words: "run, away" is not "run away".
                ok = cur.key === words[k] && /^\s+$/.test(text.slice(prev.end, cur.start));
            }
            if (ok) matched = words.length;
        }
        if (matched > 0) {
            out.push([tokens[i].start, tokens[i + matched - 1].end]);
            i += matched - 1;
        } else if (has(tokens[i].key)) {
            out.push([tokens[i].start, tokens[i].end]);
        }
    }
    return out;
}

/** Saved multi-word terms, indexed by their first word. */
function indexPhrases(terms: Iterable<string>): Map<string, string[][]> {
    const byFirst = new Map<string, string[][]>();
    for (const term of terms) {
        const words = term.split(' ');
        if (words.length < 2) continue;
        const list = byFirst.get(words[0]);
        if (list) list.push(words);
        else byFirst.set(words[0], [words]);
    }
    return byFirst;
}

const idle: (cb: () => void) => void =
    typeof requestIdleCallback === 'function'
        ? (cb) => requestIdleCallback(cb, { timeout: 1000 })
        : (cb) => setTimeout(cb, 16);

/**
 * The painter for one document. Exported for tests; the content script only
 * calls installPageHighlight().
 */
export function createPageHighlighter(doc: Document = document) {
    const view = createSavedWords();
    let phrases = new Map<string, string[][]>();
    const highlight = new Highlight();
    const rangesOf = new Map<Text, Range[]>();
    const queue: Node[] = [];
    let draining = false;
    let running = false;
    let observer: MutationObserver | undefined;
    const pending = new Set<Node>();
    let debounce: ReturnType<typeof setTimeout> | undefined;

    const clearNode = (text: Text): void => {
        for (const r of rangesOf.get(text) ?? []) highlight.delete(r);
        rangesOf.delete(text);
    };

    const paintText = (text: Text): void => {
        clearNode(text);
        if (!text.isConnected) return;
        const data = text.data;
        if (data.trim().length < 2) return;
        const hits = findSaved(data, (k) => view.has(k), phrases);
        if (hits.length === 0) return;
        const ranges = hits.map(([start, end]) => {
            const r = doc.createRange();
            r.setStart(text, start);
            r.setEnd(text, end);
            highlight.add(r);
            return r;
        });
        rangesOf.set(text, ranges);
    };

    const accept = (node: Node): number => {
        if (node.nodeType === Node.ELEMENT_NODE) {
            return (node as Element).matches(SKIP_SELECTOR)
                ? NodeFilter.FILTER_REJECT
                : NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
    };

    /** Paint the text under `root`, in idle slices. */
    const scan = (root: Node): void => {
        if (root.nodeType === Node.TEXT_NODE) {
            const parent = (root as Text).parentElement;
            if (parent && !parent.closest(SKIP_SELECTOR)) queue.push(root);
        } else if (root.nodeType === Node.ELEMENT_NODE || root.nodeType === Node.DOCUMENT_NODE) {
            const el = root.nodeType === Node.DOCUMENT_NODE ? (root as Document).body : (root as Element);
            if (!el || el.closest(SKIP_SELECTOR)) return;
            const walker = doc.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: accept });
            for (let n = walker.nextNode(); n; n = walker.nextNode()) queue.push(n);
        }
        drain();
    };

    const drain = (): void => {
        if (draining) return;
        draining = true;
        const step = (): void => {
            if (!running) {
                queue.length = 0;
                draining = false;
                return;
            }
            for (let i = 0; i < CHUNK && queue.length > 0; i++) paintText(queue.shift() as Text);
            if (queue.length > 0) idle(step);
            else draining = false;
        };
        idle(step);
    };

    /** Drop every mark whose text has left the page. */
    const prune = (): void => {
        for (const text of [...rangesOf.keys()]) if (!text.isConnected) clearNode(text);
    };

    const flushMutations = (): void => {
        debounce = undefined;
        prune();
        for (const node of pending) if (node.isConnected) scan(node);
        pending.clear();
    };

    const observe = (): void => {
        if (observer) return;
        observer = new MutationObserver((records) => {
            for (const rec of records) {
                if (rec.type === 'characterData') pending.add(rec.target);
                else rec.addedNodes.forEach((n) => pending.add(n));
            }
            if (!debounce) debounce = setTimeout(flushMutations, MUTATION_DEBOUNCE_MS);
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

    /** Forget every mark and, if anything is saved, paint the page again. */
    const repaint = (): void => {
        highlight.clear();
        rangesOf.clear();
        queue.length = 0;
        if (!running || view.size === 0) {
            // Nothing to find: do not watch the page at all.
            stopObserving();
            return;
        }
        observe();
        scan(doc);
    };

    return {
        /** Replace the saved words (a mirror snapshot) and repaint. */
        setWords(words: Record<string, 'active' | 'removed'>): void {
            view.reset(words);
            phrases = indexPhrases(view.terms());
            repaint();
        },
        start(): void {
            if (running) return;
            running = true;
            CSS.highlights.set(HIGHLIGHT_NAME, highlight);
            repaint();
        },
        stop(): void {
            running = false;
            stopObserving();
            highlight.clear();
            rangesOf.clear();
            queue.length = 0;
            // The registry belongs to the page and is shared by both editions'
            // content scripts. Remove only our own entry: an edition that
            // stands down must not wipe the marks the other one is painting.
            if (CSS.highlights.get(HIGHLIGHT_NAME) === highlight) CSS.highlights.delete(HIGHLIGHT_NAME);
        },
        /** For tests: how many ranges are painted now. */
        get size(): number {
            return highlight.size;
        },
    };
}

/** True when this browser can paint highlights without touching the DOM. */
export function canHighlight(): boolean {
    return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight === 'function';
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
