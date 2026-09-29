// Which words on screen the learner already owns.
//
// A caption line is read while it moves, and until now nothing in it answered
// "do I already have this word" — the answer existed, in the word mirror, but
// only a hover and a lookup card would show it. This module is that answer made
// ambient: a page-wide, synchronous view of the mirror plus the one DOM
// operation that paints it onto spans.
//
// SYNCHRONOUS IS THE WHOLE DESIGN. The render path runs inside updateOverlay,
// which fires on every timeupdate (~4×/sec) and rebuilds the line's children.
// It cannot await storage and it cannot await crypto.subtle, which is also why
// the view is keyed by `normalizeTerm` rather than by the digest the documents
// use — see the header of lookup/saved-words.ts, which reaches the same
// conclusion for the same reason.
//
// ONE VIEW, NOT A THIRD PRIVATE COPY. `lookup/strip.ts` and
// `lookup/word-screen.ts` each hold a SavedWords, and saved-words.ts exists
// precisely because those two used to be separate Sets that could disagree
// about the same word. A renderer with its own third copy would be that bug
// again, so this module owns one and the renderer asks it.
//
// It is a module-level singleton rather than an injected collaborator because
// SidebarUI must stay constructible without any lookup wiring at all: the embed
// builds the sidebar for the marketing site with no word-screen factory and no
// service worker (Constitution V). A required constructor argument would break
// that configuration; an import that degrades to "nothing is saved" does not.
import { createSavedWords, type SavedWords } from '../lookup/saved-words';
import { loadMirror, onMirrorChanged } from '../word-mirror';
import { normalizeTerm } from '../word-key';

/**
 * The class a saved word carries.
 *
 * Deliberately NOT `vtt-saved-word`, which is the promo path's decoration:
 * apps/youtube/src/content/index.ts paints it on an arbitrary long word during
 * screen captures, consulting nothing (deliberate-absences.test.ts signs why).
 * Collapsing the two would make a recording claim the recorder's account owns a
 * word it has never seen.
 */
export const SAVED_MARK_CLASS = 'vtt-saved-mark';

/** Spans eligible for the mark: a word that is on screen and readable. */
const WORD_SELECTOR = 'span[data-word]';

/**
 * A saved PHRASE: one unbroken line under all of its words.
 *
 * Not the word's short bar repeated. Three bars under three words read as
 * three words, which is exactly what a phrase is not — the learner saved the
 * words together, and the line says so. Drawn per span (each one reaching
 * across the space to its right), because the words are separate elements
 * and a phrase may wrap onto the next line or into the next cue.
 */
export const SAVED_RUN_CLASS = 'vtt-saved-run';
/** The last word of a run on its line: its line stops at the word's edge. */
export const SAVED_RUN_END_CLASS = 'vtt-saved-run-end';

/** Where a phrase can be read: the line itself, never its translation. */
const LINE_SCOPE = '.vtt-main-text, .vtt-overlay-main';
/**
 * Every token a line renders, in order. A masked capsule and a filler token
 * are in the stream so they BREAK a run: a phrase whose middle word is still
 * hidden is not on screen, and marking its ends would give the word away.
 */
const TOKEN_SELECTOR = 'span[data-word], span[data-hidden], span.vtt-guess-filler';

const view: SavedWords = createSavedWords();
const subscribers = new Set<() => void>();

/** How many live callers hold the mirror subscription. See startSavedMarks. */
let holders = 0;
let unsubscribeMirror: (() => void) | undefined;

/** Whether this term is in the learner's dictionary right now. */
export function isSaved(term: string): boolean {
    return view.has(term);
}

/**
 * Paint the mark across every word span under `container`.
 *
 * Idempotent, and a full re-decide rather than an add-only pass: a word whose
 * entry was just removed has to LOSE the class here, which is what makes this
 * safe to call from a mirror-change repaint as well as from a fresh build.
 *
 * Masked guess-mode words are skipped for free — `makeMaskedSpan` parks the
 * real word in `data-hidden` and leaves `data-word` off until it is revealed,
 * so the selector above cannot see them. That is deliberate: marking a capsule
 * would tell the learner "you have studied this one", which narrows the guess
 * the mode exists to pose.
 */
export function markSavedIn(container: HTMLElement): void {
    container.querySelectorAll<HTMLElement>(WORD_SELECTOR).forEach((span) => {
        const term = span.dataset.word ?? '';
        span.classList.toggle(SAVED_MARK_CLASS, term !== '' && view.has(term));
    });
    markSavedPhrasesIn(container);
}

/** A saved phrase as it stands on screen: its term and the words drawing it. */
export interface SavedPhraseRun {
    term: string;
    spans: HTMLElement[];
}

/**
 * Which run each marked word belongs to, so a pointer on any one word can be
 * answered with the whole phrase. Written by markSavedPhrasesIn alongside the
 * classes and cleared with them; weak, so a line torn down takes its entries.
 */
const runOf = new WeakMap<HTMLElement, SavedPhraseRun>();

/**
 * The saved phrase this word is drawn as part of, or null. Pointing at a word
 * of a saved phrase is asking about the phrase — the learner saved the words
 * together, and a card for one of them answers a question nobody asked.
 */
export function savedPhraseAt(span: HTMLElement): SavedPhraseRun | null {
    if (!span.classList.contains(SAVED_RUN_CLASS)) return null;
    const run = runOf.get(span);
    return run && run.spans.every((s) => s.isConnected) ? run : null;
}

interface Token {
    span: HTMLElement;
    /** Normalized word, or null for a token no phrase may pass through. */
    word: string | null;
    /** Which line it sits on, counted within the painted container. */
    line: number;
}

