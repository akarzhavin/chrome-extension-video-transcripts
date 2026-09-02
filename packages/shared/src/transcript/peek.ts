// The peek: turning a masked capsule over to show the word under it.
//
// Extracted from SidebarUI because it is a self-contained machine with its own
// state — a currently-peeked span and two maps of pending timers, keyed by span
// rather than shared, because sliding the cursor between capsules opens one and
// closes another in the same breath. Everything it needs from the sidebar is
// one question: whether guess mode is on.
//
// The timers are the reason this stayed until last: they outlive the DOM they
// animate. Note that destroy() does NOT clear them — it never did, and this
// extraction deliberately changes nothing about that. The timers are cleared
// only through dropPeek(), and every callback re-checks span.isConnected and
// the capsule's class before touching anything, which is what keeps a pending
// flip harmless once its span is detached. Left exactly as found; making
// teardown drive cancelAllFlips() would be a behaviour change, and belongs in
// its own commit if it is wanted.

/**
 * Two halves of 180ms. The stylesheet's `transition: width 0.36s` on
 * .vtt-masked-word is this doubled — the pane eases across the whole turn while
 * the face rotates in halves — so the two must move together.
 */
const PEEK_FLIP_MS = 180;

// Honouring the OS setting: the stylesheet already drops the rotation, but the
// timer below is JS. Left running, it gave reduced-motion users a dead zone
// with no feedback at all — worse than the animation they turned off.
function prefersReducedMotion(): boolean {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
}

/** What the peek needs from the sidebar hosting it. */
export interface PeekHost {
    /** Peeking is a guess-mode affordance; outside it the capsules are plain. */
    isGuessMode(): boolean;
}

export class PeekController {
    constructor(private readonly host: PeekHost) {}

    // The masked word the cursor is currently holding open. Guess mode trades
    // on the tension of not knowing, but a hidden word you cannot glance at is
    // a wall rather than a puzzle: hovering lifts the pane for exactly as long
    // as the cursor stays on it, then drops it back. Nothing about the reveal
    // state changes — a peek is looking, not answering, so the word is masked
    // again the moment the cursor leaves and the line is still unsolved.
    private peekedSpan: HTMLSpanElement | null = null;

    // The peek turns the capsule over on its horizontal axis: frosted pane on
    // the front, the word on the back. Done as ONE face rotating rather than
    // two stacked ones: the text is swapped at the halfway point, where the
    // face is edge on to the viewer and a hundred percent invisible, so the
    // swap lands in the one frame nobody can see. That is what the timer below
    // is for, and why it must stay in step with the CSS duration.
    //
    // Both sides now measure the same — the mask holds the real word (see
    // maskGlyphs) — so the swap is a repaint of identical geometry. It was not
    // always so: the filler used to be half the word's length, and hiding that
    // width change is the reason the halfway swap exists at all.
    //
    // What rotates is an INNER layer, never the span itself. Rotating the span
    // turned it into an endless flip loop: at 90deg the box leaves the cursor's
    // hit area, Chrome fires mouseout, the capsule flops back under the cursor,
    // mouseover fires again — measured with a dead-still mouse, OVER/OUT
    // repeating forever and the word never once showing. The span stays flat
    // and keeps the hit area; only its contents turn.
    // Two halves of 180ms. The stylesheet's `transition: width 0.36s` on
    // .vtt-masked-word is this doubled — the pane eases across the whole turn
    // while the face rotates in halves — so the two must move together.
    // Keyed by span, NOT one shared timer: sliding the cursor from one capsule
    // to the next closes the first and opens the second in the same breath, and
    // a single timer meant the opening cancelled the closing — the word left
    // behind stayed face-up and mid-flip forever.
    private peekFlips = new Map<HTMLSpanElement, ReturnType<typeof setTimeout>>();

