// ── Refetching a track when its token turns up late ─────────────────────────
// Extracted from page-script.ts's closure so the rules are unit testable — the
// same move pot.ts and in-flight-fetches.ts made, for the same reason.
//
// Why this exists. A timedtext request without a `pot` does not have poor odds,
// it has none: across four live traces, 158 tokenless requests returned
// subtitles 0 times. The token is obtained by briefly flashing the player's own
// captions on, and that routine gives up after POT_TOGGLE_TIMEOUT_MS.
//
// Measured, that budget is the problem. The failed mints all look like this:
//
//     4015ms, 4012ms, 0ms, 0ms
//
// Two tracks each burn the full budget; `SharedOnce.complete()` has claimed the
// video, so every later attempt returns instantly without clicking. And then:
//
//     t=272399  mint_done  present=false   <- we stopped listening
//     t=346201  sniffed    present=true    <- the token arrived anyway
//
// +73.8s in that session, +5.2s in another. The sessions where the token
// "never" arrived simply ended ~1.6s after we gave up. So the token is not
// unobtainable — nothing is watching by the time it lands.
//
// The fix is to be told rather than to poll: one refetch per track, triggered
// by a capture the page performs on its own. No request is spent unless a token
// actually shows up, which is what separates this from the retry burst that
// used to hammer a URL that could not answer.

/** What the rescue needs from the page; injected so it can be tested. */
export interface RescueDeps {
    /** Subscribe to "a token for this video was captured". Returns unsubscribe. */
    onToken: (fn: (videoId: string, pot: string) => void) => () => void;
    /** Re-run the fetch for one track. */
    refetch: (reqKey: string) => void;
    /** Diagnostics only. */
    onRescue?: (reqKey: string) => void;
}

/** One track waiting for a token. */
export interface RescueRequest {
    reqKey: string;
    videoId: string;
    /** Aborted on navigation: the wait must not outlive the video. */
    signal: AbortSignal;
}

/**
 * Tracks that failed for want of a token, waiting to be told one arrived.
 *
 * Bounded on every axis that could turn a rescue into a leak or a burst:
 *  - one listener per track, so a second failure for the same track does not
 *    stack a second subscription;
 *  - it fires at most ONCE — the listener is removed before the refetch, so a
 *    track that fails again re-arms deliberately rather than by leftover state;
 *  - a token for another video is ignored;
 *  - an abort (navigation) removes the listener, so nothing survives the video
 *    it belonged to.
 */
export class LateTokenRescue {
    private waiting = new Map<string, () => void>();

    constructor(private readonly deps: RescueDeps) {}

    /** How many tracks are currently waiting. Diagnostics and tests. */
    get size(): number {
        return this.waiting.size;
    }

    /**
     * Wait for a token for `videoId`, then refetch `reqKey` once.
     *
     * A no-op when this track is already waiting, or when the navigation that
     * owns it has already been abandoned.
     */
    arm({ reqKey, videoId, signal }: RescueRequest): void {
        if (this.waiting.has(reqKey)) return;
        if (signal.aborted) return;

        const stop = (): void => {
            this.waiting.delete(reqKey);
            off();
            signal.removeEventListener('abort', stop);
        };

        const off = this.deps.onToken((tokenVideoId) => {
            if (tokenVideoId !== videoId) return;
            if (signal.aborted) return stop();
            // Unsubscribe FIRST: the refetch can fail the same way and arm a
            // fresh rescue, and a listener still attached here would then be a
            // second one for this track.
            stop();
            this.deps.onRescue?.(reqKey);
            this.deps.refetch(reqKey);
        });

        this.waiting.set(reqKey, stop);
        signal.addEventListener('abort', stop, { once: true });
    }

    /** Drop every wait — used when the page moves to a different video. */
    clear(): void {
        for (const stop of [...this.waiting.values()]) stop();
        this.waiting.clear();
    }
}