/** Saved multi-word terms, indexed by their first word. */
function savedPhrases(): Map<string, string[][]> {
    const byFirst = new Map<string, string[][]>();
    for (const term of view.terms()) {
        const words = term.split(' ');
        if (words.length < 2) continue;
        const list = byFirst.get(words[0]);
        if (list) list.push(words);
        else byFirst.set(words[0], [words]);
    }
    return byFirst;
}

/**
 * Draw the unbroken line under every saved phrase on screen in `container`.
 *
 * A full re-decide, like markSavedIn: a phrase just removed loses its line.
 * A phrase may run from one line into the next — the selection that saves it
 * accepts two adjacent cues — but no further.
 */
export function markSavedPhrasesIn(container: HTMLElement): void {
    container.querySelectorAll<HTMLElement>(`.${SAVED_RUN_CLASS}`).forEach((s) => {
        s.classList.remove(SAVED_RUN_CLASS, SAVED_RUN_END_CLASS);
        runOf.delete(s);
    });
    const phrases = savedPhrases();
    if (phrases.size === 0) return;

    const lines = container.matches(LINE_SCOPE)
        ? [container]
        : Array.from(container.querySelectorAll<HTMLElement>(LINE_SCOPE));
    const stream: Token[] = [];
    lines.forEach((lineEl, line) => {
        lineEl.querySelectorAll<HTMLElement>(TOKEN_SELECTOR).forEach((span) => {
            const raw = span.dataset.word;
            stream.push({ span, word: raw === undefined ? null : normalizeTerm(raw), line });
        });
    });

    stream.forEach((token, i) => {
        if (!token.word) return;
        for (const words of phrases.get(token.word) ?? []) {
            const run = stream.slice(i, i + words.length);
            if (run.length !== words.length) continue;
            if (!run.every((t, k) => t.word === words[k])) continue;
            if (run[run.length - 1].line - token.line > 1) continue;
            const entry: SavedPhraseRun = { term: words.join(' '), spans: run.map((t) => t.span) };
            run.forEach((t, k) => {
                // The longest phrase a word belongs to answers for it: a
                // saved "track down" inside a saved "to track down" is the
                // smaller claim.
                const prior = runOf.get(t.span);
                if (!prior || prior.spans.length < entry.spans.length) runOf.set(t.span, entry);
                t.span.classList.add(SAVED_RUN_CLASS);
                const next = run[k + 1];
                if (!next || next.line !== t.line) t.span.classList.add(SAVED_RUN_END_CLASS);
            });
        }
    });
}

/**
 * Apply the mark to a single span the caller has just built or revealed.
 *
 * Separate from `markSavedIn` because the builders decide per word as they go,
 * and re-querying the container after each one would be quadratic on a long
 * line.
 */
export function markSavedSpan(span: HTMLElement, term: string): void {
    span.classList.toggle(SAVED_MARK_CLASS, term !== '' && view.has(term));
}

/**
 * Run `cb` whenever the set of saved words changes — a save or a removal, in
 * this tab or another. Returns an unsubscribe.
 *
 * The callback repaints lines that are ALREADY on screen. A rebuild would also
 * pick the change up, but the overlay only rebuilds when its content signature
 * changes, and "which words are saved" is not in that signature (nor should it
 * be: putting it there would rebuild the line under an open lookup card).
 */
export function onSavedWordsChanged(cb: () => void): () => void {
    subscribers.add(cb);
    return () => {
        subscribers.delete(cb);
    };
}

/**
 * Seed the view from the mirror and keep it in step.
 *
 * Safe to call more than once: content scripts construct more than one surface,
 * and each may reasonably ask for the marks to be live. Each call takes a hold
 * and returns a disposer that releases exactly that one; tracking stops when
 * the last hold goes. The seeded answers stay readable afterwards, which is
 * what a disposed sidebar rendering one last frame needs.
 *
 * Both halves degrade on a page with no extension storage: `loadMirror`
 * resolves to an empty mirror and `onMirrorChanged` returns a no-op, so the
 * embed renders every word unmarked instead of throwing.
 */
export function startSavedMarks(): () => void {
    // Counted, not a boolean.
    //
    // The boolean handed every caller after the first a no-op disposer while
    // the FIRST caller's disposer tore the shared subscription down for
    // everybody. A SidebarUI remount does exactly that — the replacement
    // starts, then the outgoing instance disposes — so the live sidebar was
    // left with marks that never updated again. Silent, too: the seeded
    // answers stay correct until the first save, and then the heart simply
    // does not fill.
    //
    // A count makes the subscription live exactly as long as someone holds it.
    holders++;

    if (holders === 1) {
        void loadMirror().then((m) => {
            view.reset(m.words);
            notify();
        });

        unsubscribeMirror = onMirrorChanged((m) => {
            view.reset(m.words);
            notify();
        });
    }

    // Idempotent per caller: a disposer called twice must not release a hold it
    // does not have, or one careless caller would unsubscribe another's.
    let released = false;
    return () => {
        if (released) return;
        released = true;
        holders--;
        if (holders > 0) return;
        unsubscribeMirror?.();
        unsubscribeMirror = undefined;
    };
}

function notify(): void {
    // A copy, so a subscriber that unsubscribes itself inside its own callback
    // cannot mutate the set mid-iteration.
    for (const cb of [...subscribers]) cb();
}

/**
 * Test-only reset of the module's singleton state.
 *
 * A module-level singleton is the right shape in a content script, which is
 * built once and torn down with its page; it is the wrong shape for a test file
 * that wants a dozen independent worlds. Exported under a name no production
 * caller would reach for.
 */
export function __resetSavedMarksForTest(): void {
    unsubscribeMirror?.();
    unsubscribeMirror = undefined;
    holders = 0;
    subscribers.clear();
    view.reset({});
}
