// ── Retrying the mint once the ad that blocked it is over ───────────────────
// Extracted from page-script.ts's closure so the rules are unit testable — the
// same move pot.ts, in-flight-fetches.ts and late-token-rescue.ts made, for the
// same reason.
//
// Why this exists. doMintPotViaCcToggle refuses to click while an ad is on
// screen: the request the click would provoke is the AD's, signed for a
// different `v=`, so the flash costs the viewer captions on an ad they never
// asked about and teaches us nothing. The refusal deliberately leaves the video
// UNCLAIMED, with the comment saying an ad is "come back later".
//
// Nothing came back. Trace wjZofJX0v4M (2026-09-17): the mint bailed, the three
// tokenless attempts spent their budget, the verdict went to "no subtitles",
// and the pre-roll ended seconds afterwards with nobody watching — on a video
// offering 21 caption tracks. The late-token rescue cannot cover this case
// either: it waits to be TOLD a token was captured, and a token is captured
// only when the player is asked, which is exactly what the ad prevented.
//
// So the promise needs a keeper. One retry, fired by the player's own state
// change rather than a poll, bounded the same way every other retry here is:
// at most once, only while the video is still the one on screen, and nothing
// outliving a navigation.

/** What the runner needs from the page; injected so it can be tested. */
export interface AfterAdDeps {
    /** Is an ad on screen right now? */
    isAdPlaying: () => boolean;
    /** Run the mint again for this video. */
    mint: (videoId: string) => void;
    /**
     * Subscribe to "the player's state changed somehow". Returns unsubscribe.
     *
     * Deliberately coarse: the runner re-reads isAdPlaying() on every call and
     * acts only when the ad is actually gone, so the subscription may be as
     * noisy as the page makes it without changing the outcome.
     */
    watch: (fn: () => void) => () => void;
}

/** One video waiting for its ad to finish. */
export interface AfterAdRequest {
    videoId: string;
    /** Aborted on navigation: the wait must not outlive the video. */
    signal: AbortSignal;
}

/**
 * The mint that an ad refused, waiting for the ad to end.
 *
 * Bounded on every axis that could turn a retry into a loop:
 *  - one wait per video, so a second refused track does not stack a second
 *    watcher;
 *  - it fires at most ONCE — the watcher is detached before the mint, so a
 *    mint that fails again re-arms deliberately rather than by leftover state;
 *  - an abort (navigation) detaches it, so nothing survives its video;
 *  - a throwing mint detaches it too, rather than leaving a watcher bound to a
 *    player that has gone away.
 */
export class AfterAdMint {
    private waiting = new Map<string, () => void>();

    constructor(private readonly deps: AfterAdDeps) {}

    /** How many videos are currently waiting. Diagnostics and tests. */
    get size(): number {
        return this.waiting.size;
    }

    /**
     * Wait for the ad to end, then mint once for `videoId`.
     *
     * A no-op when this video is already waiting, or when the navigation that
     * owns it has already been abandoned.
     */
    arm({ videoId, signal }: AfterAdRequest): void {
        if (this.waiting.has(videoId)) return;
        if (signal.aborted) return;

        const stop = (): void => {
            this.waiting.delete(videoId);
            off();
            signal.removeEventListener('abort', stop);
        };

        const off = this.deps.watch(() => {
            if (signal.aborted) return stop();
            // Still an ad — the player changed for some other reason. Nothing
            // to do, and nothing to tear down: the next ad boundary is what
            // this wait exists for.
            if (this.deps.isAdPlaying()) return;
            // Detach FIRST: the mint can refuse again and arm a fresh wait, and
            // a watcher still attached here would then be a second one for this
            // video. It also means a throwing mint cannot leave one behind.
            stop();
            try {
                this.deps.mint(videoId);
            } catch {
                // The mint touches the live player, which can go away between
                // the ad ending and this call. Throwing from here would escape
                // into whatever observer drives `watch` — the player's own
                // state machine — and that must not be taken down by an
                // optimisation of ours failing.
            }
        });

        this.waiting.set(videoId, stop);
        signal.addEventListener('abort', stop, { once: true });
    }

    /** Drop every wait — used when the page moves to a different video. */
    clear(): void {
        for (const stop of [...this.waiting.values()]) stop();
        this.waiting.clear();
    }
}