    // The rotating layer, added for the length of a peek and unwrapped once the
    // capsule is frosted and flat again. Absent at rest so a masked span in its
    // resting state is exactly the markup everything else expects — and
    // span.textContent still reads through it either way.
    private faceOf(span: HTMLSpanElement): HTMLElement {
        const existing = span.firstElementChild as HTMLElement | null;
        if (existing?.classList.contains('vtt-peek-face')) return existing;
        const face = document.createElement('span');
        face.className = 'vtt-peek-face';
        face.textContent = span.textContent ?? '';
        span.textContent = '';
        span.appendChild(face);
        return face;
    }

    // Drop the layer, folding its text back into the span. Called where the
    // span's plain form matters — a reveal is about to rewrite it — rather than
    // on a timer chasing the end of the closing turn.
    private unwrapFace(span: HTMLSpanElement): void {
        const face = span.firstElementChild as HTMLElement | null;
        if (face?.classList.contains('vtt-peek-face')) span.textContent = face.textContent;
    }

    // Turn a capsule over. `word` is the text the far side carries: the real
    // word when opening, the filler when closing.
    private flipSpan(span: HTMLSpanElement, word: string, peeked: boolean): void {
        this.cancelFlip(span);

        // Asked for less motion: swap now, no turn, no wait. The stylesheet
        // already drops the rotation, but the 180ms timer is JS — left in, it
        // gave reduced-motion users a dead zone with no feedback at all, which
        // is worse than the animation they turned off.
        if (prefersReducedMotion()) {
            span.classList.remove('vtt-flipping');
            if (!span.isConnected || !span.classList.contains('vtt-masked-word')) return;
            this.faceOf(span).textContent = word;
            span.classList.toggle('vtt-peeked-word', peeked);
            span.style.removeProperty('width');
            if (!peeked) this.unwrapFace(span);
            return;
        }

        // Carry the pane's width across the turn. With the mask holding the
        // real word this measures from and to the same number and animates
        // nothing — kept as the safety net for any font where the transparent
        // and painted states do not measure alike, so such a gap eases across
        // the full 2×PEEK_FLIP_MS instead of jumping in the frame of the swap.
        // That jump is what this was written for, back when the filler was half
        // the word's length.
        this.setFlipWidth(span, word);

        // First half: rotate the face we are leaving out of sight.
        // The face may have just been created, in which case flat is its very
        // first computed style and the browser has nothing to transition FROM —
        // it snapped straight to 90deg and sat there for the whole first half,
        // so the turn had no opening move at all, just a pause and a return.
        // Flushing layout commits the flat pose as the start state.
        const face = this.faceOf(span);
        void face.offsetWidth;
        span.classList.add('vtt-flipping');
        const timer = setTimeout(() => {
            this.peekFlips.delete(span);
            // Edge on to the viewer — swap the content and let the second half
            // of the turn bring the new face round. A span that stopped being
            // masked mid-flip (revealed, or repainted) is left alone: its text
            // is no longer ours to write.
            if (!span.isConnected || !span.classList.contains('vtt-masked-word')) {
                span.classList.remove('vtt-flipping');
                span.style.removeProperty('width');
                return;
            }
            this.faceOf(span).textContent = word;
            span.classList.toggle('vtt-peeked-word', peeked);
            span.classList.remove('vtt-flipping');
            // Hand the width back to the content once the turn is over: a
            // pinned px width would survive into the next repaint and fight
            // whatever text lands in the span then. Same moment the closing
            // turn earns its unwrap — the capsule is frosted and flat again, so
            // the rotating layer has nothing left to do and a span at rest is
            // once more exactly the markup the rest of the code expects.
            const release = setTimeout(() => {
                this.peekWidthReleases.delete(span);
                span.style.removeProperty('width');
                if (!peeked) this.unwrapFace(span);
            }, PEEK_FLIP_MS);
            this.peekWidthReleases.set(span, release);
        }, PEEK_FLIP_MS);
        this.peekFlips.set(span, timer);
    }

