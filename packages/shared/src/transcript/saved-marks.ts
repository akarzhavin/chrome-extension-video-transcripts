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
