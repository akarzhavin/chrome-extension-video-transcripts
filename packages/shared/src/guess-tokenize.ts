// Split a subtitle line into maskable units. Space-delimited scripts split
// on whitespace; spaceless scripts (Chinese/Japanese/Thai) are segmented
// with Intl.Segmenter (word granularity), falling back to per-character —
// otherwise the whole line is one token and "guess mode" masks nothing.
//
// Shared by AppState (which counts tokens to decide how many are revealed) and
// SidebarUI (which renders one span per token). The two must agree: when they
// disagreed, a spaceless line counted as a single token, so isFullyRevealed was
// true from the start and reveal never advanced for CJK on either surface.

type Segmenter = { segment(s: string): Iterable<{ segment: string }> };

// Constructing a Segmenter is not free and this runs on every overlay repaint
// (~4×/sec via isFullyRevealed). It carries no state between segment() calls,
// so one instance for the module's lifetime is enough. `null` records that the
// runtime has none; `undefined` that we haven't looked yet.
let segmenter: Segmenter | null | undefined;

function getSegmenter(): Segmenter | null {
    if (segmenter !== undefined) return segmenter;
    const Seg = (Intl as unknown as {
        Segmenter?: new (l?: string, o?: { granularity: string }) => Segmenter;
    }).Segmenter;
    try {
        segmenter = Seg ? new Seg(undefined, { granularity: 'word' }) : null;
    } catch {
        segmenter = null;
    }
    return segmenter;
}

export function tokenizeForGuess(text: string): { tokens: string[]; sep: string } {
    const trimmed = text.trim();
    // Fast path: every space-delimited script leaves before touching Intl.
    if (/\s/.test(trimmed)) return { tokens: trimmed.split(/\s+/), sep: ' ' };

    const seg = getSegmenter();
    if (seg) {
        const toks = Array.from(seg.segment(trimmed), (s) => s.segment).filter((w) => w.trim().length);
        if (toks.length > 1) return { tokens: toks, sep: '' };
    }
    return { tokens: Array.from(trimmed), sep: '' };
}