    // Measure what the far side will need and start the pane moving there.
    // Measured off a detached clone rather than by writing the word into the
    // live span: the span is on screen mid-turn, and a one-frame flash of the
    // real word inside a capsule that has not opened yet would give away the
    // very thing being hidden.
    private setFlipWidth(span: HTMLSpanElement, word: string): void {
        const from = span.getBoundingClientRect().width;
        // jsdom has no layout, so every box measures 0. Nothing to animate.
        if (!from) return;
        const probe = span.cloneNode(false) as HTMLSpanElement;
        probe.textContent = word;
        probe.style.position = 'absolute';
        probe.style.visibility = 'hidden';
        probe.style.width = 'auto';
        probe.style.left = '-9999px';
        span.parentElement?.appendChild(probe);
        const to = probe.getBoundingClientRect().width;
        probe.remove();
        if (!to) return;
        span.style.width = `${from}px`;
        // Force the pinned width to take before the target overwrites it,
        // otherwise the browser coalesces both into one style and never
        // transitions.
        void span.offsetWidth;
        span.style.width = `${to}px`;
    }

    // Width releases are tracked so a repaint can drop a pinned px width that
    // would otherwise outlive the span's turn.
    private peekWidthReleases = new Map<HTMLSpanElement, ReturnType<typeof setTimeout>>();

    // Read fresh each time rather than cached: the OS setting can change while
    // the page is open, and a peek is cheap enough to ask on.

    cancelFlip(span: HTMLSpanElement): void {
        const release = this.peekWidthReleases.get(span);
        if (release !== undefined) {
            clearTimeout(release);
            this.peekWidthReleases.delete(span);
        }
        const timer = this.peekFlips.get(span);
        if (timer === undefined) return;
        clearTimeout(timer);
        this.peekFlips.delete(span);
    }

    cancelAllFlips(): void {
        this.peekFlips.forEach((timer) => clearTimeout(timer));
        this.peekFlips.clear();
        this.peekWidthReleases.forEach((timer, span) => {
            clearTimeout(timer);
            span.style.removeProperty('width');
        });
        this.peekWidthReleases.clear();
    }

    // Let go of the peek without touching the span — for the paths where the
    // spans are going away (or already gone from view) and so must not be
    // written to. peekOff is the opposite: it closes the capsule on screen.
    dropPeek(): void {
        this.peekedSpan = null;
        this.cancelAllFlips();
    }

    peekOn(span: HTMLSpanElement): void {
        if (this.peekedSpan === span) return;
        this.peekOff();
        const word = span.dataset.hidden;
        if (!word) return;
        // data-word stays absent: quick-add's contract is that only words the
        // user has actually revealed can be saved, and a peek does not reveal.
        this.peekedSpan = span;
        this.flipSpan(span, word, true);
    }

    peekOff(): void {
        const span = this.peekedSpan;
        this.peekedSpan = null;
        if (!span) return;
        // Only put the filler back if this span is still masked. A reveal (or
        // a repaint that promoted it) already owns its text, and restoring the
        // mask here would cover a word that is now legitimately out.
        if (!span.classList.contains('vtt-masked-word')) {
            this.cancelFlip(span);
            span.classList.remove('vtt-flipping', 'vtt-peeked-word');
            span.style.removeProperty('width');
            this.unwrapFace(span);
            return;
        }
        this.flipSpan(span, span.dataset.mask ?? '', false);
    }

    // Delegated hover for the peek. The overlay only: peeking is for the line
    // you are watching, and the sidebar is a transcript you scroll — sweeping
    // the cursor down it would flip capsules the whole way.
    // Attached to the container rather than each span because the overlay
    // rebuilds its children ~4x/sec and per-span listeners would die with them.
    // mouseover / mouseout (not mouseenter/leave) so the events bubble up.
    attachPeek(container: HTMLElement): void {
        container.addEventListener('mouseover', (e) => {
            if (!this.host.isGuessMode()) return;
            const span = (e.target as Element | null)?.closest?.('.vtt-masked-word');
            if (!span) return;
            this.peekOn(span as HTMLSpanElement);
        });
        container.addEventListener('mouseout', (e) => {
            const span = (e.target as Element | null)?.closest?.('.vtt-masked-word');
            if (!span || span !== this.peekedSpan) return;
            // Ignore moves that stay inside the same capsule.
            const to = (e as MouseEvent).relatedTarget as Node | null;
            if (to && span.contains(to)) return;
            this.peekOff();
        });
    }
}
